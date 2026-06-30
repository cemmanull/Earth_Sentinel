# Skill: Tratamento de Erros

Referência por camada para o padrão de erros da plataforma Earth Sentinel.

## Princípio Geral

Cada camada trata o que pode e propaga o que não pode. Providers individuais falham
de forma isolada — uma fonte offline não derruba as demais, nem o app.

---

## Por Camada

### Camada 1: Go — Provider (`Source.Fetch`)

O provider propaga erros de I/O. Nunca os silencia.
Funções de normalização retornam `error` para itens inválidos — não `panic`.

```go
func (s *USGSSource) Fetch(ctx context.Context) ([]domain.ContentItem, error) {
    resp, err := s.client.Do(req)
    if err != nil {
        return nil, fmt.Errorf("usgs: http: %w", err)  // propagar
    }
    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("usgs: HTTP %d", resp.StatusCode)  // propagar
    }
    // ...
    items := make([]domain.ContentItem, 0, len(raw.Features))
    for _, f := range raw.Features {
        item, err := FeatureToItem(f)
        if err != nil {
            continue   // item individual inválido → pular, não interromper o lote
        }
        items = append(items, item)
    }
    return items, nil
}
```

**Por que `continue` e não `return nil, err`?** Um registro mal-formado é local e
recuperável. Erro de rede é global — o scheduler deve saber que a fonte falhou.

---

### Camada 2: Go — Scheduler (Ingestor)

O scheduler captura erros de cada provider. Um provider com falha não impede os demais.

```go
func (s *Scheduler) run(ctx context.Context, src domain.Source) {
    items, err := src.Fetch(ctx)
    if err != nil {
        slog.Warn("ingest failed",
            "source", src.ID(),
            "error",  err,
        )
        return   // fonte falhou — continua no próximo tick
    }
    if err := s.store.UpsertItems(ctx, items); err != nil {
        slog.Error("store failed", "source", src.ID(), "error", err)
    }
}
```

**Nunca `slog.Error` para falha de provider externo** — são esperadas (APIs offline).
`slog.Error` é reservado para falhas do próprio sistema (banco, cache).

---

### Camada 3: Go — Handler HTTP

Retornar status HTTP semântico com JSON `{ "error": "mensagem" }`.
Nunca deixar panic subir (middleware `recover` captura, mas não é desculpa para omitir).

```go
func (h *FeedHandler) GetFeed(w http.ResponseWriter, r *http.Request) {
    themeID := chi.URLParam(r, "themeID")

    items, err := h.store.QueryByTheme(r.Context(), themeID)
    if err != nil {
        slog.Error("query failed", "theme", themeID, "error", err)
        http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
        return
    }

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(items)
}
```

**Códigos de status:**

| Status | Quando usar |
|--------|-------------|
| 200 | Sucesso |
| 400 | Parâmetro inválido (themeID desconhecido, lat/lng fora de bounds) |
| 404 | Recurso não encontrado |
| 500 | Erro interno do sistema (banco, cache) |
| 502 | Upstream (provider externo) falhou no proxy |
| 504 | Timeout no upstream |

---

### Camada 4: Node.js — Proxy (`server.js`)

O Node.js atua como proxy thin. Propaga erros do Go backend com status adequado.

```javascript
app.get('/api/*', async (req, res) => {
  try {
    const upstream = await fetch(GO_BACKEND + req.path, {
      signal: AbortSignal.timeout(15_000),
    })
    res.status(upstream.status)
    res.set('Content-Type', 'application/json')
    res.send(await upstream.text())
  } catch (err) {
    const status = err.name === 'AbortError' ? 504 : 502
    res.status(status).json({ error: err.message })
  }
})
```

**Validar parâmetros antes de passar upstream:**

```javascript
// ✅ Validar lat/lng — prevenir injeção de parâmetros
const lat = parseFloat(req.query.lat)
if (isNaN(lat) || lat < -90 || lat > 90) {
  return res.status(400).json({ error: 'lat inválido' })
}
```

---

### Camada 5: Frontend — Web Component

Falha de feed = aviso no console. Nunca lançar exceção que derrube o componente.

```javascript
async _loadFeed() {
  try {
    const items = await this.apiClient.getThemeFeed(this._themeID)
    this._update(items)
  } catch (err) {
    console.warn(`[${this._themeID}] feed indisponível:`, err.message)
    this._renderEmpty()   // estado vazio — sem crash
  }
  this._timer = setInterval(() => this._loadFeed(), 10 * 60 * 1000)
}
```

---

### Camada 6: Frontend — `map.js` / `globe.js`

Erros de rendering nunca propagam — o loop `requestAnimationFrame` não pode lançar.

```javascript
// Em WorldMap._draw():
try {
  this._drawTileLayers(ctx)
} catch (err) {
  console.warn('[WorldMap] erro ao renderizar tiles:', err.message)
  // não propagar — próximo frame tenta novamente
}

// Tile com erro: null no cache para não retentar na sessão
this._tileCache.set(key, null)
```

---

## Timeouts

```go
// Go — sempre usar context com timeout
ctx, cancel := context.WithTimeout(parentCtx, 15*time.Second)
defer cancel()
req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)

// Timeouts por tipo de API
// APIs leves (alertas pontuais):     10s
// APIs de batch (55 pontos grid):    15s
// APIs com rate limit:               20s
```

```javascript
// Node.js — proxy para Go backend
{ signal: AbortSignal.timeout(15_000) }
```

---

## Logging — o que logar e quando

| Situação | Nível | Camada |
|---|---|---|
| Provider ingeriu com sucesso | `slog.Info` | Go scheduler |
| Provider falhou (rede, HTTP) | `slog.Warn` | Go scheduler |
| Falha do banco ou cache | `slog.Error` | Go handler |
| Feed indisponível no browser | `console.warn` | Web Component |
| Erro de rendering no mapa | `console.warn` | `map.js` |
| Erro crítico de boot | `console.error` | `app.js` |

---

## Anti-Padrões

```go
// ❌ Engolir erro silenciosamente
items, _ := src.Fetch(ctx)

// ❌ panic em vez de error
if r.ID == "" { panic("missing id") }

// ✅ Retornar erro
if r.ID == "" { return domain.ContentItem{}, fmt.Errorf("usgs: missing id") }
```

```javascript
// ❌ Lançar no Web Component sem capturar
async _loadFeed() {
  const items = await this.apiClient.getThemeFeed(...)  // se falhar → componente quebra
}

// ❌ Fetch sem timeout
const res = await fetch(url)   // pode bloquear indefinidamente

// ✅ Sempre com timeout e catch
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
} catch (err) {
  console.warn('[fonte] falhou:', err.message)
}
```

---

## Checklist para Novo Provider

- [ ] `Fetch()` propaga erro de rede e HTTP
- [ ] Normalização retorna `(ContentItem, error)` — sem panic
- [ ] Items inválidos ignorados com `continue`, não interrompem o lote
- [ ] Scheduler loga `slog.Warn` ao capturar erro do provider
- [ ] Timeout configurado no `http.Client` do provider
- [ ] Handler HTTP retorna JSON com `{ "error": "..." }` em falhas

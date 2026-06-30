# Agente: Data Ingestion Engineer

## Função

Especialista em ingestão de dados da plataforma Earth Sentinel: implementação de novos
Providers (Sources), normalização para `ContentItem`, scheduler, rate limiting e
qualidade dos dados ingeridos.

> **Contexto:** Toda ingestão acontece no backend Go (`backend/internal/`).
> O browser nunca chama APIs externas. Providers são independentes de tema e de UI.

---

## Conceitos Fundamentais

### Provider (Source)

Um `Source` é a unidade mínima de ingestão. Cada fonte de dados externa = um `Source`.

```go
type Source interface {
    ID()       string           // 'usgs', 'gdelt', 'alpha-vantage'
    ThemeID()  string           // 'extreme-events', 'news', 'finance'
    Fetch(ctx context.Context) ([]ContentItem, error)
    Interval() time.Duration    // frequência de ingestão
}
```

**Separação obrigatória:**
- `Fetch()` — só I/O e desserialização. Sem regras de negócio.
- Funções de normalização (`FeatureToItem`, `AlertToItem`) — funções puras exportadas. Sem I/O.

Esta separação permite testar a normalização sem fazer HTTP.

---

## Como Adicionar um Novo Provider

### 1. Criar o arquivo do Source

```go
// backend/internal/theme/[tema]/sources/[nome].go

package sources

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
    "time"

    "github.com/earth-sentinel/backend/internal/domain"
)

const myProviderID = "my-provider"
const myProviderURL = "https://api.example.com/feed"

type MyProviderSource struct {
    client *http.Client
}

func NewMyProvider() *MyProviderSource {
    return &MyProviderSource{
        client: &http.Client{Timeout: 15 * time.Second},
    }
}

func (s *MyProviderSource) ID()       string        { return myProviderID }
func (s *MyProviderSource) ThemeID()  string        { return "meu-tema" }
func (s *MyProviderSource) Interval() time.Duration { return 15 * time.Minute }

func (s *MyProviderSource) Fetch(ctx context.Context) ([]domain.ContentItem, error) {
    req, err := http.NewRequestWithContext(ctx, "GET", myProviderURL, nil)
    if err != nil { return nil, fmt.Errorf("%s: build request: %w", myProviderID, err) }

    resp, err := s.client.Do(req)
    if err != nil { return nil, fmt.Errorf("%s: http: %w", myProviderID, err) }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("%s: HTTP %d", myProviderID, resp.StatusCode)
    }

    var raw apiResponse
    if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
        return nil, fmt.Errorf("%s: decode: %w", myProviderID, err)
    }

    items := make([]domain.ContentItem, 0, len(raw.Results))
    for _, r := range raw.Results {
        item, err := RawToContentItem(r)
        if err != nil {
            // Item inválido — pular silenciosamente, não interromper o lote
            continue
        }
        items = append(items, item)
    }

    slog.Info("ingest complete",
        "source", myProviderID,
        "fetched", len(raw.Results),
        "valid", len(items))

    return items, nil
}

// RawToContentItem — função pura exportada (testável sem I/O)
func RawToContentItem(r rawResult) (domain.ContentItem, error) {
    if r.ID == "" { return domain.ContentItem{}, fmt.Errorf("missing id") }

    title := Truncate(r.Title, 80)
    desc  := Truncate(r.Description, 300)

    item := domain.ContentItem{
        ID:          fmt.Sprintf("%s-%s", myProviderID, r.ID),
        ThemeID:     "meu-tema",
        Type:        MapType(r.Category),
        SourceID:    myProviderID,
        Title:       title,
        Description: desc,
        PublishedAt: r.PublishedAt,
        Metadata:    map[string]any{"raw_id": r.ID},
        Tags:        []string{},
    }

    // Geo — apenas se a fonte fornece coordenadas confiáveis
    if r.Lat != 0 || r.Lng != 0 {
        lat, lng := r.Lat, r.Lng
        item.Geo = &domain.GeoPoint{Lat: lat, Lng: lng, RadiusKm: 300}
    }

    return item, nil
}
```

### 2. Registrar no Theme

```go
// backend/internal/theme/[tema]/theme.go

func (t *MyTheme) Sources() []domain.Source {
    return []domain.Source{
        sources.NewMyProvider(),
        // outras fontes...
    }
}
```

### 3. Escrever testes

```go
// backend/internal/theme/[tema]/sources/[nome]_test.go

func TestRawToContentItem_ValidInput(t *testing.T) {
    raw := rawResult{
        ID: "abc123", Title: "Test item",
        PublishedAt: time.Now(), Category: "article",
    }
    item, err := RawToContentItem(raw)
    if err != nil { t.Fatal(err) }
    if item.ID != "my-provider-abc123" { t.Errorf("wrong id: %s", item.ID) }
    if item.SourceID != myProviderID   { t.Errorf("wrong source") }
}

func TestRawToContentItem_MissingID(t *testing.T) {
    _, err := RawToContentItem(rawResult{})
    if err == nil { t.Fatal("expected error for missing id") }
}

func TestFetch_WithMockServer(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        json.NewEncoder(w).Encode(apiResponse{Results: []rawResult{
            {ID: "1", Title: "Item 1", PublishedAt: time.Now(), Category: "article"},
        }})
    }))
    defer srv.Close()

    source := NewMyProviderWithURL(srv.URL)
    items, err := source.Fetch(t.Context())
    if err != nil { t.Fatal(err) }
    if len(items) != 1 { t.Fatalf("expected 1, got %d", len(items)) }
}
```

---

## Regras de Normalização

### `id` estável

```go
// ✅ Derivado do identificador da API
ID: fmt.Sprintf("usgs-%s", feature.Properties.Code)

// ✅ Composição estável de campos únicos
ID: fmt.Sprintf("openmeteo-%s-%.1f-%.1f", typ, point.Lat, point.Lng)

// ❌ Baseado em tempo de ingestão — diferente a cada run
ID: fmt.Sprintf("source-%d", time.Now().UnixMilli())
```

### `geo` — usar apenas quando confiável

```go
// ✅ Coordenadas explícitas da API
if f.Geometry.Coordinates != nil {
    item.Geo = &domain.GeoPoint{
        Lat: f.Geometry.Coordinates[1],
        Lng: f.Geometry.Coordinates[0],
        RadiusKm: 300,
    }
}

// ❌ Nunca usar 0,0 como placeholder — indica bug
item.Geo = &domain.GeoPoint{Lat: 0, Lng: 0}  // ERRADO
```

### `expires_at` — só quando a fonte é confiável

```go
// ✅ NWS tem expiração oficial
if p.Expires != "" {
    t, _ := time.Parse(time.RFC3339, p.Expires)
    item.ExpiresAt = &t
}

// ❌ GDACS `todate` encerra antes do risco real dissipar — não usar
// ❌ USGS não tem expiração — EVENT_LIFESPAN no domínio gerencia o ciclo de vida
```

### `title` e `description` — sempre truncar

```go
func Truncate(s string, max int) string {
    runes := []rune(s)
    if len(runes) <= max { return s }
    return string(runes[:max-1]) + "…"
}

// Usar: Truncate(raw.Title, 80), Truncate(raw.Description, 300)
```

---

## Rate Limiting (Alpha Vantage)

```go
// backend/internal/theme/finance/sources/alphavantage.go

func (s *AlphaVantageSource) Fetch(ctx context.Context) ([]domain.ContentItem, error) {
    for _, symbol := range s.symbols {
        // Verificar rate limit ANTES de cada request
        if !s.rateLimiter.Allow(ctx, "alpha-vantage", 5, 60*time.Second) {
            slog.Warn("alpha-vantage rate limit reached, skipping remaining symbols")
            break
        }
        item, err := s.fetchSymbol(ctx, symbol)
        if err != nil {
            slog.Warn("alpha-vantage symbol failed", "symbol", symbol, "error", err)
            continue
        }
        items = append(items, item)
    }
    return items, nil
}
```

---

## Common Crawl — Uso do Index API (não dumps)

O Common Crawl disponibiliza um Index API (CDXJ) para buscar URLs por domínio ou termo.
**Não baixar os dumps de petabytes** — usar apenas o index.

```go
// backend/internal/theme/news/sources/commoncrawl.go

const ccIndexURL = "https://index.commoncrawl.org/CC-MAIN-2024-10-index"

// Buscar URLs de um domínio específico
func (s *CommonCrawlSource) fetchByDomain(ctx context.Context, domain string) ([]CCResult, error) {
    url := fmt.Sprintf("%s?url=%s/*&output=json&limit=100", ccIndexURL, domain)
    // ... fetch e parse de CDXJ (uma linha JSON por resultado)
}
```

Uso principal: enriquecer artigos GDELT com metadados do índice.

---

## Timeouts por Tipo de API

| Tipo | Timeout | Exemplo |
|---|---|---|
| APIs leves (alertas pontuais) | 10s | NOAA SWPC alertas |
| APIs de batch (múltiplos pontos) | 15s | Open-Meteo 55 pontos |
| APIs com rate limit | 20s | Alpha Vantage |
| APIs via proxy interno | 15s | GDACS |

```go
// Sempre usar contexto com timeout — nunca omitir
ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
defer cancel()
req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
```

---

## Observabilidade de Ingestão

### Log obrigatório ao final de cada Fetch()

```go
slog.Info("ingest complete",
    "source",      s.ID(),
    "theme",       s.ThemeID(),
    "fetched",     totalFromAPI,
    "valid",       len(items),
    "duration_ms", elapsed.Milliseconds(),
)
```

### Log de falha

```go
slog.Warn("ingest failed",
    "source", s.ID(),
    "error",  err,
)
```

### Métricas a monitorar

- `fetched` vs `valid` — discrepância alta indica mudança no schema da API
- `duration_ms` — aumento pode indicar degradação ou rate limiting silencioso
- Frequência de `ingest failed` por source

---

## Checklist para Novo Provider

- [ ] Arquivo `backend/internal/theme/[tema]/sources/[nome].go`
- [ ] Função `RawToContentItem` (ou equivalente) exportada e pura
- [ ] `ID()` retorna kebab-case único globalmente
- [ ] `Interval()` calibrado para a API (ver tabela acima)
- [ ] `id` do ContentItem estável entre ingestões
- [ ] Sem chaves de API no código — usar `os.Getenv`
- [ ] `geo` é `nil` quando não há coordenadas confiáveis
- [ ] `expires_at` é `nil` a menos que a fonte forneça expiração oficial
- [ ] Log `ingest complete` com `fetched` e `valid`
- [ ] Teste de `RawToContentItem` com input válido, input com campo ausente, input nil
- [ ] Teste de `Fetch` com mock HTTP server
- [ ] Registrado em `theme.Sources()`

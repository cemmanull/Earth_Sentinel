# Earth Sentinel — Guia de Desenvolvimento

**Earth Sentinel** é uma plataforma modular de inteligência temática, agregação de dados,
visualização geográfica e geração de newsletters baseada em plugins.

Suporta múltiplos **Temas** (Topics) — coleções de fontes de dados, lógica de domínio e
interfaces de visualização. A plataforma é extensível por design: adicionar um novo tema
não requer modificar infraestrutura existente.

> **Fonte de Verdade:** `TODO.md` — qualquer divergência entre este arquivo e o TODO.md
> deve ser resolvida seguindo o TODO.md.
> **Autoridade de UI/UX:** `DESIGN.md` (design system Aegis Sentinel) — paleta, tipografia,
> regras de componente e interação. Violar DESIGN.md equivale a quebrar arquitetura.

Idioma da interface: **pt-BR**. Código, variáveis, funções, comentários técnicos: **inglês**.

---

## Stack

| Camada | Tecnologia | Responsabilidade |
|--------|------------|------------------|
| Frontend (browser) | HTML + CSS + JS (ES modules) + Web Components + Three.js | Interface, visualização geográfica |
| Servidor frontend | Node.js 18+ + Express 4 | Serve estáticos, proxy para Go backend |
| Backend API | Go 1.21+ | Ingestão, processamento, persistência, API REST |
| Banco de dados | PostgreSQL 15+ | Persistência de `content_items`, temas, fontes |
| Cache / fila | Redis 7+ | Cache hot, rate limiting, filas de ingestão |
| Armazenamento | MinIO | Thumbnails, snapshots, assets de tema |
| Visualização 2D | Canvas API (map.js) | Mapa Web Mercator com tiles NASA GIBS |
| Visualização 3D | Three.js r128 (globe.js) | Globo 3D interativo |

---

## Estrutura de Diretórios

```
earth-sentinel/
│
├── backend/                         # Go backend
│   ├── cmd/api/main.go
│   ├── internal/
│   │   ├── domain/
│   │   │   ├── content.go           # ContentItem, GeoPoint, interfaces Theme/Source
│   │   │   └── scoring.go           # Lógica de score (portada de events.js)
│   │   ├── theme/
│   │   │   ├── registry.go          # ThemeRegistry
│   │   │   ├── extreme/             # Tema: eventos extremos
│   │   │   │   ├── theme.go
│   │   │   │   ├── scoring.go
│   │   │   │   └── sources/         # usgs.go, gdacs.go, noaa.go, eonet.go
│   │   │   ├── weather/             # Tema: clima
│   │   │   │   └── sources/         # openmeteo.go
│   │   │   ├── news/                # Tema: notícias
│   │   │   │   └── sources/         # gdelt.go, mediacloud.go
│   │   │   └── finance/             # Tema: finanças
│   │   │       └── sources/         # alphavantage.go, stooq.go
│   │   ├── ingest/
│   │   │   ├── scheduler.go         # Goroutines agendadas por fonte
│   │   │   └── worker.go            # Pool com retry/backoff
│   │   ├── store/
│   │   │   ├── postgres/            # Repositórios PostgreSQL
│   │   │   └── redis/               # Cache + rate limiting
│   │   ├── api/
│   │   │   ├── handler/             # HTTP handlers
│   │   │   └── middleware/          # CORS, rate limit
│   │   └── platform/
│   │       ├── config.go            # Lê variáveis de ambiente
│   │       └── minio.go             # Cliente MinIO
│   ├── migrations/                  # SQL numerados (001_init.sql…)
│   └── go.mod
│
├── public/                          # Frontend (browser)
│   ├── index.html                   # Shell + Web Components + seletor de tema
│   ├── css/
│   │   ├── base.css                 # Tokens CSS, reset, keyframes
│   │   ├── loader.css               # Tela de carregamento
│   │   ├── layout.css               # Header, layout, responsivo
│   │   ├── panels.css               # Painéis, cards, feeds
│   │   ├── risk-panel.css           # Painel de detalhe flutuante
│   │   └── themes/                  # Overrides por tema
│   └── js/
│       ├── app.js                   # Shell multi-tema (orquestrador)
│       ├── map.js                   # WorldMap Canvas 2D (autônomo)
│       ├── globe.js                 # Globe Three.js (autônomo)
│       ├── shared/
│       │   ├── utils.js             # truncate, escapeHtml, fetchJSON
│       │   ├── geo.js               # haversineKm, getDecayFactor
│       │   └── api-client.js        # Cliente HTTP para o Go backend
│       └── themes/
│           ├── registry.js          # ThemeRegistry frontend
│           └── [tema]/              # Ex: extreme-events/, news/, weather/, finance/
│               ├── index.js         # Entry point do tema
│               ├── domain.js        # Lógica de domínio (funções puras)
│               └── components/      # Web Components do tema
│
├── server.js                        # Node.js: static + proxy thin para Go
├── package.json
├── CLAUDE.md                        # ESTE ARQUIVO
├── TODO.md                          # FONTE DE VERDADE — roadmap e decisões
│
└── tests/
    ├── unit/                        # node:test — funções puras JS
    └── integration/
        └── server.test.js           # Rotas HTTP do Node.js
```

---

## Arquitetura

### Camadas e regra de dependência

```
Browser (PWA)
  └── Shell (app.js) → ThemeRegistry → Tema ativo → Web Components
        └── shared/api-client.js → Node.js → Go backend

Node.js (server.js)
  └── serve /public (estáticos)
  └── proxy /api/* → Go :8080

Go Backend
  └── API handlers → ThemeRegistry (Go) → Fontes agendadas
        └── store/postgres   (persistência)
        └── store/redis      (cache + rate limit)
        └── platform/minio   (objetos)
```

**Regra absoluta:** o browser nunca chama APIs externas diretamente.
Toda ingestão de dados acontece no backend Go.

### Interfaces Go obrigatórias

```go
// Source — contrato de qualquer fonte de dados, em qualquer tema
type Source interface {
    ID()       string
    ThemeID()  string
    Fetch(ctx context.Context) ([]ContentItem, error)
    Interval() time.Duration
}

// Theme — agrupa fontes e lógica de domínio
type Theme interface {
    ID()      string
    Label()   string
    Sources() []Source
    Score(item ContentItem, ctx ScoreContext) float64
}
```

### Interface de tema no frontend (JS)

```js
// Toda entrada no ThemeRegistry implementa:
{
  id:          string,
  label:       string,
  icon:        string,        // emoji ou SVG inline
  hasGeoView:  boolean,       // exibe mapa/globo?
  component:   string,        // nome do Web Component principal
  mount(container, apiClient),
  unmount(),
}
```

---

## Modelo de Dados Canônico — `ContentItem`

Contrato unificado para todos os temas e fontes.

```
ContentItem {
  id            string        // '<source>-<provider-key>' — estável entre refreshes
  theme_id      string        // 'extreme-events' | 'news' | 'weather' | 'finance'
  type          string        // tipo específico do tema (ex: 'earthquake', 'article', 'price')
  source_id     string        // identificador da fonte de dados
  title         string        // ≤ 80 chars
  description   string        // ≤ 300 chars
  published_at  time.Time
  expires_at    *time.Time    // opcional — só quando a fonte tem expiração confiável
  geo           *GeoPoint     // opcional { lat, lng, radius_km } — nil quando não aplicável
  severity      *int          // 1–5, apenas temas que modelam risco/intensidade
  confidence    *float64      // 0.0–1.0, quando aplicável
  metadata      jsonb         // campos específicos da fonte
  tags          []string
  created_at    time.Time
  updated_at    time.Time
}

GeoPoint {
  lat       float64   // -90 a +90
  lng       float64   // -180 a +180
  radius_km float64   // raio de influência
}
```

**Regras de `id`:** derivado do identificador da API, não de posição ou timestamp.
O mesmo item DEVE gerar o mesmo `id` entre ingestões consecutivas.

**Regras de `geo`:** `nil` para finanças, notícias sem localização identificada.
Nunca usar `lat: 0, lng: 0` como placeholder — isso indica bug de ingestão.

**Regras de `expires_at`:** apenas quando a fonte tem expiração oficial e confiável.
Ciclo de vida sem expiração explícita é gerenciado por TTL de ingestão e query por `published_at`.

---

## Temas — Sistema de Plugins

Temas iniciais:

| ID | Label | Geo | Score | Fontes |
|----|-------|-----|-------|--------|
| `extreme-events` | Eventos Extremos | ✅ obrigatório | risk score 1-5 | USGS, GDACS, NOAA SWPC, EONET |
| `weather` | Clima | ✅ obrigatório | conforto climático | Open-Meteo |
| `news` | Notícias | ✅ opcional | — | GDELT, MediaCloud |
| `finance` | Mercado Financeiro | ❌ nenhum | — | Alpha Vantage, Stooq |

**Extensibilidade:** adicionar um tema = criar `backend/internal/theme/<novo>/` +
`public/js/themes/<novo>/` + registrar nos dois registries. Sem tocar em infraestrutura.

---

## Fontes de Dados — Referência Rápida

### Tema: extreme-events

| Fonte | Endpoint base | Auth | Intervalo |
|-------|---------------|------|-----------|
| USGS | `earthquake.usgs.gov` | nenhuma | 10min |
| NOAA SWPC | `services.swpc.noaa.gov` | nenhuma | 5min |
| NASA EONET | `eonet.gsfc.nasa.gov` | nenhuma | 30min |
| GDACS | `www.gdacs.org/gdacsapi` | nenhuma | 15min |
| Open-Meteo (extremos) | `api.open-meteo.com` | nenhuma | 30min |
| Open-Meteo AQ | `air-quality-api.open-meteo.com` | nenhuma | 30min |

### Tema: news

| Fonte | Endpoint base | Auth | Intervalo |
|-------|---------------|------|-----------|
| GDELT GKG | `api.gdeltproject.org` | nenhuma | 15min |
| MediaCloud | `api.mediacloud.org` | `MEDIACLOUD_API_KEY` | 30min |

### Tema: finance

| Fonte | Endpoint base | Auth | Limite | Intervalo |
|-------|---------------|------|--------|-----------|
| Alpha Vantage | `alphavantage.co/query` | `ALPHA_VANTAGE_KEY` | **5 req/min** | 1min |
| Stooq | `stooq.com` | nenhuma | — | 5min |

**Alpha Vantage:** ingestão via Redis sliding-window rate limiter.
Nunca mais de 5 requests por janela de 60 segundos.

---

## Variáveis de Ambiente

```bash
# Go backend (backend/)
DATABASE_URL=postgres://user:pass@localhost:5432/earthsentinel
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=localhost:9000
MINIO_KEY=minio-access-key
MINIO_SECRET=minio-secret-key
MINIO_BUCKET=earth-sentinel
PORT=8080

# APIs com autenticação (nunca hardcode — sempre os.Getenv)
ALPHA_VANTAGE_KEY=UME9KKPI4L2XJUCI
MEDIACLOUD_API_KEY=337ccf8d51de388defc00e5fb5dd1327b28592f2

# Node.js frontend (server.js)
GO_BACKEND_URL=http://localhost:8080
PORT=3000
```

Chaves de API **nunca** aparecem em código-fonte, logs, ou arquivos sob `public/`.

---

## Convenções de Código

### Nomenclatura

| Construção | Padrão | Exemplo |
|-----------|--------|---------|
| Funções / variáveis JS | camelCase | `fetchThemeFeed`, `mapCategory` |
| Constantes de módulo JS | SCREAMING_SNAKE_CASE | `PROBE_GRID`, `EVENT_META` |
| Classes JS | PascalCase | `WorldMap`, `ThemeRegistry` |
| Membros privados JS | `_` prefix | `_draw()`, `_offsetX` |
| Web Components | kebab-case | `<extreme-events-panel>`, `<detail-panel>` |
| IDs de tema | kebab-case | `'extreme-events'`, `'finance'` |
| IDs de fonte | kebab-case | `'usgs'`, `'alpha-vantage'` |
| IDs de content item | `'<source>-<key>'` | `'usgs-us2024abc'` |
| Types de content item | snake_case | `'earthquake'`, `'article'` |
| Go: pacotes | lowercase | `theme`, `ingest`, `store` |
| Go: tipos / interfaces | PascalCase | `ContentItem`, `Source`, `Theme` |
| Go: funções exportadas | PascalCase | `FetchUSGS`, `NormalizeLevel` |
| Go: variáveis locais | camelCase | `contentItems`, `themeID` |

### Funções puras — regra fundamental

Toda função sem I/O (sem `fetch`, sem `document`, sem acesso a estado externo)
DEVE ser exportada. Isso viabiliza testes sem mocks.

```javascript
// ✅ Pura e exportada — testável
export function magnitudeToSeverity(mag) { ... }

// ❌ Privada — impossível testar sem mock do módulo
function magnitudeToSeverity(mag) { ... }
```

### Go: separação obrigatória por camada

- **Sources** (`theme/*/sources/`): I/O + normalização → `ContentItem`. Sem regras de negócio.
- **Domain** (`domain/`, `theme/*/scoring.go`): lógica pura. Sem I/O.
- **Handlers** (`api/handler/`): HTTP apenas. Delegam para stores e domain.
- **Stores** (`store/`): acesso a dados apenas. Sem regras de negócio.

---

## Tratamento de Erros

### Go backend

```go
// Ingestor: propaga erro, não engole
func (s *USGSSource) Fetch(ctx context.Context) ([]domain.ContentItem, error) {
    resp, err := http.Get(url)
    if err != nil { return nil, fmt.Errorf("usgs fetch: %w", err) }
    return items, nil
}

// Handler: resposta HTTP semântica
func (h *Handler) GetFeed(w http.ResponseWriter, r *http.Request) {
    items, err := h.store.GetFeed(r.Context(), themeID)
    if err != nil {
        http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
        return
    }
    json.NewEncoder(w).Encode(items)
}
```

### Frontend JS

```javascript
// api-client.js: propaga erro para o tema tratar
export async function getThemeFeed(themeID) {
  const res = await fetch(`/api/themes/${themeID}/feed`)
  if (!res.ok) throw new Error(`Feed HTTP ${res.status}`)
  return res.json()
}

// Tema: loga + falha silenciosa (não derruba outros temas)
async function loadFeed() {
  try {
    this._items = await getThemeFeed(this.id)
  } catch (err) {
    console.warn(`[${this.id}] feed indisponível:`, err.message)
  }
}
```

**Regras de log:**
- `console.log` — operação concluída com sucesso
- `console.warn` — falha esperada (rede, API offline)
- `console.error` — bug ou falha de boot — nunca para falhas de fonte

---

## Observabilidade — Padrão de Logs

### Go backend

```go
slog.Info("ingest complete",
    "source", s.ID(), "theme", s.ThemeID(),
    "items", len(items), "duration_ms", elapsed.Milliseconds())

slog.Warn("ingest failed", "source", s.ID(), "error", err)
```

### Frontend JS

```javascript
console.log(`[${themeID}] +${items.length} items`)
console.warn(`[${themeID}] feed indisponível: HTTP 503`)
```

**Nunca logar:** chaves de API, tokens, coordenadas exatas do usuário,
respostas completas de APIs com dados pessoais.

---

## Segurança

- Chaves de API exclusivamente em variáveis de ambiente no backend Go.
- `server.js` nunca lê `ALPHA_VANTAGE_KEY` ou `MEDIACLOUD_API_KEY`.
- `escapeHtml()` em `shared/utils.js` — usar em todo `innerHTML` com dados externos.
- Preferir `textContent = valor` a `innerHTML = valor`.
- Validação de parâmetros de rota no Go handler antes de qualquer query.
- CORS: backend Go aceita apenas requests do Node.js (origem interna).

---

## Visualização Geográfica

### `map.js` — WorldMap Canvas 2D

Classe autônoma, sem imports de outros módulos do projeto.

```
new WorldMap(container)
init()                             → inicializa canvas, loop RAF
addEventMarker(item, icon, color)  → ContentItem com geo
clearMarkers()
setLayer(name, enabled)            → camadas GIBS
getZoom() / getBounds() / getCenter()
focusOn(lat, lng, zoomHint?)
setUserLocation(lat, lng)
destroy()
```

Callbacks públicos: `onClickCallback`, `onViewChangeCallback`

### `globe.js` — Globe Three.js

Classe autônoma, depende apenas de Three.js.

```
new Globe(canvas)
addMarker(lat, lng, colorHex, icon, severity, scaleMul)
clearMarkers()
setLayer(name, enabled)
setRealistic(enabled)
setUserLocation(lat, lng)
focusOn(lat, lng)
```

**Quando usar mapa vs globo:** temas com `hasGeoView: true` e itens com `geo != null`.
Temas sem geo (finance) não exibem mapa — apenas painel de feed.

---

## Testes

### Go — `go test ./...`

```go
// Funções puras de domínio: sem I/O
func TestMagnitudeToSeverity(t *testing.T) {
    assert.Equal(t, 5, MagnitudeToSeverity(8.5))
    assert.Equal(t, 1, MagnitudeToSeverity(4.0))
}
// Ingestores: mock do HTTP client
// Handlers: httptest.NewRecorder
```

### JavaScript — `node:test`

```javascript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
// Apenas funções puras exportadas de shared/ e themes/*/domain.js
```

### Comandos

```bash
npm test                    # node:test unitários JS
npm run test:int            # integração Node.js (requer npm start)
cd backend && go test ./... # Go
```

---

## CSS — Sistema de Design

> **Autoridade visual: `DESIGN.md`** (Aegis Sentinel). Paleta, tipografia, componentes
> e regras de interação vêm de lá. Proibido: cores fora da paleta, CSS arbitrário,
> glassmorphism (exceção única: map-overlay branco conforme spec), animações > 150ms.
> Migração dark→Aegis em andamento: ver Fase 5.6 no TODO.md.

| Arquivo | Conteúdo |
|---------|---------|
| `base.css` | `@layer` order, tokens (`--sp-*`, `--fs-*`, `--z-*`, `--sev-*`), reset |
| `components.css` | Primitivas UI (`<content-card>`, `<type-badge>`, toasts…) |
| `loader.css` | Tela de carregamento |
| `layout.css` | Header com seletor de tema, layout, responsivo |
| `panels.css` | Feed genérico, cards, painéis temáticos |
| `risk-panel.css` | Painel de detalhe flutuante (todos os temas) |
| `themes/<id>.css` | Overrides visuais por tema |

---

## Como Executar

```bash
# Infraestrutura (PostgreSQL + Redis + MinIO)
docker-compose -f docker-compose.dev.yml up -d

# Backend Go
cd backend && go run ./cmd/api

# Frontend
npm install && npm start   # → http://localhost:3000

# Testes
npm test
cd backend && go test ./...
```

---

## Roadmap (resumo — ver TODO.md para detalhes e critérios)

| Fase | Status | Objetivo |
|------|--------|----------|
| 0 | 🔜 | Congelamento e preparação |
| 1 | 🔜 | Generalização do modelo frontend |
| 2 | 🔜 | Scaffold Go backend |
| 3 | 🔜 | Migrar extreme-events para Go |
| 4 | 🔜 | Redis cache e rate limiting |
| 5 | 🔜 | Shell multi-tema + Web Components |
| 6–8 | 🔜 | Novos temas (Clima, Notícias, Finanças) |
| 9 | 🔜 | PWA hardening |

---

## Tarefas Comuns

| Tarefa | Referência |
|--------|-----------|
| Adicionar novo tema | `.claude/skills/add-topic.md` |
| Adicionar novo provider | `.claude/skills/add-provider.md` |
| Adicionar novo tipo de conteúdo | `.claude/skills/add-content-type.md` |
| Tratamento de erros | `.claude/skills/error-handling.md` |
| Guia de testes | `.claude/skills/testing-guide.md` |
| Engenharia de backend Go | `.claude/agents/backend-engineer.md` |
| Engenharia de frontend | `.claude/agents/frontend-engineer.md` |
| Engenharia de ingestão | `.claude/agents/data-ingestion-engineer.md` |
| Visualização geográfica | `.claude/agents/geo-visualization-engineer.md` |
| Schema ContentItem | `.claude/schematics/content-item.md` |
| Arquitetura completa | `.claude/schematics/architecture.md` |
| API do backend Go | `.claude/schematics/api-schema.md` |

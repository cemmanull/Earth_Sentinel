# Esquemático: Arquitetura Earth Sentinel

## Visão Geral

Earth Sentinel é uma plataforma modular de inteligência temática com:
- Ingestão server-side (Go) — o browser **nunca** chama APIs externas
- Frontend PWA (HTML + CSS + JS + Web Components) via Node.js thin proxy
- Banco relacional (PostgreSQL), cache (Redis), object storage (MinIO)

---

## Diagrama de Camadas

```
┌────────────────────────────────────────────────────────────────────┐
│  BROWSER (PWA)                                                     │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  index.html + app.js (shell multi-tema)                      │  │
│  │                                                              │  │
│  │  ┌─────────────────┐  ┌──────────────────────────────────┐  │  │
│  │  │  ThemeRegistry  │  │  map.js (Canvas 2D Web Mercator) │  │  │
│  │  │  Theme modules  │  │  globe.js (Three.js 3D)          │  │  │
│  │  │  Web Components │  │  NASA GIBS tiles                 │  │  │
│  │  └────────┬────────┘  └──────────────────────────────────┘  │  │
│  │           │                                                  │  │
│  │  ┌────────▼─────────────────────────────────────────────┐   │  │
│  │  │  api-client.js  →  /api/*  (relativo ao origin)      │   │  │
│  │  └──────────────────────────────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  CSS: base · loader · layout · panels · themes/[id].css            │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │ HTTP
┌─────────────────────────────────▼──────────────────────────────────┐
│  NODE.JS (server.js)                                               │
│                                                                    │
│  Express 4                                                         │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Static middleware  →  public/                               │  │
│  │  GET /api/*         →  proxy para Go backend :8080           │  │
│  │  GET *              →  SPA fallback (index.html)             │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────┬──────────────────────────────────┘
                                  │ HTTP :8080
┌─────────────────────────────────▼──────────────────────────────────┐
│  GO BACKEND (backend/)                                             │
│                                                                    │
│  ┌──────────────┐  ┌───────────────────────────────────────────┐  │
│  │  HTTP API    │  │  Scheduler (Ingestor)                     │  │
│  │              │  │                                           │  │
│  │  GET /themes │  │  time.Ticker × Source.Interval()         │  │
│  │  GET /themes │  │  for each Theme:                         │  │
│  │    /:id/feed │  │    for each Source:                      │  │
│  │  GET /sources│  │      Fetch(ctx) → []ContentItem          │  │
│  │    /status   │  │      UpsertItems → PostgreSQL            │  │
│  │  GET /health │  │                                           │  │
│  └──────┬───────┘  └───────────────────┬───────────────────────┘  │
│         │                              │                          │
│  ┌──────▼──────────────────────────────▼───────────────────────┐  │
│  │  domain/                                                    │  │
│  │  ContentItem · GeoPoint · Source · Theme · ScoreContext     │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────────┐  ┌────────────────────────────────────┐  │
│  │  theme/              │  │  store/                            │  │
│  │  extreme-events/     │  │  PostgreSQL (UpsertItems, Query)   │  │
│  │  news/               │  │  Redis (feed cache, rate limit)    │  │
│  │  weather/            │  │  MinIO (thumbnails, snapshots)     │  │
│  │  finance/            │  └────────────────────────────────────┘  │
│  └──────────────────────┘                                          │
└──────────────────────────────────┬─────────────────────────────────┘
                                   │ HTTPS
┌──────────────────────────────────▼─────────────────────────────────┐
│  APIS EXTERNAS                                                      │
│                                                                    │
│  NOAA SWPC · USGS · NASA EONET · GDACS · NWS · Open-Meteo         │
│  GDELT · MediaCloud · Common Crawl · Alpha Vantage · Stooq        │
└────────────────────────────────────────────────────────────────────┘
```

---

## Regras de Dependência

```
server.js         →  Go backend :8080 (proxy reverso simples)
app.js            →  map.js, globe.js, ThemeRegistry, api-client.js
map.js            →  (sem imports do projeto — autônomo)
globe.js          →  Three.js CDN (sem imports do projeto)
ThemeRegistry     →  themes/*/index.js
themes/*/index.js →  themes/*/components/*.js, api-client.js
api-client.js     →  (sem imports internos — só fetch nativo)

Go: handler       →  store, domain
Go: scheduler     →  Sources, store, domain
Go: theme         →  sources, domain
Go: source        →  domain (ContentItem, GeoPoint)
Go: domain        →  (sem imports internos)
```

**Regra:** camadas inferiores nunca importam camadas superiores.
O browser nunca importa Go. O Go nunca importa Node.js.

---

## Estrutura de Diretórios (target)

```
earth-sentinel/
├── server.js                    # Node.js: estáticos + proxy reverso → Go
├── package.json
│
├── backend/
│   ├── cmd/api/main.go          # entry point — monta router e scheduler
│   ├── go.mod
│   ├── internal/
│   │   ├── domain/              # ContentItem, GeoPoint, Source, Theme interfaces
│   │   ├── store/               # PostgreSQL + Redis + MinIO
│   │   ├── ingest/              # Scheduler: gerencia goroutines de ingestão
│   │   ├── api/                 # HTTP handlers
│   │   │   └── handler/
│   │   │       ├── themes.go
│   │   │       ├── feed.go
│   │   │       └── health.go
│   │   └── theme/               # Implementações de temas
│   │       ├── extreme-events/
│   │       │   ├── theme.go
│   │       │   ├── domain/      # score, lifecycle (domain sem I/O)
│   │       │   └── sources/     # usgs.go, gdacs.go, noaa.go, ...
│   │       ├── news/
│   │       │   ├── theme.go
│   │       │   └── sources/     # gdelt.go, mediacloud.go, ...
│   │       ├── weather/
│   │       │   ├── theme.go
│   │       │   └── sources/     # openmeteo.go, nws.go
│   │       └── finance/
│   │           ├── theme.go
│   │           └── sources/     # alphavantage.go, stooq.go
│   └── migrations/              # SQL migrations (up/down)
│
├── public/
│   ├── index.html               # Shell + <script type="module" src="/js/app.js">
│   ├── css/
│   │   ├── base.css             # :root vars, reset, keyframes
│   │   ├── loader.css           # Tela de carregamento
│   │   ├── layout.css           # Header, breakpoints
│   │   ├── panels.css           # Painéis, stat cards, toasts
│   │   └── themes/              # Overrides de cor por tema
│   └── js/
│       ├── app.js               # Shell: boot, ThemeRegistry, geo views
│       ├── map.js               # WorldMap: Canvas 2D, GIBS tiles, marcadores
│       ├── globe.js             # Globe: Three.js 3D
│       ├── shared/
│       │   ├── api-client.js    # fetch → /api/*
│       │   ├── utils.js         # truncate(), escapeHtml()
│       │   ├── geo.js           # haversineKm(), getDecayFactor()
│       │   └── content-type-meta.js  # CONTENT_TYPE_META (icon, color, label)
│       └── themes/
│           ├── registry.js      # ThemeRegistry
│           ├── extreme-events/
│           │   ├── index.js     # theme definition
│           │   ├── domain.js    # funções puras de UI
│           │   └── components/  # Web Components
│           ├── news/
│           ├── weather/
│           └── finance/
│
└── tests/
    ├── unit/                    # node:test — zero rede, zero DOM
    ├── integration/             # requer npm start + go run
    └── helpers/
        └── fixtures.js
```

---

## Interfaces Centrais (Go)

```go
// domain/interfaces.go

type Source interface {
    ID()       string
    ThemeID()  string
    Fetch(ctx context.Context) ([]ContentItem, error)
    Interval() time.Duration
}

type Theme interface {
    ID()      string
    Label()   string
    Sources() []Source
    Score(item ContentItem, ctx ScoreContext) float64
}

type ScoreContext struct {
    UserLat, UserLng float64
    Now              time.Time
}
```

---

## Fluxo de Boot (frontend)

```
DOMContentLoaded → boot()
  │
  ├── fetch('/api/themes')  →  [ { id, label, hasGeoView }, ... ]
  ├── ThemeRegistry.loadAll(themes)
  ├── renderThemeSwitcher()
  ├── new WorldMap(container).init()
  ├── new Globe(canvas)
  ├── activateTheme(themes[0].id)
  │     ├── theme.mount(container, apiClient)
  │     │     └── Web Component: connectedCallback → _loadFeed → getThemeFeed
  │     └── updateGeoVisibility(theme.hasGeoView)
  └── navigator.geolocation.getCurrentPosition() (silent)
        └── setUserLocation(lat, lng)
```

---

## Fluxo de Ingestão (backend)

```
main.go → Scheduler.Start()
  │
  ├── Para cada Theme registrado:
  │     Para cada Source do tema:
  │       goroutine: ticker.C → Fetch(ctx) → UpsertItems()
  │
  └── Cada UpsertItems:
        ├── PostgreSQL: INSERT ... ON CONFLICT (id) DO UPDATE
        └── Redis: invalidar cache de feed do tema
```

---

## Camadas CSS (z-index)

```
z: 9999  #loader          tela de carregamento
z:  200  #toasts          notificações flutuantes
z:  100  #header          barra de topo
z:   95  .detail-panel    painel de detalhe de item
z:   90  .side-panel      painel lateral do tema
z:    0  #map-container   canvas 2D Mercator
z:    0  #globe-canvas    canvas 3D Three.js
```

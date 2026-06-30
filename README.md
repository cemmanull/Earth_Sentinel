# Earth Sentinel

**Plataforma modular de inteligência temática e monitoramento global em tempo real**

PWA mobile-first com visualização geográfica (mapa 2D Canvas + Globo 3D Three.js), agregação
server-side de múltiplas fontes de dados e arquitetura de plugins por tema.

Temas disponíveis: **Eventos Extremos** (terremotos, furacões, erupções solares, vulcões,
incêndios) — com Clima, Notícias e Mercado Financeiro em desenvolvimento.

---

## Quick Start

### Modo dev local (recomendado)

```bash
# 1. Setup: instala deps + sobe infra Docker (PostgreSQL, Redis, MinIO)
bash install.sh

# 2. Terminal 1 — Backend Go (porta 8080)
cd backend && go run ./cmd/api

# 3. Terminal 2 — Frontend Node.js (porta 3000)
npm start
```

Acesse: http://localhost:3000

### Modo Docker completo (sem Go/Node instalados)

```bash
bash install.sh --full   # build + sobe tudo em Docker
```

### Pré-requisitos

| Ferramenta | Versão mínima | Necessário para |
|---|---|---|
| Docker + Compose | 24+ | infra (ambos os modos) |
| Node.js | 18+ | frontend (dev local) |
| Go | 1.22+ | backend (dev local) |

---

## Stack

| Camada | Tecnologia | Responsabilidade |
|---|---|---|
| Frontend (browser) | HTML + CSS + JS (ES modules) + Web Components + Three.js | Interface, visualização geográfica |
| Servidor frontend | Node.js 18+ + Express 4 | Serve estáticos, proxy para Go backend |
| Backend API | Go 1.22+ | Ingestão, processamento, persistência, API REST |
| Banco de dados | PostgreSQL 15+ | Persistência de `content_items`, temas, fontes |
| Cache / rate limit | Redis 7+ | Cache hot por tema, sliding-window para APIs limitadas |
| Armazenamento | MinIO | Thumbnails, snapshots, assets de tema |
| Visualização 2D | Canvas API (`map.js`) | Mapa Web Mercator com tiles NASA GIBS |
| Visualização 3D | Three.js r128 (`globe.js`) | Globo 3D interativo |

---

## Arquitetura

```
Browser (PWA)
  └── Shell (app.js) → ThemeRegistry → Tema ativo → Web Components
        └── shared/api-client.js → Node.js → Go backend

Node.js (server.js)
  └── serve /public (estáticos)
  └── proxy /api/* → Go :8080

Go Backend
  └── REST handlers → ThemeRegistry → Fontes agendadas (goroutines)
        └── store/postgres   (ContentItem)
        └── store/redis      (cache + rate limit)
        └── platform/minio   (objetos)
```

**Regra absoluta:** o browser nunca chama APIs externas diretamente.
Toda ingestão acontece no backend Go.

---

## Estrutura de Diretórios

```
earth-sentinel/
├── backend/                         # Go backend
│   ├── cmd/api/main.go
│   ├── internal/
│   │   ├── domain/                  # ContentItem, GeoPoint, interfaces Theme/Source
│   │   ├── theme/
│   │   │   ├── registry.go
│   │   │   └── extreme/             # Tema: eventos extremos
│   │   │       ├── theme.go
│   │   │       ├── scoring.go
│   │   │       └── sources/         # usgs.go, gdacs.go, noaa.go, eonet.go, openmeteo.go, airquality.go
│   │   ├── ingest/                  # scheduler.go, worker.go (goroutines + retry/backoff)
│   │   ├── store/
│   │   │   ├── postgres/            # ContentItemRepository (upsert, query)
│   │   │   └── redis/               # FeedCache (TTL por tema), RateLimiter (sliding window)
│   │   ├── api/handler/             # health.go, themes.go, feed.go
│   │   └── platform/                # config.go (env vars), minio.go
│   ├── migrations/                  # 001_init.sql, 002_add_extreme_events.sql
│   ├── Dockerfile
│   └── go.mod
│
├── public/                          # Frontend (browser)
│   ├── index.html
│   ├── css/
│   │   ├── base.css                 # @layer order + tokens (--sp-*, --z-*, --sev-*, --fs-*)
│   │   ├── components.css           # Primitivas UI (6 Web Components)
│   │   ├── layout.css, panels.css, loader.css, risk-panel.css
│   │   └── themes/extreme-events.css
│   └── js/
│       ├── app.js                   # Shell multi-tema
│       ├── map.js, globe.js         # Visualização (autônomos)
│       ├── shared/
│       │   ├── utils.js, geo.js, api-client.js
│       │   ├── feed-controller.js   # ThemeFeedController (fetch + auto-refresh + subscribe)
│       │   └── components/          # detail-panel, event-ticker, content-card, type-badge...
│       └── themes/
│           ├── registry.js
│           └── extreme-events/      # index.js, domain.js, components/
│
├── server.js                        # Node.js: static + proxy /api/* → Go
├── docker-compose.yml               # Full stack (infra + backend + frontend)
├── docker-compose.dev.yml           # Só infra (dev local)
├── install.sh                       # Setup de desenvolvimento
├── .env.example                     # Template de variáveis de ambiente
├── CLAUDE.md                        # Guia de desenvolvimento (convenções, arquitetura)
└── TODO.md                          # Roadmap técnico (fonte de verdade)
```

---

## Variáveis de Ambiente

Copie `.env.example` para `.env` e preencha antes de iniciar:

```bash
# Infra (valores padrão — funcionam sem alteração com Docker)
DATABASE_URL=postgres://earthsentinel:earthsentinel@localhost:5432/earthsentinel
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=localhost:9000
MINIO_KEY=minio-access-key
MINIO_SECRET=minio-secret-key
MINIO_BUCKET=earth-sentinel
PORT=8080

# APIs com autenticação (necessário para temas futuros)
ALPHA_VANTAGE_KEY=   # Fase 8 — Mercado Financeiro
MEDIACLOUD_API_KEY=  # Fase 7 — Notícias

# Sem chave: USGS, NOAA SWPC, NASA EONET, GDACS, Open-Meteo, Stooq, GDELT
```

Chaves de API **nunca** aparecem em código-fonte, logs ou arquivos sob `public/`.

---

## API Backend

```
GET /api/health                          → status de DB e Redis
GET /api/themes                          → lista de temas registrados
GET /api/themes/{themeID}/feed           → ContentItem[] paginados por tema
  ?limit=N  &since=<ISO8601>  &type=<tipo>
```

Resposta de feed:

```json
[{
  "id": "usgs-us2024abc",
  "theme_id": "extreme-events",
  "type": "earthquake",
  "source_id": "usgs",
  "title": "M 6.2 - 40 km N of Kaikoura, New Zealand",
  "description": "...",
  "published_at": "2024-01-15T03:22:00Z",
  "geo": { "lat": -41.5, "lng": 173.9, "radius_km": 300 },
  "severity": 4,
  "metadata": { "magnitude": 6.2, "depth": 12 }
}]
```

---

## Fontes de Dados

| Tema | Fonte | Intervalo | Auth |
|---|---|---|---|
| Eventos Extremos | USGS Earthquakes | 10min | — |
| Eventos Extremos | NOAA SWPC | 5min | — |
| Eventos Extremos | NASA EONET | 30min | — |
| Eventos Extremos | GDACS | 15min | — |
| Eventos Extremos | Open-Meteo (extremos) | 30min | — |
| Eventos Extremos | Open-Meteo Air Quality | 30min | — |
| Clima *(Fase 6)* | Open-Meteo | 30min | — |
| Notícias *(Fase 7)* | GDELT GKG | 15min | — |
| Notícias *(Fase 7)* | MediaCloud | 30min | `MEDIACLOUD_API_KEY` |
| Financeiro *(Fase 8)* | Alpha Vantage | 1min | `ALPHA_VANTAGE_KEY` (5 req/min) |
| Financeiro *(Fase 8)* | Stooq | 5min | — |

---

## Testes

```bash
npm test                     # testes unitários JS (node:test nativo)
npm run test:verbose         # com spec reporter
npm run test:int             # integração Node.js (requer npm start)
cd backend && go test ./...  # testes Go
```

Cobertura atual: **384 testes JS** (domínio, componentes, controllers, meta de tipos).

---

## Como Adicionar um Novo Tema

**Backend Go** — crie `backend/internal/theme/<id>/`:
1. `theme.go` — implementa `domain.Theme` (`ID()`, `Label()`, `Sources()`, `Score()`)
2. `sources/<fonte>.go` — implementa `domain.Source` (`Fetch()`, `Interval()`)
3. Registre em `main.go`: `registry.Register(meutema.New())`

**Frontend JS** — crie `public/js/themes/<id>/`:
1. `index.js` — export default com `{ id, label, icon, hasGeoView, mount(), unmount() }`
2. `components/<painel>.js` — Web Component que compõe as primitivas de `shared/components/`
3. Importe e registre em `app.js`

Zero modificações em infraestrutura. Ver `CLAUDE.md` para convenções detalhadas.

---

## Roadmap

| Fase | Status | Objetivo |
|---|---|---|
| 0–1 | ✅ | Congelamento + generalização do modelo JS |
| 2 | ✅ | Scaffold Go backend (health, DB, Redis, migrations) |
| 3 | ✅ | 6 fontes de extreme-events migradas para Go; 100+ eventos no frontend |
| 4 | ✅ | Redis cache (TTL por tema) + rate limiter sliding-window |
| 5 | ✅ | Shell multi-tema + Web Components (`<extreme-events-panel>`, `<detail-panel>`) |
| 5.5 M1–M3 | ✅ | CSS Layers + tokens + 6 primitivas + ThemeFeedController + a11y P0 |
| 5.5 M5–M6 | 🔜 | Auditoria de contraste AA + limpeza de código legado |
| 6 | 🔜 | Tema Clima Geral (Open-Meteo) |
| 7 | 🔜 | Tema Notícias (GDELT + MediaCloud) |
| 8 | 🔜 | Tema Mercado Financeiro (Alpha Vantage + Stooq) |
| 9 | 🔜 | PWA hardening (offline, push notifications, lazy themes) |

Ver `TODO.md` para critérios de aceite, riscos e dependências entre fases.

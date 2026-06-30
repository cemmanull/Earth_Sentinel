# Earth Sentinel — Roadmap de Refatoração

**Objetivo:** Transformar o monitor de eventos extremos em uma plataforma multi-tema de
newsletter e monitoramento, com visualização geográfica, extensível por design.

**Data do plano:** 2026-06-10  
**Base analisada:** Step 2 completo (Canvas 2D + GIBS + 7 APIs + globo 3D)

---

## 1. Revisão da base atual

### O que funciona bem e SERÁ MANTIDO

| Artefato | Motivo para manter |
|---|---|
| `public/js/map.js` | Canvas WorldMap autônomo, sem dependências externas, bem encapsulado |
| `public/js/globe.js` | Globe Three.js funcional, separado do domínio |
| `public/js/events.js` | Funções puras (haversine, decay, analyzeRisk) — domínio testado e estável |
| `public/css/base.css` | Sistema de tokens CSS, glassmorphism, reset — design system completo |
| `public/css/loader.css` | Tela de carregamento reutilizável |
| `public/css/layout.css` | Layout responsivo mobile-first, bem estruturado |
| `public/css/panels.css` | Painéis, cards, modais — base para todos os temas |
| `public/css/risk-panel.css` | Painel flutuante — reutilizável como painel de detalhe genérico |
| `tests/helpers/fixtures.js` | Dados mock nomeados reutilizáveis |
| Infraestrutura de testes (`node:test`) | Sem dependências externas, Node 18+ nativo |
| Convenções de código (CLAUDE.md) | Nomenclatura, camadas, anti-patterns documentados |

### O que será MODIFICADO

| Artefato | O que muda | Por quê |
|---|---|---|
| `server.js` | Vira servidor estático thin + proxy HTTP para o backend Go | Backend Go assume ingestão e dados |
| `public/js/app.js` | Reescrito como shell multi-tema com roteamento de tema | Arquitetura de tema único acoplada ao DOM |
| `public/index.html` | Adiciona seletor de tema, slots para Web Components | Precisa suportar múltiplas interfaces |
| `public/css/layout.css` | Adiciona barra de seleção de tema, adapta header | Nova estrutura de navegação |
| `public/css/panels.css` | Generaliza para painéis temáticos (não só eventos) | Notícias, preços, clima — painéis diferentes |
| `tests/integration/server.test.js` | Adiciona rotas do Go backend e remove proxies migrados | Proxies movem para Go |

### O que será REMOVIDO

| Artefato | Motivo da remoção |
|---|---|
| `public/js/api/*.js` (6 adaptadores) | Substituídos por ingestores Go server-side; frontend não chama APIs externas |
| `public/js/sources.js` | Substituído pelo registro de temas (frontend lê do backend Go) |
| `public/js/noaa.js` (barrel re-export) | Shim de compatibilidade legado sem valor após migração |
| `public/js/notifications.js` | Será reimplementado como Web Component isolado |
| Proxy GDACS em `server.js` | Migra para Go backend |
| `tests/unit/noaa.test.js` et al. | Testes de adaptadores frontend — obsoletos após migração para Go |

### Problemas estruturais identificados

1. **Todos os fetches acontecem no browser** — sem cache, sem histórico, limite de taxa
   atingido por cada sessão de usuário separadamente.
2. **`app.js` acopla domínio, dados e DOM** — `loadEventSources`, `updateSpacePanel`,
   `showRiskPanel` e timers vivem no mesmo módulo de 502 linhas.
3. **Modelo `GlobalEvent` geo-cêntrico** — não representa notícias, preços financeiros
   ou artigos sem coordenadas geográficas.
4. **Tema único hard-coded** — tipos de evento, `SPACE_TYPES`, painel de clima espacial
   estão inlined em `app.js`; impossível trocar de tema sem reescrever o orquestrador.
5. **Sem persistência** — ao reiniciar ou trocar de aba, todos os dados são re-buscados.
6. **`notifications.js`** referenciado em `app.js` mas ausente no repositório analisado
   — indica código incompleto ou não versionado.

---

## 2. Nova arquitetura alvo

```
┌──────────────────────────────────────────────────────────────────────┐
│  BROWSER (PWA)                                                       │
│  ┌─────────────────────────┐  ┌─────────────────────────────────┐   │
│  │  Shell (app.js)         │  │  Web Components por tema        │   │
│  │  • seletor de tema      │  │  <extreme-events-panel>         │   │
│  │  • roteamento           │  │  <news-feed-panel>              │   │
│  │  • shared state         │  │  <weather-panel>                │   │
│  └─────────────────────────┘  │  <finance-panel>                │   │
│  ┌─────────────────────────┐  └─────────────────────────────────┘   │
│  │  Visualização (shared)  │  ┌─────────────────────────────────┐   │
│  │  map.js (Canvas 2D)     │  │  Registro de temas (JS)         │   │
│  │  globe.js (Three.js)    │  │  themes/registry.js             │   │
│  └─────────────────────────┘  └─────────────────────────────────┘   │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ HTTP / WebSocket / SSE
┌───────────────────────────▼──────────────────────────────────────────┐
│  NODE.JS FRONTEND SERVER                                             │
│  server.js — serve /public, proxy /api/* → Go backend               │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ HTTP interno
┌───────────────────────────▼──────────────────────────────────────────┐
│  GO BACKEND API                                                      │
│  ┌──────────────────────┐  ┌──────────────────────────────────────┐  │
│  │  REST handlers       │  │  Ingestores (goroutines agendadas)   │  │
│  │  GET /themes         │  │  extreme: USGS, GDACS, NOAA, EONET  │  │
│  │  GET /themes/:id/feed│  │  weather:  Open-Meteo               │  │
│  │  GET /sources/status │  │  news:     GDELT, MediaCloud        │  │
│  │  WS  /live           │  │  finance:  Alpha Vantage, Stooq     │  │
│  └──────────────────────┘  └──────────────────────────────────────┘  │
└──────────┬────────────────────────────┬─────────────────────────────┘
           │                            │
┌──────────▼───────┐         ┌──────────▼───────────────────────────┐
│  POSTGRESQL      │         │  REDIS                               │
│  • content_items │◄────────│  • cache hot (last N items / tema)   │
│  • themes        │         │  • rate limiter (Alpha Vantage 5/min)│
│  • sources       │         │  • fila de ingestão (jobs)           │
│  • subscriptions │         │  • session / notificações            │
└──────────────────┘         └──────────────────────────────────────┘
                                         │
                             ┌───────────▼──────────────────────────┐
                             │  MINIO                               │
                             │  • thumbnails de artigos             │
                             │  • snapshots de responses grandes    │
                             │  • assets de tema (ícones, mapas)    │
                             └──────────────────────────────────────┘
```

### Modelo de dados canônico — `ContentItem`

Generalização do `GlobalEvent` atual para suportar todos os temas:

```
ContentItem {
  id            string        // '<source>-<provider-key>' — estável entre refreshes
  theme_id      string        // 'extreme-events' | 'news' | 'weather' | 'finance'
  type          string        // tipo específico do tema (ex: 'earthquake', 'article', 'price')
  source_id     string        // identificador da fonte de dados
  title         string        // ≤ 80 chars
  description   string        // ≤ 300 chars
  published_at  time.Time
  expires_at    *time.Time    // opcional — apenas quando a fonte informa expiração confiável
  geo           *GeoPoint     // opcional { lat, lng, radius_km } — nil para finanças/notícias sem geo
  severity      *int          // 1–5, apenas temas que modelam risco/intensidade
  confidence    *float64      // 0.0–1.0, apenas quando aplicável
  metadata      jsonb         // campos específicos da fonte (preço, símbolo, nível de alerta…)
  tags          []string
  created_at    time.Time
  updated_at    time.Time
}
```

**Por que generalizar?**
- Notícias não têm lat/lng obrigatório → `geo` é ponteiro nullable.
- Preços financeiros não têm `severity` → campo ponteiro nullable.
- Todos têm `title`, `description`, `published_at`, `source_id`, `theme_id`.
- O frontend usa o mesmo componente de lista/feed para todos os temas;
  os campos extras ficam em `metadata`.

### Interfaces Go obrigatórias

```go
// Source define o contrato de qualquer fonte de dados, em qualquer tema
type Source interface {
    ID()       string
    ThemeID()  string
    Fetch(ctx context.Context) ([]ContentItem, error)
    Interval() time.Duration   // frequência de ingestão
}

// Theme agrupa fontes e lógica de domínio de um tema
type Theme interface {
    ID()      string
    Label()   string
    Sources() []Source
    Score(item ContentItem, context ScoreContext) float64  // opcional; nil = sem score
}
```

---

## 3. Estrutura de diretórios alvo

```
earth-sentinel/
│
├── backend/                        # Go backend — NOVO
│   ├── cmd/api/main.go
│   ├── internal/
│   │   ├── domain/
│   │   │   ├── content.go          # ContentItem, GeoPoint, interfaces Theme/Source
│   │   │   └── scoring.go          # Risk scoring (portado de events.js)
│   │   ├── theme/
│   │   │   ├── registry.go         # ThemeRegistry — registra e descobre temas
│   │   │   ├── extreme/            # Tema: eventos extremos
│   │   │   │   ├── theme.go        # Implementa Theme interface
│   │   │   │   ├── scoring.go      # analyzeRisk, decay — portado de events.js
│   │   │   │   └── sources/
│   │   │   │       ├── usgs.go
│   │   │   │       ├── gdacs.go
│   │   │   │       ├── noaa.go
│   │   │   │       └── eonet.go
│   │   │   ├── weather/            # Tema: clima geral
│   │   │   │   ├── theme.go
│   │   │   │   └── sources/
│   │   │   │       └── openmeteo.go
│   │   │   ├── news/               # Tema: notícias
│   │   │   │   ├── theme.go
│   │   │   │   └── sources/
│   │   │   │       ├── gdelt.go
│   │   │   │       └── mediacloud.go
│   │   │   └── finance/            # Tema: mercado financeiro
│   │   │       ├── theme.go
│   │   │       └── sources/
│   │   │           ├── alphavantage.go   # rate-limited: 5 req/min
│   │   │           └── stooq.go
│   │   ├── ingest/
│   │   │   ├── scheduler.go        # Cron scheduler por fonte
│   │   │   └── worker.go           # Pool de goroutines com retry/backoff
│   │   ├── store/
│   │   │   ├── postgres/
│   │   │   │   ├── content.go      # CRUD ContentItem
│   │   │   │   └── migrations/     # SQL migrations versionadas
│   │   │   └── redis/
│   │   │       ├── cache.go        # Cache hot por tema (TTL)
│   │   │       └── ratelimit.go    # Sliding window para Alpha Vantage
│   │   ├── api/
│   │   │   ├── handler/
│   │   │   │   ├── themes.go       # GET /themes, GET /themes/:id/feed
│   │   │   │   ├── sources.go      # GET /sources/status
│   │   │   │   └── live.go         # WebSocket ou SSE /live
│   │   │   └── middleware/
│   │   │       ├── cors.go
│   │   │       └── ratelimit.go
│   │   └── platform/
│   │       ├── config.go           # Lê env vars (DB_URL, REDIS_URL, MINIO_*)
│   │       └── minio.go            # Cliente MinIO
│   ├── migrations/                 # Arquivos SQL numerados (001_init.sql…)
│   └── go.mod
│
├── public/                         # Frontend — EVOLUÇÃO do atual
│   ├── index.html                  # MODIFICADO: seletor de tema + Web Components
│   ├── css/
│   │   ├── base.css                # MANTIDO: tokens, reset, keyframes
│   │   ├── loader.css              # MANTIDO
│   │   ├── layout.css              # MODIFICADO: barra de temas, header genérico
│   │   ├── panels.css              # MODIFICADO: painéis genéricos
│   │   ├── risk-panel.css          # MANTIDO: painel de detalhe flutuante
│   │   └── themes/                 # NOVO: overrides por tema
│   │       ├── extreme-events.css
│   │       ├── news.css
│   │       ├── weather.css
│   │       └── finance.css
│   └── js/
│       ├── app.js                  # REESCRITO: shell multi-tema
│       ├── map.js                  # MANTIDO: WorldMap Canvas 2D
│       ├── globe.js                # MANTIDO: Globe Three.js
│       ├── themes/                 # NOVO: módulos de tema
│       │   ├── registry.js         # ThemeRegistry frontend
│       │   ├── extreme-events/
│       │   │   ├── index.js        # Entry point do tema
│       │   │   ├── domain.js       # events.js migrado aqui
│       │   │   └── components/     # Web Components do tema
│       │   │       ├── space-panel.js
│       │   │       └── risk-panel.js
│       │   ├── news/
│       │   │   ├── index.js
│       │   │   └── components/
│       │   │       └── news-feed.js
│       │   ├── weather/
│       │   │   ├── index.js
│       │   │   └── components/
│       │   │       └── weather-panel.js
│       │   └── finance/
│       │       ├── index.js
│       │       └── components/
│       │           └── market-panel.js
│       └── shared/                 # NOVO: utilitários compartilhados
│           ├── utils.js            # truncate, escapeHtml, fetchJSON
│           ├── geo.js              # haversineKm (movido de events.js)
│           └── api-client.js       # Cliente HTTP para o backend Go
│
├── server.js                       # MODIFICADO: static + proxy thin
├── package.json                    # ATUALIZADO
├── CLAUDE.md                       # ATUALIZADO: nova arquitetura
│
└── tests/
    ├── unit/
    │   ├── geo.test.js             # haversineKm, decay (renomeado/movido)
    │   └── extreme-events/
    │       └── domain.test.js      # events.js portado
    └── integration/
        └── server.test.js          # ATUALIZADO: rotas Go
```

---

## 4. Riscos técnicos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Go + PostgreSQL + Redis + MinIO requerem infraestrutura local | Alta | Alto | Docker Compose obrigatório desde a fase 2 |
| Migração das 6 integrações JS → Go quebrando paridade de dados | Média | Alto | Manter adaptadores JS em paralelo durante migração (feature flag por tema) |
| GDELT/MediaCloud: rate limits, auth, estrutura de dados complexa | Alta | Médio | Fase 6 — iniciar com GDELT apenas (sem auth), MediaCloud opcional |
| Common Crawl: petabytes de dados, API de índice diferente de download | Alta | Alto | Usar apenas o Index API (CDXJ), não baixar dumps; escopo limitado a metadados |
| Alpha Vantage 5 req/min no plano gratuito | Alta | Médio | Redis sliding window; ingestão server-side elimina o limite por usuário |
| Web Components adicionam complexidade de estado | Média | Médio | Começar com componentes simples (sem shadow DOM) antes de isolar |
| Three.js CDN r128 pode ser incompatível com updates futuros | Baixa | Baixo | Travar versão no package.json quando migrar para bundler (Step 3) |
| `notifications.js` ausente no repo — código não versionado | Alta | Baixo | Reimplementar do zero como Web Component na fase 6 |
| Frontend SPA + Go backend em portas diferentes → CORS | Alta | Baixo | Node.js proxy elimina cross-origin; Go recebe apenas requests do Node |

---

## 5. Plano de implementação por fases

> **Regra entre fases:** cada fase entrega o app 100% funcional. Zero regressões.

---

### Fase 0 — Congelamento e preparação ✅
**Objetivo:** Garantir baseline sólido antes de qualquer mudança estrutural.

- [x] Criar `tests/unit/airquality.test.js` (ausente no repo)
- [x] Verificar e adicionar `public/js/notifications.js` ao controle de versão
      (reimplementado como módulo ES em notifications.js; importado por app.js)
- [x] Adicionar `public/js/globe.js` à lista de estáticos em `server.test.js`
- [x] Documentar variáveis de ambiente esperadas em `.env.example`
- [x] Criar `docker-compose.dev.yml` com PostgreSQL, Redis, MinIO

**O que NÃO muda:** nenhum arquivo de produção.

---

### Fase 1 — Generalização do modelo de dados (frontend-only) ✅
**Objetivo:** Introduzir `ContentItem` no frontend sem quebrar o comportamento atual.

- [x] Criar `public/js/shared/utils.js` com `truncate`, `escapeHtml`, `fetchJSON`
- [x] Criar `public/js/shared/geo.js` com `haversineKm`, `getDecayFactor`
- [x] Criar `public/js/themes/extreme-events/domain.js` (events.js migrado)
- [x] Criar `public/js/themes/registry.js` com ThemeRegistry funcional
- [x] Criar `public/js/shared/api-client.js` — wrapper HTTP para o backend Go
- [x] Atualizar testes para refletir novos caminhos

**Critério de aceite:** `npm test` passa; app funciona identicamente ao atual.

---

### Fase 2 — Scaffold do backend Go ✅
**Objetivo:** Backend Go com health check, conexão com DB/Redis e migrations.

- [x] `backend/go.mod` — `module github.com/earth-sentinel/backend`, go 1.22
- [x] `backend/cmd/api/main.go` — servidor HTTP na porta 8080, graceful shutdown
- [x] `backend/internal/domain/content.go` — ContentItem, GeoPoint, interfaces Theme/Source
- [x] `backend/internal/platform/config.go` — lê todas as env vars necessárias
- [x] `backend/migrations/001_init.sql` — themes, sources, content_items, índices
- [x] `backend/migrations/002_add_extreme_events.sql` — índice parcial por severidade
- [x] `backend/internal/api/handler/themes.go` — GET /api/themes, GET /api/themes/{id}/feed
- [x] `backend/internal/api/handler/health.go` — GET /api/health com status DB/Redis
- [x] `server.js` atualizado — proxy /api/* → Go :8080 via http nativo (sem dependência extra)

**Critério de aceite:** `GET /api/health` retorna 200 com status de DB e Redis. ✅

---

### Fase 3 — Migração do tema Eventos Extremos para Go ✅
**Objetivo:** APIs externas passam a ser consumidas server-side.

- [x] `backend/internal/theme/extreme/sources/usgs.go` — magnitudeToSeverity, normalização
- [x] `backend/internal/theme/extreme/sources/noaa.go` — classifica por código extraído do body da mensagem (fix: product_id não é o código real); 0→896 itens
- [x] `backend/internal/theme/extreme/sources/eonet.go` — EONET_CATEGORY_MAP
- [x] `backend/internal/theme/extreme/sources/gdacs.go` — absorve proxy GDACS do Node.js
- [x] `backend/internal/theme/extreme/sources/openmeteo.go` — PROBE_GRID, forecastDayToEvents
- [x] `backend/internal/theme/extreme/sources/airquality.go` — reutiliza PROBE_GRID
- [x] `backend/internal/theme/extreme/scoring.go` — analyzeRisk, calculateEventScore, isEventExpired
- [x] `backend/internal/ingest/scheduler.go` + `worker.go` — goroutines com retry/backoff
- [x] Persistência em PostgreSQL — fix crítico: `pq.Array` para TEXT[]; antes 0 itens persistidos
- [x] `GET /api/themes/extreme-events/feed` retornando ContentItem[] JSON (fix: slice não-nil)
- [x] `public/js/shared/api-client.js` — adapter `contentItemToEvent` para compatibilidade com map.js/globe.js
- [x] Validado em produção: 100 eventos visíveis no frontend ✅

**Pendente do M6 (limpeza):**
- [ ] Remover `public/js/api/*.js` (6 adaptadores legados — mantidos até M6 estável)
- [ ] Remover proxy GDACS de `server.js` (mantido como fallback)

**Critério de aceite:** App exibe eventos vindos do Go; zero chamadas diretas a USGS/NOAA/etc. ✅

---

### Fase 4 — Redis: cache e rate limiting ✅
**Objetivo:** Performance e controle de limites de APIs.

- [x] `backend/internal/store/redis/feed_cache.go` — GetFeed/SetFeed/InvalidateFeed com TTL por tema
- [x] `backend/internal/store/redis/rate_limiter.go` — sliding window via ZADD+ZCARD+EXPIRE
- [x] Cache-aside no handler com bypass para queries filtradas (limit/since/type)
- [x] Rate limiter pronto para uso pela Fase 8 (Alpha Vantage)
- [x] TTLs: extreme-events 5min | weather 30min | news 15min | finance 1min
- [x] InvalidateFeed chamado pelo scheduler após cada ingestão bem-sucedida

**Critério de aceite:** Segunda chamada retorna do Redis. ✅

---

### Fase 5 — Sistema de temas no frontend (Web Components) ✅
**Objetivo:** Shell multi-tema; cada tema é um módulo isolado.

- [x] `public/js/app.js` reescrito como shell — lê /api/themes, renderiza seletor, instancia tema
- [x] `public/js/themes/registry.js` — ThemeRegistry com register/get/all/getActive/setActive
- [x] Interface de tema JS formalizada: id, label, icon, hasGeoView, mount(container, ctx), unmount(), renderMarkers(), onMapClick(payload)
- [x] `ctx` object: `{ api, getMap, getGlobe, getActiveView, getUserLocation, setStatus, tickerSlot, detailPanel }`
- [x] `public/js/themes/extreme-events/index.js` — tema encapsulado com toda lógica
- [x] `<extreme-events-panel>` Web Component (side panel + space panel + legend filter)
- [x] `<detail-panel>` Web Component genérico compartilhado por todos os temas
- [x] `public/index.html` atualizado — seletor de tema no header, slots adequados
- [x] `public/css/themes/extreme-events.css`
- [x] Service Worker v11 com network-first (corrigido de cache-first que bloqueava módulos ES)

**Critério de aceite:** Tema de eventos extremos via Web Component, seletor visível. ✅

---

### Fase 5.5 — Reestruturação UX/UI multi-conteúdo
**Objetivo:** Evoluir a camada de apresentação para acomodar todos os tipos de conteúdo
(extreme-events, weather, news, finance) com primitivas reutilizáveis, cascata CSS
determinística (Layers + tokens) e o padrão "novo tipo de evento = 1 linha de metadados".

> **Pré-condição:** Fase 5 concluída.
> **Bloqueia:** Fases 6–8 — os novos temas devem nascer compondo as primitivas,
> não copiando o painel de extreme-events.

#### 5.5.0 — Mapeamento: tipos de evento → requisitos visuais

| Tema | Tipos | Geo | Sev. | Superfícies de UI |
|---|---|---|---|---|
| extreme-events | earthquake, volcano, tsunami, hurricane, tornado, severe_storm, heat_wave, cold_wave, flood, drought, wildfire, dust_storm, air_pollution | ✅ | 1–5 | marcador mapa/globo, card de evento, legenda filtrável, ticker, painel de risco |
| extreme-events (espacial) | solar_flare, cme, geomagnetic_storm, radiation_storm, radio_blackout | âncoras aurorais | 1–5 | painel "Clima Espacial" dedicado (sem marcador no mapa), card de alerta |
| weather | forecast | ✅ grid 150km | — | marcador informativo, card de métricas (temp/vento/chuva) |
| weather | weather_alert | ✅ | 2–5 | marcador de alerta, card com validade (`expires_at`) |
| news | article, report, press_release | opcional | — | card de artigo (fonte · domínio · tempo relativo; thumbnail futura via MinIO), marcador apenas quando geo existe |
| finance | price_update, price_alert, economic_indicator | ❌ | — | tabela de cotações, delta ±% colorido, sem vista geográfica (mapa colapsa) |

**Requisitos transversais:**
- Todo tipo TEM entrada em `CONTENT_TYPE_META` `{icon, color, label, category}` — fonte única de identidade visual.
- Um card genérico cobre todos os tipos; temas apenas compõem/especializam.
- Estados padronizados em qualquer feed: carregando (skeleton), vazio, erro com retry.

#### 5.5.1 — Arquitetura da UI (3 camadas de componentes)

```
shell (app.js)                       — mapa/globo, seletor de tema, camadas, geo, status, toasts
  └── tema (themes/<id>/)           — orquestra dados (ThemeFeedController) e COMPÕE primitivas
        └── primitivas (shared/components/) — "burras": recebem dados via propriedade,
                                              emitem CustomEvent; zero fetch interno
```

Primitivas derivadas do mapeamento (em `public/js/shared/components/`):

| Componente | Papel | Usado por |
|---|---|---|
| `<content-card>` | título, descrição, badge de tipo, meta (fonte · tempo), severidade opcional | todos |
| `<type-badge>` | ícone+cor+label de CONTENT_TYPE_META (cor via `--type-color`) | todos |
| `<severity-indicator>` | escala 1–5 com tokens `--sev-*` | extreme-events, weather |
| `<metric-chip>` | par label/valor (KP, preço, temperatura) | todos |
| `<trend-delta>` | variação ±% com cor | finance |
| `<feed-list>` | lista de cards com estados loading/vazio/erro+retry | news, finance, weather |
| `<empty-state>` | mensagem + ação (retry) | todos |
| `<app-toast>` | feedback não-bloqueante (erro de feed) | shell |
| `<event-ticker>` | ticker extraído do index.js do tema | extreme-events, news |
| `<detail-panel>` | já existe (Fase 5); ganha foco gerenciado (a11y) | todos |

- `ThemeFeedController` (`shared/feed-controller.js`): fetch + auto-refresh + subscribe + dispose.
  Elimina o timer/load duplicado em cada tema; Fases 6–8 ganham de graça.
- Contrato shell↔tema permanece o da Fase 5; formalizar com JSDoc typedefs
  (`ThemeDescriptor`, `ThemeContext`).

#### 5.5.2 — Estratégia de estilos (CSS Layers + tokens)

Ordem de camadas declarada UMA vez, antes de qualquer estilo:

```css
@layer reset, tokens, base, layout, components, themes, utilities;
```

- ⚠️ **GOTCHA:** CSS fora de layer vence TODAS as layers. A migração deve envelopar
  TODOS os arquivos numa única etapa (M1) — parcial inverte a cascata.
- **Tokens novos** em `base.css` (`@layer tokens`): espaçamento `--sp-1..8`, z-index
  (`--z-header`, `--z-popover`, `--z-detail`, `--z-modal`, `--z-toast`, `--z-loader`),
  severidade `--sev-1..--sev-5`, tipografia `--fs-xs..--fs-xl`.
  Já existem e ficam: superfícies, bordas, texto, acento, semântico, raios, transição.
- **Cor de tipo:** fonte única é `CONTENT_TYPE_META` (JS). Componente expõe
  `style="--type-color: ..."`; CSS consome `var(--type-color)`. Sem duplicar paleta no CSS.
- **Nomenclatura:** escopo pelo elemento custom (sem shadow DOM): `content-card .card__title`.
  BEM-lite dentro do componente; classes globais só em `@layer components`.
- **Tema:** `css/themes/<id>.css` em `@layer themes` + `data-theme="<id>"` no `<body>`
  (shell seta no mount, remove no unmount).
- **Meta:** `panels.css` encolhe até ser removido — primitivas migram para
  `css/components.css`, domínio para `css/themes/extreme-events.css`.

#### 5.5.3 — Plano de migração incremental (cada marco shippa funcional)

| Marco | Status | Conteúdo | Commit |
|---|---|---|---|
| M0 | ✅ | Baseline: 184 testes verdes | — |
| M1 | ✅ | `@layer` wrap + tokens `--sp-*`, `--z-*`, `--sev-*`, `--fs-*` | `18743bc` |
| M2 | ✅ | 6 primitivas + CONTENT_TYPE_META completo (26 tipos) + showcase `/dev/components.html` | `5784aad` |
| M3 | ✅ | ThemeFeedController + split do painel (overview-metrics, legend-filter, space-weather-panel) + `<event-ticker>` + a11y P0 (384 testes) | `ccd5f2e` |
| M5 | ⤴️ | ~~Contraste AA sobre dark glass~~ — **superado**: absorvido pela Fase 5.6 (W4 audita sobre superfícies claras Aegis; W5 cobre `prefers-reduced-motion`) | — |
| M6 | 🔜 | Limpeza: `api/*.js`, `sources.js`, `noaa.js`, proxy GDACS, testes obsoletos | — |

> **Nota:** M4 (`CONTENT_TYPE_META` completo + showcase) foi integrado ao M2.
> M5 foi redefinido pela chegada do `DESIGN.md` (2026-06-12) — ver Fase 5.6.

#### 5.5.4 — Atividades por categoria (P0 = bloqueia, P1 = alto impacto, P2 = melhoria)

**Arquitetura**
- [x] P0 — `ThemeFeedController` em `shared/feed-controller.js` (fetch, refresh, subscribe, dispose)
- [ ] P0 — JSDoc typedefs do contrato shell↔tema (`ThemeDescriptor`, `ThemeContext`)
- [x] P1 — Carregamento dinâmico de `css/themes/<id>.css` no `mountTheme` (link swap)
- [ ] P1 — `data-theme` no `<body>` no mount/unmount
- [ ] P2 — `import()` dinâmico de temas (lazy; antecipa Fase 9)

**Componentes**
- [x] P0 — Primitivas folha: `<type-badge>`, `<severity-indicator>`, `<metric-chip>`
- [x] P0 — `<content-card>` compondo as folhas
- [ ] P1 — `<feed-list>` com estados loading/vazio/erro+retry
- [x] P1 — `<empty-state>` e `<app-toast>` (erro de feed emite toast com retry)
- [x] P1 — `<event-ticker>` Web Component com lógica extraída do index.js
- [x] P1 — Split do `<extreme-events-panel>`: `<overview-metrics>`, `<legend-filter>`, `<space-weather-panel>`
- [x] P2 — Showcase estático `/dev/components.html`

**Estilos/CSS**
- [x] P0 — `@layer` order declarada + todos os arquivos CSS envelopados (M1 atomicamente)
- [x] P0 — Tokens novos: `--sp-*`, `--z-*`, `--sev-*`, `--fs-*`
- [x] P0 — Hex hardcoded de severidade substituído por `--sev-*`
- [x] P1 — Padrão `--type-color` via style inline (fonte: CONTENT_TYPE_META)
- [x] P1 — Primitivas migradas para `css/components.css`
- [ ] P2 — `prefers-reduced-motion` (marquee do ticker)
- [ ] P2 — Container queries nos cards (densidade adaptativa)

**UX/UI**
- [x] P0 — Estado de erro com retry via `<app-toast>` (toast "Tentar de novo")
- [x] P1 — Toast de erro de rede (não mais silencioso)
- [ ] P1 — Layout sem mapa para finance/news (mapa colapsa, painel expande)
- [ ] P2 — Skeleton no primeiro boot
- [ ] P2 — `<detail-panel>` mobile: gesto de arrastar para fechar

**Acessibilidade**
- [x] P0 — Legenda: `<button aria-pressed>` (não mais `<div>` clicável)
- [x] P0 — Foco gerenciado no `<detail-panel>`: abrir → foco no fechar; fechar → restaura origem
- [x] P1 — Landmarks/roles: `aside` com aria-label, status pill com `role="status"`
- [ ] P1 — Auditoria de contraste AA das 26 cores de tipo sobre vidro escuro
- [x] P1 — Alvos de toque ≥ 44px no mobile (`button.ev-item min-height: 44px`)
- [ ] P2 — `prefers-reduced-motion` no ticker

**Testes**
- [x] P0 — Completude: 168 testes garantem bidireção THEME_TYPES ↔ CONTENT_TYPE_META
- [x] P0 — Funções puras exportadas e testadas (buildCardHTML, buildTickerHTML, buildLegendHTML etc.)
- [x] P1 — `ThemeFeedController`: 7 testes com fetch injetado e timer fake
- [ ] P1 — Integração: novos estáticos respondem 200 em `server.test.js` (pendente)
- [ ] P2 — Checklist visual manual documentado por marco

**Migração e compatibilidade**
- [x] P0 — M1 em commit isolado e reversível (`18743bc`)
- [x] P1 — `sw.js` v11 com network-first; precache inclui `components.css`
- [ ] P1 — M6 limpeza: `api/*.js`, `sources.js`, `noaa.js`, proxy GDACS, testes obsoletos
- [ ] P2 — Tag git por marco para rollback rápido

**Critério de aceite da Fase 5.5:**
- Adicionar um tipo novo = 1 entrada em `CONTENT_TYPE_META` (+ grupo de legenda, se aplicável), zero mudança em componentes.
- Cascata determinística: nenhum `!important` novo; estilos de tema vencem por layer, não por especificidade.
- Todos os P0 concluídos; app visualmente idêntico ao baseline M0 após M1–M3.

---

---

### Fase 5.6 — Migração para o design system Aegis Sentinel (DESIGN.md)
**Objetivo:** Alinhar toda a camada visual ao `DESIGN.md` (autoridade arquitetural de UI):
tema claro tático, paleta teal/amber/red, tipografia Space Grotesk + Inter + monospace,
fim do glassmorphism escuro.

> **Pré-condição:** Fase 5.5 M1–M3 (tokens + layers + primitivas) — concluída.
> **Bloqueia:** Fases 6–8 — temas novos nascem no design Aegis, não no dark glass.
> **Paralelizável com:** M6 (limpeza de legado JS — não toca CSS).

#### Auditoria de gap (2026-06-12)

| Dimensão | Atual | DESIGN.md | Severidade |
|---|---|---|---|
| Esquema de cor | dark (`#030a16`) | light (`#f7fdfd`) | total |
| Superfícies | dark glass + blur 16px | `#f2f8f8` + borda 1px; glassmorphism proibido (exceção: map-overlay branco blur 12px) | total |
| Acento/semântico | `#2f73ff` azul; verde/laranja/vermelho | primary `#00575c`, accent `#154f84`, success `#1c989d`, warning `#a77e39`, danger `#7b131e` | total |
| Tipografia | Inter (fallback sistema), sem webfonts | Space Grotesk (headings), Inter (UI), JetBrains Mono + IBM Plex Mono (telemetria) | alta |
| Canvas 2D/3D | 14 cores hardcoded em map.js; 21 em globe.js | tema claro integrado | alta |
| Severidade `--sev-1..5` | calibrada p/ fundo escuro | remapear com AA sobre superfície clara | alta |
| CONTENT_TYPE_META (26 cores) | calibradas p/ dark glass | AA sobre `#f2f8f8` | alta |
| backdrop-filter | 7 usos (layout 4, components 2, panels 1) | remover (manter só map-overlay) | média |
| Animações | marquee contínuo, pulses, spinners | ≤150ms, mínimas | média |
| Layout macro | ticker no topo; painel só à direita | bottom event stream; left telemetry + right context | média (progressivo) |
| Ícones emoji (controles/brand) | emoji em header e botões | "credibilidade técnica" — sem proibição explícita | decisão pendente |

#### Ondas de migração (cada onda shippa funcional)

**W1 — Fundação de tokens** ✅ (`b561642`) · P0 · agente: frontend-engineer
- Contexto: tokens de `base.css` são a fonte de todos os consumidores; trocar valores re-tematiza ~90% da UI.
- Objetivo: re-token `@layer tokens` para a paleta Aegis mantendo os **nomes** dos tokens
  (`--bg`, `--surf-*`, `--bd-*`, `--tx-*`, `--ac`, `--ok/--warn/--hi/--crit`, `--sev-*`);
  `color-scheme: light`; raios/espaçamentos mapeados à escala do DESIGN.md.
- Objetivo 2: tipografia — woff2 self-hosted em `public/fonts/` (Space Grotesk, Inter,
  JetBrains Mono, IBM Plex Mono), `@font-face` em base.css, type scale do DESIGN.md
  (`label-sm` mono uppercase, `telemetry-value` mono). Self-host obrigatório: PWA offline
  + zero requests a third-party.
- Arquivos: `base.css`, `public/fonts/*`, `index.html` (preload), `sw.js` (precache + bump).
- Critérios: zero mudança de nome de token; app carrega em tema claro; fontes offline; 384 testes verdes.
- Riscos: componentes com cor hardcoded destoam até W2 (aceitável dentro da onda); contraste de texto até W2.

**W2 — Componentes e superfícies** ✅ (`2d96791` + `c8b762c`) · P0 · dep: W1 · agente: frontend-engineer
- Contexto: regras de componente do DESIGN.md (telemetry-card com border-left 4px,
  command-panel, critical-alert, map-overlay) substituem o vidro escuro.
- Objetivo: re-skin `components.css`, `panels.css`, `layout.css`, `risk-panel.css`,
  `loader.css`, `themes/extreme-events.css`; remover os 7 `backdrop-filter` dark
  (manter apenas map-overlay conforme spec); `--sev-1..5` remapeada com AA sobre claro.
- Restrições: proibido criar cores fora do DESIGN.md; proibido `!important`; tokens only.
- Critérios: nenhum hex de superfície/texto fora de tokens; AA em texto normal (4.5:1) e UI (3:1).
- Riscos: regressão visual ampla — validar com showcase `/dev/components.html` + checklist manual.

**W3 — Canvas e WebGL** ✅ (`68b7f72`) · P0 · dep: W1 · agente: geo-visualization-engineer
- Implementação simplificada (navalha de Occam): SEM injeção de paleta/getComputedStyle —
  cores trocadas in-place, agrupadas em `const PALETTE` no topo de cada arquivo.
  Módulos seguem autônomos; API pública inalterada; zero arquivos novos.
- Entregue: oceano/land/países/graticule/equador em tema claro; atmosfera e shader
  noturno em teal primary; marcador de usuário em `--focus`; luzes do globo rebalanceadas.
- Marcadores de evento intocados (EVENT_META — escopo W4).

**W3.5 — Alternância claro/escuro** ✅ (`6a7f81d`) · P0 · dep: W2+W3 · agente: frontend-engineer
- Contexto: arquitetura de tokens torna o dark mode um swap de valores; variante escura
  oficializada no DESIGN.md (seção "Dark Mode Variant").
- Objetivo: bloco `[data-color-scheme="dark"]` em base.css (só tokens neutros + warn/crit/ac
  clareados); botão de toggle no header (reusa `.geo-btn`); persistência em localStorage com
  `prefers-color-scheme` como hint inicial; `PALETTE_LIGHT/PALETTE_DARK` + `setColorScheme()`
  em map.js/globe.js; shell aplica atributo e propaga ao canvas; meta theme-color sincronizada.
- Restrições: zero stylesheet separado; componentes não podem ramificar por esquema
  (tokens only); sem biblioteca.
- Critérios: toggle funciona ao vivo nas duas vistas (2D/3D); escolha sobrevive a reload;
  384 testes verdes; SW bump.

**W4 — Cores de tipo + auditoria AA (dual-mode)** ✅ (`ac24a04`) · P0 · dep: W1, W3.5 · agente: frontend-engineer + qa-engineer
- Entregue: 26/26 cores na banda dual-mode (22 falhavam no claro); EVENT_META derivado
  do canônico (duplicação estrutural eliminada); SEV_COLOR/default do globo remapeados;
  tokens --sev-* auditados (todos passam; aliasing com semânticos mantido por decisão);
  teste de contraste WCAG permanente (+112, suíte em 504).
- Contexto: substitui o antigo M5 (auditoria sobre dark glass — obsoleto desde DESIGN.md).
- Objetivo: remapear as 26 cores de `CONTENT_TYPE_META` para AA sobre `#f2f8f8`;
  alinhar com semântica Aegis (teal=saúde, blue=telemetria, amber=warning, red=crítico).
- Arquivos: `content-type-meta.js`, fixtures de teste.
- Critérios: 168 testes de completude verdes; toda cor ≥ 3:1 sobre AMBAS as surfaces
  (`#f2f8f8` claro e `#101919` escuro — regra dual-mode do DESIGN.md); mapa/globo legíveis.
- Achado W1: `--sev-2/3/5` ficaram aliased a `--info/--warn/--crit` (mesma cor) — avaliar
  se a escala de severidade precisa de mais separação visual; `telemetry-3 #e700ac` está sem uso.
- Achados W3 (incluir no escopo): `SEV_COLOR` em map.js e default `0x6ea7ff` em globe.js
  têm tons claros (`#00ff88`, `#6ea7ff`) com contraste fraco sobre fundo claro;
  cores dos `.layer-dot` em panels.css também precisam de revisão.

**W5 — Layout macro + animações** ✅ (`f009d16`) · P1 · dep: W2 · agente: frontend-engineer
- Entregue: ticker no bottom event stream (zero mudança em JS); 5 transições >150ms
  corrigidas (inclusive risk-panel 280ms, fora do escopo original); todas as animações
  contínuas com `prefers-reduced-motion`; focus ring do theme-selector restaurado.
- Left telemetry panel: adiado pós-Fases 6–8 (decisão registrada abaixo).

**W6 — QA visual e fechamento** 🔶 código completo; aguarda validação visual · dep: W2–W5
- Código da Fase 5.6 está completo (W1–W5, suíte 504 verde, SW v16). Falta a parte
  humana: validação no browser (checklist abaixo) → screenshots de baseline → tag `aegis-v1`.
- Checklist de validação (hard-reload com stack de pé):
  1. Tema claro: header, painel, mapa e globo coerentes; fontes Aegis carregadas.
  2. Toggle claro/escuro: troca ao vivo nas duas vistas; persiste após reload.
  3. Marcadores legíveis nos dois esquemas (cores W4).
  4. Ticker na BASE da janela, rolando; some em ≤900px.
  5. Ícones FA no header/camadas; brand.svg no header e loader.
  6. Foco por teclado: Tab percorre controles com ring teal visível (inclusive o seletor).
  7. `/dev/components.html`: primitivas coerentes nos dois esquemas.

#### Decisões pendentes (registradas, não bloqueiam W1–W4)
- [x] ~~Ícones emoji nos controles~~ — **resolvido** (`cf22552`, regra na seção Iconography
      do DESIGN.md): FA Free = chrome do shell; Material Symbols = componentes;
      emoji = exclusivo de marcadores e CONTENT_TYPE_META (sinal funcional).
- [x] ~~Branding antigo~~ — **resolvido** (`cf22552`): `brand.svg`/`icon.svg` na paleta
      Aegis substituem o ⚡ no header, loader e ícone PWA.
- [ ] Ícones via CDN (cdnjs/fonts.googleapis): offline depende do cache de runtime do SW
      (popula no 1º acesso online). Aceitável; se virar problema, self-host como as
      webfonts (mesmo padrão da W1) — avaliar na Fase 9 (PWA hardening).

#### Dívida técnica registrada nas ondas W2/W3/W4 (P2 — não bloqueia)
- [ ] `themes/extreme-events/index.js` repete o literal de fallback
      `{ icon: '⚠️', color: '#888888' }` (3×) em vez de usar `getTypeMeta` — unificar
      quando o M6 tocar o arquivo (remoção do events.js legado).
- [ ] `telemetry-3 #e700ac` segue sem uso (nenhum tipo de família magenta) — disponível
      para tipo futuro; não forçar.
- [ ] z-index literais pré-tokens (layout.css 10/20/25/60, risk-panel.css 90,
      loader.css 9999) em vez dos tokens `--z-*` — migrar numa passada única.
- [ ] `box-shadow` animado em hover de card (components.css ~130) — paint custoso;
      trocar por `border-color` quando tocar no arquivo.
- [ ] 3 `!important` pré-existentes em layout.css (mobile `.side-toggle`) — remover ao mexer no layout (W5).
- [ ] `@keyframes spin` duplicado em layout.css e themes/extreme-events.css — unificar.
- [ ] `.risk-level-*` duplicado entre risk-panel.css e extreme-events.css — unificar.
- [ ] `.claude/agents/geo-visualization-engineer.md` cita `SEV_COLORS` com valores
      divergentes do código atual — atualizar doc.
- [ ] Left telemetry panel (layout 3 colunas do DESIGN.md): adotar agora ou pós-Fases 6–8
      quando houver mais telemetria para exibir? — recomendação: pós-fases.

---

### Infra / DevOps — Setup de desenvolvimento ✅

- [x] `docker-compose.yml` — full stack completo (postgres + redis + minio + backend Go + frontend Node.js) com healthchecks e `depends_on` em cascata
- [x] `docker-compose.dev.yml` — só infra (para workflow dev local com processos fora do Docker)
- [x] `backend/Dockerfile` — multi-stage, golang:1.22-alpine + alpine:3.19 com ca-certificates + tzdata
- [x] `Dockerfile.frontend` — node:18-alpine, sem devDeps
- [x] `install.sh` — setup cross-platform (Git Bash / WSL / Linux): verifica pré-requisitos, cria .env, npm install, go mod download, sobe infra; modo `--full` sobe stack completa
- [ ] GitHub Actions CI: `npm test` + `go test ./...` em push/PR

---

### Fase 6 — Tema Clima Geral
**Objetivo:** Primeiro tema novo end-to-end.

- [ ] `backend/internal/theme/weather/sources/openmeteo.go`
      — Open-Meteo com dados de temperatura, precipitação, vento
      — mais granular que o atual extreme-events (limiares diferentes)
- [ ] `backend/internal/theme/weather/theme.go`
      — `Score()` retorna índice de conforto climático (sem risk scoring)
- [ ] `GET /api/themes/weather/feed` — retorna `ContentItem[]` com `geo` obrigatório
- [ ] `public/js/themes/weather/index.js` + `<weather-panel>` Web Component
      — exibe condições por região, sem painel de risco
- [ ] `public/css/themes/weather.css`

**Critério de aceite:** Troca para tema Clima mostra dados no mapa com marcadores de temperatura.

---

### Fase 7 — Tema Notícias
**Objetivo:** Segundo tema novo, com dados não geo-cêntricos.

- [ ] `backend/internal/theme/news/sources/gdelt.go`
      — GDELT GKG API (sem auth); artigos com entidades geográficas
      — `geo` preenchido quando a notícia tem localização identificada
- [ ] `backend/internal/theme/news/sources/mediacloud.go`
      — MediaCloud API (requer API key — env var `MEDIACLOUD_API_KEY`); 4000 req/week via Redis rate limiter
- [ ] MinIO: armazenar thumbnails de artigos (`backend/internal/platform/minio.go`)
- [ ] `GET /api/themes/news/feed` — retorna artigos com `geo` opcional
- [ ] `public/js/themes/news/index.js` + `<news-feed>` Web Component
      — exibe lista de artigos; no mapa, marcadores apenas onde `geo` existe
- [ ] `public/css/themes/news.css`

**Nota Common Crawl:** Usar exclusivamente o Index API (CDXJ) para buscar URLs indexadas
por domínio ou termo. Não baixar dumps. Escopo inicial: enriquecimento de artigos GDELT.

**Critério de aceite:** Tema Notícias exibe artigos; artigos com localização aparecem no mapa.

---

### Fase 8 — Tema Mercado Financeiro
**Objetivo:** Terceiro tema novo, completamente assíncrono e sem geo.

- [ ] `backend/internal/theme/finance/sources/alphavantage.go`
      — Alpha Vantage (env `ALPHA_VANTAGE_KEY`); respeita 5 req/min via Redis rate limiter
      — ingestão de índices: S&P 500, IBOVESPA, DAX, Nikkei, FTSE, Nasdaq
- [ ] `backend/internal/theme/finance/sources/stooq.go`
      — Stooq (sem auth) para dados históricos e intraday
- [ ] `GET /api/themes/finance/feed` — retorna `ContentItem[]` com `geo: null`,
      `metadata: {symbol, price, change_pct, market, currency}`
- [ ] `public/js/themes/finance/index.js` + `<market-panel>` Web Component
      — exibe painel de cotações, sem mapa (ou mapa mostra bolsas por país)
- [ ] `public/css/themes/finance.css`

**Critério de aceite:** Tema Financeiro exibe cotações atualizadas automaticamente.

---

### Fase 9 — PWA hardening e polimento
**Objetivo:** Funcionalidade offline, instalação, notificações push.

- [ ] Criar `public/sw.js` — Service Worker com Workbox ou manual:
      cache de assets estáticos, stale-while-revalidate para o feed do tema ativo
- [ ] Adicionar `<link rel="manifest">` e `public/manifest.json`
- [ ] Implementar `<notification-manager>` Web Component
      (substitui `notifications.js` ausente — cadastro de localização + threshold)
- [ ] Backend: `POST /api/subscriptions` — salva em PostgreSQL;
      envia push via Web Push API quando evento com `severity >= threshold` é ingerido
- [ ] Otimizar carregamento: lazy load de módulos de tema (`import()` dinâmico)
- [ ] Adicionar `<meta name="theme-color">` por tema ativo (via CSS custom property)

**Critério de aceite:** App instala como PWA; funciona offline com dados em cache.

---

## 6. Variáveis de ambiente necessárias

Ver `.env.example` na raiz do projeto — todas as variáveis estão documentadas lá.

```
# Backend Go
DATABASE_URL=postgres://earthsentinel:earthsentinel@localhost:5432/earthsentinel
REDIS_URL=redis://localhost:6379
MINIO_ENDPOINT=localhost:9000
MINIO_KEY=minio-access-key
MINIO_SECRET=minio-secret-key
MINIO_BUCKET=earth-sentinel
PORT=8080

# APIs com auth — nunca commitar valores reais; use .env (gitignored)
ALPHA_VANTAGE_KEY=your-key-here
MEDIACLOUD_API_KEY=your-key-here

# Nenhuma chave necessária para:
# USGS, NOAA SWPC, NASA EONET, GDACS, Open-Meteo, Stooq, GDELT
```

---

## 7. Ordem de dependências entre fases

```
Fase 0 → Fase 1 → Fase 2 → Fase 3 → Fase 4
                                         ↓
                      Fase 5 ←──────────┘
                         ↓
                      Fase 5.5 (reestruturação UX/UI multi-conteúdo)
                         ↓
                      Fase 5.6 (migração Aegis Sentinel / DESIGN.md)  ‖  M6 (limpeza legado)
                         ↓
              Fase 6 ‖ Fase 7 ‖ Fase 8
                                   ↓
                                Fase 9
```

Fase 5 requer fase 3 (backend servindo dados) e fase 1 (abstrações JS preparadas).
Fase 5.5 requer fase 5 e bloqueia as fases 6–8: os novos temas devem nascer compondo
as primitivas (`<content-card>`, `<feed-list>`, etc.), não copiando o painel de
extreme-events.
Fase 5.6 requer 5.5 M1–M3 e também bloqueia 6–8: temas novos nascem no design Aegis
(`DESIGN.md`), não no dark glass. M6 (limpeza de legado JS) é paralelizável com 5.6.
Fases 6, 7, 8 são independentes entre si e podem ser paralelizadas após 5.6.

---

## 8. Critérios de qualidade por fase

Antes de avançar para a próxima fase, verificar:

- [ ] `npm test` passa sem falhas
- [ ] `go test ./...` passa sem falhas (a partir da fase 2)
- [ ] App abre e funciona no Chrome mobile (DevTools → device toolbar)
- [ ] Nenhuma chave de API exposta no código-fonte ou nos logs do browser
- [ ] Nenhum `console.error` em operações de rede esperadas (apenas `console.warn`)
- [ ] Nenhuma chamada a API externa diretamente do browser (a partir da fase 3)

---

## 9. Inconsistências a resolver (herdadas)

| Item | Ação |
|---|---|
| `public/js/notifications.js` ausente no repo mas importado em `app.js` | Fase 0: verificar e versionar ou remover import |
| `public/css/style.css` existe mas não está linkado — arquivo morto | Fase 0: deletar |
| `risk-panel.css` referenciado no HTML mas não listado no CLAUDE.md | Fase 0: atualizar CLAUDE.md |
| `nws.js` listado no CLAUDE.md mas ausente no repo atual | Fase 0: confirmar se foi removido ou nunca criado |
| `public/js/api/samples/` presente no CLAUDE.md mas não verificado no repo | Fase 0: confirmar presença |

---

## 10. Métricas de sucesso da plataforma

| Métrica | Alvo |
|---|---|
| Tempo de resposta `/api/themes/:id/feed` (Redis hit) | < 10ms |
| Tempo de resposta `/api/themes/:id/feed` (DB miss) | < 200ms |
| Tempo de boot do app no mobile (3G) | < 4s |
| Número de APIs externas chamadas diretamente pelo browser | 0 |
| Cobertura de testes Go (funções puras de domínio) | ≥ 80% |
| Temas implementados ao final | 4 |
| Novas fontes adicionáveis sem modificar código de infraestrutura | ✅ |

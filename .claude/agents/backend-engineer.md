# Agente: Backend Engineer

## Função

Especialista no backend Go da plataforma Earth Sentinel: domínio de dados (`ContentItem`),
ingestores, handlers HTTP, stores (PostgreSQL/Redis), scheduler de ingestão e infraestrutura.

> **Contexto do projeto:** O backend Go é a única camada que faz fetches a APIs externas.
> O browser nunca chama APIs externas — apenas consome o Go backend via Node.js proxy.

---

## Stack

| Componente | Tecnologia |
|---|---|
| Linguagem | Go 1.21+ |
| HTTP router | `net/http` padrão (ou chi para roteamento avançado) |
| Banco de dados | PostgreSQL 15+ via `pgx/v5` |
| Cache / fila | Redis 7+ via `go-redis/v9` |
| Object storage | MinIO via `minio-go/v7` |
| Logs | `log/slog` (estruturado, JSON em produção) |
| Testes | `testing` padrão + `httptest` |

---

## Domain Model

### `ContentItem` — contrato canônico

```go
// backend/internal/domain/content.go

type ContentItem struct {
    ID          string
    ThemeID     string
    Type        string
    SourceID    string
    Title       string       // ≤ 80 chars
    Description string       // ≤ 300 chars
    PublishedAt time.Time
    ExpiresAt   *time.Time   // nil quando não há expiração explícita
    Geo         *GeoPoint    // nil para finanças / notícias sem localização
    Severity    *int         // nil quando não aplicável; 1–5
    Confidence  *float64     // nil quando não aplicável; 0.0–1.0
    Metadata    map[string]any
    Tags        []string
    CreatedAt   time.Time
    UpdatedAt   time.Time
}

type GeoPoint struct {
    Lat      float64
    Lng      float64
    RadiusKm float64
}
```

### Interfaces obrigatórias

```go
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
    UserLat float64
    UserLng float64
    Now     time.Time
}
```

---

## Estrutura de Pacotes

```
backend/internal/
├── domain/
│   ├── content.go     # structs + interfaces
│   └── scoring.go     # funções puras: haversine, decay, risk score
├── theme/
│   ├── registry.go    # ThemeRegistry: Register(Theme), Get(id), All()
│   └── [nome]/
│       ├── theme.go   # implementa Theme interface
│       ├── scoring.go # lógica de score específica (opcional)
│       └── sources/
│           └── *.go   # cada arquivo = um Source
├── ingest/
│   ├── scheduler.go   # lança goroutine por source com time.Ticker
│   └── worker.go      # retry com backoff exponencial
├── store/
│   ├── postgres/
│   │   └── content.go # Upsert, GetFeed, Expire
│   └── redis/
│       ├── cache.go   # GetFeed / SetFeed com TTL
│       └── ratelimit.go # sliding window (Alpha Vantage 5 req/min)
├── api/
│   ├── handler/
│   │   ├── themes.go  # GET /api/themes, GET /api/themes/:id/feed
│   │   ├── sources.go # GET /api/sources/status
│   │   ├── live.go    # WebSocket / SSE /api/live
│   │   └── health.go  # GET /api/health
│   └── middleware/
│       ├── cors.go
│       └── ratelimit.go
└── platform/
    ├── config.go      # os.Getenv com defaults e validação
    └── minio.go       # upload / presigned URL
```

---

## Padrão de Ingestor (Source)

```go
// backend/internal/theme/extreme/sources/usgs.go

package sources

const usgsID = "usgs"

type USGSSource struct {
    httpClient *http.Client
}

func NewUSGS() *USGSSource {
    return &USGSSource{httpClient: &http.Client{Timeout: 15 * time.Second}}
}

func (s *USGSSource) ID()       string        { return usgsID }
func (s *USGSSource) ThemeID()  string        { return "extreme-events" }
func (s *USGSSource) Interval() time.Duration { return 10 * time.Minute }

func (s *USGSSource) Fetch(ctx context.Context) ([]domain.ContentItem, error) {
    req, _ := http.NewRequestWithContext(ctx, "GET", usgsURL, nil)
    resp, err := s.httpClient.Do(req)
    if err != nil { return nil, fmt.Errorf("usgs fetch: %w", err) }
    defer resp.Body.Close()
    if resp.StatusCode != 200 {
        return nil, fmt.Errorf("usgs HTTP %d", resp.StatusCode)
    }
    var data usgsResponse
    if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
        return nil, fmt.Errorf("usgs decode: %w", err)
    }
    items := make([]domain.ContentItem, 0, len(data.Features))
    for _, f := range data.Features {
        item, err := featureToContentItem(f)
        if err != nil { continue }  // item inválido — pular silenciosamente
        items = append(items, item)
    }
    slog.Info("ingest complete", "source", usgsID, "items", len(items))
    return items, nil
}

// Funções puras exportadas para testes
func MagnitudeToSeverity(mag float64) int {
    switch {
    case mag >= 8: return 5
    case mag >= 7: return 4
    case mag >= 6: return 3
    case mag >= 5: return 2
    default:       return 1
    }
}

func FeatureToContentItem(f Feature) (domain.ContentItem, error) { ... }
```

---

## Scheduler de Ingestão

```go
// backend/internal/ingest/scheduler.go

type Scheduler struct {
    registry *theme.Registry
    store    *postgres.Store
    cache    *redis.Cache
}

func (s *Scheduler) Start(ctx context.Context) {
    for _, theme := range s.registry.All() {
        for _, source := range theme.Sources() {
            go s.runSource(ctx, source)
        }
    }
}

func (s *Scheduler) runSource(ctx context.Context, src domain.Source) {
    // Ingestão imediata ao iniciar
    s.ingest(ctx, src)
    ticker := time.NewTicker(src.Interval())
    defer ticker.Stop()
    for {
        select {
        case <-ctx.Done(): return
        case <-ticker.C: s.ingest(ctx, src)
        }
    }
}

func (s *Scheduler) ingest(ctx context.Context, src domain.Source) {
    items, err := src.Fetch(ctx)
    if err != nil {
        slog.Warn("ingest failed", "source", src.ID(), "error", err)
        return
    }
    if err := s.store.UpsertItems(ctx, items); err != nil {
        slog.Error("store upsert failed", "source", src.ID(), "error", err)
        return
    }
    s.cache.Invalidate(ctx, src.ThemeID())
}
```

---

## API Handlers

```go
// GET /api/themes/:id/feed
func (h *ThemeHandler) GetFeed(w http.ResponseWriter, r *http.Request) {
    themeID := r.PathValue("id")

    // 1. Tenta Redis (cache quente)
    if items, ok := h.cache.GetFeed(r.Context(), themeID); ok {
        json.NewEncoder(w).Encode(items)
        return
    }

    // 2. PostgreSQL
    items, err := h.store.GetFeed(r.Context(), themeID, store.FeedOptions{
        Limit:  100,
        Offset: 0,
    })
    if err != nil {
        http.Error(w, `{"error":"internal"}`, 500)
        return
    }

    // 3. Cacheia no Redis
    h.cache.SetFeed(r.Context(), themeID, items, ttlByTheme[themeID])

    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(items)
}
```

---

## Rate Limiting (Alpha Vantage — 5 req/min)

```go
// backend/internal/store/redis/ratelimit.go

type RateLimiter struct{ client *redis.Client }

// Allow retorna true se a ação pode prosseguir (sliding window)
func (r *RateLimiter) Allow(ctx context.Context, key string, limit int, window time.Duration) bool {
    now := time.Now().UnixMilli()
    windowStart := now - window.Milliseconds()
    pipe := r.client.Pipeline()
    pipe.ZRemRangeByScore(ctx, key, "0", strconv.FormatInt(windowStart, 10))
    pipe.ZCard(ctx, key)
    results, _ := pipe.Exec(ctx)
    count := results[1].(*redis.IntCmd).Val()
    if count >= int64(limit) { return false }
    r.client.ZAdd(ctx, key, redis.Z{Score: float64(now), Member: now})
    r.client.Expire(ctx, key, window)
    return true
}
```

---

## Migrations SQL

```sql
-- backend/migrations/001_init.sql

CREATE TABLE themes (
    id      text PRIMARY KEY,
    label   text NOT NULL,
    enabled bool NOT NULL DEFAULT true
);

CREATE TABLE sources (
    id           text PRIMARY KEY,
    theme_id     text NOT NULL REFERENCES themes(id),
    label        text NOT NULL,
    interval_sec int  NOT NULL DEFAULT 600
);

CREATE TABLE content_items (
    id           text PRIMARY KEY,
    theme_id     text NOT NULL,
    type         text NOT NULL,
    source_id    text NOT NULL,
    title        text NOT NULL,
    description  text NOT NULL DEFAULT '',
    published_at timestamptz NOT NULL,
    expires_at   timestamptz,
    geo          jsonb,           -- { lat, lng, radius_km } ou null
    severity     int,
    confidence   float,
    metadata     jsonb NOT NULL DEFAULT '{}',
    tags         text[] NOT NULL DEFAULT '{}',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_feed ON content_items (theme_id, published_at DESC);
CREATE INDEX idx_content_geo   ON content_items USING gin(geo);
```

---

## Testes Go

```go
// Funções puras de domínio — sem I/O
func TestMagnitudeToSeverity(t *testing.T) {
    cases := []struct { mag float64; want int }{
        {8.5, 5}, {7.0, 4}, {6.5, 3}, {5.2, 2}, {4.5, 1},
    }
    for _, c := range cases {
        if got := MagnitudeToSeverity(c.mag); got != c.want {
            t.Errorf("mag=%.1f: got %d, want %d", c.mag, got, c.want)
        }
    }
}

// Handler com httptest
func TestGetFeed(t *testing.T) {
    handler := NewThemeHandler(mockStore, mockCache)
    req := httptest.NewRequest("GET", "/api/themes/extreme-events/feed", nil)
    rec := httptest.NewRecorder()
    handler.GetFeed(rec, req)
    if rec.Code != 200 { t.Fatalf("got %d", rec.Code) }
}

// Ingestor com HTTP mock
func TestUSGSFetch(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        json.NewEncoder(w).Encode(loadFixture("usgs_response.json"))
    }))
    defer srv.Close()
    source := NewUSGSWithURL(srv.URL)
    items, err := source.Fetch(t.Context())
    if err != nil { t.Fatal(err) }
    if len(items) == 0 { t.Fatal("expected items") }
}
```

---

## Diagnóstico Comum

### Backend não inicia

1. `DATABASE_URL` correto? `go run ./cmd/api 2>&1` — ver logs slog
2. Migration rodou? `psql $DATABASE_URL -f migrations/001_init.sql`
3. Redis acessível? `redis-cli -u $REDIS_URL ping`

### Ingestor não persiste dados

1. Log `ingest complete` aparece? Se não, `src.Fetch()` está retornando erro
2. `store.UpsertItems()` retorna erro? Verificar schema da tabela
3. Cache invalidado? `redis-cli KEYS "*"` — ver se a key do tema está presente

### Feed retorna vazio

1. `content_items` tem registros? `SELECT count(*) FROM content_items WHERE theme_id='extreme-events'`
2. TTL do cache expirou? `redis-cli TTL "feed:extreme-events"`
3. `expires_at < now`? Verificar se filtro de expiração está correto no query

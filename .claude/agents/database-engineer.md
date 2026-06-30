# Agente: Database Engineer

## Missão

Projetar e implementar a camada de persistência da plataforma Earth Sentinel:
schema PostgreSQL, índices, repositórios Go, estratégia de cache Redis e
armazenamento de objetos MinIO.

---

## Responsabilidades

- Criar e manter migrations SQL numeradas (`backend/migrations/`)
- Implementar repositórios PostgreSQL (`backend/internal/store/postgres/`)
- Implementar cache Redis (`backend/internal/store/redis/`)
- Implementar cliente MinIO (`backend/internal/platform/minio.go`)
- Projetar índices para queries de feed (por `theme_id`, `published_at`, `geo`)
- Implementar upsert idempotente por `ContentItem.id`
- Gerenciar TTL de cache por tema

---

## Escopo Permitido

```
backend/internal/store/
backend/internal/platform/
backend/migrations/
```

---

## Escopo Proibido

- `backend/internal/api/` — handlers HTTP
- `backend/internal/theme/` — lógica de domínio e providers
- `public/` — qualquer arquivo frontend
- Regras de negócio (scoring, lifecycle, tipo de evento)

---

## Schema PostgreSQL

### Tabela principal: `content_items`

```sql
-- backend/migrations/001_init.sql

CREATE TABLE content_items (
    id           TEXT        PRIMARY KEY,
    theme_id     TEXT        NOT NULL,
    type         TEXT        NOT NULL,
    source_id    TEXT        NOT NULL,
    title        TEXT        NOT NULL,
    description  TEXT        NOT NULL DEFAULT '',
    published_at TIMESTAMPTZ NOT NULL,
    expires_at   TIMESTAMPTZ,
    geo          JSONB,
    severity     SMALLINT    CHECK (severity BETWEEN 1 AND 5),
    confidence   DOUBLE PRECISION CHECK (confidence BETWEEN 0 AND 1),
    metadata     JSONB       NOT NULL DEFAULT '{}',
    tags         TEXT[]      NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para as queries mais frequentes
CREATE INDEX idx_content_items_theme_published
    ON content_items (theme_id, published_at DESC);

CREATE INDEX idx_content_items_source
    ON content_items (source_id);

CREATE INDEX idx_content_items_type
    ON content_items (theme_id, type);

-- Índice GiST para queries geográficas (extension necessária)
-- CREATE EXTENSION IF NOT EXISTS postgis;
-- ALTER TABLE content_items ADD COLUMN geo_point GEOMETRY(Point, 4326);
-- CREATE INDEX idx_content_items_geo ON content_items USING GIST (geo_point);
```

### Tabela de temas

```sql
CREATE TABLE themes (
    id      TEXT PRIMARY KEY,
    label   TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO themes (id, label) VALUES
    ('extreme-events', 'Eventos Extremos'),
    ('news',           'Notícias'),
    ('weather',        'Clima'),
    ('finance',        'Mercado Financeiro');
```

### Convenções de migration

```
001_init.sql              — schema base
002_add_theme_x.sql       — novo tema (INSERT em themes, novos índices)
003_add_index_y.sql       — índice de performance
004_alter_table_z.sql     — alterações de schema

Nunca editar migrations existentes — criar nova migration para correções.
Cada migration deve ser idempotente onde possível (IF NOT EXISTS).
```

---

## Repositório PostgreSQL

```go
// backend/internal/store/postgres/content_items.go

package postgres

import (
    "context"
    "database/sql"
    "fmt"
    "time"

    "github.com/earth-sentinel/backend/internal/domain"
)

type ContentItemRepository struct {
    db *sql.DB
}

func NewContentItemRepository(db *sql.DB) *ContentItemRepository {
    return &ContentItemRepository{db: db}
}

// UpsertItems — idempotente por ContentItem.ID
func (r *ContentItemRepository) UpsertItems(ctx context.Context, items []domain.ContentItem) error {
    if len(items) == 0 { return nil }

    for _, item := range items {
        if err := r.upsertOne(ctx, item); err != nil {
            return fmt.Errorf("upsert %s: %w", item.ID, err)
        }
    }
    return nil
}

func (r *ContentItemRepository) upsertOne(ctx context.Context, item domain.ContentItem) error {
    _, err := r.db.ExecContext(ctx, `
        INSERT INTO content_items
            (id, theme_id, type, source_id, title, description,
             published_at, expires_at, geo, severity, confidence,
             metadata, tags, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
        ON CONFLICT (id) DO UPDATE SET
            title        = EXCLUDED.title,
            description  = EXCLUDED.description,
            published_at = EXCLUDED.published_at,
            expires_at   = EXCLUDED.expires_at,
            geo          = EXCLUDED.geo,
            severity     = EXCLUDED.severity,
            confidence   = EXCLUDED.confidence,
            metadata     = EXCLUDED.metadata,
            tags         = EXCLUDED.tags,
            updated_at   = now()
    `,
        item.ID, item.ThemeID, item.Type, item.SourceID,
        item.Title, item.Description, item.PublishedAt,
        item.ExpiresAt, geoToJSON(item.Geo),
        item.Severity, item.Confidence,
        item.Metadata, item.Tags,
    )
    return err
}

// QueryByTheme — lê feed com filtros opcionais
func (r *ContentItemRepository) QueryByTheme(
    ctx context.Context,
    themeID string,
    opts QueryOptions,
) ([]domain.ContentItem, error) {
    rows, err := r.db.QueryContext(ctx, `
        SELECT id, theme_id, type, source_id, title, description,
               published_at, expires_at, geo, severity, confidence,
               metadata, tags, created_at, updated_at
        FROM content_items
        WHERE theme_id    = $1
          AND published_at > $2
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY published_at DESC
        LIMIT $3
    `, themeID, opts.Since, opts.Limit)
    if err != nil { return nil, err }
    defer rows.Close()

    return scanItems(rows)
}

type QueryOptions struct {
    Since time.Time
    Limit int
    Type  string // opcional — filtra por ContentItem.type
}
```

---

## Cache Redis

```go
// backend/internal/store/redis/feed_cache.go

package redis

import (
    "context"
    "encoding/json"
    "fmt"
    "time"

    "github.com/redis/go-redis/v9"
    "github.com/earth-sentinel/backend/internal/domain"
)

const feedCacheTTL = 2 * time.Minute

type FeedCache struct {
    client *redis.Client
}

func (c *FeedCache) GetFeed(ctx context.Context, themeID string) ([]domain.ContentItem, bool) {
    key  := fmt.Sprintf("feed:%s", themeID)
    data, err := c.client.Get(ctx, key).Bytes()
    if err != nil { return nil, false }

    var items []domain.ContentItem
    if err := json.Unmarshal(data, &items); err != nil { return nil, false }
    return items, true
}

func (c *FeedCache) SetFeed(ctx context.Context, themeID string, items []domain.ContentItem) error {
    key  := fmt.Sprintf("feed:%s", themeID)
    data, err := json.Marshal(items)
    if err != nil { return err }
    return c.client.Set(ctx, key, data, feedCacheTTL).Err()
}

func (c *FeedCache) InvalidateFeed(ctx context.Context, themeID string) {
    c.client.Del(ctx, fmt.Sprintf("feed:%s", themeID))
}
```

### Rate limiter Redis (sliding window)

```go
// backend/internal/store/redis/rate_limiter.go

func (r *RateLimiter) Allow(ctx context.Context, key string, maxReqs int, window time.Duration) bool {
    now := time.Now().UnixMilli()
    windowStart := now - window.Milliseconds()

    pipe := r.client.Pipeline()
    pipe.ZRemRangeByScore(ctx, key, "0", fmt.Sprintf("%d", windowStart))
    pipe.ZAdd(ctx, key, redis.Z{Score: float64(now), Member: now})
    pipe.ZCard(ctx, key)
    pipe.Expire(ctx, key, window)

    cmds, err := pipe.Exec(ctx)
    if err != nil { return true } // falha silenciosa — permite request

    count := cmds[2].(*redis.IntCmd).Val()
    return count <= int64(maxReqs)
}
```

---

## Padrão de Handler com Cache → Fallback

O database-engineer define a interface Store. O handler usa:

```go
// Padrão: cache Redis → fallback PostgreSQL
func (h *FeedHandler) GetFeed(w http.ResponseWriter, r *http.Request) {
    themeID := chi.URLParam(r, "themeID")

    // 1. Tentar cache
    if items, ok := h.cache.GetFeed(r.Context(), themeID); ok {
        json.NewEncoder(w).Encode(items)
        return
    }

    // 2. Fallback: banco
    items, err := h.repo.QueryByTheme(r.Context(), themeID, defaultOpts())
    if err != nil {
        http.Error(w, `{"error":"internal"}`, 500)
        return
    }

    // 3. Popular cache
    h.cache.SetFeed(r.Context(), themeID, items)
    json.NewEncoder(w).Encode(items)
}
```

---

## MinIO — Thumbnails e Snapshots

```go
// backend/internal/platform/minio.go

package platform

import (
    "context"
    "io"

    "github.com/minio/minio-go/v7"
)

type ObjectStore struct {
    client *minio.Client
    bucket string
}

func (s *ObjectStore) PutThumbnail(ctx context.Context, key string, r io.Reader, size int64) error {
    _, err := s.client.PutObject(ctx, s.bucket, "thumbnails/"+key, r, size,
        minio.PutObjectOptions{ContentType: "image/jpeg"})
    return err
}

func (s *ObjectStore) PutSnapshot(ctx context.Context, key string, data []byte) error {
    // Salvar snapshot bruto de resposta de API (para debug/replay)
    // ...
    return nil
}
```

**Uso de MinIO:** apenas para assets (thumbnails, snapshots). Nunca armazenar
`ContentItem` em MinIO — PostgreSQL é a fonte de verdade para dados estruturados.

---

## Critérios de Qualidade

- [ ] Toda migration é idempotente (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`)
- [ ] Migrations nunca são editadas retroativamente — sempre nova migration
- [ ] `UpsertItems` é idempotente: rodar N vezes = mesmo resultado que 1 vez
- [ ] Índices criados para colunas usadas em `WHERE` e `ORDER BY` das queries principais
- [ ] Sem N+1 queries: `UpsertItems` usa pipeline ou batch, nunca loop de 1 query por item
- [ ] `QueryByTheme` filtra `expires_at > now()` no SQL, não na aplicação
- [ ] Redis TTL calibrado: feed cache 2min, rate limiter janela conforme a API

## Critérios de Aprovação (pelo Tech Lead)

- [ ] `go test ./internal/store/...` passa
- [ ] `EXPLAIN ANALYZE` nas queries principais confirma uso de índice
- [ ] Schema validado contra `.claude/schematics/content-item.md`
- [ ] Upsert testado com item duplicado (mesma ingestão 2x = sem duplicata no banco)

package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/lib/pq"

	"github.com/earth-sentinel/backend/internal/domain"
)

type ContentItemRepository struct {
	db *sql.DB
}

func NewContentItemRepository(db *sql.DB) *ContentItemRepository {
	return &ContentItemRepository{db: db}
}

type QueryOptions struct {
	Since time.Time // limite inferior de published_at (exclusivo)
	Until time.Time // limite superior de published_at (inclusivo); zero = sem teto
	Limit int
	Type  string
}

func DefaultQueryOptions() QueryOptions {
	return QueryOptions{
		Since: time.Now().Add(-24 * time.Hour),
		Limit: 100,
	}
}

func (r *ContentItemRepository) UpsertItems(ctx context.Context, items []domain.ContentItem) error {
	if len(items) == 0 {
		return nil
	}
	for _, item := range items {
		if err := r.upsertOne(ctx, item); err != nil {
			return fmt.Errorf("upsert %s: %w", item.ID, err)
		}
	}
	return nil
}

func (r *ContentItemRepository) upsertOne(ctx context.Context, item domain.ContentItem) error {
	geoJSON, err := geoToJSON(item.Geo)
	if err != nil {
		return err
	}
	metaJSON, err := json.Marshal(item.Metadata)
	if err != nil {
		return err
	}
	if item.Tags == nil {
		item.Tags = []string{}
	}

	_, err = r.db.ExecContext(ctx, `
		INSERT INTO content_items
			(id, theme_id, type, source_id, title, description,
			 published_at, expires_at, geo, severity, confidence,
			 metadata, tags, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),now())
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
		item.ExpiresAt, geoJSON,
		item.Severity, item.Confidence,
		metaJSON, pq.Array(item.Tags),
	)
	return err
}

func (r *ContentItemRepository) QueryByTheme(
	ctx context.Context,
	themeID string,
	opts QueryOptions,
) ([]domain.ContentItem, error) {
	limit := opts.Limit
	if limit <= 0 {
		limit = 100
	}

	// Teto opcional: nil quando não informado (zero time) → cláusula vira no-op.
	var until interface{}
	if !opts.Until.IsZero() {
		until = opts.Until
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT id, theme_id, type, source_id, title, description,
		       published_at, expires_at, geo, severity, confidence,
		       metadata, tags, created_at, updated_at
		FROM content_items
		WHERE theme_id     = $1
		  AND published_at > $2
		  AND ($5::timestamptz IS NULL OR published_at <= $5)
		  AND (expires_at IS NULL OR expires_at > now())
		  AND ($4 = '' OR type = $4)
		ORDER BY severity DESC NULLS LAST, published_at DESC
		LIMIT $3
	`, themeID, opts.Since, limit, opts.Type, until)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanRows(rows)
}

func (r *ContentItemRepository) GetByID(ctx context.Context, id string) (domain.ContentItem, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, theme_id, type, source_id, title, description,
		       published_at, expires_at, geo, severity, confidence,
		       metadata, tags, created_at, updated_at
		FROM content_items WHERE id = $1 LIMIT 1
	`, id)
	if err != nil {
		return domain.ContentItem{}, err
	}
	defer rows.Close()

	items, err := scanRows(rows)
	if err != nil {
		return domain.ContentItem{}, err
	}
	if len(items) == 0 {
		return domain.ContentItem{}, fmt.Errorf("item not found: %s", id)
	}
	return items[0], nil
}

// InvalidateFeed satisfies the ingest.Storer interface — postgres layer is a no-op
// (invalidation is handled by the redis layer in the combined store).
func (r *ContentItemRepository) InvalidateFeed(_ context.Context, _ string) {}

func geoToJSON(g *domain.GeoPoint) ([]byte, error) {
	if g == nil {
		return nil, nil
	}
	return json.Marshal(g)
}

func scanRows(rows *sql.Rows) ([]domain.ContentItem, error) {
	// Non-nil so an empty feed serializes as `[]`, not `null`.
	items := []domain.ContentItem{}
	for rows.Next() {
		var item domain.ContentItem
		var geoJSON  []byte
		var metaJSON []byte
		var expiresAt *time.Time

		err := rows.Scan(
			&item.ID, &item.ThemeID, &item.Type, &item.SourceID,
			&item.Title, &item.Description, &item.PublishedAt,
			&expiresAt, &geoJSON,
			&item.Severity, &item.Confidence,
			&metaJSON, pq.Array(&item.Tags),
			&item.CreatedAt, &item.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		item.ExpiresAt = expiresAt
		if geoJSON != nil {
			var g domain.GeoPoint
			if err := json.Unmarshal(geoJSON, &g); err == nil {
				item.Geo = &g
			}
		}
		if metaJSON != nil {
			json.Unmarshal(metaJSON, &item.Metadata) //nolint:errcheck
		}
		if item.Tags == nil {
			item.Tags = []string{}
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func Open(dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	return db, nil
}

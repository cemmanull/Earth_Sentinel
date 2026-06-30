-- Earth Sentinel — Initial schema
-- Migration 001: content_items, themes, indexes

CREATE TABLE IF NOT EXISTS themes (
    id      TEXT PRIMARY KEY,
    label   TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO themes (id, label) VALUES
    ('extreme-events', 'Eventos Extremos'),
    ('news',           'Notícias'),
    ('weather',        'Clima'),
    ('finance',        'Mercado Financeiro')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS content_items (
    id           TEXT        PRIMARY KEY,
    theme_id     TEXT        NOT NULL REFERENCES themes(id),
    type         TEXT        NOT NULL,
    source_id    TEXT        NOT NULL,
    title        TEXT        NOT NULL,
    description  TEXT        NOT NULL DEFAULT '',
    published_at TIMESTAMPTZ NOT NULL,
    expires_at   TIMESTAMPTZ,
    geo          JSONB,
    severity     SMALLINT    CHECK (severity BETWEEN 1 AND 5),
    confidence   DOUBLE PRECISION CHECK (confidence BETWEEN 0.0 AND 1.0),
    metadata     JSONB       NOT NULL DEFAULT '{}',
    tags         TEXT[]      NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_content_items_theme_published
    ON content_items (theme_id, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_items_source
    ON content_items (source_id);

CREATE INDEX IF NOT EXISTS idx_content_items_type
    ON content_items (theme_id, type);

CREATE INDEX IF NOT EXISTS idx_content_items_expires
    ON content_items (expires_at)
    WHERE expires_at IS NOT NULL;

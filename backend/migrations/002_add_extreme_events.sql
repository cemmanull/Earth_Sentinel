-- Earth Sentinel — Migration 002: extreme-events theme indexes
-- A linha do tema 'extreme-events' já é inserida por 001_init.sql.

-- Índice parcial para feeds ordenados por criticidade dentro do tema extreme-events.
CREATE INDEX IF NOT EXISTS idx_extreme_events_severity
    ON content_items (published_at DESC, severity DESC)
    WHERE theme_id = 'extreme-events';

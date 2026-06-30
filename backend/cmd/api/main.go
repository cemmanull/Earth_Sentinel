package main

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/earth-sentinel/backend/internal/api/handler"
	"github.com/earth-sentinel/backend/internal/domain"
	"github.com/earth-sentinel/backend/internal/ingest"
	"github.com/earth-sentinel/backend/internal/platform"
	pgstore "github.com/earth-sentinel/backend/internal/store/postgres"
	redisstore "github.com/earth-sentinel/backend/internal/store/redis"
	"github.com/earth-sentinel/backend/internal/theme"
	"github.com/earth-sentinel/backend/internal/theme/extreme"
)

// combinedStore satisfies ingest.Storer by delegating UpsertItems to postgres
// and InvalidateFeed to redis.
type combinedStore struct {
	repo  *pgstore.ContentItemRepository
	cache *redisstore.FeedCache
}

func (s *combinedStore) UpsertItems(ctx context.Context, items []domain.ContentItem) error {
	return s.repo.UpsertItems(ctx, items)
}

func (s *combinedStore) InvalidateFeed(ctx context.Context, themeID string) {
	s.cache.InvalidateFeed(ctx, themeID)
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	cfg := platform.LoadConfig()

	db, err := pgstore.Open(cfg.DatabaseURL)
	if err != nil {
		slog.Error("db connect failed", "error", err)
		os.Exit(1)
	}
	defer db.Close()

	if err := pingDB(db); err != nil {
		slog.Warn("db not ready", "error", err)
	}

	redisClient := redisstore.NewClient(redisAddrFromURL(cfg.RedisURL))
	feedCache := redisstore.NewFeedCache(redisClient)

	repo := pgstore.NewContentItemRepository(db)
	registry := theme.NewRegistry()
	registry.Register(extreme.NewExtremeEventsTheme())

	store := &combinedStore{repo: repo, cache: feedCache}
	scheduler := ingest.NewScheduler(registry.AllSources(), store)

	healthH := handler.NewHealthHandler(db, feedCache)
	themesH := handler.NewThemesHandler(registry)
	feedH := handler.NewFeedHandler(repo, feedCache, registry)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", healthH.Check)
	mux.HandleFunc("GET /api/themes", themesH.List)
	mux.HandleFunc("GET /api/themes/{themeID}/feed", feedH.GetFeed)

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		slog.Info("starting Go backend", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	go scheduler.Start(ctx)

	<-ctx.Done()
	slog.Info("shutting down...")
	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(shutCtx) //nolint:errcheck
	slog.Info("shutdown complete")
}

func pingDB(db *sql.DB) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return db.PingContext(ctx)
}

func redisAddrFromURL(url string) string {
	// redis://localhost:6379 → localhost:6379
	if len(url) > 8 && url[:8] == "redis://" {
		return url[8:]
	}
	return url
}

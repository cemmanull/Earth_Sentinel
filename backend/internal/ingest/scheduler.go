package ingest

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/earth-sentinel/backend/internal/domain"
)

type Storer interface {
	UpsertItems(ctx context.Context, items []domain.ContentItem) error
	InvalidateFeed(ctx context.Context, themeID string)
}

type Scheduler struct {
	sources []domain.Source
	store   Storer
}

func NewScheduler(sources []domain.Source, store Storer) *Scheduler {
	return &Scheduler{sources: sources, store: store}
}

func (s *Scheduler) Start(ctx context.Context) {
	var wg sync.WaitGroup
	for _, src := range s.sources {
		wg.Add(1)
		go func(source domain.Source) {
			defer wg.Done()
			s.runSource(ctx, source)
		}(src)
	}
	wg.Wait()
}

func (s *Scheduler) runSource(ctx context.Context, src domain.Source) {
	s.fetch(ctx, src)

	ticker := time.NewTicker(src.Interval())
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.fetch(ctx, src)
		}
	}
}

func (s *Scheduler) fetch(ctx context.Context, src domain.Source) {
	start := time.Now()
	items, err := src.Fetch(ctx)
	if err != nil {
		slog.Warn("ingest failed",
			"source", src.ID(),
			"theme", src.ThemeID(),
			"error", err,
		)
		return
	}

	if err := s.store.UpsertItems(ctx, items); err != nil {
		slog.Error("store failed",
			"source", src.ID(),
			"error", err,
		)
		return
	}

	s.store.InvalidateFeed(ctx, src.ThemeID())

	slog.Info("ingest complete",
		"source", src.ID(),
		"theme", src.ThemeID(),
		"items", len(items),
		"duration_ms", time.Since(start).Milliseconds(),
	)
}

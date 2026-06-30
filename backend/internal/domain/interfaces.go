package domain

import (
	"context"
	"time"
)

type Source interface {
	ID() string
	ThemeID() string
	Fetch(ctx context.Context) ([]ContentItem, error)
	Interval() time.Duration
}

type Theme interface {
	ID() string
	Label() string
	Sources() []Source
	Score(item ContentItem, ctx ScoreContext) float64
}

type ScoreContext struct {
	UserLat float64
	UserLng float64
	Now     time.Time
}

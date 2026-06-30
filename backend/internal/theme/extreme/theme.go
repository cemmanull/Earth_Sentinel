package extreme

import (
	"github.com/earth-sentinel/backend/internal/domain"
	"github.com/earth-sentinel/backend/internal/theme/extreme/sources"
)

// ExtremeEventsTheme is the Theme implementation for natural and space-weather
// extreme events. It aggregates the six extreme-events data sources and scores
// each item by severity, proximity, confidence and recency decay.
type ExtremeEventsTheme struct{}

// NewExtremeEventsTheme constructs the extreme-events theme.
func NewExtremeEventsTheme() *ExtremeEventsTheme { return &ExtremeEventsTheme{} }

// Ensure ExtremeEventsTheme satisfies the domain.Theme contract at compile time.
var _ domain.Theme = (*ExtremeEventsTheme)(nil)

func (t *ExtremeEventsTheme) ID() string    { return "extreme-events" }
func (t *ExtremeEventsTheme) Label() string { return "Eventos Extremos" }

// Sources returns the six data sources for this theme. Each constructor returns
// a domain.Source.
func (t *ExtremeEventsTheme) Sources() []domain.Source {
	return []domain.Source{
		sources.NewUSGS(),
		sources.NewGDACS(),
		sources.NewNOAASWPC(),
		sources.NewEONET(),
		sources.NewOpenMeteo(),
		sources.NewOpenMeteoAQ(),
	}
}

// Score computes the risk contribution of a single item for the user described
// by ctx. The recency decay is derived from the item's age (ctx.Now -
// item.PublishedAt) and the half-life for its type, then fed into EventScore.
func (t *ExtremeEventsTheme) Score(item domain.ContentItem, ctx domain.ScoreContext) float64 {
	halfLifeH, _ := LifespanFor(item.Type)
	elapsedH := ctx.Now.Sub(item.PublishedAt).Hours()
	decay := DecayFactor(elapsedH, halfLifeH)
	return EventScore(item, ctx.UserLat, ctx.UserLng, decay)
}

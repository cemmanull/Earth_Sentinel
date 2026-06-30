package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/earth-sentinel/backend/internal/domain"
)

const (
	usgsDefaultURL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson"
	usgsInterval   = 10 * time.Minute
)

// usgsSource implements domain.Source for USGS earthquake data.
type usgsSource struct {
	baseURL    string
	httpClient *http.Client
}

// NewUSGS returns a USGS source using the default production endpoint.
func NewUSGS() domain.Source {
	return NewUSGSWithURL(usgsDefaultURL)
}

// NewUSGSWithURL returns a USGS source with an injectable base URL (for tests).
func NewUSGSWithURL(baseURL string) domain.Source {
	return &usgsSource{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 20 * time.Second},
	}
}

func (s *usgsSource) ID() string              { return "usgs" }
func (s *usgsSource) ThemeID() string         { return "extreme-events" }
func (s *usgsSource) Interval() time.Duration { return usgsInterval }

// Fetch retrieves the M≥4.5 weekly earthquake feed from USGS.
func (s *usgsSource) Fetch(ctx context.Context) ([]domain.ContentItem, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL, nil)
	if err != nil {
		return nil, fmt.Errorf("usgs build request: %w", err)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("usgs fetch: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("usgs fetch: HTTP %d", resp.StatusCode)
	}

	var feed usgsGeoJSONFeed
	if err := json.NewDecoder(resp.Body).Decode(&feed); err != nil {
		return nil, fmt.Errorf("usgs decode: %w", err)
	}

	now := time.Now().UTC()
	items := make([]domain.ContentItem, 0, len(feed.Features))

	for _, f := range feed.Features {
		item, ok := FeatureToItem(f)
		if !ok {
			continue
		}
		item.CreatedAt = now
		item.UpdatedAt = now

		if err := domain.Validate(item); err != nil {
			slog.Warn("usgs item invalid, skipping", "id", item.ID, "error", err)
			continue
		}
		items = append(items, item)
	}

	slog.Info("usgs ingest complete",
		"source", s.ID(),
		"theme", s.ThemeID(),
		"items", len(items),
		"total_features", len(feed.Features),
	)

	return items, nil
}

// ---- Exported pure functions (testable without I/O) ----

// MagnitudeToSeverity converts a Richter magnitude to a 1–5 severity scale.
// Mirrors the JS magnitudeToSeverity function exactly.
func MagnitudeToSeverity(mag float64) int {
	if mag >= 8 {
		return 5
	}
	if mag >= 7 {
		return 4
	}
	if mag >= 6 {
		return 3
	}
	if mag >= 5 {
		return 2
	}
	return 1
}

// FeatureToItem converts a GeoJSON feature from the USGS feed into a ContentItem.
// Returns (item, true) on success; (zero, false) if the feature should be skipped.
func FeatureToItem(f GeoJSONFeature) (domain.ContentItem, bool) {
	p := f.Properties
	coords := f.Geometry.Coordinates

	// Coordinates are [lng, lat, depth] in GeoJSON spec — do NOT invert
	if len(coords) < 2 {
		return domain.ContentItem{}, false
	}
	lng := coords[0]
	lat := coords[1]
	depth := 0.0
	if len(coords) >= 3 {
		depth = coords[2]
	}

	if p.Mag == nil || *p.Mag < 4.5 {
		return domain.ContentItem{}, false
	}
	mag := *p.Mag

	// id is derived from the USGS feature id — stable across ingestões
	if f.ID == "" {
		return domain.ContentItem{}, false
	}
	id := "usgs-" + f.ID

	severity := MagnitudeToSeverity(mag)

	var radiusKm float64
	switch {
	case mag >= 7:
		radiusKm = 500
	case mag >= 6:
		radiusKm = 200
	default:
		radiusKm = 100
	}

	publishedAt := time.Now().UTC()
	if p.Time != nil {
		publishedAt = time.UnixMilli(*p.Time).UTC()
	}

	place := ""
	if p.Place != nil {
		place = *p.Place
	}
	status := ""
	if p.Status != nil {
		status = *p.Status
	}

	title := domain.Truncate(
		fmt.Sprintf("M%.1f %s", mag, place),
		80,
	)
	description := domain.Truncate(
		fmt.Sprintf("Magnitude %.1f, profundidade %d km. %s", mag, int(depth), place),
		300,
	)

	item := domain.ContentItem{
		ID:          id,
		ThemeID:     "extreme-events",
		Type:        "earthquake",
		SourceID:    "usgs",
		Title:       title,
		Description: description,
		PublishedAt: publishedAt,
		Geo: &domain.GeoPoint{
			Lat:      lat,
			Lng:      lng,
			RadiusKm: radiusKm,
		},
		Severity:   domain.PtrInt(severity),
		Confidence: domain.PtrFloat(0.99),
		Metadata: map[string]any{
			"mag":    mag,
			"depth":  depth,
			"place":  place,
			"status": status,
		},
		Tags: []string{"earthquake", "seismic"},
	}

	return item, true
}

// ---- JSON structures (exported so tests can construct them directly) ----

type usgsGeoJSONFeed struct {
	Features []GeoJSONFeature `json:"features"`
}

// GeoJSONFeature represents a single earthquake feature from the USGS GeoJSON feed.
type GeoJSONFeature struct {
	ID         string           `json:"id"`
	Geometry   USGSGeometry     `json:"geometry"`
	Properties USGSFeatureProps `json:"properties"`
}

// USGSGeometry holds the GeoJSON geometry coordinates [lng, lat, depth].
type USGSGeometry struct {
	Coordinates []float64 `json:"coordinates"`
}

// USGSFeatureProps holds the USGS earthquake feature properties.
type USGSFeatureProps struct {
	Mag    *float64 `json:"mag"`
	Place  *string  `json:"place"`
	Time   *int64   `json:"time"`
	Status *string  `json:"status"`
	Title  *string  `json:"title"`
}

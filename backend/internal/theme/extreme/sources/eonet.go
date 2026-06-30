package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/earth-sentinel/backend/internal/domain"
)

const eonetDefaultBase = "https://eonet.gsfc.nasa.gov/api/v3/events"

// eonetCategoryMap maps EONET category IDs to ContentItem types.
// Ported from public/js/api/eonet.js EONET_CATEGORY_MAP.
var eonetCategoryMap = map[string]string{
	"wildfires":    "wildfire",
	"severeStorms": "severe_storm",
	"volcanoes":    "volcano",
	"earthquakes":  "earthquake",
	"floods":       "flood",
	"landslides":   "earthquake",
	"snow":         "severe_storm",
	"tempExtremes": "heat_wave",
	"drought":      "drought",
	"dustHaze":     "dust_storm",
}

// eonetAllowedTypes is the set of types this source produces (per spec).
var eonetAllowedTypes = map[string]bool{
	"wildfire":     true,
	"volcano":      true,
	"severe_storm": true,
	"flood":        true,
	"dust_storm":   true,
}

// EONETGeometry represents one geometry entry in the EONET event.
type EONETGeometry struct {
	MagnitudeValue *float64    `json:"magnitudeValue"`
	MagnitudeUnit  string      `json:"magnitudeUnit"`
	Date           string      `json:"date"`
	Type           string      `json:"type"`
	Coordinates    interface{} `json:"coordinates"`
}

// EONETCategory represents a category entry.
type EONETCategory struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// EONETEvent represents a single event from the EONET API response.
type EONETEvent struct {
	ID          string          `json:"id"`
	Title       string          `json:"title"`
	Description *string         `json:"description"`
	Link        string          `json:"link"`
	Closed      *string         `json:"closed"`
	Categories  []EONETCategory `json:"categories"`
	Geometry    []EONETGeometry `json:"geometry"`
}

// eonetResponse is the top-level EONET API response.
type eonetResponse struct {
	Events []EONETEvent `json:"events"`
}

// MapEONETCategory maps an EONET category ID to a ContentItem type string.
// Returns "" if the category is not recognised.
func MapEONETCategory(categoryID string) string {
	return eonetCategoryMap[categoryID]
}

// EONETEventToItem converts a raw EONETEvent into a domain.ContentItem.
// Returns (item, true) on success; (zero, false) when the event should be skipped.
func EONETEventToItem(e EONETEvent) (domain.ContentItem, bool) {
	if e.ID == "" || e.Title == "" {
		return domain.ContentItem{}, false
	}

	// Resolve type from categories.
	eventType := ""
	for _, cat := range e.Categories {
		if t := eonetCategoryMap[cat.ID]; t != "" {
			eventType = t
			break
		}
	}
	if eventType == "" {
		return domain.ContentItem{}, false
	}
	// Only emit allowed types.
	if !eonetAllowedTypes[eventType] {
		return domain.ContentItem{}, false
	}

	if len(e.Geometry) == 0 {
		return domain.ContentItem{}, false
	}

	// Use the last geometry entry (most recent track point).
	geom := e.Geometry[len(e.Geometry)-1]
	if geom.Coordinates == nil {
		return domain.ContentItem{}, false
	}

	var lat, lng float64
	switch geom.Type {
	case "Point":
		// EONET coordinates are [lng, lat] — DO NOT invert.
		coords, ok := geom.Coordinates.([]interface{})
		if !ok || len(coords) < 2 {
			return domain.ContentItem{}, false
		}
		lngF, ok1 := toFloat64(coords[0])
		latF, ok2 := toFloat64(coords[1])
		if !ok1 || !ok2 {
			return domain.ContentItem{}, false
		}
		lng = lngF
		lat = latF
	case "Polygon":
		coords, ok := geom.Coordinates.([]interface{})
		if !ok || len(coords) == 0 {
			return domain.ContentItem{}, false
		}
		ring, ok := coords[0].([]interface{})
		if !ok || len(ring) == 0 {
			return domain.ContentItem{}, false
		}
		var sumLat, sumLng float64
		count := 0
		for _, pt := range ring {
			pair, ok := pt.([]interface{})
			if !ok || len(pair) < 2 {
				continue
			}
			lngF, ok1 := toFloat64(pair[0])
			latF, ok2 := toFloat64(pair[1])
			if !ok1 || !ok2 {
				continue
			}
			sumLng += lngF
			sumLat += latF
			count++
		}
		if count == 0 {
			return domain.ContentItem{}, false
		}
		lat = sumLat / float64(count)
		lng = sumLng / float64(count)
	default:
		return domain.ContentItem{}, false
	}

	// Validate coordinates.
	if lat == 0 && lng == 0 {
		return domain.ContentItem{}, false
	}

	// Parse published_at from geometry date.
	publishedAt := time.Now().UTC()
	if geom.Date != "" {
		if t, err := time.Parse(time.RFC3339, geom.Date); err == nil {
			publishedAt = t
		}
	}

	// Build description from event description or fallback to title.
	desc := e.Title
	if e.Description != nil && *e.Description != "" {
		desc = *e.Description
	}

	// Collect category IDs for metadata.
	catIDs := make([]string, 0, len(e.Categories))
	for _, cat := range e.Categories {
		catIDs = append(catIDs, cat.ID)
	}

	now := time.Now().UTC()
	item := domain.ContentItem{
		ID:          "eonet-" + e.ID,
		ThemeID:     "extreme-events",
		Type:        eventType,
		SourceID:    "eonet",
		Title:       domain.Truncate(e.Title, 80),
		Description: domain.Truncate(desc, 300),
		PublishedAt: publishedAt,
		Geo: &domain.GeoPoint{
			Lat:      lat,
			Lng:      lng,
			RadiusKm: 150,
		},
		Severity:   domain.PtrInt(2),
		Confidence: domain.PtrFloat(0.75),
		Metadata: map[string]any{
			"eonet_id":   e.ID,
			"categories": catIDs,
		},
		Tags:      []string{"eonet", eventType},
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := domain.Validate(item); err != nil {
		return domain.ContentItem{}, false
	}
	return item, true
}

// eonetSource implements domain.Source for NASA EONET.
type eonetSource struct {
	baseURL    string
	httpClient *http.Client
}

// NewEONET returns a new EONET source using the default endpoint.
func NewEONET() domain.Source {
	return &eonetSource{
		baseURL:    eonetDefaultBase,
		httpClient: &http.Client{Timeout: 20 * time.Second},
	}
}

// NewEONETWithURL returns a new EONET source using a custom base URL (for tests).
func NewEONETWithURL(baseURL string) domain.Source {
	return &eonetSource{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 20 * time.Second},
	}
}

func (s *eonetSource) ID() string              { return "eonet" }
func (s *eonetSource) ThemeID() string         { return "extreme-events" }
func (s *eonetSource) Interval() time.Duration { return 30 * time.Minute }

func (s *eonetSource) Fetch(ctx context.Context) ([]domain.ContentItem, error) {
	url := s.baseURL + "?status=open&limit=100"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("eonet build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("eonet fetch: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("eonet fetch: HTTP %d", resp.StatusCode)
	}

	var raw eonetResponse
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("eonet decode: %w", err)
	}

	items := make([]domain.ContentItem, 0, len(raw.Events))
	for _, ev := range raw.Events {
		item, ok := EONETEventToItem(ev)
		if !ok {
			continue
		}
		items = append(items, item)
	}
	return items, nil
}

// toFloat64 converts an interface{} to float64, supporting both float64 and
// json.Number (which the standard decoder may produce depending on settings).
func toFloat64(v interface{}) (float64, bool) {
	switch val := v.(type) {
	case float64:
		return val, true
	case json.Number:
		f, err := val.Float64()
		return f, err == nil
	}
	return 0, false
}

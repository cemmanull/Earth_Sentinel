package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/earth-sentinel/backend/internal/domain"
)

const (
	gdacsDefaultURL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
	gdacsInterval   = 15 * time.Minute
)

// gdacsSource implements domain.Source for GDACS multi-hazard event data.
type gdacsSource struct {
	baseURL    string
	httpClient *http.Client
}

// NewGDACS returns a GDACS source using the default production endpoint.
func NewGDACS() domain.Source {
	return NewGDACSWithURL(gdacsDefaultURL)
}

// NewGDACSWithURL returns a GDACS source with an injectable base URL (for tests).
func NewGDACSWithURL(baseURL string) domain.Source {
	return &gdacsSource{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (s *gdacsSource) ID() string              { return "gdacs" }
func (s *gdacsSource) ThemeID() string         { return "extreme-events" }
func (s *gdacsSource) Interval() time.Duration { return gdacsInterval }

// gdacsEventTypes is the ordered list of GDACS event type codes to fetch.
var gdacsEventTypes = []string{"EQ", "VO", "TC", "FL", "DR", "WF", "TS"}

// gdacsAlertLevels is the list of alert levels to fetch per event type.
var gdacsAlertLevels = []string{"Green", "Orange", "Red"}

// Fetch retrieves all active GDACS events across all types and alert levels.
// It issues sequential requests per type (3 alert levels each) to stay within
// GDACS rate limits, then deduplicates by eventtype-eventid.
func (s *gdacsSource) Fetch(ctx context.Context) ([]domain.ContentItem, error) {
	allFeatures := make([]GDACSFeature, 0, 256)
	var failCount int

	for _, evType := range gdacsEventTypes {
		for _, level := range gdacsAlertLevels {
			url := fmt.Sprintf("%s?eventtype=%s&alertlevel=%s", s.baseURL, evType, level)
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
			if err != nil {
				failCount++
				slog.Warn("gdacs build request failed", "eventtype", evType, "level", level, "error", err)
				continue
			}

			resp, err := s.httpClient.Do(req)
			if err != nil {
				failCount++
				slog.Warn("gdacs fetch failed", "eventtype", evType, "level", level, "error", err)
				continue
			}

			if resp.StatusCode != http.StatusOK {
				resp.Body.Close()
				failCount++
				slog.Warn("gdacs HTTP error", "eventtype", evType, "level", level, "status", resp.StatusCode)
				continue
			}

			var feed gdacsFeatureCollection
			if err := json.NewDecoder(resp.Body).Decode(&feed); err != nil {
				resp.Body.Close()
				failCount++
				slog.Warn("gdacs decode failed", "eventtype", evType, "level", level, "error", err)
				continue
			}
			resp.Body.Close()

			allFeatures = append(allFeatures, feed.Features...)
		}
	}

	if failCount > 0 {
		slog.Warn("gdacs slices failed", "failed", failCount, "total", len(gdacsEventTypes)*len(gdacsAlertLevels))
	}

	// Deduplicate by eventtype-eventid (same event may appear across alert levels)
	seen := make(map[string]struct{}, len(allFeatures))
	now := time.Now().UTC()
	items := make([]domain.ContentItem, 0, len(allFeatures))

	for _, f := range allFeatures {
		key := fmt.Sprintf("%s-%d", f.Properties.Eventtype, f.Properties.Eventid)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}

		item, ok := GDACSEventToItem(f)
		if !ok {
			continue
		}
		item.CreatedAt = now
		item.UpdatedAt = now

		if err := domain.Validate(item); err != nil {
			slog.Warn("gdacs item invalid, skipping", "id", item.ID, "error", err)
			continue
		}
		items = append(items, item)
	}

	slog.Info("gdacs ingest complete",
		"source", "gdacs",
		"theme", "extreme-events",
		"items", len(items),
		"total_features", len(allFeatures),
	)

	return items, nil
}

// ---- Exported pure functions (testable without I/O) ----

// MapGDACSType maps a GDACS eventtype code to a canonical ContentItem type string.
// Returns "" for unknown codes.
func MapGDACSType(eventtype string) string {
	switch eventtype {
	case "EQ":
		return "earthquake"
	case "TC":
		return "hurricane"
	case "FL":
		return "flood"
	case "VO":
		return "volcano"
	case "DR":
		return "drought"
	case "WF":
		return "wildfire"
	case "TS":
		return "tsunami"
	default:
		return ""
	}
}

// GDACSAlertToSeverity converts a GDACS alert level string to a 1–5 severity.
// Uses episodealertlevel (current episode state), not alertlevel (historical peak).
func GDACSAlertToSeverity(level string) int {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "red":
		return 5
	case "orange":
		return 3
	case "green":
		return 1
	default:
		return 1
	}
}

// GDACSEventToItem converts a GDACS GeoJSON feature into a ContentItem.
// Returns (item, true) on success; (zero, false) if the feature should be skipped.
func GDACSEventToItem(f GDACSFeature) (domain.ContentItem, bool) {
	p := f.Properties

	// Validate geometry — coordinates are [lng, lat] in GeoJSON
	coords := f.Geometry.Coordinates
	if len(coords) < 2 {
		return domain.ContentItem{}, false
	}
	lng := coords[0]
	lat := coords[1]

	// Reject (0,0) placeholder coordinates
	if lat == 0 && lng == 0 {
		return domain.ContentItem{}, false
	}

	// Map event type
	itemType := MapGDACSType(p.Eventtype)
	if itemType == "" {
		return domain.ContentItem{}, false
	}

	// Validate required fields
	if p.Eventid == 0 {
		return domain.ContentItem{}, false
	}

	// episodealertlevel = current episode state (use for severity)
	// alertlevel = historical peak (fallback only)
	level := p.Episodealertlevel
	if level == "" {
		level = p.Alertlevel
	}
	if level == "" {
		level = "Green"
	}
	severity := GDACSAlertToSeverity(level)

	// id is stable: derived from eventtype + eventid
	id := fmt.Sprintf("gdacs-%s-%d", p.Eventtype, p.Eventid)

	// startTime = max(fromdate, todate) — last recorded activity
	publishedAt := gdacsMaxDate(p.Fromdate, p.Todate)

	// radiusKm follows JS logic: severity >= 4 → 500, >= 3 → 300, else 150
	var radiusKm float64
	switch {
	case severity >= 4:
		radiusKm = 500
	case severity >= 3:
		radiusKm = 300
	default:
		radiusKm = 150
	}

	// Title: prefer name, then eventname, fallback
	title := p.Name
	if title == "" {
		title = p.Eventname
	}
	if title == "" {
		title = fmt.Sprintf("%s event", p.Eventtype)
	}

	// Description: prefer description field, fallback
	desc := p.Description
	if desc == "" {
		country := p.Country
		if country == "" {
			country = "?"
		}
		desc = fmt.Sprintf("Level: %s. Country: %s", level, country)
	}

	item := domain.ContentItem{
		ID:          id,
		ThemeID:     "extreme-events",
		Type:        itemType,
		SourceID:    "gdacs",
		Title:       domain.Truncate(title, 80),
		Description: domain.Truncate(desc, 300),
		PublishedAt: publishedAt,
		Geo: &domain.GeoPoint{
			Lat:      lat,
			Lng:      lng,
			RadiusKm: radiusKm,
		},
		Severity:   domain.PtrInt(severity),
		Confidence: domain.PtrFloat(0.90),
		Metadata: map[string]any{
			"alertLevel": level,
			"country":    p.Country,
			"eventtype":  p.Eventtype,
			"episodeid":  p.Episodeid,
		},
		Tags: []string{itemType, "gdacs"},
	}

	return item, true
}

// gdacsMaxDate returns the later of two parsed date strings (or time.Now if both fail).
func gdacsMaxDate(a, b string) time.Time {
	ta := gdacsParseDate(a)
	tb := gdacsParseDate(b)

	switch {
	case ta != nil && tb != nil:
		if tb.After(*ta) {
			return *tb
		}
		return *ta
	case ta != nil:
		return *ta
	case tb != nil:
		return *tb
	default:
		return time.Now().UTC()
	}
}

// gdacsParseDate parses a GDACS date string; returns nil on failure.
func gdacsParseDate(s string) *time.Time {
	if s == "" {
		return nil
	}
	// GDACS uses "2006-01-02T15:04:05" format
	t, err := time.Parse("2006-01-02T15:04:05", s)
	if err != nil {
		return nil
	}
	ut := t.UTC()
	return &ut
}

// ---- JSON structures (exported so tests can construct them directly) ----

type gdacsFeatureCollection struct {
	Features []GDACSFeature `json:"features"`
}

// GDACSFeature represents a single event feature from the GDACS API response.
type GDACSFeature struct {
	Geometry   GDACSGeometry   `json:"geometry"`
	Properties GDACSProperties `json:"properties"`
}

// GDACSGeometry holds the GeoJSON geometry coordinates [lng, lat].
type GDACSGeometry struct {
	Coordinates []float64 `json:"coordinates"`
}

// GDACSProperties holds the GDACS event properties.
// Field names match the exact JSON keys returned by the GDACS API
// (confirmed from .claude/API/gdacs_exemple.json).
type GDACSProperties struct {
	Eventtype         string `json:"eventtype"`
	Eventid           int    `json:"eventid"`
	Episodeid         int    `json:"episodeid"`
	Eventname         string `json:"eventname"`
	Name              string `json:"name"`
	Description       string `json:"description"`
	Alertlevel        string `json:"alertlevel"`        // historical peak
	Episodealertlevel string `json:"episodealertlevel"` // current episode state (USE THIS)
	Country           string `json:"country"`
	Fromdate          string `json:"fromdate"`
	Todate            string `json:"todate"`
}

package sources

import (
	"context"
	"crypto/sha1"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/earth-sentinel/backend/internal/domain"
)

const (
	noaaDefaultURL = "https://services.swpc.noaa.gov/products/alerts.json"
	noaaInterval   = 5 * time.Minute
)

// GEO_ANCHORS are the 8 auroral anchor points used to distribute space-weather
// events across the globe. Space weather events have no real coordinates, so each
// alert is replicated once per anchor. This symbol is owned by noaa.go in this
// package — do NOT redefine in other files.
var GEO_ANCHORS = []domain.GeoPoint{
	{Lat: 69.6, Lng: 18.9, RadiusKm: 20000},   // Tromsø, Norway
	{Lat: 64.8, Lng: -147.7, RadiusKm: 20000}, // Fairbanks, Alaska
	{Lat: 64.1, Lng: -21.9, RadiusKm: 20000},  // Reykjavik, Iceland
	{Lat: 58.8, Lng: -94.2, RadiusKm: 20000},  // Churchill, Canada
	{Lat: 68.9, Lng: 33.1, RadiusKm: 20000},   // Murmansk, Russia
	{Lat: 65.0, Lng: 25.5, RadiusKm: 20000},   // Oulu, Finland
	{Lat: -54.8, Lng: -68.3, RadiusKm: 20000}, // Ushuaia, Argentina
	{Lat: -77.8, Lng: 166.7, RadiusKm: 20000}, // McMurdo, Antarctica
}

// noaaSource implements domain.Source for NOAA SWPC space weather alerts.
type noaaSource struct {
	baseURL    string
	httpClient *http.Client
}

// NewNOAASWPC returns a NOAA SWPC source using the default production endpoint.
func NewNOAASWPC() domain.Source {
	return NewNOAASWPCWithURL(noaaDefaultURL)
}

// NewNOAASWPCWithURL returns a NOAA SWPC source with an injectable base URL (for tests).
func NewNOAASWPCWithURL(baseURL string) domain.Source {
	return &noaaSource{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}

func (s *noaaSource) ID() string              { return "noaa-swpc" }
func (s *noaaSource) ThemeID() string         { return "extreme-events" }
func (s *noaaSource) Interval() time.Duration { return noaaInterval }

// Fetch retrieves NOAA SWPC alerts and converts each alert into N ContentItems
// (one per GEO_ANCHOR) so space weather events appear distributed on the map.
func (s *noaaSource) Fetch(ctx context.Context) ([]domain.ContentItem, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.baseURL, nil)
	if err != nil {
		return nil, fmt.Errorf("noaa build request: %w", err)
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("noaa fetch: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("noaa fetch: HTTP %d", resp.StatusCode)
	}

	var alerts []NOAAAlert
	if err := json.NewDecoder(resp.Body).Decode(&alerts); err != nil {
		return nil, fmt.Errorf("noaa decode: %w", err)
	}

	now := time.Now().UTC()
	items := make([]domain.ContentItem, 0, len(alerts)*len(GEO_ANCHORS))

	for _, alert := range alerts {
		anchorItems := NOAAAlertToItems(alert)
		for _, item := range anchorItems {
			item.CreatedAt = now
			item.UpdatedAt = now
			if err := domain.Validate(item); err != nil {
				slog.Warn("noaa item invalid, skipping", "id", item.ID, "error", err)
				continue
			}
			items = append(items, item)
		}
	}

	slog.Info("noaa ingest complete",
		"source", s.ID(),
		"theme", s.ThemeID(),
		"items", len(items),
		"alerts", len(alerts),
	)

	return items, nil
}

// ---- Exported pure functions (testable without I/O) ----

// ParseNOAAAlert maps a NOAA product_id to an event type string.
// Returns (eventType, true) on match; ("", false) if the alert should be ignored.
// Mirrors the JS parseAlertType function.
func ParseNOAAAlert(productID string) (string, bool) {
	if productID == "" {
		return "", false
	}
	id := strings.ToUpper(productID)

	switch {
	case rexAltEF.MatchString(id):
		return "radiation_storm", true
	case rexAltTP.MatchString(id):
		return "radio_blackout", true
	case rexAltKG.MatchString(id):
		return "geomagnetic_storm", true
	case rexAltXR.MatchString(id):
		return "solar_flare", true
	case rexCME.MatchString(id):
		return "cme", true
	case rexPOR.MatchString(id):
		return "radiation_storm", true
	default:
		return "", false
	}
}

// Compiled regexes for ParseNOAAAlert — mirrors the JS regex patterns exactly.
var (
	rexAltEF = regexp.MustCompile(`ALTEF`)
	rexAltTP = regexp.MustCompile(`ALTTP|WARK\d`)
	rexAltKG = regexp.MustCompile(`ALTK|ALTG|WATA|GEOMET`)
	rexAltXR = regexp.MustCompile(`ALTXMF|ALTXRF|ALTXRB|PRF`)
	rexCME   = regexp.MustCompile(`CME|ALTCME|WATA20`)
	rexPOR   = regexp.MustCompile(`WATPOR|ALTPOR`)
)

// rexMsgCode extracts the real alert code from the message body. NOAA's
// alerts.json puts the meaningful code (e.g. "ALTTP2", "WARK04") on the
// "Space Weather Message Code:" line, while product_id carries an unrelated
// routing id (e.g. "TIIA", "K04W") that does NOT match the type regexes.
var rexMsgCode = regexp.MustCompile(`(?i)Space Weather Message Code:\s*(\S+)`)

// extractMessageCode returns the alert code embedded in the message, or "" if
// the message has no "Space Weather Message Code:" line.
func extractMessageCode(message string) string {
	m := rexMsgCode.FindStringSubmatch(message)
	if len(m) < 2 {
		return ""
	}
	return strings.ToUpper(m[1])
}

// noaaCodeToSeverity extracts the trailing digit from a product_id and clamps to 1–5.
// Example: "ALTEF3" → 3, "ALTG5" → 5, "ALTK" → 2 (default).
func noaaCodeToSeverity(productID string) int {
	re := regexp.MustCompile(`(\d+)$`)
	m := re.FindString(strings.ToUpper(productID))
	if m == "" {
		return 2 // default per JS: parseInt('2', 10)
	}
	n := 0
	fmt.Sscanf(m, "%d", &n)
	if n < 1 {
		return 1
	}
	if n > 5 {
		return 5
	}
	return n
}

// noaaMsgHash returns a short stable hash of a message string (first 64 chars),
// used to build stable item IDs for space-weather events which lack a natural key.
func noaaMsgHash(message string) string {
	// Use up to 200 chars for stability; trim whitespace
	s := strings.TrimSpace(message)
	if len(s) > 200 {
		s = s[:200]
	}
	h := sha1.Sum([]byte(s))
	return fmt.Sprintf("%x", h[:6]) // 12 hex chars — short but collision-safe for our volume
}

// NOAAAlertToItems converts a single NOAA alert into one ContentItem per GEO_ANCHOR.
// Space weather affects all auroral zones simultaneously, so we replicate the alert
// across all 8 anchor points.
func NOAAAlertToItems(alert NOAAAlert) []domain.ContentItem {
	// The classifiable code lives in the message ("Space Weather Message Code: XXXX"),
	// not in product_id (an unrelated routing id). Fall back to product_id when the
	// message carries no code line (keeps synthetic/legacy inputs working).
	code := extractMessageCode(alert.Message)
	if code == "" {
		code = alert.ProductID
	}

	eventType, ok := ParseNOAAAlert(code)
	if !ok {
		return nil
	}

	severity := noaaCodeToSeverity(code)
	msgHash := noaaMsgHash(alert.Message)

	var publishedAt time.Time
	if alert.IssueDatetime != "" {
		t, err := time.Parse("2006-01-02 15:04:05.0", alert.IssueDatetime)
		if err != nil {
			// Try alternate format without fractional seconds
			t, err = time.Parse("2006-01-02 15:04:05", alert.IssueDatetime)
		}
		if err == nil {
			publishedAt = t.UTC()
		}
	}
	if publishedAt.IsZero() {
		publishedAt = time.Now().UTC()
	}

	// Extract first useful line from message as title (mirrors JS alertToEvent)
	title := noaaExtractTitle(alert.Message, eventType)

	items := make([]domain.ContentItem, 0, len(GEO_ANCHORS))
	for i, anchor := range GEO_ANCHORS {
		// id is stable: hash of message content + anchor index
		id := fmt.Sprintf("noaa-ev-%s-%d", msgHash, i)

		item := domain.ContentItem{
			ID:          id,
			ThemeID:     "extreme-events",
			Type:        eventType,
			SourceID:    "noaa-swpc",
			Title:       domain.Truncate(title, 80),
			Description: domain.Truncate(alert.Message, 300),
			PublishedAt: publishedAt,
			Geo: &domain.GeoPoint{
				Lat:      anchor.Lat,
				Lng:      anchor.Lng,
				RadiusKm: 20000, // space weather affects global scale
			},
			Severity:   domain.PtrInt(severity),
			Confidence: domain.PtrFloat(0.90),
			Metadata: map[string]any{
				"product_id": alert.ProductID,
				"code":       code,
				"anchor":     i,
			},
			Tags: []string{eventType, "space-weather", "noaa"},
		}
		items = append(items, item)
	}

	return items
}

// noaaExtractTitle pulls the first non-boilerplate line from a NOAA alert message.
// Falls back to "NOAA SWPC <eventType>" if no useful line is found.
func noaaExtractTitle(message, eventType string) string {
	for _, line := range strings.Split(message, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "Space Weather") {
			continue
		}
		if len(line) > 5 {
			return line
		}
	}
	return fmt.Sprintf("NOAA SWPC %s", eventType)
}

// ---- JSON structures (exported so tests can construct them directly) ----

// NOAAAlert represents a single alert from the NOAA SWPC alerts.json endpoint.
type NOAAAlert struct {
	ProductID     string `json:"product_id"`
	IssueDatetime string `json:"issue_datetime"`
	Message       string `json:"message"`
}

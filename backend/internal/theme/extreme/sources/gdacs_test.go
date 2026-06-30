package sources_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/earth-sentinel/backend/internal/theme/extreme/sources"
)

// ---- MapGDACSType ----

func TestMapGDACSType(t *testing.T) {
	cases := []struct {
		code     string
		expected string
	}{
		{"EQ", "earthquake"},
		{"TC", "hurricane"},
		{"FL", "flood"},
		{"VO", "volcano"},
		{"DR", "drought"},
		{"WF", "wildfire"},
		{"TS", "tsunami"},
		{"XX", ""},
		{"", ""},
	}
	for _, tc := range cases {
		got := sources.MapGDACSType(tc.code)
		if got != tc.expected {
			t.Errorf("MapGDACSType(%q) = %q, want %q", tc.code, got, tc.expected)
		}
	}
}

// ---- GDACSAlertToSeverity ----

func TestGDACSAlertToSeverity(t *testing.T) {
	cases := []struct {
		level    string
		expected int
	}{
		{"Red", 5},
		{"red", 5},
		{"RED", 5},
		{"Orange", 3},
		{"orange", 3},
		{"Green", 1},
		{"green", 1},
		{"", 1},
		{"unknown", 1},
	}
	for _, tc := range cases {
		got := sources.GDACSAlertToSeverity(tc.level)
		if got != tc.expected {
			t.Errorf("GDACSAlertToSeverity(%q) = %d, want %d", tc.level, got, tc.expected)
		}
	}
}

// ---- GDACSEventToItem: valid input ----

func makeGDACSFeature(eventtype string, eventid int, lng, lat float64, alertLevel, episodeAlertLevel, name, country, fromdate, todate string) sources.GDACSFeature {
	return sources.GDACSFeature{
		Geometry: sources.GDACSGeometry{
			Coordinates: []float64{lng, lat},
		},
		Properties: sources.GDACSProperties{
			Eventtype:         eventtype,
			Eventid:           eventid,
			Episodeid:         1,
			Name:              name,
			Alertlevel:        alertLevel,
			Episodealertlevel: episodeAlertLevel,
			Country:           country,
			Fromdate:          fromdate,
			Todate:            todate,
		},
	}
}

func TestGDACSEventToItem_ValidInput(t *testing.T) {
	f := makeGDACSFeature(
		"EQ", 1541314,
		109.2073, 24.4799,
		"Orange", "Orange",
		"Earthquake in China", "China",
		"2026-05-18T13:44:26", "2026-05-18T13:44:26",
	)

	item, ok := sources.GDACSEventToItem(f)
	if !ok {
		t.Fatal("expected GDACSEventToItem to return ok=true")
	}

	if item.ID != "gdacs-EQ-1541314" {
		t.Errorf("ID = %q, want %q", item.ID, "gdacs-EQ-1541314")
	}
	if item.ThemeID != "extreme-events" {
		t.Errorf("ThemeID = %q", item.ThemeID)
	}
	if item.Type != "earthquake" {
		t.Errorf("Type = %q", item.Type)
	}
	if item.SourceID != "gdacs" {
		t.Errorf("SourceID = %q", item.SourceID)
	}
	if item.Geo == nil {
		t.Fatal("Geo should not be nil")
	}
	// GeoJSON: [lng, lat]
	if item.Geo.Lng != 109.2073 {
		t.Errorf("Lng = %f, want 109.2073", item.Geo.Lng)
	}
	if item.Geo.Lat != 24.4799 {
		t.Errorf("Lat = %f, want 24.4799", item.Geo.Lat)
	}
	// Orange → severity 3 → radiusKm 300
	if item.Severity == nil || *item.Severity != 3 {
		t.Errorf("Severity = %v, want 3", item.Severity)
	}
	if item.Geo.RadiusKm != 300 {
		t.Errorf("RadiusKm = %f, want 300", item.Geo.RadiusKm)
	}
	if item.Confidence == nil || *item.Confidence != 0.90 {
		t.Errorf("Confidence = %v, want 0.90", item.Confidence)
	}
	if len([]rune(item.Title)) > 80 {
		t.Errorf("Title too long: %d runes", len([]rune(item.Title)))
	}
	if len([]rune(item.Description)) > 300 {
		t.Errorf("Description too long: %d runes", len([]rune(item.Description)))
	}
}

// ---- GDACSEventToItem: uses episodealertlevel over alertlevel ----

func TestGDACSEventToItem_EpisodeAlertLevelTakesPrecedence(t *testing.T) {
	// alertlevel=Red (historical peak), episodealertlevel=Green (current)
	f := makeGDACSFeature(
		"FL", 999001,
		30.0, -5.0,
		"Red", "Green",
		"Flood somewhere", "Congo",
		"2026-01-01T00:00:00", "2026-01-05T00:00:00",
	)

	item, ok := sources.GDACSEventToItem(f)
	if !ok {
		t.Fatal("expected ok=true")
	}
	// episodealertlevel=Green → severity 1
	if item.Severity == nil || *item.Severity != 1 {
		t.Errorf("Severity = %v, want 1 (episodealertlevel=Green)", item.Severity)
	}
}

// ---- GDACSEventToItem: ID stability ----

func TestGDACSEventToItem_IDStability(t *testing.T) {
	f := makeGDACSFeature(
		"VO", 1000140,
		127.8783, 1.6992,
		"Orange", "Orange",
		"Eruption Dukono", "Indonesia",
		"2026-05-08T09:10:00", "2026-05-08T09:10:00",
	)

	item1, ok1 := sources.GDACSEventToItem(f)
	item2, ok2 := sources.GDACSEventToItem(f)

	if !ok1 || !ok2 {
		t.Fatal("both calls should succeed")
	}
	if item1.ID != item2.ID {
		t.Errorf("ID not stable: %q vs %q", item1.ID, item2.ID)
	}
	if item1.ID != "gdacs-VO-1000140" {
		t.Errorf("ID = %q, want %q", item1.ID, "gdacs-VO-1000140")
	}
}

// ---- GDACSEventToItem: unknown eventtype skipped ----

func TestGDACSEventToItem_UnknownTypeSKipped(t *testing.T) {
	f := makeGDACSFeature(
		"XX", 123456,
		10.0, 20.0,
		"Green", "Green",
		"Unknown event", "Nowhere",
		"2026-01-01T00:00:00", "2026-01-01T00:00:00",
	)
	_, ok := sources.GDACSEventToItem(f)
	if ok {
		t.Error("expected ok=false for unknown event type XX")
	}
}

// ---- GDACSEventToItem: zero coordinates rejected ----

func TestGDACSEventToItem_ZeroCoordRejected(t *testing.T) {
	f := makeGDACSFeature(
		"EQ", 111111,
		0.0, 0.0,
		"Green", "Green",
		"Event at zero", "Unknown",
		"2026-01-01T00:00:00", "2026-01-01T00:00:00",
	)
	_, ok := sources.GDACSEventToItem(f)
	if ok {
		t.Error("expected ok=false for (0,0) coordinates")
	}
}

// ---- Fetch: success with httptest server ----

func TestGDACFetch_Success(t *testing.T) {
	feed := map[string]any{
		"type": "FeatureCollection",
		"features": []any{
			map[string]any{
				"type": "Feature",
				"geometry": map[string]any{
					"type":        "Point",
					"coordinates": []float64{46.567, -20.506},
				},
				"properties": map[string]any{
					"eventtype":         "DR",
					"eventid":           1018431,
					"episodeid":         5,
					"name":              "Drought in Madagascar",
					"description":       "Drought in Madagascar",
					"alertlevel":        "Orange",
					"episodealertlevel": "Orange",
					"country":           "Madagascar",
					"fromdate":          "2025-11-21T00:00:00",
					"todate":            "2026-06-04T00:00:00",
				},
			},
		},
	}

	body, _ := json.Marshal(feed)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(body)
	}))
	defer srv.Close()

	source := sources.NewGDACSWithURL(srv.URL)
	items, err := source.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch returned error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].ID != "gdacs-DR-1018431" {
		t.Errorf("item ID = %q, want %q", items[0].ID, "gdacs-DR-1018431")
	}
}

// ---- Fetch: HTTP 503 — all slices fail — returns no error but logs warnings ----
// Per spec: network error per slice is logged+skipped, not a fatal error.
// Fetch only returns error on build-request failure; HTTP errors are soft failures.

func TestGDACFetch_HTTP503(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	source := sources.NewGDACSWithURL(srv.URL)
	items, err := source.Fetch(context.Background())
	// Per design: individual slice failures are soft (logged, not returned as error)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(items) != 0 {
		t.Errorf("expected 0 items on all-503, got %d", len(items))
	}
}

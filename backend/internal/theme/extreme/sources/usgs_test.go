package sources_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/earth-sentinel/backend/internal/theme/extreme/sources"
)

// ---- MagnitudeToSeverity ----

func TestMagnitudeToSeverity(t *testing.T) {
	cases := []struct {
		mag      float64
		expected int
	}{
		{8.5, 5},
		{8.0, 5},
		{7.9, 4},
		{7.0, 4},
		{6.9, 3},
		{6.0, 3},
		{5.9, 2},
		{5.0, 2},
		{4.9, 1},
		{4.5, 1},
	}
	for _, tc := range cases {
		got := sources.MagnitudeToSeverity(tc.mag)
		if got != tc.expected {
			t.Errorf("MagnitudeToSeverity(%.1f) = %d, want %d", tc.mag, got, tc.expected)
		}
	}
}

// helper to build a GeoJSONFeature inline
func makeUSGSFeature(id string, lng, lat, depth float64, mag float64, place, status string, timeMs int64) sources.GeoJSONFeature {
	magPtr := mag
	placePtr := place
	statusPtr := status
	timePtrVal := timeMs
	return sources.GeoJSONFeature{
		ID: id,
		Geometry: sources.USGSGeometry{
			Coordinates: []float64{lng, lat, depth},
		},
		Properties: sources.USGSFeatureProps{
			Mag:    &magPtr,
			Place:  &placePtr,
			Status: &statusPtr,
			Time:   &timePtrVal,
		},
	}
}

// ---- FeatureToItem: valid input ----

func TestFeatureToItem_ValidInput(t *testing.T) {
	f := makeUSGSFeature("us2024abc", -118.5, 34.2, 10.0, 6.5, "15 km NW of Los Angeles, CA", "reviewed", 1700000000000)

	item, ok := sources.FeatureToItem(f)
	if !ok {
		t.Fatal("expected FeatureToItem to return ok=true")
	}

	if item.ID != "usgs-us2024abc" {
		t.Errorf("ID = %q, want %q", item.ID, "usgs-us2024abc")
	}
	if item.ThemeID != "extreme-events" {
		t.Errorf("ThemeID = %q", item.ThemeID)
	}
	if item.Type != "earthquake" {
		t.Errorf("Type = %q", item.Type)
	}
	if item.SourceID != "usgs" {
		t.Errorf("SourceID = %q", item.SourceID)
	}
	if item.Geo == nil {
		t.Fatal("Geo should not be nil")
	}
	// GeoJSON is [lng, lat, depth] — verify coordinates are NOT inverted
	if item.Geo.Lng != -118.5 {
		t.Errorf("Lng = %f, want -118.5", item.Geo.Lng)
	}
	if item.Geo.Lat != 34.2 {
		t.Errorf("Lat = %f, want 34.2", item.Geo.Lat)
	}
	// mag 6.5 → radiusKm 200
	if item.Geo.RadiusKm != 200 {
		t.Errorf("RadiusKm = %f, want 200", item.Geo.RadiusKm)
	}
	if item.Severity == nil || *item.Severity != 3 {
		t.Errorf("Severity = %v, want 3", item.Severity)
	}
	if item.Confidence == nil || *item.Confidence != 0.99 {
		t.Errorf("Confidence = %v, want 0.99", item.Confidence)
	}
	if len([]rune(item.Title)) > 80 {
		t.Errorf("Title too long: %d runes", len([]rune(item.Title)))
	}
	if len([]rune(item.Description)) > 300 {
		t.Errorf("Description too long: %d runes", len([]rune(item.Description)))
	}
}

// ---- FeatureToItem: ID stability ----

func TestFeatureToItem_IDStability(t *testing.T) {
	f := makeUSGSFeature("us2024xyz", 139.7, 35.6, 20.0, 5.2, "Near Tokyo, Japan", "automatic", 1700000001000)

	item1, ok1 := sources.FeatureToItem(f)
	item2, ok2 := sources.FeatureToItem(f)

	if !ok1 || !ok2 {
		t.Fatal("both calls should succeed")
	}
	if item1.ID != item2.ID {
		t.Errorf("ID not stable: %q vs %q", item1.ID, item2.ID)
	}
}

// ---- FeatureToItem: filter mag < 4.5 ----

func TestFeatureToItem_LowMagFiltered(t *testing.T) {
	f := makeUSGSFeature("us2024low", -10.0, 20.0, 5.0, 4.0, "somewhere", "automatic", 1700000000000)
	_, ok := sources.FeatureToItem(f)
	if ok {
		t.Error("expected ok=false for mag 4.0 (below 4.5 threshold)")
	}
}

// ---- FeatureToItem: missing ID skipped ----

func TestFeatureToItem_MissingIDSkipped(t *testing.T) {
	f := makeUSGSFeature("", -70.0, -30.0, 15.0, 5.5, "somewhere", "reviewed", 1700000000000)
	_, ok := sources.FeatureToItem(f)
	if ok {
		t.Error("expected ok=false for empty feature ID")
	}
}

// ---- Fetch: success with httptest server ----

func TestUSGSFetch_Success(t *testing.T) {
	feed := map[string]any{
		"type": "FeatureCollection",
		"features": []any{
			map[string]any{
				"id":   "test-ev-001",
				"type": "Feature",
				"geometry": map[string]any{
					"type":        "Point",
					"coordinates": []float64{-120.0, 37.5, 8.0},
				},
				"properties": map[string]any{
					"mag":    6.0,
					"place":  "Test Location, CA",
					"status": "reviewed",
					"time":   int64(1700000000000),
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

	source := sources.NewUSGSWithURL(srv.URL)
	items, err := source.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch returned error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(items))
	}
	if items[0].ID != "usgs-test-ev-001" {
		t.Errorf("item ID = %q, want %q", items[0].ID, "usgs-test-ev-001")
	}
}

// ---- Fetch: HTTP 503 returns error ----

func TestUSGSFetch_HTTP503(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	source := sources.NewUSGSWithURL(srv.URL)
	_, err := source.Fetch(context.Background())
	if err == nil {
		t.Fatal("expected error on HTTP 503, got nil")
	}
}

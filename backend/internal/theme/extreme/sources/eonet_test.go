package sources

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ── MapEONETCategory ────────────────────────────────────────────────────────

func TestMapEONETCategory_KnownCategories(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{"wildfires", "wildfire"},
		{"severeStorms", "severe_storm"},
		{"volcanoes", "volcano"},
		{"earthquakes", "earthquake"},
		{"floods", "flood"},
		{"landslides", "earthquake"},
		{"snow", "severe_storm"},
		{"tempExtremes", "heat_wave"},
		{"drought", "drought"},
		{"dustHaze", "dust_storm"},
	}
	for _, tc := range cases {
		got := MapEONETCategory(tc.input)
		if got != tc.expected {
			t.Errorf("MapEONETCategory(%q) = %q; want %q", tc.input, got, tc.expected)
		}
	}
}

func TestMapEONETCategory_Unknown(t *testing.T) {
	if got := MapEONETCategory("unknownCategory"); got != "" {
		t.Errorf("expected empty string for unknown category, got %q", got)
	}
}

// ── EONETEventToItem ────────────────────────────────────────────────────────

func makePointEvent(id, title, catID string, lng, lat float64) EONETEvent {
	return EONETEvent{
		ID:    id,
		Title: title,
		Categories: []EONETCategory{
			{ID: catID, Title: catID},
		},
		Geometry: []EONETGeometry{
			{
				Date:        "2024-06-01T12:00:00Z",
				Type:        "Point",
				Coordinates: []interface{}{lng, lat},
			},
		},
	}
}

func TestEONETEventToItem_ValidInput_Wildfire(t *testing.T) {
	ev := makePointEvent("EONET_12345", "Kirk Fire", "wildfires", -118.5, 34.2)
	item, ok := EONETEventToItem(ev)
	if !ok {
		t.Fatal("expected ok=true for valid wildfire event")
	}
	if item.ID != "eonet-EONET_12345" {
		t.Errorf("unexpected ID: %q", item.ID)
	}
	if item.Type != "wildfire" {
		t.Errorf("unexpected Type: %q", item.Type)
	}
	if item.ThemeID != "extreme-events" {
		t.Errorf("unexpected ThemeID: %q", item.ThemeID)
	}
	if item.SourceID != "eonet" {
		t.Errorf("unexpected SourceID: %q", item.SourceID)
	}
	if item.Geo == nil {
		t.Fatal("Geo must not be nil")
	}
	// Coordinates: Point [lng, lat] → geo.Lat=34.2, geo.Lng=-118.5
	if item.Geo.Lat != 34.2 {
		t.Errorf("Geo.Lat = %v; want 34.2", item.Geo.Lat)
	}
	if item.Geo.Lng != -118.5 {
		t.Errorf("Geo.Lng = %v; want -118.5", item.Geo.Lng)
	}
	if item.Geo.RadiusKm != 150 {
		t.Errorf("Geo.RadiusKm = %v; want 150", item.Geo.RadiusKm)
	}
	if item.Severity == nil || *item.Severity != 2 {
		t.Errorf("Severity = %v; want 2", item.Severity)
	}
	if item.Confidence == nil || *item.Confidence != 0.75 {
		t.Errorf("Confidence = %v; want 0.75", item.Confidence)
	}
}

func TestEONETEventToItem_IDStability(t *testing.T) {
	ev := makePointEvent("EONET_99999", "Test Volcano", "volcanoes", 30.0, 10.0)
	item1, ok1 := EONETEventToItem(ev)
	item2, ok2 := EONETEventToItem(ev)
	if !ok1 || !ok2 {
		t.Fatal("both calls must return ok=true")
	}
	if item1.ID != item2.ID {
		t.Errorf("ID not stable: %q vs %q", item1.ID, item2.ID)
	}
	if item1.ID != "eonet-EONET_99999" {
		t.Errorf("unexpected ID: %q", item1.ID)
	}
}

func TestEONETEventToItem_MissingID(t *testing.T) {
	ev := makePointEvent("", "No ID", "wildfires", 10.0, 20.0)
	_, ok := EONETEventToItem(ev)
	if ok {
		t.Error("expected ok=false when event ID is empty")
	}
}

func TestEONETEventToItem_NoGeometry(t *testing.T) {
	ev := EONETEvent{
		ID:         "EONET_1",
		Title:      "No Geometry",
		Categories: []EONETCategory{{ID: "wildfires"}},
		Geometry:   []EONETGeometry{},
	}
	_, ok := EONETEventToItem(ev)
	if ok {
		t.Error("expected ok=false when geometry is empty")
	}
}

func TestEONETEventToItem_UnknownCategory(t *testing.T) {
	ev := makePointEvent("EONET_2", "Unknown", "unknownCat", 10.0, 20.0)
	_, ok := EONETEventToItem(ev)
	if ok {
		t.Error("expected ok=false for unknown category")
	}
}

func TestEONETEventToItem_FilteredType_Earthquake(t *testing.T) {
	// "earthquakes" maps to "earthquake" which is not in eonetAllowedTypes
	ev := makePointEvent("EONET_3", "Earthquake", "earthquakes", 10.0, 20.0)
	_, ok := EONETEventToItem(ev)
	if ok {
		t.Error("expected ok=false for earthquake (not in allowed types)")
	}
}

func TestEONETEventToItem_TitleTruncated(t *testing.T) {
	long := "A Very Long Fire Name That Exceeds The Eighty Character Limit By A Considerable Margin Yes"
	ev := makePointEvent("EONET_4", long, "wildfires", -100.0, 40.0)
	item, ok := EONETEventToItem(ev)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if len([]rune(item.Title)) > 80 {
		t.Errorf("Title too long: %d runes", len([]rune(item.Title)))
	}
}

func TestEONETEventToItem_Polygon(t *testing.T) {
	// Polygon ring with non-zero centroid: lng≈-100, lat≈40.
	ring := []interface{}{
		[]interface{}{-102.0, 41.0},
		[]interface{}{-98.0, 41.0},
		[]interface{}{-98.0, 39.0},
		[]interface{}{-102.0, 39.0},
	}
	ev := EONETEvent{
		ID:         "EONET_POLY",
		Title:      "Polygon Fire",
		Categories: []EONETCategory{{ID: "wildfires"}},
		Geometry: []EONETGeometry{
			{
				Date:        "2024-06-01T00:00:00Z",
				Type:        "Polygon",
				Coordinates: []interface{}{ring},
			},
		},
	}
	item, ok := EONETEventToItem(ev)
	if !ok {
		t.Fatal("expected ok=true for polygon event with non-zero centroid")
	}
	if item.Geo == nil {
		t.Fatal("Geo must not be nil")
	}
	// Centroid: lng=(-102-98-98-102)/4=-100, lat=(41+41+39+39)/4=40
	if item.Geo.Lng != -100.0 || item.Geo.Lat != 40.0 {
		t.Errorf("unexpected centroid: lat=%v lng=%v; want lat=40 lng=-100", item.Geo.Lat, item.Geo.Lng)
	}
}

func TestEONETEventToItem_PolygonZeroCentroid_Filtered(t *testing.T) {
	// Polygon whose centroid is (0,0) must be rejected by domain.Validate.
	ring := []interface{}{
		[]interface{}{-10.0, 10.0},
		[]interface{}{10.0, 10.0},
		[]interface{}{10.0, -10.0},
		[]interface{}{-10.0, -10.0},
	}
	ev := EONETEvent{
		ID:         "EONET_POLY_ZERO",
		Title:      "Zero Centroid Fire",
		Categories: []EONETCategory{{ID: "wildfires"}},
		Geometry: []EONETGeometry{
			{
				Date:        "2024-06-01T00:00:00Z",
				Type:        "Polygon",
				Coordinates: []interface{}{ring},
			},
		},
	}
	_, ok := EONETEventToItem(ev)
	if ok {
		t.Error("expected ok=false for polygon with (0,0) centroid")
	}
}

func TestEONETEventToItem_LastGeometryUsed(t *testing.T) {
	// Event with two geometry entries — last must be used
	ev := EONETEvent{
		ID:         "EONET_MULTI",
		Title:      "Multi-point Storm",
		Categories: []EONETCategory{{ID: "severeStorms"}},
		Geometry: []EONETGeometry{
			{Date: "2024-01-01T00:00:00Z", Type: "Point", Coordinates: []interface{}{0.0, 0.0}},
			{Date: "2024-06-01T00:00:00Z", Type: "Point", Coordinates: []interface{}{-80.0, 25.0}},
		},
	}
	item, ok := EONETEventToItem(ev)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if item.Geo.Lat != 25.0 || item.Geo.Lng != -80.0 {
		t.Errorf("expected last geometry coords, got lat=%v lng=%v", item.Geo.Lat, item.Geo.Lng)
	}
}

// ── Fetch with httptest ─────────────────────────────────────────────────────

func makeEONETResponse(events []EONETEvent) []byte {
	resp := eonetResponse{Events: events}
	b, _ := json.Marshal(resp)
	return b
}

func TestEONETFetch_Success(t *testing.T) {
	events := []EONETEvent{
		makePointEvent("EONET_10001", "Sample Fire", "wildfires", -120.0, 38.0),
		makePointEvent("EONET_10002", "Sample Volcano", "volcanoes", 145.0, -6.0),
		// earthquake — should be filtered (not in allowed types)
		makePointEvent("EONET_10003", "Sample Quake", "earthquakes", 140.0, 35.0),
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write(makeEONETResponse(events))
	}))
	defer srv.Close()

	src := NewEONETWithURL(srv.URL)
	items, err := src.Fetch(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// 2 allowed (wildfire, volcano); 1 filtered (earthquake)
	if len(items) != 2 {
		t.Errorf("expected 2 items, got %d", len(items))
	}
	for _, it := range items {
		if it.Geo == nil {
			t.Error("all items must have non-nil Geo")
		}
		if it.Geo != nil && it.Geo.Lat == 0 && it.Geo.Lng == 0 {
			t.Errorf("item %q has zero-zero geo", it.ID)
		}
		if it.ThemeID != "extreme-events" {
			t.Errorf("ThemeID = %q; want extreme-events", it.ThemeID)
		}
	}
}

func TestEONETFetch_HTTP503(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	src := NewEONETWithURL(srv.URL)
	_, err := src.Fetch(context.Background())
	if err == nil {
		t.Fatal("expected error on HTTP 503")
	}
}

func TestEONETSource_IDAndTheme(t *testing.T) {
	src := NewEONET()
	if src.ID() != "eonet" {
		t.Errorf("ID() = %q; want eonet", src.ID())
	}
	if src.ThemeID() != "extreme-events" {
		t.Errorf("ThemeID() = %q; want extreme-events", src.ThemeID())
	}
}

package sources

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// ── Severity threshold functions ────────────────────────────────────────────

func TestDustUgm3ToSeverity(t *testing.T) {
	cases := []struct {
		ugm3     float64
		expected int
	}{
		{2000.0, 5},
		{1999.9, 4},
		{1200.0, 4},
		{1199.9, 3},
		{800.0, 3},
		{799.9, 2},
		{500.0, 2}, // at threshold minimum → severity 2
	}
	for _, tc := range cases {
		got := DustUgm3ToSeverity(tc.ugm3)
		if got != tc.expected {
			t.Errorf("DustUgm3ToSeverity(%.1f) = %d; want %d", tc.ugm3, got, tc.expected)
		}
	}
}

func TestUSAQIToSeverity(t *testing.T) {
	cases := []struct {
		aqi      int
		expected int
	}{
		{301, 5},
		{300, 4},
		{201, 4},
		{200, 3},
		{151, 3},
		{150, 2},
		{101, 2}, // at threshold minimum → severity 2
	}
	for _, tc := range cases {
		got := USAQIToSeverity(tc.aqi)
		if got != tc.expected {
			t.Errorf("USAQIToSeverity(%d) = %d; want %d", tc.aqi, got, tc.expected)
		}
	}
}

// ── ParseAQResponse ─────────────────────────────────────────────────────────

func TestParseAQResponse_DustStorm(t *testing.T) {
	p := ProbePoint{Name: "Test", Lat: 15.0, Lng: 30.0}
	r := AQResponse{
		Hourly: &AQHourlyData{
			Time:  []string{"2024-06-01T12:00"},
			Dust:  []float64{900.0}, // >= 500 threshold, >= 800 → severity 3
			USAQI: []float64{50.0},  // below threshold — no air_pollution
		},
	}
	items := ParseAQResponse(r, p)
	if len(items) != 1 {
		t.Fatalf("expected 1 item (dust_storm only), got %d", len(items))
	}
	it := items[0]
	if it.Type != "dust_storm" {
		t.Errorf("Type = %q; want dust_storm", it.Type)
	}
	if it.SourceID != "openmeteo-aq" {
		t.Errorf("SourceID = %q; want openmeteo-aq", it.SourceID)
	}
	if it.Severity == nil || *it.Severity != 3 {
		t.Errorf("Severity = %v; want 3 (for 900 µg/m³)", it.Severity)
	}
	if it.Geo == nil {
		t.Fatal("Geo must not be nil")
	}
	if it.Geo.RadiusKm != 400.0 {
		t.Errorf("RadiusKm = %v; want 400", it.Geo.RadiusKm)
	}
}

func TestParseAQResponse_AirPollution(t *testing.T) {
	p := ProbePoint{Name: "Test", Lat: 28.6, Lng: 77.2}
	r := AQResponse{
		Hourly: &AQHourlyData{
			Time:  []string{"2024-06-01T06:00"},
			Dust:  []float64{100.0}, // below threshold
			USAQI: []float64{165.0}, // >= 151 → severity 3
		},
	}
	items := ParseAQResponse(r, p)
	if len(items) != 1 {
		t.Fatalf("expected 1 item (air_pollution only), got %d", len(items))
	}
	it := items[0]
	if it.Type != "air_pollution" {
		t.Errorf("Type = %q; want air_pollution", it.Type)
	}
	if it.Severity == nil || *it.Severity != 3 {
		t.Errorf("Severity = %v; want 3 (for AQI 165)", it.Severity)
	}
	if it.Geo == nil {
		t.Fatal("Geo must not be nil")
	}
	if it.Geo.RadiusKm != 200.0 {
		t.Errorf("RadiusKm = %v; want 200", it.Geo.RadiusKm)
	}
}

func TestParseAQResponse_BothThresholds(t *testing.T) {
	p := ProbePoint{Name: "Test", Lat: 25.0, Lng: 55.0}
	r := AQResponse{
		Hourly: &AQHourlyData{
			Time:  []string{"2024-06-01T09:00"},
			Dust:  []float64{2500.0}, // >= 2000 → severity 5
			USAQI: []float64{310.0},  // >= 301 → severity 5
		},
	}
	items := ParseAQResponse(r, p)
	if len(items) != 2 {
		t.Fatalf("expected 2 items (dust + aqi), got %d", len(items))
	}
	types := map[string]bool{}
	for _, it := range items {
		types[it.Type] = true
		if it.Severity == nil || *it.Severity != 5 {
			t.Errorf("item %q: expected severity 5, got %v", it.ID, it.Severity)
		}
	}
	if !types["dust_storm"] {
		t.Error("missing dust_storm item")
	}
	if !types["air_pollution"] {
		t.Error("missing air_pollution item")
	}
}

func TestParseAQResponse_BelowThresholds(t *testing.T) {
	p := ProbePoint{Name: "Test", Lat: 0.0, Lng: 20.0}
	r := AQResponse{
		Hourly: &AQHourlyData{
			Time:  []string{"2024-06-01T00:00"},
			Dust:  []float64{100.0}, // below 500
			USAQI: []float64{50.0},  // below 101
		},
	}
	items := ParseAQResponse(r, p)
	if len(items) != 0 {
		t.Errorf("expected 0 items below all thresholds, got %d", len(items))
	}
}

func TestParseAQResponse_IDStability(t *testing.T) {
	p := ProbePoint{Name: "Test", Lat: 31.2, Lng: 121.5}
	r := AQResponse{
		Hourly: &AQHourlyData{
			Time:  []string{"2024-06-01T12:00"},
			Dust:  []float64{1500.0},
			USAQI: []float64{200.0},
		},
	}
	items1 := ParseAQResponse(r, p)
	items2 := ParseAQResponse(r, p)
	if len(items1) != len(items2) {
		t.Fatalf("item count differs: %d vs %d", len(items1), len(items2))
	}
	for i := range items1 {
		if items1[i].ID != items2[i].ID {
			t.Errorf("ID not stable at index %d: %q vs %q", i, items1[i].ID, items2[i].ID)
		}
	}
}

func TestParseAQResponse_NoGeoZeroZero(t *testing.T) {
	// Use a point that is not (0,0) to verify geo is correctly set
	p := ProbePoint{Name: "Test", Lat: 35.7, Lng: 139.7}
	r := AQResponse{
		Hourly: &AQHourlyData{
			Time:  []string{"2024-06-01T00:00"},
			Dust:  []float64{3000.0},
			USAQI: []float64{350.0},
		},
	}
	items := ParseAQResponse(r, p)
	for _, it := range items {
		if it.Geo == nil {
			t.Errorf("item %q has nil Geo", it.ID)
			continue
		}
		if it.Geo.Lat == 0 && it.Geo.Lng == 0 {
			t.Errorf("item %q has zero-zero Geo", it.ID)
		}
	}
}

func TestParseAQResponse_TitleTruncated(t *testing.T) {
	p := ProbePoint{Name: "Test", Lat: 22.0, Lng: 114.0}
	// AQI 310 → "Qualidade do Ar Degradada — AQI 310" is well within 80 chars
	r := AQResponse{
		Hourly: &AQHourlyData{
			Time:  []string{"2024-06-01T00:00"},
			Dust:  []float64{100.0},
			USAQI: []float64{310.0},
		},
	}
	items := ParseAQResponse(r, p)
	for _, it := range items {
		if len([]rune(it.Title)) > 80 {
			t.Errorf("item %q Title too long: %d runes", it.ID, len([]rune(it.Title)))
		}
	}
}

func TestParseAQResponse_ThemeID(t *testing.T) {
	p := ProbePoint{Name: "Test", Lat: 14.0, Lng: 120.0}
	r := AQResponse{
		Hourly: &AQHourlyData{
			Time:  []string{"2024-06-01T00:00"},
			Dust:  []float64{600.0},
			USAQI: []float64{200.0},
		},
	}
	items := ParseAQResponse(r, p)
	for _, it := range items {
		if it.ThemeID != "extreme-events" {
			t.Errorf("ThemeID = %q; want extreme-events", it.ThemeID)
		}
	}
}

func TestParseAQResponse_IDContainsDustPrefix(t *testing.T) {
	p := ProbePoint{Name: "Test", Lat: 1.3, Lng: 103.8}
	r := AQResponse{
		Hourly: &AQHourlyData{
			Time:  []string{"2024-06-01T00:00"},
			Dust:  []float64{600.0},
			USAQI: []float64{50.0},
		},
	}
	items := ParseAQResponse(r, p)
	for _, it := range items {
		if it.Type == "dust_storm" && !strings.HasPrefix(it.ID, "openmeteo-dust_storm-") {
			t.Errorf("dust_storm ID should start with openmeteo-dust_storm-: %q", it.ID)
		}
	}
}

// ── Fetch with httptest ─────────────────────────────────────────────────────

func TestOpenMeteoAQFetch_Success(t *testing.T) {
	responses := make([]AQResponse, len(PROBE_GRID))
	for i := range responses {
		responses[i] = AQResponse{
			Hourly: &AQHourlyData{
				Time:  []string{"2024-06-01T00:00"},
				Dust:  []float64{1000.0}, // triggers dust_storm
				USAQI: []float64{50.0},   // below threshold
			},
		}
	}
	body, _ := json.Marshal(responses)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write(body)
	}))
	defer srv.Close()

	src := NewOpenMeteoAQWithURL(srv.URL)
	items, err := src.Fetch(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(items) == 0 {
		t.Error("expected items from successful fetch")
	}
	for _, it := range items {
		if it.Geo == nil {
			t.Errorf("item %q has nil Geo", it.ID)
		}
		if it.Geo != nil && it.Geo.Lat == 0 && it.Geo.Lng == 0 {
			t.Errorf("item %q has zero-zero Geo", it.ID)
		}
	}
}

func TestOpenMeteoAQFetch_HTTP503(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	src := NewOpenMeteoAQWithURL(srv.URL)
	_, err := src.Fetch(context.Background())
	if err == nil {
		t.Fatal("expected error on HTTP 503")
	}
}

func TestOpenMeteoAQSource_IDAndTheme(t *testing.T) {
	src := NewOpenMeteoAQ()
	if src.ID() != "openmeteo-aq" {
		t.Errorf("ID() = %q; want openmeteo-aq", src.ID())
	}
	if src.ThemeID() != "extreme-events" {
		t.Errorf("ThemeID() = %q; want extreme-events", src.ThemeID())
	}
}

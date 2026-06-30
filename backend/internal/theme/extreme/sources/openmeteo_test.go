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

func TestTempToHeatSeverity(t *testing.T) {
	cases := []struct {
		temp     float64
		expected int
	}{
		{50.0, 5},
		{49.9, 4},
		{47.0, 4},
		{46.9, 3},
		{44.0, 3},
		{43.9, 2},
		{42.0, 2},
		{41.9, 1},
		{33.0, 1},
	}
	for _, tc := range cases {
		got := TempToHeatSeverity(tc.temp)
		if got != tc.expected {
			t.Errorf("TempToHeatSeverity(%.1f) = %d; want %d", tc.temp, got, tc.expected)
		}
	}
}

func TestTempToColdSeverity(t *testing.T) {
	cases := []struct {
		temp     float64
		expected int
	}{
		{-40.0, 5},
		{-39.9, 4},
		{-35.0, 4},
		{-34.9, 3},
		{-30.0, 3},
		{-29.9, 2},
		{-20.0, 2},
		{-19.9, 1},
		{-8.0, 1},
	}
	for _, tc := range cases {
		got := TempToColdSeverity(tc.temp)
		if got != tc.expected {
			t.Errorf("TempToColdSeverity(%.1f) = %d; want %d", tc.temp, got, tc.expected)
		}
	}
}

func TestWindSpeedToSeverity(t *testing.T) {
	// Boundaries in km/h (m/s * 3.6): 28→100.8, 36→129.6, 44→158.4, 55→198
	cases := []struct {
		kmh      float64
		expected int
	}{
		{198.0, 5},
		{197.9, 4},
		{158.4, 4},
		{158.3, 3},
		{129.6, 3},
		{129.5, 2},
		{100.8, 2},
		{100.7, 1},
		{50.4, 1}, // warn threshold — still severity 1
	}
	for _, tc := range cases {
		got := WindSpeedToSeverity(tc.kmh)
		if got != tc.expected {
			t.Errorf("WindSpeedToSeverity(%.1f) = %d; want %d", tc.kmh, got, tc.expected)
		}
	}
}

func TestRainToFloodSeverity(t *testing.T) {
	cases := []struct {
		mm       float64
		expected int
	}{
		{200.0, 5},
		{199.9, 4},
		{150.0, 4},
		{149.9, 3},
		{100.0, 3},
		{99.9, 2},
		{80.0, 2},
		{79.9, 1},
		{30.0, 1},
	}
	for _, tc := range cases {
		got := RainToFloodSeverity(tc.mm)
		if got != tc.expected {
			t.Errorf("RainToFloodSeverity(%.1f) = %d; want %d", tc.mm, got, tc.expected)
		}
	}
}

// ── ParseOpenMeteoResponse ──────────────────────────────────────────────────

func TestParseOpenMeteoResponse_HeatAlert(t *testing.T) {
	p := ProbePoint{Name: "Test", Lat: 30.0, Lng: 45.0}
	r := OpenMeteoResponse{
		Daily: &OpenMeteoDailyData{
			Time:             []string{"2024-07-15"},
			Temperature2mMax: []float64{45.0},
			Temperature2mMin: []float64{20.0},
			PrecipitationSum: []float64{0.0},
			WindGusts10mMax:  []float64{5.0},
		},
	}
	items := ParseOpenMeteoResponse(r, p)
	if len(items) == 0 {
		t.Fatal("expected at least one heat_wave item")
	}
	found := false
	for _, it := range items {
		if it.Type == "heat_wave" {
			found = true
			if it.Geo == nil {
				t.Error("Geo must not be nil")
			}
			if it.Geo.Lat == 0 && it.Geo.Lng == 0 {
				t.Error("Geo must not be (0,0)")
			}
			if it.Severity == nil || *it.Severity < 3 {
				t.Errorf("expected severity >= 3 for 45°C heat, got %v", it.Severity)
			}
			if !strings.HasPrefix(it.ID, "openmeteo-heat_wave-a-") {
				t.Errorf("unexpected ID prefix: %q", it.ID)
			}
		}
	}
	if !found {
		t.Error("no heat_wave item found")
	}
}

func TestParseOpenMeteoResponse_HeatWarn(t *testing.T) {
	p := ProbePoint{Name: "Test", Lat: 25.0, Lng: 55.0}
	r := OpenMeteoResponse{
		Daily: &OpenMeteoDailyData{
			Time:             []string{"2024-07-15"},
			Temperature2mMax: []float64{36.0}, // >= 33 warn, < 42 alert
			Temperature2mMin: []float64{15.0},
			PrecipitationSum: []float64{0.0},
			WindGusts10mMax:  []float64{5.0},
		},
	}
	items := ParseOpenMeteoResponse(r, p)
	found := false
	for _, it := range items {
		if it.Type == "heat_wave" {
			found = true
			if it.Severity == nil || *it.Severity != 1 {
				t.Errorf("warning tier should have severity 1, got %v", it.Severity)
			}
			if !strings.HasPrefix(it.ID, "openmeteo-heat_wave-w-") {
				t.Errorf("warning ID should have -w- flag: %q", it.ID)
			}
		}
	}
	if !found {
		t.Error("expected a heat_wave warning item")
	}
}

func TestParseOpenMeteoResponse_ColdAlert(t *testing.T) {
	p := ProbePoint{Name: "Test", Lat: 70.0, Lng: -20.0}
	r := OpenMeteoResponse{
		Daily: &OpenMeteoDailyData{
			Time:             []string{"2024-01-15"},
			Temperature2mMax: []float64{-15.0},
			Temperature2mMin: []float64{-30.0}, // <= -20 alert, abs=30 → severity 3
			PrecipitationSum: []float64{0.0},
			WindGusts10mMax:  []float64{5.0},
		},
	}
	items := ParseOpenMeteoResponse(r, p)
	found := false
	for _, it := range items {
		if it.Type == "cold_wave" {
			found = true
			if it.Severity == nil || *it.Severity < 2 {
				t.Errorf("expected severity >= 2 for -30°C, got %v", it.Severity)
			}
		}
	}
	if !found {
		t.Error("expected a cold_wave item")
	}
}

func TestParseOpenMeteoResponse_Flood(t *testing.T) {
	p := ProbePoint{Name: "Test", Lat: -6.0, Lng: 107.0}
	r := OpenMeteoResponse{
		Daily: &OpenMeteoDailyData{
			Time:             []string{"2024-03-01"},
			Temperature2mMax: []float64{30.0},
			Temperature2mMin: []float64{24.0},
			PrecipitationSum: []float64{120.0}, // >= 80 alert, < 150 → severity 3
			WindGusts10mMax:  []float64{10.0},
		},
	}
	items := ParseOpenMeteoResponse(r, p)
	found := false
	for _, it := range items {
		if it.Type == "flood" {
			found = true
			if it.Severity == nil || *it.Severity != 3 {
				t.Errorf("expected severity 3 for 120mm, got %v", it.Severity)
			}
		}
	}
	if !found {
		t.Error("expected a flood item")
	}
}

func TestParseOpenMeteoResponse_Wind(t *testing.T) {
	p := ProbePoint{Name: "Test", Lat: 52.0, Lng: 0.0}
	// 30 m/s * 3.6 = 108 km/h → >= 100.8 alert threshold → severity 2
	r := OpenMeteoResponse{
		Daily: &OpenMeteoDailyData{
			Time:             []string{"2024-02-10"},
			Temperature2mMax: []float64{10.0},
			Temperature2mMin: []float64{5.0},
			PrecipitationSum: []float64{5.0},
			WindGusts10mMax:  []float64{30.0}, // m/s
		},
	}
	items := ParseOpenMeteoResponse(r, p)
	found := false
	for _, it := range items {
		if it.Type == "severe_storm" {
			found = true
			if it.Severity == nil || *it.Severity != 2 {
				t.Errorf("expected severity 2 for 108 km/h, got %v", it.Severity)
			}
		}
	}
	if !found {
		t.Error("expected a severe_storm item")
	}
}

func TestParseOpenMeteoResponse_NoGeoZeroZero(t *testing.T) {
	// Use a grid point that is NOT (0,0)
	p := ProbePoint{Name: "Test", Lat: 35.0, Lng: -95.0}
	r := OpenMeteoResponse{
		Daily: &OpenMeteoDailyData{
			Time:             []string{"2024-07-01"},
			Temperature2mMax: []float64{50.0},
			Temperature2mMin: []float64{35.0},
			PrecipitationSum: []float64{200.0},
			WindGusts10mMax:  []float64{60.0},
		},
	}
	items := ParseOpenMeteoResponse(r, p)
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

func TestParseOpenMeteoResponse_IDStability(t *testing.T) {
	p := ProbePoint{Name: "Test", Lat: 48.0, Lng: 2.4}
	r := OpenMeteoResponse{
		Daily: &OpenMeteoDailyData{
			Time:             []string{"2024-07-15"},
			Temperature2mMax: []float64{45.0},
			Temperature2mMin: []float64{10.0},
			PrecipitationSum: []float64{0.0},
			WindGusts10mMax:  []float64{5.0},
		},
	}
	items1 := ParseOpenMeteoResponse(r, p)
	items2 := ParseOpenMeteoResponse(r, p)
	if len(items1) != len(items2) {
		t.Fatalf("different item counts on repeated call: %d vs %d", len(items1), len(items2))
	}
	for i := range items1 {
		if items1[i].ID != items2[i].ID {
			t.Errorf("ID not stable at index %d: %q vs %q", i, items1[i].ID, items2[i].ID)
		}
	}
}

func TestParseOpenMeteoResponse_BelowThresholds(t *testing.T) {
	p := ProbePoint{Name: "Test", Lat: 20.0, Lng: 100.0}
	r := OpenMeteoResponse{
		Daily: &OpenMeteoDailyData{
			Time:             []string{"2024-07-01"},
			Temperature2mMax: []float64{25.0}, // < 33 heat warn
			Temperature2mMin: []float64{-5.0}, // > -8 cold warn
			PrecipitationSum: []float64{10.0}, // < 30 prec warn
			WindGusts10mMax:  []float64{10.0}, // 36 km/h < 50.4 wind warn
		},
	}
	items := ParseOpenMeteoResponse(r, p)
	if len(items) != 0 {
		t.Errorf("expected 0 items below all thresholds, got %d", len(items))
	}
}

// ── Fetch with httptest ─────────────────────────────────────────────────────

func TestOpenMeteoFetch_Success(t *testing.T) {
	// Build a minimal array response for all probe grid points
	responses := make([]OpenMeteoResponse, len(PROBE_GRID))
	for i := range responses {
		responses[i] = OpenMeteoResponse{
			Daily: &OpenMeteoDailyData{
				Time:             []string{"2024-07-15"},
				Temperature2mMax: []float64{45.0}, // triggers heat_wave
				Temperature2mMin: []float64{10.0},
				PrecipitationSum: []float64{0.0},
				WindGusts10mMax:  []float64{5.0},
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

	src := NewOpenMeteoWithURL(srv.URL)
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

func TestOpenMeteoFetch_HTTP503(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	src := NewOpenMeteoWithURL(srv.URL)
	_, err := src.Fetch(context.Background())
	if err == nil {
		t.Fatal("expected error on HTTP 503")
	}
}

func TestOpenMeteoSource_IDAndTheme(t *testing.T) {
	src := NewOpenMeteo()
	if src.ID() != "openmeteo" {
		t.Errorf("ID() = %q; want openmeteo", src.ID())
	}
	if src.ThemeID() != "extreme-events" {
		t.Errorf("ThemeID() = %q; want extreme-events", src.ThemeID())
	}
}

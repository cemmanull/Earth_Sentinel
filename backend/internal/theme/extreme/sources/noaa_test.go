package sources_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/earth-sentinel/backend/internal/theme/extreme/sources"
)

// ---- ParseNOAAAlert ----

func TestParseNOAAAlert(t *testing.T) {
	cases := []struct {
		productID    string
		expectedType string
		expectedOK   bool
	}{
		{"ALTEF3", "radiation_storm", true},
		{"ALTEF2", "radiation_storm", true},
		{"ALTTP2", "radio_blackout", true},
		{"WARK3", "radio_blackout", true},
		{"ALTK4", "geomagnetic_storm", true},
		{"ALTG5", "geomagnetic_storm", true},
		{"WATA12", "geomagnetic_storm", true},
		{"WATA20", "geomagnetic_storm", true}, // WATA prefix matches geomagnetic_storm before CME (mirrors JS order)
		{"GEOMET", "geomagnetic_storm", true},
		{"ALTXMF4", "solar_flare", true},
		{"ALTXRF3", "solar_flare", true},
		{"ALTXRB2", "solar_flare", true},
		{"PRF3", "solar_flare", true},
		{"ALTCME", "cme", true},
		{"CME3", "cme", true},
		{"WATPOR2", "radiation_storm", true},
		{"ALTPOR3", "radiation_storm", true},
		{"UNKNOWN", "", false},
		{"", "", false},
	}
	for _, tc := range cases {
		gotType, gotOK := sources.ParseNOAAAlert(tc.productID)
		if gotOK != tc.expectedOK {
			t.Errorf("ParseNOAAAlert(%q) ok=%v, want %v", tc.productID, gotOK, tc.expectedOK)
			continue
		}
		if gotType != tc.expectedType {
			t.Errorf("ParseNOAAAlert(%q) type=%q, want %q", tc.productID, gotType, tc.expectedType)
		}
	}
}

// ---- NOAAAlertToItems: valid alert produces 8 items (one per anchor) ----

func TestNOAAAlertToItems_ValidInput(t *testing.T) {
	alert := sources.NOAAAlert{
		ProductID:     "ALTG5",
		IssueDatetime: "2026-03-15 14:30:00.0",
		Message:       "Space Weather Message Code: ALTG5\nSerial Number: 1234\nGeomagnetic Storm Watch in effect.\nKp index expected to reach 8.",
	}

	items := sources.NOAAAlertToItems(alert)

	// Should produce exactly len(GEO_ANCHORS) = 8 items
	if len(items) != 8 {
		t.Fatalf("expected 8 items (one per anchor), got %d", len(items))
	}

	// Verify all items share consistent fields
	for i, item := range items {
		if item.ThemeID != "extreme-events" {
			t.Errorf("item[%d] ThemeID = %q", i, item.ThemeID)
		}
		if item.Type != "geomagnetic_storm" {
			t.Errorf("item[%d] Type = %q, want geomagnetic_storm", i, item.Type)
		}
		if item.SourceID != "noaa-swpc" {
			t.Errorf("item[%d] SourceID = %q", i, item.SourceID)
		}
		if item.Geo == nil {
			t.Errorf("item[%d] Geo is nil", i)
			continue
		}
		// No item should have (0,0) coordinates
		if item.Geo.Lat == 0 && item.Geo.Lng == 0 {
			t.Errorf("item[%d] has (0,0) coordinates — invalid anchor", i)
		}
		if item.Geo.RadiusKm != 20000 {
			t.Errorf("item[%d] RadiusKm = %f, want 20000", i, item.Geo.RadiusKm)
		}
		if item.Severity == nil || *item.Severity != 5 {
			t.Errorf("item[%d] Severity = %v, want 5 (ALTG5)", i, item.Severity)
		}
		if len([]rune(item.Title)) > 80 {
			t.Errorf("item[%d] Title too long: %d runes", i, len([]rune(item.Title)))
		}
		if len([]rune(item.Description)) > 300 {
			t.Errorf("item[%d] Description too long: %d runes", i, len([]rune(item.Description)))
		}
		// Verify metadata fields
		if pid, ok := item.Metadata["product_id"]; !ok || pid != "ALTG5" {
			t.Errorf("item[%d] metadata.product_id = %v, want ALTG5", i, pid)
		}
		anchorVal, _ := item.Metadata["anchor"].(int)
		if anchorVal != i {
			t.Errorf("item[%d] metadata.anchor = %d, want %d", i, anchorVal, i)
		}
	}
}

// ---- extractMessageCode + real-world classification (regression) ----

// Regression: real NOAA alerts carry an unrelated routing id in product_id
// (e.g. "TIIA", "K04W") while the classifiable code lives in the message
// ("Space Weather Message Code: ALTTP2"). Classification must use the message code.
func TestNOAAAlertToItems_UsesMessageCodeNotProductID(t *testing.T) {
	alert := sources.NOAAAlert{
		ProductID:     "TIIA", // unrelated routing id — matches no type regex
		IssueDatetime: "2026-06-10 17:38:31.317",
		Message:       "Space Weather Message Code: ALTTP2\nSerial Number: 1502\nIssue Time: 2026 Jun 10 1738 UTC",
	}

	items := sources.NOAAAlertToItems(alert)
	if len(items) != 8 {
		t.Fatalf("expected 8 items from message-code classification, got %d", len(items))
	}
	for i, item := range items {
		if item.Type != "radio_blackout" {
			t.Errorf("item[%d] Type = %q, want radio_blackout (ALTTP2)", i, item.Type)
		}
		if item.Severity == nil || *item.Severity != 2 {
			t.Errorf("item[%d] Severity = %v, want 2 (ALTTP2)", i, item.Severity)
		}
		if code, _ := item.Metadata["code"].(string); code != "ALTTP2" {
			t.Errorf("item[%d] metadata.code = %q, want ALTTP2", i, code)
		}
	}
}

func TestExtractMessageCode_DatetimeFormat(t *testing.T) {
	// Real NOAA issue_datetime uses fractional seconds: "2026-03-09 20:22:26.127".
	// Use March (not the current month) so a fallback to now() would be detectable.
	alert := sources.NOAAAlert{
		ProductID:     "K04W",
		IssueDatetime: "2026-03-09 20:22:26.127",
		Message:       "Space Weather Message Code: WARK04\nSerial Number: 5362",
	}
	items := sources.NOAAAlertToItems(alert)
	if len(items) != 8 {
		t.Fatalf("expected 8 items, got %d", len(items))
	}
	if items[0].Type != "radio_blackout" {
		t.Errorf("Type = %q, want radio_blackout (WARK04)", items[0].Type)
	}
	// PublishedAt must parse the fractional-second datetime, not fall back to now().
	pub := items[0].PublishedAt
	if pub.Year() != 2026 || pub.Month() != 3 || pub.Day() != 9 {
		t.Errorf("PublishedAt = %v, want parsed 2026-03-09 (not now() fallback)", pub)
	}
}

// ---- NOAAAlertToItems: unknown product_id returns nil ----

func TestNOAAAlertToItems_UnknownProductID(t *testing.T) {
	alert := sources.NOAAAlert{
		ProductID:     "UNKNOWN99",
		IssueDatetime: "2026-01-01 00:00:00.0",
		Message:       "Some unknown alert message.",
	}
	items := sources.NOAAAlertToItems(alert)
	if items != nil && len(items) != 0 {
		t.Errorf("expected nil/empty items for unknown product_id, got %d", len(items))
	}
}

// ---- NOAAAlertToItems: ID stability ----

func TestNOAAAlertToItems_IDStability(t *testing.T) {
	alert := sources.NOAAAlert{
		ProductID:     "ALTEF3",
		IssueDatetime: "2026-04-10 09:00:00.0",
		Message:       "Space Weather Message Code: ALTEF3\nRadiation Storm Watch in effect.",
	}

	items1 := sources.NOAAAlertToItems(alert)
	items2 := sources.NOAAAlertToItems(alert)

	if len(items1) != len(items2) {
		t.Fatalf("call 1 produced %d items, call 2 produced %d", len(items1), len(items2))
	}
	for i := range items1 {
		if items1[i].ID != items2[i].ID {
			t.Errorf("item[%d] ID not stable: %q vs %q", i, items1[i].ID, items2[i].ID)
		}
	}
}

// ---- NOAAAlertToItems: each anchor has a distinct ID ----

func TestNOAAAlertToItems_DistinctIDsPerAnchor(t *testing.T) {
	alert := sources.NOAAAlert{
		ProductID:     "ALTCME",
		IssueDatetime: "2026-05-01 12:00:00.0",
		Message:       "Coronal Mass Ejection observed.",
	}
	items := sources.NOAAAlertToItems(alert)
	seen := make(map[string]int)
	for i, item := range items {
		if prev, dup := seen[item.ID]; dup {
			t.Errorf("duplicate ID %q at index %d (first seen at %d)", item.ID, i, prev)
		}
		seen[item.ID] = i
	}
}

// ---- GEO_ANCHORS: verify no (0,0) entries ----

func TestGEOAnchors_NoZeroCoords(t *testing.T) {
	for i, anchor := range sources.GEO_ANCHORS {
		if anchor.Lat == 0 && anchor.Lng == 0 {
			t.Errorf("GEO_ANCHORS[%d] is (0,0) — invalid placeholder", i)
		}
	}
}

// ---- Fetch: success with httptest server ----

func TestNOAAFetch_Success(t *testing.T) {
	alerts := []map[string]any{
		{
			"product_id":     "ALTG4",
			"issue_datetime": "2026-03-01 10:00:00.0",
			"message":        "Geomagnetic K-index of 7 or greater expected.\nKp expected to reach 8.",
		},
	}

	body, _ := json.Marshal(alerts)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(body)
	}))
	defer srv.Close()

	source := sources.NewNOAASWPCWithURL(srv.URL)
	items, err := source.Fetch(context.Background())
	if err != nil {
		t.Fatalf("Fetch returned error: %v", err)
	}
	// One ALTG4 alert × 8 anchors = 8 items
	if len(items) != 8 {
		t.Errorf("expected 8 items, got %d", len(items))
	}
	// All items should have ID prefix "noaa-ev-"
	for _, item := range items {
		if !strings.HasPrefix(item.ID, "noaa-ev-") {
			t.Errorf("item ID %q does not start with 'noaa-ev-'", item.ID)
		}
	}
}

// ---- Fetch: HTTP 503 returns error ----

func TestNOAAFetch_HTTP503(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	source := sources.NewNOAASWPCWithURL(srv.URL)
	_, err := source.Fetch(context.Background())
	if err == nil {
		t.Fatal("expected error on HTTP 503, got nil")
	}
}

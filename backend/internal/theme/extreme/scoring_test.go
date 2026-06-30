package extreme

import (
	"math"
	"testing"
	"time"

	"github.com/earth-sentinel/backend/internal/domain"
)

func TestHaversineKm(t *testing.T) {
	// One degree of longitude at the equator is ~111.19 km.
	got := HaversineKm(0, 0, 0, 1)
	if math.Abs(got-111.19) > 1 {
		t.Fatalf("HaversineKm(0,0,0,1) = %f, want ~111.19", got)
	}
	// Same point → 0 km.
	if d := HaversineKm(40, -75, 40, -75); math.Abs(d) > 1e-9 {
		t.Fatalf("HaversineKm same point = %f, want 0", d)
	}
}

func TestDecayFactor(t *testing.T) {
	if got := DecayFactor(0, 24); got != 1.0 {
		t.Fatalf("DecayFactor(0, 24) = %f, want 1.0", got)
	}
	// Negative / zero elapsed always yields the full factor.
	if got := DecayFactor(-5, 24); got != 1.0 {
		t.Fatalf("DecayFactor(-5, 24) = %f, want 1.0", got)
	}
	// At exactly one half-life, the factor is 0.5.
	if got := DecayFactor(24, 24); math.Abs(got-0.5) > 0.001 {
		t.Fatalf("DecayFactor(24, 24) = %f, want 0.5", got)
	}
}

func TestEventScore_OutsideRadius(t *testing.T) {
	sev := 5
	item := domain.ContentItem{
		Type:     "earthquake",
		Severity: &sev,
		Geo:      &domain.GeoPoint{Lat: 0, Lng: 0, RadiusKm: 100},
	}
	// User is ~1112 km away (10 degrees longitude), well beyond the 100 km radius.
	if got := EventScore(item, 0, 10, 1.0); got != 0 {
		t.Fatalf("EventScore outside radius = %f, want 0", got)
	}
}

func TestEventScore_AtEpicenter(t *testing.T) {
	sev := 4
	item := domain.ContentItem{
		Type:     "earthquake",
		Severity: &sev,
		Geo:      &domain.GeoPoint{Lat: 12.34, Lng: -56.78, RadiusKm: 300},
	}
	// User exactly at the epicentre → proximity ≈ 1, so score must exceed the
	// severity-only contribution (severity*0.8).
	got := EventScore(item, 12.34, -56.78, 1.0)
	if got <= float64(sev)*0.8 {
		t.Fatalf("EventScore at epicentre = %f, want > %f", got, float64(sev)*0.8)
	}
	// Exact expected value: sev*0.8 + 1*0.8 + 0.75*0.2 + 1.0*0.1.
	want := float64(sev)*0.8 + 1*0.8 + 0.75*0.2 + 1.0*0.1
	if math.Abs(got-want) > 0.001 {
		t.Fatalf("EventScore at epicentre = %f, want %f", got, want)
	}
}

func TestEventScore_NilGeo(t *testing.T) {
	sev := 5
	item := domain.ContentItem{Type: "earthquake", Severity: &sev, Geo: nil}
	if got := EventScore(item, 0, 0, 1.0); got != 0 {
		t.Fatalf("EventScore with nil geo = %f, want 0", got)
	}
}

func TestEventScore_NilSeverityAndConfidence(t *testing.T) {
	// No severity (→0) and no confidence (→0.75 default), at the epicentre.
	item := domain.ContentItem{
		Type: "flood",
		Geo:  &domain.GeoPoint{Lat: 5, Lng: 5, RadiusKm: 300},
	}
	got := EventScore(item, 5, 5, 1.0)
	want := 0*0.8 + 1*0.8 + 0.75*0.2 + 1.0*0.1
	if math.Abs(got-want) > 0.001 {
		t.Fatalf("EventScore nil severity/confidence = %f, want %f", got, want)
	}
}

func TestIsExpired(t *testing.T) {
	now := time.Date(2026, 6, 10, 12, 0, 0, 0, time.UTC)

	// earthquake maxAge = 168h (7 days). Published 10 days ago → expired.
	old := domain.ContentItem{Type: "earthquake", PublishedAt: now.Add(-240 * time.Hour)}
	if !IsExpired(old, now) {
		t.Fatalf("expected old earthquake to be expired")
	}

	// Published 1 hour ago → not expired.
	recent := domain.ContentItem{Type: "earthquake", PublishedAt: now.Add(-1 * time.Hour)}
	if IsExpired(recent, now) {
		t.Fatalf("expected recent earthquake to not be expired")
	}

	// Explicit ExpiresAt in the past → expired regardless of age.
	past := now.Add(-1 * time.Minute)
	expired := domain.ContentItem{Type: "earthquake", PublishedAt: now, ExpiresAt: &past}
	if !IsExpired(expired, now) {
		t.Fatalf("expected item with past ExpiresAt to be expired")
	}

	// Unknown type falls back to _default maxAge (168h); 1h old → not expired.
	unknown := domain.ContentItem{Type: "totally_unknown", PublishedAt: now.Add(-1 * time.Hour)}
	if IsExpired(unknown, now) {
		t.Fatalf("expected unknown-type item within default maxAge to not be expired")
	}
}

func TestSatisfiesThemeInterface(t *testing.T) {
	var _ domain.Theme = NewExtremeEventsTheme()
}

// Package extreme implements the "extreme-events" theme: lifecycle, scoring,
// and the Theme implementation that registers its data sources.
//
// The scoring logic in this file is a direct port of public/js/events.js
// (EVENT_LIFESPAN, haversineKm, getDecayFactor, calculateEventScore). It is
// pure (no I/O) and therefore fully unit-testable.
package extreme

import (
	"math"

	"github.com/earth-sentinel/backend/internal/domain"
)

// EventLifespan maps an event type to [halfLifeHours, maxAgeHours].
//
//   - halfLifeHours drives the exponential decay of an event's contribution
//     to the local risk score (see DecayFactor).
//   - maxAgeHours is the hard cutoff after which an event is considered
//     expired (see lifecycle.IsExpired).
//
// Direct port of EVENT_LIFESPAN from public/js/events.js.
var EventLifespan = map[string][2]float64{
	// meteorological
	"hurricane":    {18, 240},
	"tornado":      {6, 48},
	"severe_storm": {12, 96},
	"heat_wave":    {24, 240},
	"cold_wave":    {24, 240},
	"flood":        {12, 168},
	"drought":      {720, 8760},
	// geophysical
	"earthquake": {12, 168},
	"volcano":    {48, 4380},
	"tsunami":    {2, 24},
	// environmental
	"wildfire":      {48, 720},
	"dust_storm":    {8, 96},
	"air_pollution": {12, 120},
	// space weather
	"solar_flare":       {4, 24},
	"cme":               {24, 96},
	"geomagnetic_storm": {12, 168},
	"radiation_storm":   {12, 72},
	"radio_blackout":    {4, 24},
	// fallback
	"_default": {24, 168},
}

// LifespanFor returns the [halfLifeHours, maxAgeHours] pair for an event type,
// falling back to the "_default" entry for unknown types.
func LifespanFor(eventType string) (halfLifeH, maxAgeH float64) {
	if pair, ok := EventLifespan[eventType]; ok {
		return pair[0], pair[1]
	}
	def := EventLifespan["_default"]
	return def[0], def[1]
}

// HaversineKm returns the great-circle distance in kilometres between two
// (lat, lng) coordinates. Direct port of haversineKm from public/js/events.js.
func HaversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const R = 6371.0
	dLat := (lat2 - lat1) * math.Pi / 180
	dLng := (lng2 - lng1) * math.Pi / 180
	a := math.Pow(math.Sin(dLat/2), 2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Pow(math.Sin(dLng/2), 2)
	return R * 2 * math.Asin(math.Sqrt(a))
}

// DecayFactor returns the exponential decay multiplier (0..1] for an event of
// the given age, halving every halfLifeHours. Direct port of getDecayFactor
// from public/js/events.js.
func DecayFactor(elapsedHours, halfLifeHours float64) float64 {
	if elapsedHours <= 0 {
		return 1.0
	}
	return math.Pow(2, -elapsedHours/halfLifeHours)
}

// EventScore computes the weighted risk contribution of a single ContentItem
// for a user at (userLat, userLng). Direct port of calculateEventScore from
// public/js/events.js.
//
// Formula:
//
//	max(0, severity*0.8 + proximity*0.8 + confidence*0.2 + decayFactor*0.1)
//
// where proximity = 1 - dist/radius (1 at the epicentre, 0 at the radius edge).
//
// Nil handling (item has no geo / severity / confidence in the JS source these
// were optional fields with defaults):
//   - item.Geo == nil          → 0 (no location, no local contribution)
//   - item.Geo.RadiusKm == 0   → default radius of 300 km
//   - item.Severity == nil     → treated as 0
//   - item.Confidence == nil   → treated as 0.75 (the JS default)
//
// Events outside their radius of effect contribute 0.
func EventScore(item domain.ContentItem, userLat, userLng, decayFactor float64) float64 {
	if item.Geo == nil {
		return 0
	}

	radius := item.Geo.RadiusKm
	if radius == 0 {
		radius = 300
	}

	distKm := HaversineKm(item.Geo.Lat, item.Geo.Lng, userLat, userLng)
	if distKm > radius {
		return 0
	}

	proximity := 1 - distKm/radius

	severity := 0.0
	if item.Severity != nil {
		severity = float64(*item.Severity)
	}

	confidence := 0.75
	if item.Confidence != nil {
		confidence = *item.Confidence
	}

	return math.Max(0, severity*0.8+proximity*0.8+confidence*0.2+decayFactor*0.1)
}

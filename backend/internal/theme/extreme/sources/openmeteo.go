package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/earth-sentinel/backend/internal/domain"
)

const openMeteoDefaultBase = "https://api.open-meteo.com/v1/forecast"

// Thresholds ported from public/js/api/openmeteo.js.
// Temperature in °C, precipitation in mm/day, wind in km/h.
const (
	heatWarn  = 33.0  // °C
	heatAlert = 42.0  // °C
	coldWarn  = -8.0  // °C
	coldAlert = -20.0 // °C

	// Wind: original JS uses m/s (warn=14, alert=28).
	// WindSpeedToSeverity takes km/h as per spec. Multiply m/s × 3.6.
	windWarnKmh  = 50.4  // 14 m/s * 3.6
	windAlertKmh = 100.8 // 28 m/s * 3.6

	precipWarn  = 30.0 // mm/day
	precipAlert = 80.0 // mm/day
)

// TempToHeatSeverity returns a severity 1-5 for a heat event at the given
// temperature in °C. Ported from tempToSeverity(isHeat=true) in openmeteo.js.
func TempToHeatSeverity(c float64) int {
	switch {
	case c >= 50:
		return 5
	case c >= 47:
		return 4
	case c >= 44:
		return 3
	case c >= 42:
		return 2
	default:
		return 1
	}
}

// TempToColdSeverity returns a severity 1-5 for a cold event at the given
// temperature in °C. Ported from tempToSeverity(isHeat=false) in openmeteo.js.
func TempToColdSeverity(c float64) int {
	abs := c
	if abs < 0 {
		abs = -abs
	}
	switch {
	case abs >= 40:
		return 5
	case abs >= 35:
		return 4
	case abs >= 30:
		return 3
	case abs >= 20:
		return 2
	default:
		return 1
	}
}

// WindSpeedToSeverity returns a severity 1-5 for wind speed in km/h.
// Ported from windToSeverity in openmeteo.js (original gusts in m/s, * 3.6 = km/h).
func WindSpeedToSeverity(kmh float64) int {
	switch {
	case kmh >= 198.0: // 55 m/s * 3.6
		return 5
	case kmh >= 158.4: // 44 m/s * 3.6
		return 4
	case kmh >= 129.6: // 36 m/s * 3.6
		return 3
	case kmh >= 100.8: // 28 m/s * 3.6
		return 2
	default:
		return 1
	}
}

// RainToFloodSeverity returns a severity 1-5 for daily precipitation in mm.
// Ported from precipToSeverity in openmeteo.js.
func RainToFloodSeverity(mmh float64) int {
	switch {
	case mmh >= 200:
		return 5
	case mmh >= 150:
		return 4
	case mmh >= 100:
		return 3
	case mmh >= 80:
		return 2
	default:
		return 1
	}
}

// OpenMeteoDaily holds the daily forecast fields returned by the API.
type OpenMeteoDailyData struct {
	Time             []string  `json:"time"`
	Temperature2mMax []float64 `json:"temperature_2m_max"`
	Temperature2mMin []float64 `json:"temperature_2m_min"`
	PrecipitationSum []float64 `json:"precipitation_sum"`
	WindGusts10mMax  []float64 `json:"wind_gusts_10m_max"`
}

// OpenMeteoResponse represents the API response for one probe point.
type OpenMeteoResponse struct {
	Daily *OpenMeteoDailyData `json:"daily"`
}

// ParseOpenMeteoResponse converts one probe point's API response into ContentItems.
// Exported so it can be called from tests without HTTP.
func ParseOpenMeteoResponse(r OpenMeteoResponse, p ProbePoint) []domain.ContentItem {
	if r.Daily == nil || len(r.Daily.Time) == 0 {
		return nil
	}
	daily := r.Daily
	items := make([]domain.ContentItem, 0)
	now := time.Now().UTC()

	for di, dateStr := range daily.Time {
		publishedAt, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			publishedAt = now
		} else {
			publishedAt = publishedAt.UTC()
		}

		latStr := fmt.Sprintf("%.1f", p.Lat)
		lngStr := fmt.Sprintf("%.1f", p.Lng)

		// Heat wave
		if di < len(daily.Temperature2mMax) {
			tMax := daily.Temperature2mMax[di]
			if tMax >= heatAlert {
				sev := TempToHeatSeverity(tMax)
				radiusKm := 300.0
				if sev >= 4 {
					radiusKm = 500.0
				}
				id := fmt.Sprintf("openmeteo-heat_wave-a-%s-%s-%s", latStr, lngStr, dateStr)
				item := domain.ContentItem{
					ID:          id,
					ThemeID:     "extreme-events",
					Type:        "heat_wave",
					SourceID:    "openmeteo",
					Title:       domain.Truncate(fmt.Sprintf("Onda de Calor — %.1f°C", tMax), 80),
					Description: domain.Truncate(fmt.Sprintf("Temperatura máxima de %.1f°C prevista.", tMax), 300),
					PublishedAt: publishedAt,
					Geo:         &domain.GeoPoint{Lat: p.Lat, Lng: p.Lng, RadiusKm: radiusKm},
					Severity:    domain.PtrInt(sev),
					Confidence:  domain.PtrFloat(0.75),
					Metadata:    map[string]any{"warning": false, "value": tMax},
					Tags:        []string{"openmeteo", "heat_wave"},
					CreatedAt:   now,
					UpdatedAt:   now,
				}
				if domain.Validate(item) == nil {
					items = append(items, item)
				}
			} else if tMax >= heatWarn {
				id := fmt.Sprintf("openmeteo-heat_wave-w-%s-%s-%s", latStr, lngStr, dateStr)
				item := domain.ContentItem{
					ID:          id,
					ThemeID:     "extreme-events",
					Type:        "heat_wave",
					SourceID:    "openmeteo",
					Title:       domain.Truncate(fmt.Sprintf("Calor Intenso — %.1f°C", tMax), 80),
					Description: domain.Truncate(fmt.Sprintf("Temperatura elevada de %.1f°C prevista.", tMax), 300),
					PublishedAt: publishedAt,
					Geo:         &domain.GeoPoint{Lat: p.Lat, Lng: p.Lng, RadiusKm: 150.0},
					Severity:    domain.PtrInt(1),
					Confidence:  domain.PtrFloat(0.65),
					Metadata:    map[string]any{"warning": true, "value": tMax},
					Tags:        []string{"openmeteo", "heat_wave", "warning"},
					CreatedAt:   now,
					UpdatedAt:   now,
				}
				if domain.Validate(item) == nil {
					items = append(items, item)
				}
			}
		}

		// Cold wave
		if di < len(daily.Temperature2mMin) {
			tMin := daily.Temperature2mMin[di]
			if tMin <= coldAlert {
				sev := TempToColdSeverity(tMin)
				radiusKm := 300.0
				if sev >= 4 {
					radiusKm = 500.0
				}
				id := fmt.Sprintf("openmeteo-cold_wave-a-%s-%s-%s", latStr, lngStr, dateStr)
				item := domain.ContentItem{
					ID:          id,
					ThemeID:     "extreme-events",
					Type:        "cold_wave",
					SourceID:    "openmeteo",
					Title:       domain.Truncate(fmt.Sprintf("Onda de Frio — %.1f°C", tMin), 80),
					Description: domain.Truncate(fmt.Sprintf("Temperatura mínima de %.1f°C prevista.", tMin), 300),
					PublishedAt: publishedAt,
					Geo:         &domain.GeoPoint{Lat: p.Lat, Lng: p.Lng, RadiusKm: radiusKm},
					Severity:    domain.PtrInt(sev),
					Confidence:  domain.PtrFloat(0.75),
					Metadata:    map[string]any{"warning": false, "value": tMin},
					Tags:        []string{"openmeteo", "cold_wave"},
					CreatedAt:   now,
					UpdatedAt:   now,
				}
				if domain.Validate(item) == nil {
					items = append(items, item)
				}
			} else if tMin <= coldWarn {
				id := fmt.Sprintf("openmeteo-cold_wave-w-%s-%s-%s", latStr, lngStr, dateStr)
				item := domain.ContentItem{
					ID:          id,
					ThemeID:     "extreme-events",
					Type:        "cold_wave",
					SourceID:    "openmeteo",
					Title:       domain.Truncate(fmt.Sprintf("Frio Intenso — %.1f°C", tMin), 80),
					Description: domain.Truncate(fmt.Sprintf("Temperatura mínima de %.1f°C prevista.", tMin), 300),
					PublishedAt: publishedAt,
					Geo:         &domain.GeoPoint{Lat: p.Lat, Lng: p.Lng, RadiusKm: 150.0},
					Severity:    domain.PtrInt(1),
					Confidence:  domain.PtrFloat(0.65),
					Metadata:    map[string]any{"warning": true, "value": tMin},
					Tags:        []string{"openmeteo", "cold_wave", "warning"},
					CreatedAt:   now,
					UpdatedAt:   now,
				}
				if domain.Validate(item) == nil {
					items = append(items, item)
				}
			}
		}

		// Flood (heavy precipitation)
		if di < len(daily.PrecipitationSum) {
			prec := daily.PrecipitationSum[di]
			if prec >= precipAlert {
				sev := RainToFloodSeverity(prec)
				id := fmt.Sprintf("openmeteo-flood-a-%s-%s-%s", latStr, lngStr, dateStr)
				item := domain.ContentItem{
					ID:          id,
					ThemeID:     "extreme-events",
					Type:        "flood",
					SourceID:    "openmeteo",
					Title:       domain.Truncate(fmt.Sprintf("Chuva Intensa — %.0f mm", prec), 80),
					Description: domain.Truncate(fmt.Sprintf("Precipitação acumulada de %.0f mm prevista.", prec), 300),
					PublishedAt: publishedAt,
					Geo:         &domain.GeoPoint{Lat: p.Lat, Lng: p.Lng, RadiusKm: 300.0},
					Severity:    domain.PtrInt(sev),
					Confidence:  domain.PtrFloat(0.75),
					Metadata:    map[string]any{"warning": false, "value": prec},
					Tags:        []string{"openmeteo", "flood"},
					CreatedAt:   now,
					UpdatedAt:   now,
				}
				if domain.Validate(item) == nil {
					items = append(items, item)
				}
			} else if prec >= precipWarn {
				id := fmt.Sprintf("openmeteo-flood-w-%s-%s-%s", latStr, lngStr, dateStr)
				item := domain.ContentItem{
					ID:          id,
					ThemeID:     "extreme-events",
					Type:        "flood",
					SourceID:    "openmeteo",
					Title:       domain.Truncate(fmt.Sprintf("Chuva Elevada — %.0f mm", prec), 80),
					Description: domain.Truncate(fmt.Sprintf("Precipitação de %.0f mm prevista.", prec), 300),
					PublishedAt: publishedAt,
					Geo:         &domain.GeoPoint{Lat: p.Lat, Lng: p.Lng, RadiusKm: 150.0},
					Severity:    domain.PtrInt(1),
					Confidence:  domain.PtrFloat(0.65),
					Metadata:    map[string]any{"warning": true, "value": prec},
					Tags:        []string{"openmeteo", "flood", "warning"},
					CreatedAt:   now,
					UpdatedAt:   now,
				}
				if domain.Validate(item) == nil {
					items = append(items, item)
				}
			}
		}

		// Severe storm (high wind gusts); JS wind data is m/s, API returns m/s
		if di < len(daily.WindGusts10mMax) {
			windMs := daily.WindGusts10mMax[di]
			windKmh := windMs * 3.6
			if windKmh >= windAlertKmh {
				sev := WindSpeedToSeverity(windKmh)
				id := fmt.Sprintf("openmeteo-severe_storm-a-%s-%s-%s", latStr, lngStr, dateStr)
				item := domain.ContentItem{
					ID:          id,
					ThemeID:     "extreme-events",
					Type:        "severe_storm",
					SourceID:    "openmeteo",
					Title:       domain.Truncate(fmt.Sprintf("Vento Severo — %.0f km/h", windKmh), 80),
					Description: domain.Truncate(fmt.Sprintf("Rajadas de vento de %.0f km/h previstas.", windKmh), 300),
					PublishedAt: publishedAt,
					Geo:         &domain.GeoPoint{Lat: p.Lat, Lng: p.Lng, RadiusKm: 300.0},
					Severity:    domain.PtrInt(sev),
					Confidence:  domain.PtrFloat(0.75),
					Metadata:    map[string]any{"warning": false, "value": windMs},
					Tags:        []string{"openmeteo", "severe_storm"},
					CreatedAt:   now,
					UpdatedAt:   now,
				}
				if domain.Validate(item) == nil {
					items = append(items, item)
				}
			} else if windKmh >= windWarnKmh {
				id := fmt.Sprintf("openmeteo-severe_storm-w-%s-%s-%s", latStr, lngStr, dateStr)
				item := domain.ContentItem{
					ID:          id,
					ThemeID:     "extreme-events",
					Type:        "severe_storm",
					SourceID:    "openmeteo",
					Title:       domain.Truncate(fmt.Sprintf("Vento Forte — %.0f km/h", windKmh), 80),
					Description: domain.Truncate(fmt.Sprintf("Rajadas de %.0f km/h previstas.", windKmh), 300),
					PublishedAt: publishedAt,
					Geo:         &domain.GeoPoint{Lat: p.Lat, Lng: p.Lng, RadiusKm: 150.0},
					Severity:    domain.PtrInt(1),
					Confidence:  domain.PtrFloat(0.65),
					Metadata:    map[string]any{"warning": true, "value": windMs},
					Tags:        []string{"openmeteo", "severe_storm", "warning"},
					CreatedAt:   now,
					UpdatedAt:   now,
				}
				if domain.Validate(item) == nil {
					items = append(items, item)
				}
			}
		}
	}

	return items
}

// openMeteoSource implements domain.Source for Open-Meteo weather extremes.
type openMeteoSource struct {
	baseURL    string
	httpClient *http.Client
}

// NewOpenMeteo returns a new Open-Meteo extremes source using the default endpoint.
func NewOpenMeteo() domain.Source {
	return &openMeteoSource{
		baseURL:    openMeteoDefaultBase,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// NewOpenMeteoWithURL returns a new Open-Meteo extremes source with a custom base URL.
func NewOpenMeteoWithURL(baseURL string) domain.Source {
	return &openMeteoSource{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (s *openMeteoSource) ID() string              { return "openmeteo" }
func (s *openMeteoSource) ThemeID() string         { return "extreme-events" }
func (s *openMeteoSource) Interval() time.Duration { return 30 * time.Minute }

func (s *openMeteoSource) Fetch(ctx context.Context) ([]domain.ContentItem, error) {
	// Build comma-separated lists of all probe point coordinates.
	lats := make([]string, len(PROBE_GRID))
	lngs := make([]string, len(PROBE_GRID))
	for i, p := range PROBE_GRID {
		lats[i] = fmt.Sprintf("%g", p.Lat)
		lngs[i] = fmt.Sprintf("%g", p.Lng)
	}

	vars := "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max"
	url := fmt.Sprintf(
		"%s?latitude=%s&longitude=%s&daily=%s&timezone=UTC&forecast_days=7",
		s.baseURL,
		strings.Join(lats, ","),
		strings.Join(lngs, ","),
		vars,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("openmeteo build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openmeteo fetch: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openmeteo fetch: HTTP %d", resp.StatusCode)
	}

	// The API returns an array when multiple locations are requested.
	var rawArr []OpenMeteoResponse
	dec := json.NewDecoder(resp.Body)
	// Try array first; fall back to single object.
	if err := dec.Decode(&rawArr); err != nil {
		return nil, fmt.Errorf("openmeteo decode: %w", err)
	}

	items := make([]domain.ContentItem, 0)
	for i, r := range rawArr {
		if i >= len(PROBE_GRID) {
			break
		}
		items = append(items, ParseOpenMeteoResponse(r, PROBE_GRID[i])...)
	}
	return items, nil
}

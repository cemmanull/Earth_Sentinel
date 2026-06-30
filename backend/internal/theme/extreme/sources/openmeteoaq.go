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

const openMeteoAQDefaultBase = "https://air-quality-api.open-meteo.com/v1/air-quality"

// Thresholds ported from public/js/api/airquality.js.
const (
	dustThresholdUgm3 = 500.0 // µg/m³ — minimum to emit dust_storm
	aqiThreshold      = 101   // US AQI — minimum to emit air_pollution
)

// DustUgm3ToSeverity returns severity 1-5 for dust concentration in µg/m³.
// Ported from dustToSeverity in airquality.js.
func DustUgm3ToSeverity(ugm3 float64) int {
	switch {
	case ugm3 >= 2000:
		return 5
	case ugm3 >= 1200:
		return 4
	case ugm3 >= 800:
		return 3
	default:
		return 2 // 500–799 µg/m³ → severity 2
	}
}

// USAQIToSeverity returns severity 1-5 for US AQI value.
// Ported from aqiToSeverity in airquality.js.
func USAQIToSeverity(aqi int) int {
	switch {
	case aqi >= 301: // Hazardous
		return 5
	case aqi >= 201: // Very Unhealthy
		return 4
	case aqi >= 151: // Unhealthy
		return 3
	default: // 101–150: Unhealthy for Sensitive Groups
		return 2
	}
}

// AQHourlyData holds the hourly AQ fields returned by the API.
type AQHourlyData struct {
	Time  []string  `json:"time"`
	Dust  []float64 `json:"dust"`
	USAQI []float64 `json:"us_aqi"` // API returns float; truncate to int for severity
}

// AQResponse represents the API response for one probe point.
type AQResponse struct {
	Hourly *AQHourlyData `json:"hourly"`
}

// ParseAQResponse converts one probe point's AQ API response into ContentItems.
// Exported for unit testing without HTTP.
func ParseAQResponse(r AQResponse, p ProbePoint) []domain.ContentItem {
	if r.Hourly == nil || len(r.Hourly.Time) == 0 {
		return nil
	}
	hourly := r.Hourly
	items := make([]domain.ContentItem, 0)
	now := time.Now().UTC()

	latStr := fmt.Sprintf("%.1f", p.Lat)
	lngStr := fmt.Sprintf("%.1f", p.Lng)

	for hi, timeStr := range hourly.Time {
		publishedAt, err := time.Parse("2006-01-02T15:04", timeStr)
		if err != nil {
			// Try RFC3339 as fallback
			publishedAt, err = time.Parse(time.RFC3339, timeStr)
			if err != nil {
				publishedAt = now
			}
		}
		publishedAt = publishedAt.UTC()

		// Dust storm
		if hi < len(hourly.Dust) {
			dust := hourly.Dust[hi]
			if dust >= dustThresholdUgm3 {
				sev := DustUgm3ToSeverity(dust)
				id := fmt.Sprintf("openmeteo-dust_storm-%.1f-%.1f-%s", p.Lat, p.Lng, timeStr)
				item := domain.ContentItem{
					ID:          id,
					ThemeID:     "extreme-events",
					Type:        "dust_storm",
					SourceID:    "openmeteo-aq",
					Title:       domain.Truncate(fmt.Sprintf("Tempestade de Areia — %.0f µg/m³", dust), 80),
					Description: domain.Truncate(fmt.Sprintf("Concentração de poeira de %.0f µg/m³.", dust), 300),
					PublishedAt: publishedAt,
					Geo:         &domain.GeoPoint{Lat: p.Lat, Lng: p.Lng, RadiusKm: 400.0},
					Severity:    domain.PtrInt(sev),
					Confidence:  domain.PtrFloat(0.75),
					Metadata:    map[string]any{"dust_ugm3": dust},
					Tags:        []string{"openmeteo-aq", "dust_storm"},
					CreatedAt:   now,
					UpdatedAt:   now,
				}
				if domain.Validate(item) == nil {
					items = append(items, item)
				}
			}
		}

		// Air pollution
		if hi < len(hourly.USAQI) {
			aqiF := hourly.USAQI[hi]
			aqi := int(aqiF)
			if aqi >= aqiThreshold {
				sev := USAQIToSeverity(aqi)
				id := fmt.Sprintf("openmeteo-air_pollution-%s-%s-%s", latStr, lngStr, timeStr)
				item := domain.ContentItem{
					ID:          id,
					ThemeID:     "extreme-events",
					Type:        "air_pollution",
					SourceID:    "openmeteo-aq",
					Title:       domain.Truncate(fmt.Sprintf("Qualidade do Ar Degradada — AQI %d", aqi), 80),
					Description: domain.Truncate(fmt.Sprintf("Índice de qualidade do ar US AQI: %d.", aqi), 300),
					PublishedAt: publishedAt,
					Geo:         &domain.GeoPoint{Lat: p.Lat, Lng: p.Lng, RadiusKm: 200.0},
					Severity:    domain.PtrInt(sev),
					Confidence:  domain.PtrFloat(0.75),
					Metadata:    map[string]any{"us_aqi": aqi},
					Tags:        []string{"openmeteo-aq", "air_pollution"},
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

// openMeteoAQSource implements domain.Source for Open-Meteo Air Quality.
type openMeteoAQSource struct {
	baseURL    string
	httpClient *http.Client
}

// NewOpenMeteoAQ returns a new Open-Meteo AQ source using the default endpoint.
func NewOpenMeteoAQ() domain.Source {
	return &openMeteoAQSource{
		baseURL:    openMeteoAQDefaultBase,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

// NewOpenMeteoAQWithURL returns a new Open-Meteo AQ source with a custom base URL.
func NewOpenMeteoAQWithURL(baseURL string) domain.Source {
	return &openMeteoAQSource{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (s *openMeteoAQSource) ID() string              { return "openmeteo-aq" }
func (s *openMeteoAQSource) ThemeID() string         { return "extreme-events" }
func (s *openMeteoAQSource) Interval() time.Duration { return 30 * time.Minute }

func (s *openMeteoAQSource) Fetch(ctx context.Context) ([]domain.ContentItem, error) {
	lats := make([]string, len(PROBE_GRID))
	lngs := make([]string, len(PROBE_GRID))
	for i, p := range PROBE_GRID {
		lats[i] = fmt.Sprintf("%g", p.Lat)
		lngs[i] = fmt.Sprintf("%g", p.Lng)
	}

	url := fmt.Sprintf(
		"%s?latitude=%s&longitude=%s&hourly=dust,us_aqi&timezone=UTC&forecast_days=1",
		s.baseURL,
		strings.Join(lats, ","),
		strings.Join(lngs, ","),
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("openmeteo-aq build request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openmeteo-aq fetch: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openmeteo-aq fetch: HTTP %d", resp.StatusCode)
	}

	var rawArr []AQResponse
	if err := json.NewDecoder(resp.Body).Decode(&rawArr); err != nil {
		return nil, fmt.Errorf("openmeteo-aq decode: %w", err)
	}

	items := make([]domain.ContentItem, 0)
	for i, r := range rawArr {
		if i >= len(PROBE_GRID) {
			break
		}
		items = append(items, ParseAQResponse(r, PROBE_GRID[i])...)
	}
	return items, nil
}

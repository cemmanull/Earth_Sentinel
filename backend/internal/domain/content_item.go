package domain

import (
	"fmt"
	"math"
	"time"
)

type ContentItem struct {
	ID          string         `json:"id"`
	ThemeID     string         `json:"theme_id"`
	Type        string         `json:"type"`
	SourceID    string         `json:"source_id"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	PublishedAt time.Time      `json:"published_at"`
	ExpiresAt   *time.Time     `json:"expires_at,omitempty"`
	Geo         *GeoPoint      `json:"geo,omitempty"`
	Severity    *int           `json:"severity,omitempty"`
	Confidence  *float64       `json:"confidence,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
	Tags        []string       `json:"tags"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

type GeoPoint struct {
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
	RadiusKm float64 `json:"radius_km"`
}

func Validate(item ContentItem) error {
	if item.ID == "" {
		return fmt.Errorf("missing id")
	}
	if item.ThemeID == "" {
		return fmt.Errorf("missing theme_id")
	}
	if item.Type == "" {
		return fmt.Errorf("missing type")
	}
	if item.SourceID == "" {
		return fmt.Errorf("missing source_id")
	}
	if item.Title == "" {
		return fmt.Errorf("missing title")
	}
	if item.PublishedAt.IsZero() {
		return fmt.Errorf("missing published_at")
	}

	if item.Geo != nil {
		if item.Geo.Lat == 0 && item.Geo.Lng == 0 {
			return fmt.Errorf("geo (0,0) is invalid — use nil for items without location")
		}
		if math.Abs(item.Geo.Lat) > 90 {
			return fmt.Errorf("lat out of range: %f", item.Geo.Lat)
		}
		if math.Abs(item.Geo.Lng) > 180 {
			return fmt.Errorf("lng out of range: %f", item.Geo.Lng)
		}
	}
	if item.Severity != nil && (*item.Severity < 1 || *item.Severity > 5) {
		return fmt.Errorf("severity out of 1–5: %d", *item.Severity)
	}
	if item.Confidence != nil && (*item.Confidence < 0 || *item.Confidence > 1) {
		return fmt.Errorf("confidence out of 0–1: %f", *item.Confidence)
	}
	return nil
}

func PtrInt(v int) *int           { return &v }
func PtrFloat(v float64) *float64 { return &v }

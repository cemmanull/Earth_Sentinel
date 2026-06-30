package handler

import (
	"encoding/json"
	"net/http"

	"github.com/earth-sentinel/backend/internal/domain"
)

type ThemeRegistry interface {
	All() []domain.Theme
}

type ThemesHandler struct {
	registry ThemeRegistry
}

func NewThemesHandler(registry ThemeRegistry) *ThemesHandler {
	return &ThemesHandler{registry: registry}
}

type themeResponse struct {
	ID         string `json:"id"`
	Label      string `json:"label"`
	HasGeoView bool   `json:"has_geo_view"`
}

var geoThemes = map[string]bool{
	"extreme-events": true,
	"weather":        true,
}

func (h *ThemesHandler) List(w http.ResponseWriter, r *http.Request) {
	themes := h.registry.All()
	resp := make([]themeResponse, 0, len(themes))
	for _, t := range themes {
		resp = append(resp, themeResponse{
			ID:         t.ID(),
			Label:      t.Label(),
			HasGeoView: geoThemes[t.ID()],
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp) //nolint:errcheck
}

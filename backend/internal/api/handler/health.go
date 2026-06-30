package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

type Pinger interface {
	Ping(ctx context.Context) error
}

type DBPinger interface {
	PingContext(ctx context.Context) error
}

type HealthHandler struct {
	db    DBPinger
	cache Pinger
}

func NewHealthHandler(db DBPinger, cache Pinger) *HealthHandler {
	return &HealthHandler{db: db, cache: cache}
}

func (h *HealthHandler) Check(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	dbOK := h.db != nil && h.db.PingContext(ctx) == nil
	cacheOK := h.cache != nil && h.cache.Ping(ctx) == nil

	status := "ok"
	code := http.StatusOK
	if !dbOK || !cacheOK {
		status = "degraded"
		code = http.StatusServiceUnavailable
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]any{ //nolint:errcheck
		"status": status,
		"db":     dbOK,
		"cache":  cacheOK,
		"time":   time.Now().UTC(),
	})
}

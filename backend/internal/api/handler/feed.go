package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/earth-sentinel/backend/internal/domain"
	pgstore "github.com/earth-sentinel/backend/internal/store/postgres"
)

type FeedStore interface {
	QueryByTheme(ctx context.Context, themeID string, opts pgstore.QueryOptions) ([]domain.ContentItem, error)
}

type FeedCacher interface {
	GetFeed(ctx context.Context, themeID string) ([]domain.ContentItem, bool)
	SetFeed(ctx context.Context, themeID string, items []domain.ContentItem) error
}

type ThemeGetter interface {
	Get(id string) (domain.Theme, error)
}

type FeedHandler struct {
	store    FeedStore
	cache    FeedCacher
	registry ThemeGetter
}

func NewFeedHandler(store FeedStore, cache FeedCacher, registry ThemeGetter) *FeedHandler {
	return &FeedHandler{store: store, cache: cache, registry: registry}
}

func (h *FeedHandler) GetFeed(w http.ResponseWriter, r *http.Request) {
	themeID := r.PathValue("themeID")
	if themeID == "" {
		http.Error(w, `{"error":"missing themeID"}`, http.StatusBadRequest)
		return
	}

	if _, err := h.registry.Get(themeID); err != nil {
		http.Error(w, `{"error":"unknown theme"}`, http.StatusBadRequest)
		return
	}

	// O cache guarda apenas o feed canônico do tema (sem filtros). Requests com
	// query params vão direto ao PostgreSQL para não poluir o feed quente.
	q := r.URL.Query()
	isDefaultQuery := q.Get("limit") == "" && q.Get("since") == "" &&
		q.Get("type") == "" && q.Get("until") == ""

	if h.cache != nil && isDefaultQuery {
		if items, ok := h.cache.GetFeed(r.Context(), themeID); ok {
			writeJSON(w, items)
			return
		}
	}

	opts := pgstore.DefaultQueryOptions()
	if v := q.Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			opts.Limit = n
		}
	}
	if v := q.Get("since"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			opts.Since = t
		}
	}
	if v := q.Get("until"); v != "" {
		if t, err := time.Parse(time.RFC3339, v); err == nil {
			opts.Until = t
		}
	}
	opts.Type = q.Get("type")

	items, err := h.store.QueryByTheme(r.Context(), themeID, opts)
	if err != nil {
		slog.Error("query failed", "theme", themeID, "error", err)
		http.Error(w, `{"error":"internal error"}`, http.StatusInternalServerError)
		return
	}

	if h.cache != nil && isDefaultQuery && len(items) > 0 {
		h.cache.SetFeed(r.Context(), themeID, items) //nolint:errcheck
	}

	writeJSON(w, items)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

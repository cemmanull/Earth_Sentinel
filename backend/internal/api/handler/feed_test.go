package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/earth-sentinel/backend/internal/domain"
	pgstore "github.com/earth-sentinel/backend/internal/store/postgres"
)

// --- fakes -------------------------------------------------------------------

type fakeStore struct {
	calls int
	items []domain.ContentItem
}

func (f *fakeStore) QueryByTheme(_ context.Context, _ string, _ pgstore.QueryOptions) ([]domain.ContentItem, error) {
	f.calls++
	return f.items, nil
}

type fakeCache struct {
	data     map[string][]domain.ContentItem
	getCalls int
	setCalls int
}

func (c *fakeCache) GetFeed(_ context.Context, themeID string) ([]domain.ContentItem, bool) {
	c.getCalls++
	items, ok := c.data[themeID]
	return items, ok
}

func (c *fakeCache) SetFeed(_ context.Context, themeID string, items []domain.ContentItem) error {
	c.setCalls++
	if c.data == nil {
		c.data = map[string][]domain.ContentItem{}
	}
	c.data[themeID] = items
	return nil
}

type fakeRegistry struct{ known map[string]bool }

func (r *fakeRegistry) Get(id string) (domain.Theme, error) {
	if r.known[id] {
		return nil, nil // handler only checks the error, not the value
	}
	return nil, errors.New("unknown theme")
}

func newRequest(themeID, rawQuery string) *http.Request {
	target := "/api/themes/" + themeID + "/feed"
	if rawQuery != "" {
		target += "?" + rawQuery
	}
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.SetPathValue("themeID", themeID)
	return req
}

// --- tests -------------------------------------------------------------------

func TestGetFeed_CacheMissThenHit(t *testing.T) {
	store := &fakeStore{items: []domain.ContentItem{{ID: "usgs-1", ThemeID: "extreme-events"}}}
	cache := &fakeCache{}
	reg := &fakeRegistry{known: map[string]bool{"extreme-events": true}}
	h := NewFeedHandler(store, cache, reg)

	// First call: cache miss → hits store, then populates cache.
	rec1 := httptest.NewRecorder()
	h.GetFeed(rec1, newRequest("extreme-events", ""))
	if rec1.Code != http.StatusOK {
		t.Fatalf("call 1 status = %d, want 200", rec1.Code)
	}
	if store.calls != 1 {
		t.Errorf("call 1: store.calls = %d, want 1", store.calls)
	}
	if cache.setCalls != 1 {
		t.Errorf("call 1: cache.setCalls = %d, want 1", cache.setCalls)
	}

	// Second call: cache hit → store must NOT be queried again.
	rec2 := httptest.NewRecorder()
	h.GetFeed(rec2, newRequest("extreme-events", ""))
	if rec2.Code != http.StatusOK {
		t.Fatalf("call 2 status = %d, want 200", rec2.Code)
	}
	if store.calls != 1 {
		t.Errorf("call 2: store.calls = %d, want still 1 (cache hit)", store.calls)
	}
}

func TestGetFeed_WithQueryParamsBypassesCache(t *testing.T) {
	store := &fakeStore{items: []domain.ContentItem{{ID: "usgs-1", ThemeID: "extreme-events"}}}
	cache := &fakeCache{}
	reg := &fakeRegistry{known: map[string]bool{"extreme-events": true}}
	h := NewFeedHandler(store, cache, reg)

	rec := httptest.NewRecorder()
	h.GetFeed(rec, newRequest("extreme-events", "type=earthquake"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	// Filtered queries never touch the cache (neither read nor write).
	if cache.getCalls != 0 {
		t.Errorf("cache.getCalls = %d, want 0 (filtered query must bypass cache)", cache.getCalls)
	}
	if cache.setCalls != 0 {
		t.Errorf("cache.setCalls = %d, want 0 (filtered query must not populate cache)", cache.setCalls)
	}
	if store.calls != 1 {
		t.Errorf("store.calls = %d, want 1", store.calls)
	}
}

func TestGetFeed_UntilBypassesCache(t *testing.T) {
	store := &fakeStore{items: []domain.ContentItem{{ID: "usgs-1", ThemeID: "extreme-events"}}}
	cache := &fakeCache{}
	reg := &fakeRegistry{known: map[string]bool{"extreme-events": true}}
	h := NewFeedHandler(store, cache, reg)

	rec := httptest.NewRecorder()
	h.GetFeed(rec, newRequest("extreme-events", "since=2025-01-01T00:00:00Z&until=2025-12-31T23:59:59Z"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	// Janela histórica (since/until) nunca usa o cache do feed quente.
	if cache.getCalls != 0 {
		t.Errorf("cache.getCalls = %d, want 0 (date-range query must bypass cache)", cache.getCalls)
	}
	if cache.setCalls != 0 {
		t.Errorf("cache.setCalls = %d, want 0 (date-range query must not populate cache)", cache.setCalls)
	}
	if store.calls != 1 {
		t.Errorf("store.calls = %d, want 1", store.calls)
	}
}

func TestGetFeed_UnknownTheme(t *testing.T) {
	store := &fakeStore{}
	cache := &fakeCache{}
	reg := &fakeRegistry{known: map[string]bool{"extreme-events": true}}
	h := NewFeedHandler(store, cache, reg)

	rec := httptest.NewRecorder()
	h.GetFeed(rec, newRequest("does-not-exist", ""))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for unknown theme", rec.Code)
	}
	if store.calls != 0 {
		t.Errorf("store.calls = %d, want 0 (unknown theme rejected before query)", store.calls)
	}
}

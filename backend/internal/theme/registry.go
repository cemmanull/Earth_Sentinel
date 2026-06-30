package theme

import (
	"fmt"
	"sync"

	"github.com/earth-sentinel/backend/internal/domain"
)

type Registry struct {
	mu     sync.RWMutex
	themes map[string]domain.Theme
	order  []string
}

func NewRegistry() *Registry {
	return &Registry{themes: make(map[string]domain.Theme)}
}

func (r *Registry) Register(t domain.Theme) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.themes[t.ID()]; !exists {
		r.order = append(r.order, t.ID())
	}
	r.themes[t.ID()] = t
}

func (r *Registry) Get(id string) (domain.Theme, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	t, ok := r.themes[id]
	if !ok {
		return nil, fmt.Errorf("theme not found: %s", id)
	}
	return t, nil
}

func (r *Registry) All() []domain.Theme {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]domain.Theme, 0, len(r.order))
	for _, id := range r.order {
		out = append(out, r.themes[id])
	}
	return out
}

func (r *Registry) AllSources() []domain.Source {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var sources []domain.Source
	for _, id := range r.order {
		sources = append(sources, r.themes[id].Sources()...)
	}
	return sources
}

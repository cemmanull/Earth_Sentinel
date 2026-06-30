package redis

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/earth-sentinel/backend/internal/domain"
)

// themeTTL — cada tema tem cadência de ingestão própria, então o feed quente
// expira em ritmos diferentes. Feeds com fontes voláteis (finance) expiram rápido;
// feeds mais estáveis (weather) toleram TTL maior.
var themeTTL = map[string]time.Duration{
	"extreme-events": 5 * time.Minute,
	"weather":        30 * time.Minute,
	"news":           15 * time.Minute,
	"finance":        1 * time.Minute,
}

const defaultFeedTTL = 5 * time.Minute

func ttlFor(themeID string) time.Duration {
	if d, ok := themeTTL[themeID]; ok {
		return d
	}
	return defaultFeedTTL
}

type FeedCache struct {
	client *redis.Client
}

func NewFeedCache(client *redis.Client) *FeedCache {
	return &FeedCache{client: client}
}

func NewClient(addr string) *redis.Client {
	return redis.NewClient(&redis.Options{Addr: addr})
}

func (c *FeedCache) GetFeed(ctx context.Context, themeID string) ([]domain.ContentItem, bool) {
	key := feedKey(themeID)
	data, err := c.client.Get(ctx, key).Bytes()
	if err != nil {
		return nil, false
	}
	var items []domain.ContentItem
	if err := json.Unmarshal(data, &items); err != nil {
		return nil, false
	}
	return items, true
}

func (c *FeedCache) SetFeed(ctx context.Context, themeID string, items []domain.ContentItem) error {
	data, err := json.Marshal(items)
	if err != nil {
		return err
	}
	return c.client.Set(ctx, feedKey(themeID), data, ttlFor(themeID)).Err()
}

func (c *FeedCache) InvalidateFeed(ctx context.Context, themeID string) {
	c.client.Del(ctx, feedKey(themeID)) //nolint:errcheck
}

func (c *FeedCache) Ping(ctx context.Context) error {
	return c.client.Ping(ctx).Err()
}

func feedKey(themeID string) string {
	return fmt.Sprintf("feed:%s", themeID)
}

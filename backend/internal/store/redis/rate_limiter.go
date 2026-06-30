package redis

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type RateLimiter struct {
	client *redis.Client
}

func NewRateLimiter(client *redis.Client) *RateLimiter {
	return &RateLimiter{client: client}
}

// Allow returns true if the request is within the allowed rate limit.
// Uses a Redis sorted-set sliding-window counter.
func (r *RateLimiter) Allow(ctx context.Context, key string, maxReqs int, window time.Duration) bool {
	now := time.Now().UnixMilli()
	windowStart := now - window.Milliseconds()
	rKey := fmt.Sprintf("ratelimit:%s", key)

	pipe := r.client.Pipeline()
	pipe.ZRemRangeByScore(ctx, rKey, "0", fmt.Sprintf("%d", windowStart))
	pipe.ZAdd(ctx, rKey, redis.Z{Score: float64(now), Member: now})
	countCmd := pipe.ZCard(ctx, rKey)
	pipe.Expire(ctx, rKey, window)

	if _, err := pipe.Exec(ctx); err != nil {
		// On Redis failure, allow the request to avoid blocking ingestion.
		return true
	}
	return countCmd.Val() <= int64(maxReqs)
}

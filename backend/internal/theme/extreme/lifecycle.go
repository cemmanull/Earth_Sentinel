package extreme

import (
	"time"

	"github.com/earth-sentinel/backend/internal/domain"
)

// IsExpired reports whether an extreme-event item should be considered expired
// at the given time. Direct port of isEventExpired from public/js/events.js.
//
// An item is expired when either:
//   - it has an explicit ExpiresAt (the JS endTime) that is at or before now; or
//   - its age (now - PublishedAt, the JS startTime) exceeds the maxAge for its
//     type from EventLifespan (falling back to the "_default" entry).
func IsExpired(item domain.ContentItem, now time.Time) bool {
	if item.ExpiresAt != nil && !item.ExpiresAt.After(now) {
		return true
	}
	_, maxAgeH := LifespanFor(item.Type)
	ageH := now.Sub(item.PublishedAt).Hours()
	return ageH > maxAgeH
}

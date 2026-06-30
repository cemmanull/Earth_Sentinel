package redis

import (
	"testing"
	"time"
)

func TestTTLFor_KnownThemes(t *testing.T) {
	cases := map[string]time.Duration{
		"extreme-events": 5 * time.Minute,
		"weather":        30 * time.Minute,
		"news":           15 * time.Minute,
		"finance":        1 * time.Minute,
	}
	for themeID, want := range cases {
		if got := ttlFor(themeID); got != want {
			t.Errorf("ttlFor(%q) = %v, want %v", themeID, got, want)
		}
	}
}

func TestTTLFor_UnknownThemeUsesDefault(t *testing.T) {
	if got := ttlFor("does-not-exist"); got != defaultFeedTTL {
		t.Errorf("ttlFor(unknown) = %v, want default %v", got, defaultFeedTTL)
	}
}

func TestFeedKey_Stable(t *testing.T) {
	if got := feedKey("extreme-events"); got != "feed:extreme-events" {
		t.Errorf("feedKey = %q, want %q", got, "feed:extreme-events")
	}
}

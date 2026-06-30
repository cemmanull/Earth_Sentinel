package domain_test

import (
	"testing"

	"github.com/earth-sentinel/backend/internal/domain"
)

func TestTruncate_Short(t *testing.T) {
	got := domain.Truncate("hello", 80)
	if got != "hello" {
		t.Errorf("expected 'hello', got %q", got)
	}
}

func TestTruncate_Long(t *testing.T) {
	input := "abcdefghij"
	got := domain.Truncate(input, 5)
	if len([]rune(got)) > 5 {
		t.Errorf("expected ≤5 runes, got %d in %q", len([]rune(got)), got)
	}
}

func TestTruncate_Exact(t *testing.T) {
	input := "abcde"
	got := domain.Truncate(input, 5)
	if got != "abcde" {
		t.Errorf("expected no truncation, got %q", got)
	}
}

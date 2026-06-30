//go:build integration

// Smoke test de ingestão real — bate nas APIs públicas (sem auth, sem DB/Redis).
// Rodar com: go test -tags=integration ./internal/theme/extreme/ -run Integration -v
// Tolera falhas de rede por fonte; exige que o TOTAL de itens seja > 0 e que todo
// item respeite o contrato ContentItem (validação + theme_id + ausência de geo {0,0}).

package extreme_test

import (
	"context"
	"testing"
	"time"

	"github.com/earth-sentinel/backend/internal/domain"
	"github.com/earth-sentinel/backend/internal/theme/extreme"
)

func TestIntegration_IngestAllSources(t *testing.T) {
	theme := extreme.NewExtremeEventsTheme()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	totalItems := 0
	for _, src := range theme.Sources() {
		items, err := src.Fetch(ctx)
		if err != nil {
			t.Logf("source %-14s fetch error (tolerated): %v", src.ID(), err)
			continue
		}
		t.Logf("source %-14s theme=%s items=%d", src.ID(), src.ThemeID(), len(items))
		totalItems += len(items)

		for _, it := range items {
			if err := domain.Validate(it); err != nil {
				t.Errorf("source %s produced invalid item %q: %v", src.ID(), it.ID, err)
			}
			if it.ThemeID != "extreme-events" {
				t.Errorf("source %s item %q theme_id=%q, want extreme-events", src.ID(), it.ID, it.ThemeID)
			}
			if it.Geo != nil && it.Geo.Lat == 0 && it.Geo.Lng == 0 {
				t.Errorf("source %s item %q has forbidden geo {0,0}", src.ID(), it.ID)
			}
		}
	}

	t.Logf("TOTAL items ingested across all sources: %d", totalItems)
	if totalItems == 0 {
		t.Error("expected > 0 items (USGS/EONET usually have data); got 0 — possible parsing or network issue")
	}
}

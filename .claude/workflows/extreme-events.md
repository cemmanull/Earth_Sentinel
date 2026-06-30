# Workflow: Extreme Events

## Objetivo

Implementar o tema `extreme-events` completo: 6 providers, scoring de risco,
persistência, handlers, frontend Web Component e testes.

**Pré-condição:** `.claude/workflows/infrastructure.md` concluído.

---

## Agentes Envolvidos

| Agente | Papel neste workflow |
|--------|----------------------|
| Tech Lead | Coordena paralelismo, valida ContentItem e isolamento |
| Data Ingestion Engineer | 6 providers (USGS, GDACS, NOAA SWPC, EONET, Open-Meteo, Open-Meteo AQ) |
| Backend Engineer | Theme struct, scoring, handlers, ThemeRegistry |
| Frontend Engineer | Web Component, CSS, CONTENT_TYPE_META |
| Database Engineer | Migration para tema + índices específicos |
| QA Engineer | Testes de todos os providers + handler + contrato |

---

## Grafo de Tarefas

```
PARALELO — Fase 1 (sem dependências):
  [A] Data Ingestion   → USGSSource
  [B] Data Ingestion   → GDACSSource
  [C] Data Ingestion   → NOAASWPCSource
  [D] Data Ingestion   → EONETSource
  [E] Data Ingestion   → OpenMeteoSource
  [F] Data Ingestion   → OpenMeteoAQSource
  [G] Backend Eng.     → ExtremeEventsTheme struct + scoring domain
  [H] Database Eng.    → migration + índices
  [I] Frontend Eng.    → Web Component base + CONTENT_TYPE_META

PARALELO — Fase 2 (depende de A-F + G):
  [J] Backend Eng.     → registrar todos os 6 Sources no Theme
  [K] QA Engineer      → testes unitários A-F (em paralelo com J)

SEQUENCIAL — Fase 3 (depende de J + K + H + I):
  [L] QA Engineer      → testes de handler feed + smoke test end-to-end
  [M] Tech Lead        → validação final + aprovação
```

---

## Fase 1A — USGS

Consultar: `.claude/API/` (arquivo USGS se existir), documentação em `CLAUDE.md`.

```
Endpoint: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson
Auth: nenhuma
Interval: 10min

Tipos produzidos: earthquake
Funções exportadas:
  FeatureToItem(f GeoJSONFeature) (ContentItem, error)
  MagnitudeToSeverity(mag float64) int
```

Regras específicas:
- `id = "usgs-" + properties.code`
- Coordenadas: GeoJSON `[lng, lat, depth]` — não inverter
- `geo.radius_km` proporcional à magnitude: mag≥7→500, mag≥5→250, default→100

---

## Fase 1B — GDACS

```
Endpoint: https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH
Auth: nenhuma
Interval: 15min

Tipos produzidos: earthquake, hurricane, flood, volcano, tsunami, wildfire
Funções exportadas:
  GDACSEventToItem(e GDACSEvent) (ContentItem, error)
  GDACSAlertToSeverity(level string) int   → Red→5, Orange→3, Green→1

ATENÇÃO: usar episodealertlevel (estado atual), não alertlevel (pico histórico)
```

Consultar: `.claude/API/gdacs_api.json` e `.claude/API/gdacs_exemple.json`.

---

## Fase 1C — NOAA SWPC

```
Endpoints:
  https://services.swpc.noaa.gov/products/alerts.json          (alertas texto)
  https://services.swpc.noaa.gov/json/planetary_k_index_1m.json (KP index)
Auth: nenhuma
Interval: 5min

Tipos produzidos: solar_flare, cme, geomagnetic_storm, radiation_storm, radio_blackout
```

Regras específicas:
- Eventos espaciais NÃO têm coordenadas geográficas reais
- Distribuir por `GEO_ANCHORS` (8 pontos aurorais: Tromsø, Fairbanks, Reykjavik, Churchill, Murmansk, Oulu, Ushuaia, McMurdo)
- NUNCA usar `{lat: 0, lng: 0}`
- `id = fmt.Sprintf("noaa-ev-%s-%d", normalizedMessage, anchorIndex)`

---

## Fase 1D — EONET (NASA)

Consultar: `.claude/API/eonet_api.yaml` e `.claude/API/eonet_events.json`.

```
Endpoint: https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=100
Auth: nenhuma
Interval: 30min

Tipos produzidos: wildfire, volcano, severe_storm, flood, dust_storm
Funções exportadas:
  EONETEventToItem(e EONETEvent) (ContentItem, error)
  MapEONETCategory(categoryID string) string
```

---

## Fase 1E — Open-Meteo (Extremos Meteorológicos)

```
Endpoint: https://api.open-meteo.com/v1/forecast
Auth: nenhuma
Interval: 30min
Estratégia: grid de pontos (ex: 55 cidades populosas)

Tipos produzidos: heat_wave, cold_wave, severe_storm, flood
Funções exportadas:
  ParseOpenMeteoResponse(r OpenMeteoResponse, point ProbePoint) []ContentItem
  WindSpeedToSeverity(kmh float64) int
  TempToHeatSeverity(c float64) int
  RainToFloodSeverity(mmh float64) int
```

---

## Fase 1F — Open-Meteo AQ (Qualidade do Ar)

```
Endpoint: https://air-quality-api.open-meteo.com/v1/air-quality
Auth: nenhuma
Interval: 30min

Tipos produzidos: dust_storm, air_pollution
Funções exportadas:
  ParseAQResponse(r AQResponse, point ProbePoint) []ContentItem
  DustUgm3ToSeverity(ugm3 float64) int
  USAQIToSeverity(aqi int) int
```

---

## Fase 1G — Backend Engineer: Theme + Scoring

```go
// backend/internal/theme/extreme-events/theme.go
// backend/internal/theme/extreme-events/domain/scoring.go
// backend/internal/theme/extreme-events/domain/lifecycle.go

// Fórmula de risco:
// score = (severity × 0.4) + (proximity × 1.5) + (confidence × 1.0) + (decay × 0.5)
// proximity = max(0, 1 - distKm / 2000)
// decay = 2^(-elapsedH / halfLifeH)   ← por tipo de evento (EVENT_LIFESPAN)
```

---

## Fase 1H — Database Engineer

```sql
-- backend/migrations/002_add_extreme_events.sql
INSERT INTO themes (id, label) VALUES ('extreme-events', 'Eventos Extremos')
ON CONFLICT (id) DO NOTHING;

-- Índice por severidade (para feed ordenado por criticidade)
CREATE INDEX IF NOT EXISTS idx_extreme_events_severity
    ON content_items (published_at DESC, severity DESC)
    WHERE theme_id = 'extreme-events';
```

---

## Fase 1I — Frontend Engineer

```
public/js/themes/extreme-events/
├── index.js         ← { id: 'extreme-events', hasGeoView: true, ... }
└── components/
    └── extreme-events-panel.js

public/css/themes/extreme-events.css
```

Adicionar todos os tipos de `content-item.md` → seção extreme-events no
`CONTENT_TYPE_META` de `public/js/shared/content-type-meta.js`.

---

## Fase 2J — Backend Engineer: Registro de Sources

```go
func (t *ExtremeEventsTheme) Sources() []domain.Source {
    return []domain.Source{
        sources.NewUSGS(),
        sources.NewGDACS(),
        sources.NewNOAASWPC(),
        sources.NewEONET(),
        sources.NewOpenMeteo(),
        sources.NewOpenMeteoAQ(),
    }
}
```

---

## Fase 2K — QA Engineer: Testes Unitários (paralelo)

Para cada um dos 6 providers, criar:
- `Test[Provider]ToContentItem_ValidInput`
- `Test[Provider]ToContentItem_IDStability`
- `TestMap[Provider]Type`
- `TestMap[Provider]Severity`
- `Test[Provider]Fetch_Success` (mock HTTP)
- `Test[Provider]Fetch_HTTP503`

Ver template completo em `.claude/agents/qa-engineer.md`.

---

## Fase 3L — QA Engineer: Smoke Test

```bash
# Iniciar stack + backend + frontend
# Aguardar 1 ciclo de ingestão (max 30min)
curl http://localhost:3000/api/themes/extreme-events/feed | jq 'length'
# esperado: > 0

# Verificar contrato em cada item
curl .../feed | jq '.[] | select(.geo == null and .type != "unknown")'
# esperado: nenhum item geo nulo com tipo diferente de eventos espaciais

# Verificar ausência de {0,0}
curl .../feed | jq '.[] | select(.geo.lat == 0 and .geo.lng == 0)'
# esperado: vazio
```

---

## Critérios de Conclusão

- [ ] 6 providers registrados e ingerindo
- [ ] `GET /api/themes/extreme-events/feed` retorna ContentItems válidos
- [ ] Todos os tipos de `content-item.md` → extreme-events têm ícone e cor em CONTENT_TYPE_META
- [ ] Frontend exibe marcadores no mapa para itens com geo
- [ ] `go test ./internal/theme/extreme-events/...` passa (N testes)
- [ ] Nenhum item com `geo: {0,0}` no feed
- [ ] QA relatório: APROVADO
- [ ] Tech Lead: APROVADO

---

## Próximo Workflow

`.claude/workflows/weather.md` ou `.claude/workflows/news.md` (paralelos entre si)

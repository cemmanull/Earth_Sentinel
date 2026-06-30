# Workflow: Weather

## Objetivo

Implementar o tema `weather` com dados climáticos gerais via Open-Meteo e alertas
NWS, exibindo previsões e condições atuais com visualização geográfica.

**Pré-condição:** `.claude/workflows/infrastructure.md` concluído.
Pode rodar em paralelo com `news.md` e `finance.md`.

---

## Agentes Envolvidos

| Agente | Papel neste workflow |
|--------|----------------------|
| Tech Lead | Coordena, valida |
| Data Ingestion Engineer | OpenMeteoForecast + NWSAlerts sources |
| Backend Engineer | WeatherTheme struct, handler |
| Frontend Engineer | weather-panel Web Component, CSS |
| Database Engineer | Migration para tema weather |
| QA Engineer | Testes unitários + integração |

---

## Grafo de Tarefas

```
PARALELO — Fase 1:
  [A] Data Ingestion   → OpenMeteoForecastSource (previsão 7 dias, 55 pontos)
  [B] Data Ingestion   → NWSAlertsSource (alertas clima USA)
  [C] Backend Eng.     → WeatherTheme struct
  [D] Database Eng.    → migration 00N_add_weather.sql
  [E] Frontend Eng.    → weather-panel Web Component + CSS

PARALELO — Fase 2 (depende de A + B + C):
  [F] Backend Eng.     → registrar Sources no WeatherTheme
  [G] QA Engineer      → testes unitários A + B

SEQUENCIAL — Fase 3 (depende de D + E + F + G):
  [H] QA Engineer      → smoke test end-to-end
  [I] Tech Lead        → validação final
```

---

## Fase 1A — OpenMeteoForecastSource

```
Endpoint: https://api.open-meteo.com/v1/forecast
Auth: nenhuma
Interval: 30min
Estratégia: grid de 55 pontos (cidades populosas globalmente)

Params obrigatórios:
  hourly=temperature_2m,windspeed_10m,precipitation
  forecast_days=7
  timezone=auto

Tipos ContentItem produzidos: forecast
  id = fmt.Sprintf("openmeteo-forecast-%.1f-%.1f", lat, lng)
  geo.radius_km = 150 (representativo da célula do grid)
  severity = nil  (clima não é risco — usar weather_alert para alertas)
  confidence = nil
```

---

## Fase 1B — NWSAlertsSource

```
Endpoint: https://api.weather.gov/alerts/active
Auth: nenhuma (User-Agent header obrigatório)
Interval: 15min

Tipos ContentItem produzidos: weather_alert
  id = "nws-" + alert.id
  geo: centroid do area afetado (extrair de geometry ou geocode)
  severity: Extreme→5, Severe→4, Moderate→3, Minor→2
  expires_at: ✅ usar p.expires (NWS tem expiração confiável)
```

---

## Fase 1C — WeatherTheme Struct

```go
// backend/internal/theme/weather/theme.go
// Score retorna 0 — weather não modela risco 1-5
// Alertas têm severity mas o Score() do tema pode retornar 0
```

---

## Fase 1D — Database Engineer

```sql
-- backend/migrations/00N_add_weather.sql
INSERT INTO themes (id, label) VALUES ('weather', 'Clima') ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_weather_feed
    ON content_items (published_at DESC)
    WHERE theme_id = 'weather';
```

---

## Fase 1E — Frontend Engineer

```
public/js/themes/weather/
├── index.js                  ← { id: 'weather', hasGeoView: true }
└── components/
    └── weather-panel.js      ← exibe previsão + alertas ativos

public/css/themes/weather.css
```

CONTENT_TYPE_META para o tema weather:
```javascript
forecast:      { icon: '🌤️', color: '#88ddff', label: 'Previsão', category: 'clima' }
weather_alert: { icon: '⚠️', color: '#ffcc00', label: 'Alerta',   category: 'clima' }
```

---

## Critérios de Conclusão

- [ ] `GET /api/themes/weather/feed` retorna items de previsão e alertas
- [ ] Alertas NWS têm `expires_at` preenchido
- [ ] Previsões Open-Meteo têm `geo` válido
- [ ] Frontend exibe painel de clima com marcadores no mapa
- [ ] `go test ./internal/theme/weather/...` passa
- [ ] QA relatório: APROVADO

# Esquemático: ContentItem

Contrato canônico de dados da plataforma. Todos os providers DEVEM produzir exatamente
este formato. Substitui o antigo `GlobalEvent`.

---

## Structs Go

```go
// backend/internal/domain/content_item.go

type ContentItem struct {
    // Identidade
    ID       string `json:"id"`        // '<source>-<api-key>' — estável entre ingestões
    ThemeID  string `json:"theme_id"`  // 'extreme-events' | 'news' | 'weather' | 'finance'
    Type     string `json:"type"`      // snake_case — ver tabela de tipos abaixo
    SourceID string `json:"source_id"` // 'usgs' | 'gdelt' | 'alpha-vantage' | ...

    // Conteúdo
    Title       string `json:"title"`       // ≤ 80 chars via Truncate(s, 80)
    Description string `json:"description"` // ≤ 300 chars via Truncate(s, 300)
    PublishedAt time.Time `json:"published_at"` // DEVE ser time.Time, não string

    // Expiração — apenas quando a fonte fornece expiração oficial confiável
    ExpiresAt *time.Time `json:"expires_at,omitempty"`

    // Geográfico — nil se o item não tem localização relevante
    Geo *GeoPoint `json:"geo,omitempty"`

    // Intensidade — nil para temas sem conceito de risco (news, finance)
    Severity   *int     `json:"severity,omitempty"`   // 1–5
    Confidence *float64 `json:"confidence,omitempty"` // 0.0–1.0

    // Metadados específicos da fonte — não usar na lógica core
    Metadata map[string]any `json:"metadata,omitempty"`
    Tags     []string       `json:"tags"`
}

type GeoPoint struct {
    Lat      float64 `json:"lat"`       // -90 a +90 (WGS84)
    Lng      float64 `json:"lng"`       // -180 a +180 (WGS84)
    RadiusKm float64 `json:"radius_km"` // raio de impacto: ponto≈50, regional≈300, global≈20000
}
```

---

## Regras de `id`

- Estável entre ingestões: o mesmo evento DEVE gerar o mesmo `id` em chamadas consecutivas
- Derivado do identificador da API, nunca de timestamp ou hash aleatório
- Formato: `<source_id>-<chave-da-api>`
- Colisões causam upsert silencioso (atualiza o existente)
- IDs instáveis causam crescimento ilimitado no banco

```go
// ✅ Estável — derivado da API
ID: fmt.Sprintf("usgs-%s", properties.Code)
ID: fmt.Sprintf("gdacs-%s-%s", eventType, eventID)

// ✅ Composição estável para APIs sem ID explícito
ID: fmt.Sprintf("openmeteo-%s-%.1f-%.1f", contentType, point.Lat, point.Lng)

// ❌ Instável — diferente a cada ingestão
ID: fmt.Sprintf("source-%d", time.Now().UnixMilli())
```

---

## Regras de `geo`

```go
// ✅ Apenas com coordenadas confiáveis da API
if f.Geometry.Coordinates != nil {
    item.Geo = &domain.GeoPoint{
        Lat:      f.Geometry.Coordinates[1],   // GeoJSON: [lng, lat]
        Lng:      f.Geometry.Coordinates[0],
        RadiusKm: 300,
    }
}

// ✅ nil para artigos, preços e qualquer item sem localização
item.Geo = nil   // válido — o frontend ignora graciosamente

// ❌ Nunca usar 0,0 como placeholder
item.Geo = &domain.GeoPoint{Lat: 0, Lng: 0}  // ERRADO — indica bug de ingestão
```

O mapa/globo ignora itens com `geo == nil`. Isso é comportamento esperado.

---

## Regras de `expires_at`

| Fonte | ExpiresAt? | Motivo |
|-------|-----------|--------|
| NWS alertas | ✅ `p.Expires` | Expiração oficial explícita |
| GDACS | ❌ `nil` | `todate` encerra antes do risco real dissipar |
| USGS | ❌ `nil` | Ciclo de vida por `published_at` + lifecycle do tema |
| Open-Meteo | ❌ `nil` | Leitura pontual; lifecycle do tema gerencia |
| Artigos de notícias | ❌ `nil` | Não expiram — paginação gerencia relevância |
| Preços financeiros | ❌ `nil` | Substituídos por ingestões mais recentes |

---

## Regras de `severity` e `confidence`

```go
// severity e confidence: apenas em temas que modelam risco
// extreme-events: obrigatório (1–5)
// weather: quando há alerta oficial (1–5)
// news, finance: nil

sev := 4
conf := 0.99
item.Severity   = &sev
item.Confidence = &conf

// Para temas sem risco:
item.Severity   = nil
item.Confidence = nil
```

**Valores de `confidence`:**
- `0.99` — instrumentação precisa (USGS magnitude, satélite)
- `0.90` — dado oficial com contexto (GDACS, NWS)
- `0.75` — inferência sem campo explícito (Open-Meteo limiares)

---

## Tipos por Tema

### extreme-events

| Type | Ícone | Categoria | Fontes |
|------|-------|-----------|--------|
| `hurricane` | 🌀 | meteorológico | NWS, GDACS(TC) |
| `tornado` | 🌪️ | meteorológico | NWS |
| `severe_storm` | ⛈️ | meteorológico | NWS, Open-Meteo, EONET |
| `heat_wave` | 🌡️ | meteorológico | NWS, Open-Meteo |
| `cold_wave` | ❄️ | meteorológico | NWS, Open-Meteo |
| `flood` | 🚣 | meteorológico | NWS, GDACS(FL), EONET |
| `drought` | 🏜️ | meteorológico | NWS, GDACS(DR), EONET |
| `earthquake` | ⛰️ | geológico | USGS, GDACS(EQ) |
| `volcano` | 🌋 | geológico | EONET, GDACS(VO) |
| `tsunami` | 🌊 | geológico | GDACS(TS), EONET |
| `wildfire` | 🔥 | atmosférico | EONET, GDACS(WF), NWS |
| `dust_storm` | 🌫️ | atmosférico | Open-Meteo AQ |
| `air_pollution` | 💨 | atmosférico | Open-Meteo AQ |
| `solar_flare` | ☀️ | espacial | NOAA SWPC |
| `cme` | 💥 | espacial | NOAA SWPC |
| `geomagnetic_storm` | 🧭 | espacial | NOAA SWPC |
| `radiation_storm` | ☢️ | espacial | NOAA SWPC |
| `radio_blackout` | 📡 | espacial | NOAA SWPC |

### news

| Type | Label |
|------|-------|
| `article` | Artigo |
| `report` | Relatório |
| `press_release` | Comunicado |

### weather

| Type | Label |
|------|-------|
| `forecast` | Previsão |
| `weather_alert` | Alerta Meteorológico |

### finance

| Type | Label |
|------|-------|
| `price_update` | Atualização de Preço |
| `price_alert` | Alerta de Preço |
| `economic_indicator` | Indicador Econômico |

---

## Exemplos Válidos

```go
// extreme-events — com geo e severity
ContentItem{
    ID:          "usgs-us2024abc01",
    ThemeID:     "extreme-events",
    Type:        "earthquake",
    SourceID:    "usgs",
    Title:       "M 7.1 - 50km NE of Tokyo, Japan",
    Description: "50km NE of Tokyo, Japan",
    PublishedAt: time.Date(2026, 6, 5, 3, 15, 0, 0, time.UTC),
    Geo:         &GeoPoint{Lat: 35.7, Lng: 139.7, RadiusKm: 280},
    Severity:    ptr(4),
    Confidence:  ptr(0.99),
    Metadata:    map[string]any{"magnitude": 7.1, "depth": 35},
    Tags:        []string{},
}

// news — sem geo, sem severity
ContentItem{
    ID:          "gdelt-article-20260605001",
    ThemeID:     "news",
    Type:        "article",
    SourceID:    "gdelt",
    Title:       "Título do artigo aqui",
    Description: "Descrição do artigo de notícia.",
    PublishedAt: time.Now(),
    Geo:         nil,   // artigos raramente têm geo confiável
    Severity:    nil,
    Confidence:  nil,
    Metadata:    map[string]any{"lang": "pt", "domain": "exemplo.com"},
    Tags:        []string{"política"},
}

// extreme-events — espacial com GEO_ANCHOR (nunca 0,0)
ContentItem{
    ID:          "noaa-ev-20260605120000-0",
    ThemeID:     "extreme-events",
    Type:        "geomagnetic_storm",
    SourceID:    "noaa-swpc",
    Title:       "WATCH: Geomagnetic G3 storm expected",
    Description: "WATCH: Geomagnetic G3 storm expected",
    PublishedAt: time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC),
    Geo: &GeoPoint{
        Lat: 69.6, Lng: 18.9,  // GEO_ANCHOR[0] — Tromsø (nunca 0,0)
        RadiusKm: 20000,
    },
    Severity:   ptr(3),
    Confidence: ptr(0.95),
}
```

---

## Validação (Go)

```go
func Validate(item ContentItem) error {
    if item.ID == ""          { return fmt.Errorf("missing id") }
    if item.ThemeID == ""     { return fmt.Errorf("missing theme_id") }
    if item.Type == ""        { return fmt.Errorf("missing type") }
    if item.SourceID == ""    { return fmt.Errorf("missing source_id") }
    if item.Title == ""       { return fmt.Errorf("missing title") }
    if item.PublishedAt.IsZero() { return fmt.Errorf("missing published_at") }

    if item.Geo != nil {
        if item.Geo.Lat == 0 && item.Geo.Lng == 0 {
            return fmt.Errorf("geo (0,0) is invalid — indicates ingestion bug")
        }
        if math.Abs(item.Geo.Lat) > 90  { return fmt.Errorf("lat out of range") }
        if math.Abs(item.Geo.Lng) > 180 { return fmt.Errorf("lng out of range") }
    }

    if item.Severity != nil && (*item.Severity < 1 || *item.Severity > 5) {
        return fmt.Errorf("severity out of 1–5: %d", *item.Severity)
    }

    return nil
}
```

# Skill: Guia de Testes

Referência completa para escrever e executar testes na plataforma Earth Sentinel.

## Stack

```
Go:         go test ./...        (padrão Go toolchain, sem frameworks externos)
JavaScript: node:test + node:assert/strict  (Node.js 18+ nativo, sem Jest/Vitest/Mocha)
```

---

## Comandos

### Backend Go

```bash
go test ./...                          # todos os pacotes
go test ./internal/theme/...           # por subárvore
go test -run TestUSGSToContentItem ... # por nome de teste
go test -v ./...                       # verbose
go test -race ./...                    # detectar race conditions
```

### Frontend JS

```bash
npm test              # todos os unitários (tests/unit/**/*.test.js)
npm run test:int      # integração (requer Node.js server rodando)
npm run test:all      # ambos

# Filtrar por nome
node --test --test-name-pattern "ContentItem" tests/unit/
```

---

## Estrutura de Diretórios

```
backend/
├── internal/
│   ├── domain/
│   │   ├── content_item_test.go
│   │   └── truncate_test.go
│   └── theme/
│       ├── extreme-events/sources/
│       │   ├── usgs_test.go
│       │   └── gdacs_test.go
│       ├── news/sources/
│       │   └── gdelt_test.go
│       └── finance/sources/
│           └── alphavantage_test.go
│
tests/
├── unit/
│   ├── shared/
│   │   ├── utils.test.js          # truncate, escapeHtml
│   │   ├── geo.test.js            # haversineKm, getDecayFactor
│   │   └── content-type-meta.test.js
│   └── themes/
│       └── extreme-events/
│           └── domain.test.js     # funções puras do tema
├── integration/
│   └── server.test.js             # rotas Node.js + proxy para Go
└── helpers/
    └── fixtures.js                # ContentItem mocks reutilizáveis
```

---

## Testes Go — Padrão

### Teste unitário de normalização (sem I/O)

```go
// backend/internal/theme/extreme-events/sources/usgs_test.go

package sources_test

import (
    "testing"
    "time"
    "github.com/earth-sentinel/backend/internal/theme/extremeevents/sources"
)

func TestFeatureToItem_ValidEarthquake(t *testing.T) {
    feat := sources.GeoJSONFeature{
        Properties: sources.USGSProperties{
            Code:  "us2024abc",
            Mag:   7.1,
            Place: "50km NE of Tokyo",
            Time:  time.Now().UnixMilli(),
        },
        Geometry: sources.Point{Coordinates: [3]float64{139.7, 35.7, 35}},
    }

    item, err := sources.FeatureToItem(feat)
    if err != nil { t.Fatal(err) }

    if item.ID != "usgs-us2024abc"    { t.Errorf("id: got %s", item.ID) }
    if item.ThemeID != "extreme-events" { t.Errorf("themeID: %s", item.ThemeID) }
    if item.Geo == nil                { t.Error("geo should not be nil") }
    if item.Geo.Lat != 35.7           { t.Errorf("lat: %f", item.Geo.Lat) }
    if *item.Severity != 4            { t.Errorf("severity: %v", item.Severity) }
    if len(item.Title) > 80           { t.Errorf("title too long: %d chars", len(item.Title)) }
}

func TestFeatureToItem_MissingID(t *testing.T) {
    _, err := sources.FeatureToItem(sources.GeoJSONFeature{})
    if err == nil { t.Fatal("expected error for missing id") }
}

func TestMagnitudeToSeverity(t *testing.T) {
    cases := []struct{ mag float64; want int }{
        {8.5, 5}, {7.0, 4}, {6.0, 3}, {5.0, 2}, {4.5, 1},
    }
    for _, c := range cases {
        got := sources.MagnitudeToSeverity(c.mag)
        if got != c.want {
            t.Errorf("MagnitudeToSeverity(%.1f) = %d, want %d", c.mag, got, c.want)
        }
    }
}
```

### Teste de Fetch com mock HTTP server

```go
func TestUSGSFetch(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        json.NewEncoder(w).Encode(sources.GeoJSONCollection{
            Features: []sources.GeoJSONFeature{
                {
                    Properties: sources.USGSProperties{
                        Code: "1", Mag: 5.5, Place: "Test", Time: time.Now().UnixMilli(),
                    },
                    Geometry: sources.Point{Coordinates: [3]float64{139.7, 35.7, 30}},
                },
            },
        })
    }))
    defer srv.Close()

    source := sources.NewUSGSWithURL(srv.URL)
    items, err := source.Fetch(t.Context())
    if err != nil { t.Fatal(err) }
    if len(items) != 1 { t.Fatalf("expected 1, got %d", len(items)) }
}

func TestUSGSFetch_HTTPError(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(503)
    }))
    defer srv.Close()

    source := sources.NewUSGSWithURL(srv.URL)
    _, err := source.Fetch(t.Context())
    if err == nil { t.Fatal("expected error for HTTP 503") }
}
```

---

## Testes JS — Padrão

```javascript
// tests/unit/shared/geo.test.js

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { haversineKm, getDecayFactor } from '../../../public/js/shared/geo.js'

describe('haversineKm()', () => {
  it('mesma coordenada → 0', () =>
    assert.equal(haversineKm(0, 0, 0, 0), 0))

  it('NYC → Londres ≈ 5570 km (±50)', () => {
    const d = haversineKm(40.7, -74.0, 51.5, -0.1)
    assert.ok(d > 5520 && d < 5620, `got ${d}`)
  })
})

describe('getDecayFactor()', () => {
  it('tempo 0 → fator 1.0', () =>
    assert.equal(getDecayFactor(0, 24), 1.0))

  it('tempo = meia-vida → fator 0.5', () => {
    const f = getDecayFactor(24, 24)
    assert.ok(Math.abs(f - 0.5) < 0.001)
  })

  it('tempo > maxAge → fator 0', () =>
    assert.equal(getDecayFactor(200, 24), 0))
})
```

---

## Fixtures — `tests/helpers/fixtures.js`

```javascript
// Dados mock reutilizáveis — nunca duplicar inline entre testes

export const CONTENT_ITEM_EARTHQUAKE = {
  id:          'usgs-us2024abc01',
  theme_id:    'extreme-events',
  type:        'earthquake',
  source_id:   'usgs',
  title:       'M 7.1 - 50km NE of Tokyo',
  description: '50km NE of Tokyo, Japan',
  published_at: new Date(Date.now() - 3_600_000),
  geo:         { lat: 35.7, lng: 139.7, radius_km: 280 },
  severity:    4,
  confidence:  0.99,
  metadata:    { magnitude: 7.1, depth: 35 },
  tags:        [],
}

export const CONTENT_ITEM_ARTICLE = {
  id:          'gdelt-article-20260605001',
  theme_id:    'news',
  type:        'article',
  source_id:   'gdelt',
  title:       'Artigo de notícia de teste',
  description: 'Descrição do artigo de notícia de teste.',
  published_at: new Date(),
  geo:         null,   // artigo sem geo — válido
  severity:    null,
  confidence:  null,
  metadata:    { lang: 'pt', domain: 'exemplo.com' },
  tags:        ['política'],
}
```

---

## Teste de Integração (Node.js server)

```javascript
// tests/integration/server.test.js
// Requer: npm start (server.js + go backend)

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const BASE = 'http://localhost:3000'
const get  = url => fetch(`${BASE}${url}`)

describe('GET /api/health', () => {
  it('retorna 200 com { status: "ok" }', async () => {
    const res  = await get('/api/health')
    const body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(body.status, 'ok')
  })
})

describe('Arquivos estáticos', () => {
  for (const f of ['base.css', 'loader.css', 'layout.css', 'panels.css']) {
    it(`GET /css/${f} → 200`, async () =>
      assert.equal((await get(`/css/${f}`)).status, 200))
  }
  for (const f of ['app.js', 'map.js', 'globe.js']) {
    it(`GET /js/${f} → 200`, async () =>
      assert.equal((await get(`/js/${f}`)).status, 200))
  }
})

describe('GET /api/themes', () => {
  it('retorna array com pelo menos um tema', async () => {
    const res   = await get('/api/themes')
    const themes = await res.json()
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(themes) && themes.length > 0)
  })
})
```

---

## Assertions Mais Usadas

```javascript
assert.equal(valor, esperado)         // igualdade estrita ===
assert.deepEqual(obj, esperado)       // igualdade profunda
assert.ok(cond)                       // truthy
assert.ok(Array.isArray(arr))
assert.ok(item.geo === null)          // ContentItem sem geo
assert.ok(item.published_at instanceof Date)
assert.ok(len(item.title) <= 80)
assert.throws(() => fn(), /regex/)    // espera erro com mensagem
```

```go
// Go — padrão de assertion
if got != want { t.Errorf("got %v, want %v", got, want) }
if err != nil  { t.Fatal(err) }
```

---

## O que testar e o que não testar

### Deve ter teste unitário

- Go: toda função exportada de `sources/*.go` que não faz I/O (`FeatureToItem`, `MagnitudeToSeverity`)
- JS: toda função exportada de `shared/*.js` e `themes/*/domain.js`

### Deve ter teste com mock HTTP

- Go: `Source.Fetch()` com `httptest.NewServer`

### Pode ser testado apenas via integração

- Rotas Node.js (`/api/health`, `/api/themes`, `/api/themes/:id/feed`)
- Servir arquivos estáticos

### Não testar unitariamente

- Go `main.go` — orquestração e I/O
- JS `app.js` — orquestra DOM e I/O
- `map.js` / `globe.js` — Canvas/WebGL não disponíveis em Node.js
- Web Components — `customElements` não disponível em Node.js

---

## Anti-Padrões

```go
// ❌ Mockar módulos inteiros — testa o mock, não o código real
// ❌ Asserção que passa com qualquer valor
if err == nil { t.Error("should fail") }  // passou sem verificar o que falhou

// ✅ Asserção específica
if !strings.Contains(err.Error(), "missing id") {
    t.Errorf("expected 'missing id', got: %v", err)
}
```

```javascript
// ❌ Dados de teste duplicados em vários arquivos — usar fixtures.js
// ❌ Depender de time.Now() sem margem
assert.ok(item.published_at.getTime() === Date.now())  // corrida

// ✅ Com margem temporal
assert.ok(Math.abs(item.published_at.getTime() - Date.now()) < 2000)
```

# Skill: Adicionar Novo Provider (Source)

Use este guia para adicionar uma nova fonte de dados a qualquer tema existente.
Um Provider implementa a interface `Source` e é completamente independente da UI.

> Esta skill funciona para qualquer tipo de dado: eventos, artigos, preços,
> métricas, alertas — qualquer coisa que produza `ContentItem[]`.

## Checklist

- [ ] 1. Verificar autenticação e rate limits da API
- [ ] 2. Criar `backend/internal/theme/[tema]/sources/[nome].go`
- [ ] 3. Exportar funções puras de normalização (testáveis sem rede)
- [ ] 4. Escrever testes unitários e de integração (mock HTTP)
- [ ] 5. Registrar o Source no Theme correspondente
- [ ] 6. Salvar amostra real da resposta em `.claude/API/[nome].json`

---

## Passo 0 — Verificar antes de começar

```bash
# Verificar se a API tem auth
curl -I "https://api.nova-fonte.com/endpoint"
# Header Authorization ou API key?

# Salvar amostra real
curl "https://api.nova-fonte.com/endpoint" > .claude/API/nova-fonte.json

# Verificar rate limits na documentação ou no header Retry-After
```

**Se a API precisa de chave:** variável de ambiente em `config.go`.
Nunca hardcode. Nunca em `public/`.

**Se a API tem rate limit severo:** implementar Redis sliding window.
Ver `.claude/agents/data-ingestion-engineer.md` → seção Rate Limiting.

---

## Passo 1 — Criar o Source

```go
// backend/internal/theme/[tema]/sources/[nome].go

package sources

import (
    "context"
    "encoding/json"
    "fmt"
    "net/http"
    "os"
    "time"

    "github.com/earth-sentinel/backend/internal/domain"
)

const [nome]ID = "[nome]"

// Estruturas da resposta externa (privadas — nunca expor ao domínio)
type [nome]Response struct {
    // mapear campos da API real
}

type [nome]Item struct {
    ID          string    `json:"id"`
    Title       string    `json:"title"`
    Description string    `json:"description"`
    PublishedAt time.Time `json:"published_at"`
    // ...
}

type [Nome]Source struct {
    client  *http.Client
    apiKey  string
}

func New[Nome]() *[Nome]Source {
    return &[Nome]Source{
        client: &http.Client{Timeout: 15 * time.Second},
        apiKey: os.Getenv("[NOME]_API_KEY"),   // vazio se não precisar
    }
}

// Construtor para testes — aceita URL customizável
func New[Nome]WithURL(baseURL string) *[Nome]Source {
    return &[Nome]Source{
        client:  &http.Client{Timeout: 5 * time.Second},
        baseURL: baseURL,
    }
}

func (s *[Nome]Source) ID()       string        { return [nome]ID }
func (s *[Nome]Source) ThemeID()  string        { return "[tema]" }
func (s *[Nome]Source) Interval() time.Duration { return 15 * time.Minute }

func (s *[Nome]Source) Fetch(ctx context.Context) ([]domain.ContentItem, error) {
    url := s.baseURL + "/endpoint"
    if s.apiKey != "" {
        url += "?apikey=" + s.apiKey
    }

    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil { return nil, fmt.Errorf("%s: %w", [nome]ID, err) }

    resp, err := s.client.Do(req)
    if err != nil { return nil, fmt.Errorf("%s: http: %w", [nome]ID, err) }
    defer resp.Body.Close()

    if resp.StatusCode != http.StatusOK {
        return nil, fmt.Errorf("%s: HTTP %d", [nome]ID, resp.StatusCode)
    }

    var raw [nome]Response
    if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
        return nil, fmt.Errorf("%s: decode: %w", [nome]ID, err)
    }

    items := make([]domain.ContentItem, 0, len(raw.Items))
    for _, r := range raw.Items {
        item, err := [nome]ItemToContent(r)
        if err != nil { continue }
        items = append(items, item)
    }

    slog.Info("ingest complete",
        "source", [nome]ID,
        "fetched", len(raw.Items),
        "valid",   len(items))

    return items, nil
}

// [nome]ItemToContent — PURA e EXPORTADA (testável sem rede)
func [nome]ItemToContent(r [nome]Item) (domain.ContentItem, error) {
    if r.ID == "" {
        return domain.ContentItem{}, fmt.Errorf("[nome]: missing id")
    }

    item := domain.ContentItem{
        ID:          fmt.Sprintf("%s-%s", [nome]ID, r.ID),
        ThemeID:     "[tema]",
        Type:        Map[Nome]Type(r.Category),
        SourceID:    [nome]ID,
        Title:       domain.Truncate(r.Title, 80),
        Description: domain.Truncate(r.Description, 300),
        PublishedAt: r.PublishedAt,
        Metadata:    map[string]any{"raw_category": r.Category},
        Tags:        []string{},
    }

    // Adicionar geo apenas se a fonte fornece coordenadas confiáveis
    // if r.Lat != 0 && r.Lng != 0 {
    //     item.Geo = &domain.GeoPoint{Lat: r.Lat, Lng: r.Lng, RadiusKm: 200}
    // }

    return item, nil
}

// Map[Nome]Type — exportada para teste
func Map[Nome]Type(category string) string {
    switch category {
    case "TIPO_A": return "meu_tipo_a"
    case "TIPO_B": return "meu_tipo_b"
    default:       return "unknown"
    }
}
```

---

## Passo 2 — Testes

```go
// backend/internal/theme/[tema]/sources/[nome]_test.go

package sources_test

import (
    "encoding/json"
    "net/http"
    "net/http/httptest"
    "testing"
    "time"

    "github.com/earth-sentinel/backend/internal/theme/[tema]/sources"
)

// Teste de normalização — sem rede
func Test[Nome]ItemToContent_Valid(t *testing.T) {
    raw := sources.[nome]Item{
        ID: "abc123", Title: "Título do item",
        Description: "Descrição do item",
        PublishedAt: time.Now(),
        Category:    "TIPO_A",
    }
    item, err := sources.[nome]ItemToContent(raw)
    if err != nil { t.Fatal(err) }
    if item.ID != "[nome]-abc123" { t.Errorf("id: got %s", item.ID) }
    if item.Type != "meu_tipo_a"  { t.Errorf("type: got %s", item.Type) }
    if len(item.Title) > 80       { t.Errorf("title too long") }
}

func Test[Nome]ItemToContent_MissingID(t *testing.T) {
    _, err := sources.[nome]ItemToContent(sources.[nome]Item{})
    if err == nil { t.Fatal("expected error for missing id") }
}

func Test[Nome]ItemToContent_TruncatesLongTitle(t *testing.T) {
    raw := sources.[nome]Item{
        ID: "1", Title: string(make([]byte, 200)),
        PublishedAt: time.Now(),
    }
    item, err := sources.[nome]ItemToContent(raw)
    if err != nil { t.Fatal(err) }
    if len([]rune(item.Title)) > 80 { t.Errorf("title not truncated") }
}

func TestMap[Nome]Type(t *testing.T) {
    if sources.Map[Nome]Type("TIPO_A") != "meu_tipo_a" { t.Error("wrong mapping") }
    if sources.Map[Nome]Type("UNKNOWN") != "unknown"    { t.Error("no fallback") }
}

// Teste de fetch — com mock HTTP
func Test[Nome]Fetch(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        json.NewEncoder(w).Encode(sources.[nome]Response{
            Items: []sources.[nome]Item{
                {ID: "1", Title: "Item 1", PublishedAt: time.Now(), Category: "TIPO_A"},
            },
        })
    }))
    defer srv.Close()

    source := sources.New[Nome]WithURL(srv.URL)
    items, err := source.Fetch(t.Context())
    if err != nil { t.Fatal(err) }
    if len(items) != 1 { t.Fatalf("expected 1, got %d", len(items)) }
}

func Test[Nome]Fetch_HTTPError(t *testing.T) {
    srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.WriteHeader(503)
    }))
    defer srv.Close()

    source := sources.New[Nome]WithURL(srv.URL)
    _, err := source.Fetch(t.Context())
    if err == nil { t.Fatal("expected error for HTTP 503") }
}
```

---

## Passo 3 — Registrar no Theme

```go
// backend/internal/theme/[tema]/theme.go

func (t *[NomeTema]Theme) Sources() []domain.Source {
    return []domain.Source{
        sources.New[Nome](),
        // outras fontes existentes...
    }
}
```

---

## Passo 4 — Salvar amostra

```bash
curl "https://api.nova-fonte.com/endpoint" \
  -H "Authorization: Bearer $[NOME]_API_KEY" \
  > .claude/API/[nome].json
```

A amostra serve como documentação viva do schema real da API.

---

## Decisões Comuns

### Quando definir `ExpiresAt`?

| Fonte | ExpiresAt? | Motivo |
|-------|-----------|--------|
| NWS alertas | ✅ `p.Expires` | Expiração oficial explícita |
| GDACS | ❌ | `todate` encerra antes do risco real |
| USGS | ❌ | Ciclo de vida gerenciado por query de `published_at` |
| Notícias | ❌ | Artigos não expiram — paginação gerencia relevância |
| Preços | ❌ | Substituídos por ingestões mais recentes |

### Quando definir `Severity`?

Apenas para temas que modelam risco ou intensidade:
- `extreme-events`: 1–5 obrigatório
- `weather`: 1–5 quando há alerta
- `news`, `finance`: `nil`

### Intervalo de ingestão recomendado

| Tipo de dado | Interval() |
|---|---|
| Alertas críticos (terremotos, furacões) | 5–10min |
| Notícias | 15min |
| Clima | 30min |
| Preços financeiros | 1min (com rate limit) |
| Dados históricos | 6h |

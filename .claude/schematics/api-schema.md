# Esquemático: API Schema

Rotas da plataforma Earth Sentinel.

## Base URLs

| Camada | URL |
|--------|-----|
| Node.js (frontend host) | `http://localhost:3000` (dev) |
| Go backend | `http://localhost:8080` (dev interno) |
| Produção | `https://earth-sentinel.app` |

O browser fala apenas com o Node.js. O Node.js faz proxy de `/api/*` para o Go.

---

## Rotas Node.js (`server.js`)

### `GET /`
SPA fallback → `public/index.html`

### `GET /css/*`, `GET /js/*`, `GET /fonts/*`
Arquivos estáticos de `public/`.

### `GET /api/*`
Proxy reverso transparente para Go backend em `:8080`.
Não transforma o payload — passa headers `Content-Type` e status code intatos.

---

## Rotas Go Backend

### `GET /api/health`

Liveness check.

**Response 200:**
```json
{
  "status": "ok",
  "time":   "2026-06-10T14:32:00Z"
}
```

---

### `GET /api/themes`

Lista todos os temas registrados no `ThemeRegistry`.

**Response 200:**
```json
[
  {
    "id":           "extreme-events",
    "label":        "Eventos Extremos",
    "icon":         "🌍",
    "has_geo_view": true
  },
  {
    "id":           "news",
    "label":        "Notícias",
    "icon":         "📰",
    "has_geo_view": false
  },
  {
    "id":           "weather",
    "label":        "Clima",
    "icon":         "🌤️",
    "has_geo_view": true
  },
  {
    "id":           "finance",
    "label":        "Mercado",
    "icon":         "📈",
    "has_geo_view": false
  }
]
```

---

### `GET /api/themes/:themeID/feed`

Feed de `ContentItem` para o tema solicitado.
Lê do cache Redis, com fallback para PostgreSQL.

**Query params:**

| Param | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `limit` | int | 100 | Máximo de itens |
| `since` | ISO 8601 | 24h atrás | Apenas itens publicados após esta data |
| `type` | string | todos | Filtrar por `ContentItem.type` |
| `lat` | float | — | Lat do usuário (para score de proximidade) |
| `lng` | float | — | Lng do usuário |

**Response 200:**
```json
[
  {
    "id":           "usgs-us2024abc01",
    "theme_id":     "extreme-events",
    "type":         "earthquake",
    "source_id":    "usgs",
    "title":        "M 7.1 - 50km NE of Tokyo, Japan",
    "description":  "50km NE of Tokyo, Japan",
    "published_at": "2026-06-05T03:15:00Z",
    "expires_at":   null,
    "geo": {
      "lat":       35.7,
      "lng":       139.7,
      "radius_km": 280
    },
    "severity":    4,
    "confidence":  0.99,
    "metadata":    { "magnitude": 7.1, "depth": 35 },
    "tags":        []
  }
]
```

**Response 400:** `themeID` desconhecido ou parâmetros inválidos.
```json
{ "error": "unknown theme: foo" }
```

---

### `GET /api/themes/:themeID/feed/:itemID`

Detalhe de um `ContentItem` específico.

**Response 200:** objeto `ContentItem` completo (mesmo schema do feed).
**Response 404:** item não encontrado.
```json
{ "error": "item not found" }
```

---

### `GET /api/sources/status`

Status de cada provider: última ingestão, contagem de itens, erro mais recente.

**Response 200:**
```json
[
  {
    "id":         "usgs",
    "theme_id":   "extreme-events",
    "last_run":   "2026-06-10T14:30:00Z",
    "item_count": 42,
    "last_error": null,
    "next_run":   "2026-06-10T14:40:00Z"
  },
  {
    "id":         "gdelt",
    "theme_id":   "news",
    "last_run":   "2026-06-10T14:15:00Z",
    "item_count": 200,
    "last_error": "HTTP 503",
    "next_run":   "2026-06-10T14:30:00Z"
  }
]
```

---

## Convenções

### Erros

Todos os erros retornam JSON com campo `error`:
```json
{ "error": "mensagem descritiva" }
```

Nunca retornar HTML em erro — o cliente JS sempre parseia como JSON.

### Datas

Todas as datas em ISO 8601 UTC: `"2026-06-10T14:32:00Z"`

### Paginação

Feed usa `limit` + `since` (cursor temporal). Não usa `page`/`offset` para evitar
drift em dados em tempo real.

### CORS

O Node.js serve o frontend e o Go backend — sem CORS cross-origin em produção.
Em dev, o Node.js proxy gerencia o encaminhamento.

---

## Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `PORT` | `3000` | Porta do Node.js |
| `GO_BACKEND_URL` | `http://localhost:8080` | URL interna do Go |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis |
| `MINIO_ENDPOINT` | — | MinIO endpoint |
| `MINIO_ACCESS_KEY` | — | MinIO access key |
| `MINIO_SECRET_KEY` | — | MinIO secret key |
| `ALPHA_VANTAGE_KEY` | — | Alpha Vantage API key |
| `MEDIACLOUD_API_KEY` | — | MediaCloud API key |

**Chaves de API:** nunca em `public/` — apenas em variáveis de ambiente do Go backend.

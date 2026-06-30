# Workflow: News

## Objetivo

Implementar o tema `news` com agregação de notícias via GDELT e MediaCloud,
sem visualização geográfica obrigatória (notícias raramente têm geo confiável).

**Pré-condição:** `.claude/workflows/infrastructure.md` concluído.
Pode rodar em paralelo com `weather.md` e `finance.md`.

---

## Agentes Envolvidos

| Agente | Papel neste workflow |
|--------|----------------------|
| Tech Lead | Coordena, valida |
| Data Ingestion Engineer | GDELTSource + MediaCloudSource |
| Backend Engineer | NewsTheme struct, handler |
| Frontend Engineer | news-panel Web Component, CSS |
| Database Engineer | Migration + índice full-text |
| QA Engineer | Testes unitários + integração |

---

## Grafo de Tarefas

```
PARALELO — Fase 1:
  [A] Data Ingestion   → GDELTSource (artigos via GKG API, sem auth)
  [B] Data Ingestion   → MediaCloudSource (artigos via API, com auth)
  [C] Backend Eng.     → NewsTheme struct
  [D] Database Eng.    → migration + índice por source_id e tags
  [E] Frontend Eng.    → news-panel Web Component + CSS

PARALELO — Fase 2 (depende de A + B + C):
  [F] Backend Eng.     → registrar Sources no NewsTheme
  [G] QA Engineer      → testes unitários A + B

SEQUENCIAL — Fase 3:
  [H] QA Engineer      → smoke test
  [I] Tech Lead        → validação final
```

---

## Fase 1A — GDELTSource

```
Endpoint: https://api.gdeltproject.org/api/v2/doc/doc
  ?query=...&mode=artlist&maxrecords=25&format=json
Auth: nenhuma
Interval: 15min

Tipos ContentItem produzidos: article
  id = "gdelt-" + hash(url)          ← URL é identificador estável do artigo
  geo = nil                           ← artigos raramente têm geo confiável
  severity = nil
  confidence = nil
  expires_at = nil
  title: extrair de sourceurl domain + headline (≤ 80 chars)
  metadata: { url, lang, tone, domain }
  tags: [ tema GDELT, domínio ]
```

Função exportada obrigatória:
```go
GDELTRecordToItem(r GDELTRecord) (ContentItem, error)
```

---

## Fase 1B — MediaCloudSource

```
Endpoint: https://api.mediacloud.org/api/v2/stories/list
Auth: MEDIACLOUD_API_KEY (variável de ambiente)
Interval: 30min

Tipos ContentItem produzidos: article
  id = "mediacloud-" + story.guid_hash
  geo = nil
  severity = nil
  confidence = nil
  metadata: { url, language, media_id, media_name }
```

Função exportada obrigatória:
```go
MediaCloudStoryToItem(s MediaCloudStory) (ContentItem, error)
```

---

## Fase 1C — NewsTheme Struct

```go
// backend/internal/theme/news/theme.go
// Score() retorna 0 — notícias não têm score de risco
// hasGeoView = false no registro frontend
```

---

## Fase 1D — Database Engineer

```sql
-- backend/migrations/00N_add_news.sql
INSERT INTO themes (id, label) VALUES ('news', 'Notícias') ON CONFLICT DO NOTHING;

-- Índice para busca por fonte e tag
CREATE INDEX IF NOT EXISTS idx_news_source
    ON content_items (source_id, published_at DESC)
    WHERE theme_id = 'news';

CREATE INDEX IF NOT EXISTS idx_news_tags
    ON content_items USING gin (tags)
    WHERE theme_id = 'news';
```

---

## Fase 1E — Frontend Engineer

```
public/js/themes/news/
├── index.js              ← { id: 'news', hasGeoView: false }
└── components/
    └── news-panel.js     ← lista de artigos, sem mapa

public/css/themes/news.css
```

CONTENT_TYPE_META:
```javascript
article:       { icon: '📰', color: '#88ddff', label: 'Artigo',    category: 'notícias' }
report:        { icon: '📊', color: '#aaaaff', label: 'Relatório', category: 'notícias' }
press_release: { icon: '📢', color: '#ddddff', label: 'Comunicado', category: 'notícias' }
```

---

## Atenção: Chave de API MediaCloud

- `MEDIACLOUD_API_KEY` deve estar em variável de ambiente do Go backend
- Nunca expor em logs, frontend ou arquivos sob `public/`
- Se a chave não estiver configurada, `MediaCloudSource.Fetch()` retorna `nil, nil` com log de aviso

---

## Critérios de Conclusão

- [ ] `GET /api/themes/news/feed` retorna artigos de GDELT e MediaCloud
- [ ] Nenhum artigo tem `geo` preenchido com `{0,0}`
- [ ] IDs são estáveis entre ingestões (baseados em URL ou guid)
- [ ] Frontend exibe lista de artigos sem mapa (hasGeoView: false)
- [ ] `go test ./internal/theme/news/...` passa
- [ ] QA relatório: APROVADO

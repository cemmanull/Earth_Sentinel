# Workflow: Add Topic

## Objetivo

Adicionar um novo tema (Topic) completo à plataforma, incluindo backend Go,
frontend Web Component, CSS e pelo menos um provider.

**Pré-condição:** `.claude/workflows/infrastructure.md` concluído.

**Extensibilidade:** Este workflow funciona para qualquer tema — Saúde, Energia,
Logística, Cibersegurança, Transporte, ou qualquer domínio futuro.

---

## Agentes Envolvidos

| Agente | Papel neste workflow |
|--------|----------------------|
| Tech Lead | Coordena, define interface do tema, valida isolamento |
| Backend Engineer | Theme struct Go, handler de feed, ThemeRegistry |
| Data Ingestion Engineer | Pelo menos 1 Source funcional |
| Frontend Engineer | Módulo de tema, Web Component, CSS |
| Database Engineer | Migration SQL (INSERT em `themes`) |
| QA Engineer | Testes de Theme, Source, handler e componente |

---

## Entrada Necessária (Tech Lead define antes de delegar)

```
- ID do tema: [kebab-case]      ex: "health"
- Label: [string pt-BR]         ex: "Saúde"
- Ícone: [emoji]                ex: "🏥"
- Tem geo? [sim/não]            ex: "sim"
- Score 1-5? [sim/não]          ex: "não"
- Providers iniciais: [lista]   ex: ["who-alerts", "brasil-saude"]
- Tipos ContentItem: [lista]    ex: ["outbreak", "health_alert"]
```

---

## Grafo de Tarefas

```
PARALELO — Fase 1 (sem dependências):
  [A] Backend Engineer      → Theme struct + ThemeRegistry
  [B] Data Ingestion Eng.   → 1º Source do tema
  [C] Database Engineer     → migration SQL + registro em themes
  [D] Frontend Engineer     → módulo index.js + Web Component base

SEQUENCIAL — Fase 2 (depende de A + B):
  [E] Backend Engineer      → registrar Source em theme.Sources()
  [F] QA Engineer           → testes de Theme + Source

SEQUENCIAL — Fase 3 (depende de C + D):
  [G] Frontend Engineer     → CSS de tema + CONTENT_TYPE_META
  [H] QA Engineer           → testes JS de domain.js

SEQUENCIAL — Fase 4 (depende de E + F + G + H):
  [I] Tech Lead             → validação de isolamento + aprovação final
```

---

## Fase 1A — Backend Engineer: Theme Struct

```go
// backend/internal/theme/[id]/theme.go

package [id]   // ex: health

import "github.com/earth-sentinel/backend/internal/domain"

const ID = "[id]"

type Theme struct{ sources []domain.Source }

func New() *Theme { return &Theme{sources: []domain.Source{}} }

func (t *Theme) ID()      string          { return ID }
func (t *Theme) Label()   string          { return "[Label]" }
func (t *Theme) Sources() []domain.Source { return t.sources }
func (t *Theme) Score(item domain.ContentItem, ctx domain.ScoreContext) float64 {
    return 0  // implementar scoring se o tema usa 1-5
}
```

Registrar no `ThemeRegistry`:

```go
// backend/cmd/api/main.go
r.Register([id].New())
```

---

## Fase 1B — Data Ingestion Engineer: 1º Source

Consultar `.claude/skills/add-provider.md`.
O provider entregue nesta fase pode ser simples — apenas 1 endpoint funcional.
Providers adicionais: usar workflow `.claude/workflows/add-provider.md`.

---

## Fase 1C — Database Engineer: Migration

```sql
-- backend/migrations/00N_add_[id]_theme.sql
INSERT INTO themes (id, label) VALUES ('[id]', '[Label]')
ON CONFLICT (id) DO NOTHING;
```

Se o tema introduz tipos de ContentItem que precisam de índices adicionais:

```sql
-- índice específico se necessário
CREATE INDEX IF NOT EXISTS idx_content_items_[id]_type
    ON content_items (theme_id, type)
    WHERE theme_id = '[id]';
```

---

## Fase 1D — Frontend Engineer: Módulo Base

Consultar `.claude/skills/add-topic.md` para template completo.

```
public/js/themes/[id]/
├── index.js            ← { id, label, icon, hasGeoView, mount, unmount }
├── domain.js           ← funções puras (opcional — só se houver lógica de display)
└── components/
    └── [id]-panel.js   ← Web Component: _render, _loadFeed, _update
```

Registrar no `ThemeRegistry` frontend em `app.js`.

---

## Fase 3G — Frontend Engineer: CSS + Meta

```css
/* public/css/themes/[id].css */
.theme-[id] { --theme-accent: #hex; }
```

```javascript
// public/js/shared/content-type-meta.js
// Adicionar entrada para cada tipo do tema
[tipo]: { icon: '🔬', color: '#88ddff', label: 'Label', category: 'categoria' }
```

---

## Fase 4I — Tech Lead: Validação de Isolamento

```
Teste de isolamento:
  1. Desativar o novo tema no ThemeRegistry
  2. Todos os outros temas continuam funcionando? → SIM
  3. Reativar → novo tema aparece sem afetar outros? → SIM

Checklist:
  [ ] Pasta backend/internal/theme/[id]/ é auto-contida
  [ ] Pasta public/js/themes/[id]/ é auto-contida
  [ ] Nenhum arquivo fora dessas pastas foi modificado (exceto registros)
  [ ] go test ./... passa
  [ ] npm test passa
  [ ] GET /api/themes inclui o novo tema
  [ ] GET /api/themes/[id]/feed retorna ContentItem[] (pode ser vazio se sem ingestão)
```

---

## Critérios de Conclusão

- [ ] Tema aparece no seletor de tema no frontend
- [ ] Feed do tema retorna dados após 1 ciclo de ingestão
- [ ] Remover o tema = apagar 2 pastas + 2 linhas de registro. Zero resíduos.
- [ ] `go test ./...` e `npm test` passam
- [ ] QA aprovou via checklist de `.claude/agents/qa-engineer.md`

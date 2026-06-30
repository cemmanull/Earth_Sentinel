# Skill: Adicionar Novo Tema (Topic)

Use este guia para integrar um novo tema à plataforma Earth Sentinel.
Um tema agrupa providers (fontes), lógica de domínio e interface de visualização.

**Exemplos de temas:** Saúde, Energia, Logística, Cibersegurança, Transporte.

> Esta skill funciona para qualquer tema — não é específica de eventos extremos,
> clima, notícias ou finanças.

## Checklist

- [ ] 1. Criar o tema no backend Go
- [ ] 2. Criar migrations SQL (se necessário)
- [ ] 3. Criar pelo menos um Provider
- [ ] 4. Registrar o tema no ThemeRegistry do Go
- [ ] 5. Criar o módulo de tema no frontend
- [ ] 6. Criar o Web Component principal do tema
- [ ] 7. Adicionar CSS de tema
- [ ] 8. Registrar no ThemeRegistry do frontend
- [ ] 9. Escrever testes

---

## Passo 1 — Backend: criar o tema

```go
// backend/internal/theme/[nome]/theme.go

package [nome]

import "github.com/earth-sentinel/backend/internal/domain"

const ID = "[nome]"   // kebab-case, único globalmente

type Theme struct {
    sources []domain.Source
}

func New() *Theme {
    return &Theme{
        sources: []domain.Source{
            sources.NewMeuProvider(),
        },
    }
}

func (t *Theme) ID()      string         { return ID }
func (t *Theme) Label()   string         { return "Meu Tema" }
func (t *Theme) Sources() []domain.Source { return t.sources }

// Score — implementar se o tema precisa de pontuação
// Para temas sem score (ex: notícias, finanças), retornar 0
func (t *Theme) Score(item domain.ContentItem, ctx domain.ScoreContext) float64 {
    return 0
}
```

## Passo 2 — Migrations SQL

Se o tema precisa de tipos ou categorias específicos no banco:

```sql
-- backend/migrations/00N_add_[nome]_theme.sql
INSERT INTO themes (id, label, enabled) VALUES ('[nome]', 'Meu Tema', true);
```

## Passo 3 — Criar Provider(s)

Ver `.claude/skills/add-provider.md` para guia detalhado.

Estrutura mínima:
```
backend/internal/theme/[nome]/sources/
└── meu-provider.go
```

## Passo 4 — Registrar no ThemeRegistry Go

```go
// backend/cmd/api/main.go (ou onde o registry é montado)

import [nome] "github.com/earth-sentinel/backend/internal/theme/[nome]"

func buildRegistry() *theme.Registry {
    r := theme.NewRegistry()
    r.Register(extreme.New())
    r.Register(weather.New())
    r.Register([nome].New())   // ← adicionar aqui
    return r
}
```

## Passo 5 — Frontend: criar módulo de tema

```
public/js/themes/[nome]/
├── index.js        # entry point
├── domain.js       # funções puras (opcionais, se há lógica de display)
└── components/
    └── [nome]-panel.js   # Web Component principal
```

```javascript
// public/js/themes/[nome]/index.js

import { [NomePanel] } from './components/[nome]-panel.js'

export default {
  id:         '[nome]',
  label:      'Meu Tema',
  icon:       '🔬',
  hasGeoView: false,   // true se o tema tem dados geográficos

  mount(container, apiClient) {
    if (!customElements.get('[nome]-panel')) {
      customElements.define('[nome]-panel', [NomePanel])
    }
    const el = document.createElement('[nome]-panel')
    el.apiClient = apiClient
    container.appendChild(el)
  },

  unmount() {
    document.querySelector('[nome]-panel')?.remove()
  },
}
```

## Passo 6 — Web Component principal

Ver `.claude/agents/frontend-engineer.md` para padrão detalhado de Web Component.

```javascript
// public/js/themes/[nome]/components/[nome]-panel.js

export class [NomePanel] extends HTMLElement {
  connectedCallback() {
    this._render()
    this._load()
  }

  disconnectedCallback() {
    clearInterval(this._timer)
  }

  _render() {
    this.innerHTML = `<div class="theme-panel [nome]-panel">...</div>`
  }

  async _load() {
    try {
      const items = await this.apiClient.getThemeFeed('[nome]')
      this._update(items)
    } catch (err) {
      console.warn('[[nome]] feed indisponível:', err.message)
    }
    this._timer = setInterval(() => this._load(), 10 * 60 * 1000)
  }

  _update(items) {
    // Atualizar DOM com items
    // Disparar evento para o shell atualizar o mapa (se hasGeoView: true)
    if (this._needsGeo) {
      this.dispatchEvent(new CustomEvent('items-updated', {
        bubbles: true, detail: { items }
      }))
    }
  }
}
```

## Passo 7 — CSS de tema

```css
/* public/css/themes/[nome].css */

/* Cor de destaque específica do tema */
.theme-[nome] {
  --theme-accent: #hex-cor;
}

/* Overrides de componentes para este tema */
.theme-[nome] .metric-card {
  border-color: var(--theme-accent);
}
```

Linkar em `index.html`:
```html
<!-- Carregado dinamicamente quando o tema é ativado -->
<link id="theme-css" rel="stylesheet" href="">
```

```javascript
// Em app.js ao ativar um tema
document.getElementById('theme-css').href = `/css/themes/${id}.css`
```

## Passo 8 — Registrar no ThemeRegistry frontend

```javascript
// public/js/app.js (ou themes/registry.js)

import [NomeTema] from './themes/[nome]/index.js'
ThemeRegistry.register([NomeTema])
```

## Passo 9 — Testes

### Backend Go

```go
// backend/internal/theme/[nome]/theme_test.go
func TestThemeID(t *testing.T) {
    theme := New()
    if theme.ID() != "[nome]" { t.Errorf("wrong id") }
    if len(theme.Sources()) == 0 { t.Errorf("no sources") }
}
```

### Frontend JS (funções puras de domain.js)

```javascript
// tests/unit/themes/[nome]/domain.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { algumaTranformacao } from '../../../public/js/themes/[nome]/domain.js'

describe('algumaTranformacao()', () => {
  it('retorna valor correto para input válido', () => {
    assert.equal(algumaTranformacao('input'), 'esperado')
  })
})
```

---

## Checklist de Qualidade — Teste de Extensibilidade

Antes de considerar o tema concluído, responder:

- [ ] Adicionar o tema não exigiu modificar `backend/internal/ingest/scheduler.go`?
- [ ] Não foi necessário modificar handlers existentes em `api/handler/`?
- [ ] O frontend carregou o novo tema sem modificar `app.js` além do import?
- [ ] Remover o tema = apagar a pasta e o registro. Sem resíduos em outras camadas?
- [ ] O tema funciona se o provider falhar (sem derrubar outros temas)?

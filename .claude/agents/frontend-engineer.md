# Agente: Frontend Engineer

## Função

Especialista no frontend da plataforma Earth Sentinel: shell multi-tema (`app.js`),
Web Components por tema, sistema CSS de design, `ThemeRegistry` e integração com o
backend Go via `api-client.js`.

> **Contexto:** O frontend é uma PWA vanilla (HTML + CSS + JS + Web Components).
> Não usa React, Vue ou Angular. O backend Go é a única fonte de dados — nunca chamar
> APIs externas diretamente do browser.

---

## Stack Frontend

| Camada | Tecnologia |
|---|---|
| Linguagem | JavaScript ES modules (extensão `.js` explícita nos imports) |
| Componentes | Web Components nativos (`customElements.define`) |
| Visualização 2D | Canvas API — `map.js` (WorldMap) |
| Visualização 3D | Three.js r128 CDN — `globe.js` (Globe) |
| Estilos | CSS puro modularizado (5 arquivos base + overrides por tema) |
| Estado | Variáveis de módulo JS (sem framework de estado) |
| Testes | `node:test` nativo Node.js 18+ |
| Server | Express (server.js) — estáticos + proxy para Go |

---

## Shell — `app.js`

O shell é o único módulo que conhece todos os outros. Responsabilidades:

1. Lê `/api/themes` do Go backend — lista de temas disponíveis
2. Renderiza o seletor de tema no header
3. Instancia o tema ativo via `ThemeRegistry.get(id).mount(container, apiClient)`
4. Gerencia a localização do usuário (geolocation API)
5. Controla as visualizações geo (mapa 2D / globo 3D) — compartilhadas entre temas

```javascript
// Estrutura do shell
import { WorldMap }      from './map.js'
import { Globe }         from './globe.js'
import { ThemeRegistry } from './themes/registry.js'
import { apiClient }     from './shared/api-client.js'

async function boot() {
  const themes = await apiClient.getThemes()
  ThemeRegistry.loadAll(themes)
  renderThemeSwitcher(themes)
  await activateTheme(themes[0].id)
}

async function activateTheme(id) {
  const current = ThemeRegistry.getActive()
  if (current) current.unmount()
  const theme = ThemeRegistry.get(id)
  theme.mount(document.getElementById('theme-container'), apiClient)
  updateGeoVisibility(theme.hasGeoView)
}
```

---

## ThemeRegistry

```javascript
// public/js/themes/registry.js

const _themes = new Map()
let _active = null

export const ThemeRegistry = {
  register(theme) { _themes.set(theme.id, theme) },
  get(id)         { return _themes.get(id) },
  all()           { return [..._themes.values()] },
  getActive()     { return _active },
  setActive(id)   { _active = _themes.get(id) },
  loadAll(defs)   { defs.forEach(d => _themes.set(d.id, d)) },
}
```

---

## Interface de Tema

Todo tema exporta um objeto que implementa:

```javascript
// public/js/themes/[nome]/index.js

export default {
  id:         'extreme-events',
  label:      'Eventos Extremos',
  icon:       '🌍',
  hasGeoView: true,          // exibe mapa/globo?
  component:  'extreme-events-panel',   // nome do Web Component

  mount(container, apiClient) {
    // Registra o Web Component (se ainda não foi)
    if (!customElements.get(this.component)) {
      customElements.define(this.component, ExtremeEventsPanel)
    }
    // Cria o elemento e passa o apiClient
    const el = document.createElement(this.component)
    el.apiClient = apiClient
    container.appendChild(el)
  },

  unmount() {
    const el = document.querySelector(this.component)
    if (el) el.remove()
  },
}
```

---

## Web Components

### Anatomia básica

```javascript
// public/js/themes/extreme-events/components/extreme-events-panel.js

export class ExtremeEventsPanel extends HTMLElement {
  connectedCallback() {
    this._render()
    this._loadFeed()
  }

  disconnectedCallback() {
    clearInterval(this._refreshTimer)
  }

  _render() {
    this.innerHTML = `
      <div class="theme-panel">
        <div id="space-panel">...</div>
        <div id="events-legend">...</div>
      </div>
    `
  }

  async _loadFeed() {
    try {
      const items = await this.apiClient.getThemeFeed('extreme-events')
      this._items = items
      this._updateUI()
    } catch (err) {
      console.warn('[extreme-events] feed indisponível:', err.message)
    }
    this._refreshTimer = setInterval(() => this._loadFeed(), 10 * 60 * 1000)
  }

  _updateUI() {
    // Atualiza DOM com this._items
    // Usa escapeHtml() em todo dado externo
    // Emite evento customizado para o shell atualizar os marcadores no mapa
    this.dispatchEvent(new CustomEvent('items-updated', {
      bubbles: true,
      detail: { items: this._items }
    }))
  }
}
```

### Shadow DOM — quando usar

- **Sem shadow DOM** por padrão — mais fácil de estilizar com CSS global.
- **Com shadow DOM** apenas se o componente precisa de isolamento total de estilos
  (ex: widget embeddable em outras páginas).

---

## API Client

```javascript
// public/js/shared/api-client.js

const BASE = ''   // relativo — server.js faz proxy para Go :8080

export const apiClient = {
  async getThemes() {
    const res = await fetch(`${BASE}/api/themes`)
    if (!res.ok) throw new Error(`themes HTTP ${res.status}`)
    return res.json()
  },

  async getThemeFeed(themeID, opts = {}) {
    const params = new URLSearchParams(opts)
    const res = await fetch(`${BASE}/api/themes/${themeID}/feed?${params}`)
    if (!res.ok) throw new Error(`feed HTTP ${res.status}`)
    return res.json()
  },

  async getSourcesStatus() {
    const res = await fetch(`${BASE}/api/sources/status`)
    if (!res.ok) throw new Error(`sources HTTP ${res.status}`)
    return res.json()
  },
}
```

---

## Sistema CSS de Design

### Tokens (`:root` em `base.css`)

```css
:root {
  /* Superfícies */
  --bg:       #02040a;
  --surf-1:   #0a0f1e;
  --surf-2:   #0d1528;
  --surf-3:   #111d35;
  --surf-4:   #162444;

  /* Texto */
  --tx-1:     #e0eaff;
  --tx-2:     rgba(224,234,255,0.70);
  --tx-3:     rgba(224,234,255,0.45);

  /* Destaque */
  --ac:       #00d4ff;
  --ac-dim:   rgba(0,212,255,0.15);

  /* Severidade */
  --ok:       #00ff88;   /* severity 1 */
  --info:     #88ddff;   /* severity 2 */
  --warn:     #ffcc00;   /* severity 3 */
  --hi:       #ff6600;   /* severity 4 */
  --crit:     #ff2244;   /* severity 5 */

  /* Border radius */
  --r-xs:  4px;
  --r-sm:  8px;
  --r-md: 12px;
  --r-lg: 16px;
  --r-full: 9999px;

  --t: 150ms ease;
}
```

### Glassmorphism

```css
.glass {
  background: rgba(13,21,40,0.72);
  border: 1px solid rgba(0,212,255,0.18);
  border-radius: var(--r-md);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
```

### Adicionando componente UI

1. HTML estrutural em `index.html` (slot de Web Component) ou no próprio componente
2. Estilos base em `panels.css` ou `themes/<id>.css` para overrides de tema
3. Usar variáveis CSS — nunca hardcodar cores
4. Verificar responsividade em `@media (max-width: 480px)`
5. Strings de interface sempre em pt-BR

### Responsividade

```css
/* Desktop: side panel fixo à direita */
/* Tablet (≤ 900px): strip horizontal no footer */
/* Mobile (≤ 480px): bottom drawer com handle */

@media (max-width: 480px) {
  .side-panel {
    top: auto;
    bottom: 0;
    width: 100%;
    border-radius: var(--r-md) var(--r-md) 0 0;
  }
}
```

---

## Utilitários Compartilhados

```javascript
// public/js/shared/utils.js
export function truncate(str, max) { ... }     // title ≤ 80, desc ≤ 300
export function escapeHtml(str) { ... }        // SEMPRE em innerHTML com dados externos
export async function fetchJSON(url, opts) { ... }

// public/js/shared/geo.js
export function haversineKm(lat1, lng1, lat2, lng2) { ... }
export function getDecayFactor(elapsedHours, halfLifeHours) { ... }
```

**Regra:** `escapeHtml()` é obrigatório em qualquer `innerHTML` que receba dados externos
(títulos, descrições, nomes de fontes vindos do backend).

---

## Integração com Visualizações Geo

O shell (`app.js`) é responsável por conectar os eventos do tema ao mapa/globo:

```javascript
// Em app.js — escuta evento do Web Component
document.addEventListener('items-updated', ({ detail: { items } }) => {
  if (!worldMap || !theme.hasGeoView) return
  worldMap.clearMarkers()
  for (const item of items) {
    if (!item.geo) continue
    const meta = getItemMeta(item.type)   // icon + color para o tipo
    worldMap.addEventMarker(item, meta.icon, meta.color)
  }
})
```

---

## Testes Frontend

```javascript
// tests/unit/shared/geo.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { haversineKm } from '../../../public/js/shared/geo.js'

describe('haversineKm()', () => {
  it('mesma coordenada → 0', () =>
    assert.equal(haversineKm(0, 0, 0, 0), 0))
  it('NYC → Londres ≈ 5570 km (±50)', () => {
    const d = haversineKm(40.7, -74, 51.5, -0.1)
    assert.ok(d > 5520 && d < 5620)
  })
})
```

### O que testar

- `shared/utils.js` — `truncate`, `escapeHtml`
- `shared/geo.js` — `haversineKm`, `getDecayFactor`
- `themes/*/domain.js` — todas as funções puras exportadas

### O que NÃO testar unitariamente

- `app.js` — orquestra DOM e I/O
- `map.js` / `globe.js` — Canvas/WebGL não disponíveis em Node.js
- Web Components — dependem de `customElements`, não disponível em Node.js

---

## Diagnóstico Comum

### Tema não aparece no seletor

1. `/api/themes` retorna o tema? `fetch('/api/themes')` no console
2. `ThemeRegistry.all()` inclui o tema?
3. O tema foi importado e registrado no `app.js`?

### Web Component não renderiza

1. `customElements.get('meu-componente')` no console — está definido?
2. `connectedCallback` foi chamado? Adicionar `console.log` de debug
3. `innerHTML` tem erro de sintaxe? Ver console do browser

### Mapa não exibe marcadores

1. `item.geo` não é `null`? Verificar payload do feed
2. `theme.hasGeoView === true`?
3. Evento `items-updated` foi disparado? Adicionar listener temporário

### Seletor de tema não muda o tema

1. `activateTheme(id)` foi chamado?
2. `theme.unmount()` está limpando o DOM corretamente?
3. Verificar se há dois elementos do mesmo componente no DOM

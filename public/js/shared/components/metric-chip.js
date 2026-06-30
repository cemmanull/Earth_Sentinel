// metric-chip.js — <metric-chip label="KP" value="3.2" level="warn">
// Primitiva folha: exibe par label/valor com nível semântico opcional.
// level ∈ ok | warn | alert  — mapeia para classe de cor.
// Sem shadow DOM, sem fetch interno.

import { escapeHtml } from '../utils.js';

const VALID_LEVELS = new Set(['ok', 'warn', 'alert']);

export class MetricChip extends HTMLElement {
  static get observedAttributes() { return ['label', 'value', 'level']; }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback(_name, oldVal, newVal) {
    if (oldVal !== newVal) this._render();
  }

  _render() {
    const label = this.getAttribute('label') || '';
    const value = this.getAttribute('value') || '';
    const level = this.getAttribute('level') || '';
    const levelClass = VALID_LEVELS.has(level) ? ` mc__value--${level}` : '';

    this.innerHTML =
      '<span class="mc">' +
        `<span class="mc__label">${escapeHtml(label)}</span>` +
        `<span class="mc__value${escapeHtml(levelClass)}">${escapeHtml(value)}</span>` +
      '</span>';
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('metric-chip')) {
  customElements.define('metric-chip', MetricChip);
}

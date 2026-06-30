// type-badge.js — <type-badge type="earthquake">
// Primitiva folha: lê CONTENT_TYPE_META e renderiza ícone + label do tipo.
// Expõe --type-color via style inline para o CSS consumir.
// Sem shadow DOM, sem fetch interno.

import { getTypeMeta } from '../content-type-meta.js';

export class TypeBadge extends HTMLElement {
  static get observedAttributes() { return ['type']; }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback(_name, oldVal, newVal) {
    if (oldVal !== newVal) this._render();
  }

  _render() {
    const type = this.getAttribute('type') || '';
    const meta = getTypeMeta(type);
    this.style.setProperty('--type-color', meta.color);
    // textContent é seguro para icon e label (vindos de CONTENT_TYPE_META, não de input externo)
    this.innerHTML =
      '<span class="tb">' +
        '<span class="tb__icon">' + meta.icon + '</span>' +
        '<span class="tb__label">' + meta.label + '</span>' +
      '</span>';
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('type-badge')) {
  customElements.define('type-badge', TypeBadge);
}

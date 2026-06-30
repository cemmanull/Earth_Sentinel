// empty-state.js — <empty-state message="Sem dados" action-label="Tentar de novo" icon="📭">
// Primitiva folha: mensagem de estado vazio + botão de ação opcional.
// Botão emite CustomEvent('empty-action', { bubbles: true }).
// Sem shadow DOM, sem fetch interno.

import { escapeHtml } from '../utils.js';

export class EmptyState extends HTMLElement {
  static get observedAttributes() { return ['message', 'action-label', 'icon']; }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback(_name, oldVal, newVal) {
    if (oldVal !== newVal) this._render();
  }

  _render() {
    const message     = this.getAttribute('message')      || 'Sem dados';
    const actionLabel = this.getAttribute('action-label') || '';
    const icon        = this.getAttribute('icon')         || '📭';

    const buttonHtml = actionLabel
      ? `<button class="es__action">${escapeHtml(actionLabel)}</button>`
      : '';

    this.innerHTML =
      '<div class="es">' +
        `<span class="es__icon">${icon}</span>` +
        `<p class="es__message">${escapeHtml(message)}</p>` +
        buttonHtml +
      '</div>';

    if (actionLabel) {
      this.querySelector('.es__action')
        ?.addEventListener('click', () => {
          this.dispatchEvent(new CustomEvent('empty-action', { bubbles: true }));
        });
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('empty-state')) {
  customElements.define('empty-state', EmptyState);
}

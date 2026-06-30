// content-card.js — <content-card>
// Primitiva composta: recebe dados via propriedade `data` (objeto rico).
// Clique → CustomEvent('card-click', { bubbles: true, detail: { data } }).
// Sem shadow DOM, sem fetch interno.
//
// Contrato de data:
//   { type, title, desc, meta, badge, severity }
//   - type:     string  — chave de CONTENT_TYPE_META
//   - title:    string  — título do item (escapado ao renderizar)
//   - desc:     string  — descrição (opcional, escapado ao renderizar)
//   - meta:     string  — rodapé (fonte · tempo; opcional, escapado)
//   - badge:    string  — texto de badge no canto do header (opcional, escapado)
//   - severity: number|null — 1–5; null/undefined → não renderiza severity-indicator

import { escapeHtml } from '../utils.js';

// ── buildCardHTML ─────────────────────────────────────────────────────────────
// Função pura exportada — retorna o innerHTML interno do card.
// Usa tags <type-badge> e <severity-indicator> inline (string); não acessa DOM.
// Testável em Node sem customElements/document.
export function buildCardHTML(data) {
  const { type = '', title = '', desc = '', meta = '', badge = null, severity = null } = data || {};

  const badgeHtml = badge != null
    ? `<span class="card__badge">${escapeHtml(String(badge))}</span>`
    : '';

  const descHtml = desc
    ? `<p class="card__desc">${escapeHtml(String(desc))}</p>`
    : '';

  const metaHtml = meta
    ? `<span class="card__meta">${escapeHtml(String(meta))}</span>`
    : '';

  const severityHtml = severity != null
    ? `<severity-indicator value="${escapeHtml(String(severity))}"></severity-indicator>`
    : '';

  return (
    '<div class="card__header">' +
      `<type-badge type="${escapeHtml(String(type))}"></type-badge>` +
      `<span class="card__title">${escapeHtml(String(title))}</span>` +
      badgeHtml +
    '</div>' +
    (descHtml ? `<div class="card__body">${descHtml}</div>` : '') +
    '<div class="card__footer">' +
      metaHtml +
      severityHtml +
    '</div>'
  );
}

// ── ContentCard Web Component ─────────────────────────────────────────────────
// Safe base: HTMLElement exists in browser; falls back to plain class in Node (for testing buildCardHTML).
const _Base = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export class ContentCard extends _Base {
  constructor() {
    super();
    this._data = null;
    this._onClick = this._onClick.bind(this);
  }

  connectedCallback() {
    this.classList.add('card');
    this.setAttribute('tabindex', '0');
    this.setAttribute('role', 'button');
    this.addEventListener('click', this._onClick);
    this.addEventListener('keydown', this._onKeydown);
    if (this._data) this._render();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this._onClick);
    this.removeEventListener('keydown', this._onKeydown);
  }

  // Rich property — triggers re-render
  set data(value) {
    this._data = value;
    if (this.isConnected) this._render();
  }

  get data() {
    return this._data;
  }

  _render() {
    this.innerHTML = buildCardHTML(this._data);
  }

  _onClick() {
    this.dispatchEvent(new CustomEvent('card-click', {
      bubbles: true,
      detail: { data: this._data },
    }));
  }

  _onKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this._onClick();
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('content-card')) {
  customElements.define('content-card', ContentCard);
}

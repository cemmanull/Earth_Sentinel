// detail-panel.js — Web Component <detail-panel> (sem shadow DOM).
// Painel de detalhe flutuante genérico, compartilhado por todos os temas.
// Reutiliza as classes de risk-panel.css. O tema chama show(data)/hide().

import { escapeHtml } from '../utils.js';

// Mapeia o nível semântico do contrato para a classe de cor de risk-panel.css.
const LEVEL_CLASS = {
  critical: 'risk-level-critical',
  high:     'risk-level-high',
  moderate: 'risk-level-moderate',
  low:      'risk-level-low',
};

export class DetailPanel extends HTMLElement {
  constructor() {
    super();
    this._onKeydown = this._onKeydown.bind(this);
  }

  connectedCallback() {
    // Estrutura base do painel. Estilizado por risk-panel.css.
    this.classList.add('risk-panel');
    this.innerHTML =
      '<div class="risk-panel-header">' +
        '<div>' +
          '<h3 class="detail-title"></h3>' +
          '<div class="risk-coords detail-subtitle"></div>' +
        '</div>' +
        '<button class="risk-panel-close" aria-label="Fechar painel"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>' +
      '</div>' +
      '<div class="risk-score detail-metrics"></div>' +
      '<div class="nearby-events detail-items"></div>';

    this._titleEl    = this.querySelector('.detail-title');
    this._subtitleEl = this.querySelector('.detail-subtitle');
    this._metricsEl  = this.querySelector('.detail-metrics');
    this._itemsEl    = this.querySelector('.detail-items');

    this.querySelector('.risk-panel-close')
      ?.addEventListener('click', () => this.hide());

    document.addEventListener('keydown', this._onKeydown);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKeydown);
  }

  _onKeydown(e) {
    if (e.key === 'Escape') this.hide();
  }

  // show({ title, subtitle, metrics, items, emptyText })
  show(data = {}) {
    const {
      title = '', subtitle = '',
      metrics = [], items = [],
      emptyText = 'Nenhum item para exibir.',
    } = data;

    // A11y: na transição fechado→aberto, guarda a origem do foco para restaurar
    // no hide(). Cliques sucessivos com o painel já aberto não sobrescrevem.
    const wasActive = this.classList.contains('active');
    if (!wasActive) {
      this._returnFocus = (typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement)
        ? document.activeElement
        : null;
    }

    if (this._titleEl)    this._titleEl.textContent    = title;
    if (this._subtitleEl) this._subtitleEl.textContent = subtitle;

    // Métricas
    if (this._metricsEl) {
      this._metricsEl.innerHTML = (metrics || []).map(m => {
        const levelClass = m.level ? (LEVEL_CLASS[m.level] || '') : '';
        return '<div class="risk-item">' +
          `<span class="risk-item-label">${escapeHtml(m.label)}</span>` +
          `<span class="risk-item-value ${escapeHtml(levelClass)}">${escapeHtml(m.value)}</span>` +
        '</div>';
      }).join('');
    }

    // Itens (lista da área inferior)
    if (this._itemsEl) {
      if (!items || items.length === 0) {
        this._itemsEl.innerHTML =
          `<div class="event-item event-item-empty">${escapeHtml(emptyText)}</div>`;
      } else {
        this._itemsEl.innerHTML = items.map(it => {
          const badge = it.badge
            ? `<span class="event-dist">${escapeHtml(it.badge)}</span>`
            : '';
          return '<div class="event-item">' +
            '<div class="event-item-header">' +
              `<strong>${escapeHtml(it.icon || '')} ${escapeHtml(it.title || '')}</strong>` +
              badge +
            '</div>' +
            (it.desc ? `<span class="event-desc">${escapeHtml(it.desc)}</span>` : '') +
            (it.meta ? `<span class="event-meta">${escapeHtml(it.meta)}</span>` : '') +
          '</div>';
        }).join('');
      }
    }

    this.classList.add('active');
    if (!wasActive) {
      this.querySelector('.risk-panel-close')?.focus();
    }
  }

  hide() {
    const wasActive = this.classList.contains('active');
    this.classList.remove('active');
    // A11y: devolve o foco a quem abriu o painel (se ainda estiver no DOM).
    if (wasActive && this._returnFocus && document.contains(this._returnFocus)) {
      this._returnFocus.focus();
    }
    this._returnFocus = null;
  }
}

if (!customElements.get('detail-panel')) {
  customElements.define('detail-panel', DetailPanel);
}

// event-ticker.js — Web Component <event-ticker> (sem shadow DOM).
// Renderiza a faixa de itens do ticker (lista duplicada para o loop de marquee
// CSS). A SELEÇÃO dos itens é responsabilidade do tema; aqui só se renderiza.
// display:contents mantém o layout do .ticker-track idêntico ao de antes
// (os .ticker-item participam do flex do pai como se o wrapper não existisse).

import { escapeHtml } from '../utils.js';

/**
 * buildTickerHTML — pura: gera o HTML dos itens, duplicados para o marquee.
 * @param {Array<{icon?: string, text?: string, source?: string}>} items
 * @returns {string}
 */
export function buildTickerHTML(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const row = items.map(it =>
    '<div class="ticker-item">' +
      `<span class="ticker-icon">${escapeHtml(it.icon ?? '')}</span>` +
      `<span class="ticker-text">${escapeHtml(it.text ?? '')}</span>` +
      `<span class="ticker-source">${escapeHtml(it.source ?? '')}</span>` +
    '</div>'
  ).join('');
  return row + row;
}

const _Base = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export class EventTicker extends _Base {
  connectedCallback() {
    this.style.display = 'contents';
  }

  /** @param {Array<{icon?: string, text?: string, source?: string}>} items */
  setItems(items) {
    this.innerHTML = buildTickerHTML(items);
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('event-ticker')) {
  customElements.define('event-ticker', EventTicker);
}

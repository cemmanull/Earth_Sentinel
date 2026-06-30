// legend-filter.js — Web Component <legend-filter> (sem shadow DOM).
// Legenda filtrável do tema extreme-events. A11Y: cada item é um <button> real
// com aria-pressed (antes era <div> clicável). Mesmas classes CSS de panels.css.

import { escapeHtml } from '../../../shared/utils.js';
import { getTypeMeta } from '../../../shared/content-type-meta.js';

// Ordem e agrupamento dos tipos exibidos na legenda.
export const LEGEND_GROUPS = [
  { label: 'Geológico',     types: ['earthquake', 'volcano', 'tsunami'] },
  { label: 'Meteorológico', types: ['hurricane', 'tornado', 'severe_storm', 'heat_wave', 'cold_wave', 'flood', 'drought'] },
  { label: 'Atmosférico',   types: ['wildfire', 'dust_storm', 'air_pollution'] },
];

/**
 * buildLegendHTML — pura: gera os grupos e botões da legenda.
 * @param {Array<{label: string, types: string[]}>} groups
 * @returns {string}
 */
export function buildLegendHTML(groups = LEGEND_GROUPS) {
  return groups.map(group => {
    const items = group.types.map(type => {
      const meta = getTypeMeta(type);
      return (
        `<button type="button" class="ev-item" data-type="${escapeHtml(type)}" aria-pressed="false">` +
          `<span class="ev-dot" style="background:${escapeHtml(meta.color)}"></span>` +
          `<span class="ev-icon">${escapeHtml(meta.icon)}</span>` +
          `<span class="ev-name">${escapeHtml(meta.label)}</span>` +
        '</button>'
      );
    }).join('');
    return `<div class="ev-cat">${escapeHtml(group.label)}</div>${items}`;
  }).join('');
}

const _Base = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export class LegendFilter extends _Base {
  constructor() {
    super();
    this._activeFilter = null;
    this.onFilterChange = null;   // (type|null) => void
    this._handleClick = this._handleClick.bind(this);
  }

  connectedCallback() {
    this.style.display = 'contents';
    this.innerHTML =
      '<div class="ps">' +
        '<div class="ps-label">Legenda <span class="ps-hint">toque para filtrar</span></div>' +
        `<div class="ev-list">${buildLegendHTML()}</div>` +
      '</div>';
    this.querySelector('.ev-list').addEventListener('click', this._handleClick);
  }

  disconnectedCallback() {
    this.querySelector('.ev-list')?.removeEventListener('click', this._handleClick);
  }

  _handleClick(e) {
    const item = e.target.closest('.ev-item[data-type]');
    if (!item) return;
    const type = item.dataset.type;
    const next = this._activeFilter === type ? null : type;   // toggle
    this.setActiveFilter(next);
    if (typeof this.onFilterChange === 'function') this.onFilterChange(next);
  }

  /** Sincroniza estado visual + aria-pressed com o filtro ativo. */
  setActiveFilter(type) {
    this._activeFilter = type ?? null;
    this.querySelectorAll('.ev-item[data-type]').forEach(item => {
      const active = item.dataset.type === this._activeFilter;
      item.classList.toggle('ev-filter-active', active);
      item.setAttribute('aria-pressed', String(active));
    });
  }

  /** Badges de contagem por tipo. @param {Record<string, number>} byType */
  setCounts(byType) {
    this.querySelectorAll('.ev-item[data-type]').forEach(item => {
      const c = byType[item.dataset.type] ?? 0;
      let badge = item.querySelector('.ev-count');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'ev-count';
        item.appendChild(badge);
      }
      badge.textContent = c || '';
      badge.style.display = c > 0 ? '' : 'none';
    });
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('legend-filter')) {
  customElements.define('legend-filter', LegendFilter);
}

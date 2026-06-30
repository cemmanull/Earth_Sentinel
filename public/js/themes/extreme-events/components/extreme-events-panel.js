// extreme-events-panel.js — Web Component <extreme-events-panel> (sem shadow DOM).
// COMPOSITE fino (Fase 5.5 M3): compõe <overview-metrics> + <legend-filter> +
// <space-weather-panel> e delega, mantendo a MESMA API pública do antigo
// monólito — o index.js do tema não precisa saber do split.

import './overview-metrics.js';
import './legend-filter.js';
import './space-weather-panel.js';
import { EVENT_META, isEventExpired } from '../domain.js';

// Tipos de clima espacial — contam para o painel dedicado, não para a visão geral.
export const SPACE_TYPES = new Set([
  'solar_flare', 'cme', 'geomagnetic_storm', 'radiation_storm', 'radio_blackout',
]);

/**
 * countByType — pura: conta eventos não-expirados e não-espaciais por tipo.
 * @param {any[]} events
 * @returns {{ byType: Record<string, number>, total: number }}
 */
export function countByType(events) {
  const byType = {};
  let total = 0;
  for (const e of (Array.isArray(events) ? events : [])) {
    if (isEventExpired(e) || SPACE_TYPES.has(e.type)) continue;
    byType[e.type] = (byType[e.type] ?? 0) + 1;
    total++;
  }
  return { byType, total };
}

const _Base = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export class ExtremeEventsPanel extends _Base {
  constructor() {
    super();
    this._events = [];
    this._activeFilter = null;

    // Callbacks — atribuídos pelo index.js do tema (API igual à anterior).
    this.onFilterChange = null;   // (type|null) => void
    this.onRefresh = null;        // () => void
  }

  connectedCallback() {
    this._overview = document.createElement('overview-metrics');
    this._legend   = document.createElement('legend-filter');
    this._space    = document.createElement('space-weather-panel');
    this.append(this._overview, this._legend, this._space);

    this._legend.onFilterChange = (type) => {
      this._activeFilter = type;
      this._refreshOverview();
      if (typeof this.onFilterChange === 'function') this.onFilterChange(type);
    };
    this._overview.onRefresh = () => {
      if (typeof this.onRefresh === 'function') this.onRefresh();
    };
  }

  // ── API pública (inalterada em relação ao monólito) ────────────────────────

  setData(events, activeFilter) {
    this._events = Array.isArray(events) ? events : [];
    this._activeFilter = activeFilter ?? null;
    this._refreshOverview();
    this._legend?.setCounts(countByType(this._events).byType);
    this._overview?.setLastUpdate(new Date());
  }

  setSpaceData(spaceEvents, climaAggregates) {
    this._space?.setSpaceData(spaceEvents, climaAggregates);
  }

  setActiveFilter(type) {
    this._activeFilter = type ?? null;
    this._legend?.setActiveFilter(this._activeFilter);
    this._refreshOverview();
  }

  setRiskLevel(levelText, levelClass) {
    this._overview?.setRiskLevel(levelText, levelClass);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  _refreshOverview() {
    const { byType, total } = countByType(this._events);
    const count = this._activeFilter ? (byType[this._activeFilter] ?? 0) : total;
    const label = this._activeFilter
      ? (EVENT_META[this._activeFilter]?.label ?? this._activeFilter)
      : 'Eventos ativos';
    this._overview?.setCount(count, label);
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('extreme-events-panel')) {
  customElements.define('extreme-events-panel', ExtremeEventsPanel);
}

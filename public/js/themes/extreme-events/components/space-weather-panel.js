// space-weather-panel.js — Web Component <space-weather-panel> (sem shadow DOM).
// Bloco "Clima Espacial": métricas KP/Raios-X/Tempestade + alertas espaciais
// ativos. Mesmas classes CSS de panels.css.

import { escapeHtml } from '../../../shared/utils.js';
import { EVENT_META, isEventExpired } from '../domain.js';

const _Base = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export class SpaceWeatherPanel extends _Base {
  connectedCallback() {
    this.style.display = 'contents';
    this.innerHTML =
      '<div class="ps">' +
        '<div class="ps-label">Clima Espacial</div>' +
        '<div class="space-panel">' +
          '<div class="space-metrics-row">' +
            '<div class="space-metric">' +
              '<span class="space-metric-label">KP</span>' +
              '<span class="space-metric-value eep-space-kp">—</span>' +
            '</div>' +
            '<div class="space-metric">' +
              '<span class="space-metric-label">Raios-X</span>' +
              '<span class="space-metric-value eep-space-xray">—</span>' +
            '</div>' +
            '<div class="space-metric space-metric-wide">' +
              '<span class="space-metric-label">Tempestade</span>' +
              '<span class="space-metric-value eep-space-storm">—</span>' +
            '</div>' +
          '</div>' +
          '<div class="space-alerts eep-space-alerts">' +
            '<div class="space-quiet">Aguardando dados…</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    this._kpEl     = this.querySelector('.eep-space-kp');
    this._xrayEl   = this.querySelector('.eep-space-xray');
    this._stormEl  = this.querySelector('.eep-space-storm');
    this._alertsEl = this.querySelector('.eep-space-alerts');
  }

  /**
   * @param {any[]} spaceEvents — eventos espaciais (já filtrados pelo tema)
   * @param {{kp?: number, xray?: string, stormLevel?: string}|null} climaAggregates
   */
  setSpaceData(spaceEvents, climaAggregates) {
    const clima = climaAggregates ?? null;
    const kp = clima?.kp ?? 0;

    if (this._kpEl) {
      this._kpEl.textContent = typeof kp === 'number' && clima ? kp.toFixed(1) : '—';
      this._kpEl.className = 'space-metric-value eep-space-kp' +
        (kp >= 5 ? ' space-alert' : kp >= 3 ? ' space-warn' : '');
    }
    if (this._xrayEl)  this._xrayEl.textContent  = clima?.xray ?? '—';
    if (this._stormEl) this._stormEl.textContent = clima?.stormLevel ?? '—';

    if (!this._alertsEl) return;

    const active = (Array.isArray(spaceEvents) ? spaceEvents : []).filter(e => !isEventExpired(e));
    if (active.length === 0) {
      this._alertsEl.innerHTML = '<div class="space-quiet">Sem alertas espaciais ativos</div>';
      return;
    }

    this._alertsEl.innerHTML = active.slice(0, 6).map(e => {
      const meta = EVENT_META[e.type] || { icon: '⚡' };
      return (
        `<div class="space-alert-item sev-${escapeHtml(String(e.severity ?? 1))}">` +
          `<span class="space-alert-icon">${escapeHtml(meta.icon)}</span>` +
          `<span class="space-alert-text">${escapeHtml(e.title)}</span>` +
        '</div>'
      );
    }).join('');
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('space-weather-panel')) {
  customElements.define('space-weather-panel', SpaceWeatherPanel);
}

// overview-metrics.js — Web Component <overview-metrics> (sem shadow DOM).
// Bloco "Visão Geral": contagem de eventos, risco local, última atualização e
// botão de refresh. display:contents preserva o layout dos .ps no .side-scroll.

const _Base = typeof HTMLElement !== 'undefined' ? HTMLElement : class {};

export class OverviewMetrics extends _Base {
  constructor() {
    super();
    this.onRefresh = null;   // () => void — atribuído pelo composite/tema
    this._handleRefresh = this._handleRefresh.bind(this);
  }

  connectedCallback() {
    this.style.display = 'contents';
    this.innerHTML =
      '<div class="ps">' +
        '<div class="ps-label">Visão Geral</div>' +
        '<div class="metrics-row">' +
          '<div class="metric-card">' +
            '<span class="metric-value eep-event-count">0</span>' +
            '<span class="metric-label eep-metric-label">Eventos ativos</span>' +
          '</div>' +
          '<div class="metric-card">' +
            '<span class="metric-value eep-risk-level">—</span>' +
            '<span class="metric-label">Risco local</span>' +
          '</div>' +
        '</div>' +
        '<div class="last-update-row">' +
          '<span class="last-update-label">Atualizado:</span>' +
          '<span class="last-update-value eep-last-update">—</span>' +
          '<button class="refresh-btn eep-refresh-btn" title="Atualizar dados agora" aria-label="Atualizar"><span class="material-symbols-outlined" aria-hidden="true">refresh</span></button>' +
        '</div>' +
      '</div>';

    this._countEl  = this.querySelector('.eep-event-count');
    this._labelEl  = this.querySelector('.eep-metric-label');
    this._riskEl   = this.querySelector('.eep-risk-level');
    this._updateEl = this.querySelector('.eep-last-update');

    this.querySelector('.eep-refresh-btn').addEventListener('click', this._handleRefresh);
  }

  disconnectedCallback() {
    this.querySelector('.eep-refresh-btn')?.removeEventListener('click', this._handleRefresh);
  }

  _handleRefresh() {
    if (typeof this.onRefresh === 'function') this.onRefresh();
  }

  setCount(n, label) {
    if (this._countEl) this._countEl.textContent = n;
    if (this._labelEl && label) this._labelEl.textContent = label;
  }

  setRiskLevel(text, cssClass) {
    if (!this._riskEl) return;
    this._riskEl.textContent = text;
    this._riskEl.className = 'metric-value eep-risk-level' + (cssClass ? ' ' + cssClass : '');
  }

  setLastUpdate(date) {
    if (this._updateEl && date instanceof Date) {
      this._updateEl.textContent = date.toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit',
      });
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('overview-metrics')) {
  customElements.define('overview-metrics', OverviewMetrics);
}

// index.js — descriptor do tema extreme-events.
// Implementa a interface de tema (id, label, icon, hasGeoView, mount, unmount,
// renderMarkers, onMapClick) conforme o contrato Shell ↔ Tema da Fase 5.
// Fase 5.5 M3: dados orquestrados pelo ThemeFeedController; ticker como
// <event-ticker>; erro de feed notifica via toast (app:toast) com retry.

import { analyzeRisk, EVENT_META, isEventExpired, haversineKm } from './domain.js';
import { checkNotifications } from '../../notifications.js';
import { ThemeFeedController } from '../../shared/feed-controller.js';
import './components/extreme-events-panel.js';
import '../../shared/components/event-ticker.js';

// ── Constants ─────────────────────────────────────────────────────────────────

// Tipos de evento de clima espacial — vão para o painel lateral, NÃO para o mapa.
const SPACE_TYPES = new Set([
  'solar_flare', 'cme', 'geomagnetic_storm', 'radiation_storm', 'radio_blackout',
]);

// Mapeamento de nível de risco → classe CSS (compatível com risk-panel.css).
const LEVEL_CLASS = {
  crítico:  'risk-level-critical',
  alto:     'risk-level-high',
  moderado: 'risk-level-moderate',
  baixo:    'risk-level-low',
};

// Mapeamento nível pt-BR → chave em inglês para o contrato do <detail-panel>.
const LEVEL_KEY = {
  crítico:  'critical',
  alto:     'high',
  moderado: 'moderate',
  baixo:    'low',
};

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

// Limite do feed ao navegar um intervalo histórico explícito: maior que o feed
// ao vivo (100) para revelar mais ocorrências da janela; ordenação por
// severidade no backend garante que os eventos mais graves venham primeiro.
const HISTORY_FEED_LIMIT = 500;

// ── Helpers (funções puras) ───────────────────────────────────────────────────

// fmtEventDate — formata uma Date para exibição em pt-BR.
export function fmtEventDate(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  const now      = new Date();
  const time     = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const sameDay  =
    date.getDate()     === now.getDate()     &&
    date.getMonth()    === now.getMonth()    &&
    date.getFullYear() === now.getFullYear();
  if (sameDay) return `hoje, ${time}`;
  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }) + ', ' + time;
}

// visibleEvents — filtra eventos a renderizar no mapa/globo: não espaciais e
// compatíveis com o filtro de tipo ativo (null = todos). A janela temporal é
// aplicada no backend (params since/until); aqui só decidimos a expiração por
// frescor: no modo histórico (intervalo de datas explícito) ela NÃO se aplica,
// pois o usuário quer justamente ver eventos antigos.
export function visibleEvents(events, activeFilter, historical = false) {
  return events.filter(e => {
    if (!historical && isEventExpired(e))        return false;
    if (SPACE_TYPES.has(e.type))                 return false;
    if (activeFilter && e.type !== activeFilter) return false;
    return true;
  });
}

// selectTickerEvents — pura: escolhe os eventos do ticker. Com localização do
// usuário, prioriza eventos cujo raio de efeito alcança a região (fallback:
// top global); sem localização, top global por severidade. No modo histórico
// a expiração por frescor não se aplica (coerência com os marcadores do mapa).
export function selectTickerEvents(events, userLoc, historical = false) {
  const active = events.filter(e => (historical || !isEventExpired(e)) && !SPACE_TYPES.has(e.type));
  if (active.length === 0) return [];
  if (userLoc) {
    const regional = active.filter(e =>
      haversineKm(e.latitude, e.longitude, userLoc.lat, userLoc.lng) <= (e.radiusKm ?? 300),
    );
    return regional.length > 0
      ? regional.sort((a, b) => b.severity - a.severity).slice(0, 14)
      : [...active].sort((a, b) => b.severity - a.severity).slice(0, 5);
  }
  return [...active].sort((a, b) => b.severity - a.severity).slice(0, 14);
}

// ── Theme descriptor ─────────────────────────────────────────────────────────

const ExtremeEventsTheme = {
  id:         'extreme-events',
  label:      'Eventos Extremos',
  icon:       '⚡',
  hasGeoView: true,

  // ── Internal state ───────────────────────────────────────────────────────
  _events:       [],
  _activeFilter: null,
  _dateRange:    null,   // { start, end } em epoch ms (null = sem limite) ou null
  _ctx:          null,
  _panel:        null,   // <extreme-events-panel>
  _ticker:       null,   // <event-ticker>
  _controller:   null,   // ThemeFeedController
  _unsubscribe:  null,

  // ── mount ────────────────────────────────────────────────────────────────
  async mount(container, ctx) {
    this._ctx          = ctx;
    this._events       = [];
    this._activeFilter = null;
    this._dateRange    = null;

    this._panel = document.createElement('extreme-events-panel');
    container.appendChild(this._panel);

    this._panel.onFilterChange = (type) => {
      this._activeFilter = type;
      this.renderMarkers();
    };
    this._panel.onRefresh = async () => {
      const btn = this._panel.querySelector('.eep-refresh-btn');
      btn?.classList.add('spinning');
      await this._controller?.refresh();
      btn?.classList.remove('spinning');
    };

    // Ticker como componente dentro do slot do shell.
    ctx.tickerSlot.innerHTML = '';
    this._ticker = document.createElement('event-ticker');
    ctx.tickerSlot.appendChild(this._ticker);

    this._controller = new ThemeFeedController({
      fetcher:    () => ctx.api.getThemeEvents('extreme-events', this._fetchParams()),
      intervalMs: REFRESH_INTERVAL_MS,
    });
    this._unsubscribe = this._controller.subscribe(p => this._onFeedUpdate(p));

    ctx.setStatus('Carregando eventos…');
    this._controller.start();   // refresh imediato + auto-refresh
  },

  // ── unmount ──────────────────────────────────────────────────────────────
  unmount() {
    this._unsubscribe?.();
    this._unsubscribe = null;
    this._controller?.stop();
    this._controller = null;

    const map   = this._ctx?.getMap?.();
    const globe = this._ctx?.getGlobe?.();
    if (map)   try { map.clearMarkers();   } catch { /* ignore */ }
    if (globe) try { globe.clearMarkers(); } catch { /* ignore */ }

    try { this._ctx?.detailPanel?.hide?.(); } catch { /* ignore */ }

    if (this._ctx?.tickerSlot) this._ctx.tickerSlot.innerHTML = '';
    this._ticker = null;

    if (this._panel && this._panel.parentNode) {
      this._panel.parentNode.removeChild(this._panel);
    }
    this._panel        = null;
    this._ctx          = null;
    this._events       = [];
    this._activeFilter = null;
    this._dateRange    = null;
  },

  // ── setDateRange ───────────────────────────────────────────────────────────
  // Contrato Shell ↔ Tema: o overlay de período (shell) empurra o intervalo
  // selecionado. startMs/endMs em epoch ms ou null/NaN = lado ilimitado.
  // Diferente do filtro de tipo (cliente), a data é server-side: re-busca o feed
  // com since/until para revelar eventos fora da janela ao vivo (24h). Re-busca
  // só quando o intervalo muda de fato (evita fetch redundante no reset do mount).
  setDateRange(startMs, endMs) {
    const start = Number.isFinite(startMs) ? startMs : null;
    const end   = Number.isFinite(endMs)   ? endMs   : null;
    const prev  = this._dateRange;
    const changed = (prev == null)
      ? !(start == null && end == null)
      : (prev.start !== start || prev.end !== end);
    if (!changed) return;
    this._dateRange = (start == null && end == null) ? null : { start, end };
    this._controller?.refresh();
  },

  // _fetchParams — traduz o intervalo selecionado em params do feed. Sem
  // intervalo → {} (feed ao vivo, cacheado no backend). Com intervalo → since
  // explícito (epoch quando não há início, para não herdar o piso de 24h) +
  // until quando há fim, e limite ampliado para a navegação histórica.
  _fetchParams() {
    const r = this._dateRange;
    if (!r) return {};
    const params = { limit: HISTORY_FEED_LIMIT };
    params.since = new Date(r.start ?? 0).toISOString();
    if (r.end != null) params.until = new Date(r.end).toISOString();
    return params;
  },

  // ── renderMarkers ────────────────────────────────────────────────────────
  renderMarkers() {
    if (!this._ctx) return;

    const view  = this._ctx.getActiveView?.() ?? '2d';
    const map   = this._ctx.getMap?.();
    const globe = this._ctx.getGlobe?.();
    const historical = this._dateRange != null;

    if (view === '2d') {
      if (!map) return;
      map.clearMarkers();
      for (const event of visibleEvents(this._events, this._activeFilter, historical)) {
        const meta = EVENT_META[event.type] || { icon: '⚠️', color: '#888888' };
        map.addEventMarker(event, meta.icon, meta.color);
      }
    } else {
      if (!globe) return;
      globe.clearMarkers();
      for (const event of visibleEvents(this._events, this._activeFilter, historical)) {
        const meta     = EVENT_META[event.type] || { icon: '⚠️', color: '#888888' };
        const colorHex = parseInt(meta.color.replace('#', ''), 16);
        const scaleMul = event.metadata?.warning ? 0.45 : 1.0;
        globe.addMarker(
          event.latitude, event.longitude,
          colorHex, meta.icon,
          event.severity, scaleMul,
        );
      }
    }
  },

  // ── onMapClick ───────────────────────────────────────────────────────────
  onMapClick(payload) {
    if (!this._ctx?.detailPanel) return;

    const lat = payload.type === 'event'
      ? (payload.event?.latitude  ?? payload.lat)
      : payload.lat;
    const lng = payload.type === 'event'
      ? (payload.event?.longitude ?? payload.lng)
      : payload.lng;

    if (lat == null || lng == null) return;

    const riskData = analyzeRisk(lat, lng, this._events);

    const levelEn = LEVEL_KEY[riskData.level] || 'low';
    const levelPt = riskData.level.charAt(0).toUpperCase() + riskData.level.slice(1);

    const metrics = [
      { label: 'Score',   value: riskData.score.toFixed(2) },
      { label: 'Nível',   value: levelPt, level: levelEn },
      { label: 'Na área', value: String(riskData.nearbyEvents.length) },
    ];

    const items = riskData.nearbyEvents.map(({ event, distKm }) => {
      const meta      = EVENT_META[event.type] || { icon: '⚠️' };
      const distLabel = distKm < 1 ? '< 1 km' : `${distKm.toLocaleString('pt-BR')} km`;
      // Texto cru — o <detail-panel> aplica escapeHtml ao renderizar.
      const metaText  =
        event.source +
        ' · ' + fmtEventDate(event.startTime) +
        ' · raio ' + (event.radiusKm ?? 0).toLocaleString('pt-BR') + ' km';
      return {
        icon:  meta.icon,
        title: event.title,
        desc:  event.description,
        meta:  metaText,
        badge: distLabel,
      };
    });

    this._ctx.detailPanel.show({
      title:     'Análise de Risco',
      subtitle:  `📍 ${lat.toFixed(2)}°  ${lng.toFixed(2)}°`,
      metrics,
      items,
      emptyText: 'Nenhum evento na área de efeito desta localização.',
    });

    const map   = this._ctx.getMap?.();
    const globe = this._ctx.getGlobe?.();
    if (map)   try { map.focusOn(lat, lng);   } catch { /* ignore */ }
    if (globe) try { globe.focusOn(lat, lng); } catch { /* ignore */ }
  },

  // ── Private: reação a cada ciclo do feed ────────────────────────────────
  _onFeedUpdate({ items, error }) {
    this._events = items;

    if (error) {
      console.warn('[extreme-events] feed indisponível:', error.message);
      document.dispatchEvent(new CustomEvent('app:toast', {
        detail: {
          message:     'Feed indisponível — exibindo dados anteriores',
          actionLabel: 'Tentar de novo',
          onAction:    () => this._controller?.refresh(),
        },
      }));
    } else {
      console.log(`[extreme-events] +${items.length} eventos do backend`);
    }

    const spaceEvents = this._events.filter(e => SPACE_TYPES.has(e.type) && !isEventExpired(e));

    if (this._panel) {
      this._panel.setData(this._events, this._activeFilter);
      this._panel.setSpaceData(spaceEvents, null); // agregados KP/X-ray via endpoint dedicado, futuramente

      const userLoc = this._ctx?.getUserLocation?.();
      if (userLoc) {
        const risk  = analyzeRisk(userLoc.lat, userLoc.lng, this._events);
        const lvlPt = risk.level.charAt(0).toUpperCase() + risk.level.slice(1);
        this._panel.setRiskLevel(lvlPt, LEVEL_CLASS[risk.level] || '');
      }
    }

    this._updateTicker();
    this.renderMarkers();
    // Notificações são sobre eventos ao vivo; ao navegar histórico não alertamos.
    if (this._dateRange == null) checkNotifications(this._events);
    this._ctx?.setStatus?.('Pronto');
  },

  // ── Private: ticker ───────────────────────────────────────────────────────
  _updateTicker() {
    if (!this._ticker) return;
    const userLoc  = this._ctx?.getUserLocation?.();
    const selected = selectTickerEvents(this._events, userLoc, this._dateRange != null);
    this._ticker.setItems(selected.map(e => ({
      icon:   (EVENT_META[e.type] || { icon: '⚠️' }).icon,
      text:   e.title,
      source: e.source,
    })));
  },
};

export default ExtremeEventsTheme;

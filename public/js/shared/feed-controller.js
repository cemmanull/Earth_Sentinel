// feed-controller.js — ThemeFeedController: orquestra fetch + auto-refresh +
// assinatura de um feed de tema. Sem DOM: testável em Node puro.
//
// Elimina o par _loadFeed/setInterval duplicado em cada tema. Uso típico:
//
//   const controller = new ThemeFeedController({
//     fetcher: () => ctx.api.getThemeEvents('extreme-events'),
//     intervalMs: 600_000,
//   })
//   const unsubscribe = controller.subscribe(({ items, error, lastUpdate }) => { ... })
//   controller.start()           // refresh imediato + timer
//   ...
//   controller.stop(); unsubscribe()

export class ThemeFeedController {
  /**
   * @param {object} opts
   * @param {() => Promise<any[]>} opts.fetcher  Busca os itens do feed.
   * @param {number} [opts.intervalMs=600000]    Intervalo do auto-refresh (10min).
   */
  constructor({ fetcher, intervalMs = 600_000 } = {}) {
    if (typeof fetcher !== 'function') {
      throw new TypeError('ThemeFeedController: fetcher must be a function');
    }
    this._fetcher = fetcher;
    this._intervalMs = intervalMs;
    this._items = [];
    this._lastUpdate = null;
    this._timer = null;
    this._subscribers = new Set();
  }

  /** Snapshot atual dos itens (último load bem-sucedido). */
  get items() {
    return this._items;
  }

  /**
   * Registra um observador chamado após cada refresh (sucesso ou falha).
   * @param {(payload: { items: any[], error: Error|null, lastUpdate: Date|null }) => void} cb
   * @returns {() => void} função de unsubscribe
   */
  subscribe(cb) {
    this._subscribers.add(cb);
    return () => this._subscribers.delete(cb);
  }

  /**
   * Executa o fetcher. Sucesso: atualiza items/lastUpdate. Falha: MANTÉM os
   * items anteriores e propaga o erro no payload — a UI decide o que exibir.
   */
  async refresh() {
    let error = null;
    try {
      const items = await this._fetcher();
      this._items = Array.isArray(items) ? items : [];
      this._lastUpdate = new Date();
    } catch (err) {
      error = err;
    }
    const payload = { items: this._items, error, lastUpdate: this._lastUpdate };
    this._notify(payload);
    return payload;
  }

  /** Refresh imediato + timer de auto-refresh. Chamadas repetidas são no-op. */
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => { this.refresh(); }, this._intervalMs);
    this.refresh();
  }

  /** Para o auto-refresh. Idempotente. */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  _notify(payload) {
    for (const cb of this._subscribers) {
      try {
        cb(payload);
      } catch (err) {
        console.warn('[feed-controller] subscriber falhou:', err.message);
      }
    }
  }
}

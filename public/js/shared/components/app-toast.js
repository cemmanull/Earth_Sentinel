// app-toast.js — <app-toast>
// Container fixo (bottom) para notificações não-bloqueantes.
//
// API pública:
//   show(message, { actionLabel, onAction, duration = 6000 } = {})
//
// Contrato global (outro agente depende):
//   Escuta `document.addEventListener('app:toast', e => this.show(e.detail.message, e.detail))`
//   e.detail = { message, actionLabel?, onAction?, duration? }
//
// Máximo 3 toasts simultâneos — descarta o mais antigo ao exceder.
// role="status" aria-live="polite"
// Sem shadow DOM, sem fetch interno.

import { escapeHtml } from '../utils.js';

const MAX_TOASTS = 3;

export class AppToast extends HTMLElement {
  constructor() {
    super();
    this._toasts = [];
    this._onDocToast = (e) => this.show(e.detail.message, e.detail);
  }

  connectedCallback() {
    this.setAttribute('role', 'status');
    this.setAttribute('aria-live', 'polite');
    this.classList.add('toast-container');
    document.addEventListener('app:toast', this._onDocToast);
  }

  disconnectedCallback() {
    document.removeEventListener('app:toast', this._onDocToast);
    // Clear any pending timers
    this._toasts.forEach(t => { if (t._timer) clearTimeout(t._timer); });
    this._toasts = [];
  }

  // show — empilha um toast, auto-dismiss após duration ms.
  show(message, { actionLabel = '', onAction = null, duration = 6000 } = {}) {
    // Descarta o mais antigo se já estamos no limite
    if (this._toasts.length >= MAX_TOASTS) {
      this._dismiss(this._toasts[0].id);
    }

    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'alert');
    el.dataset.toastId = id;

    const actionHtml = actionLabel
      ? `<button class="toast__action">${escapeHtml(actionLabel)}</button>`
      : '';

    el.innerHTML =
      `<span class="toast__message">${escapeHtml(String(message))}</span>` +
      '<div class="toast__controls">' +
        actionHtml +
        '<button class="toast__close" aria-label="Fechar notificação">✕</button>' +
      '</div>';

    el.querySelector('.toast__close').addEventListener('click', () => this._dismiss(id));

    if (actionLabel && onAction) {
      el.querySelector('.toast__action')?.addEventListener('click', () => {
        onAction();
        this._dismiss(id);
      });
    }

    this.appendChild(el);

    const timer = duration > 0
      ? setTimeout(() => this._dismiss(id), duration)
      : null;

    this._toasts.push({ id, el, _timer: timer });
  }

  _dismiss(id) {
    const idx = this._toasts.findIndex(t => t.id === id);
    if (idx === -1) return;

    const { el, _timer } = this._toasts[idx];
    if (_timer) clearTimeout(_timer);
    this._toasts.splice(idx, 1);

    el.classList.add('toast--leaving');
    // Remove after animation (matches CSS transition duration)
    const remove = () => { if (el.parentNode) el.parentNode.removeChild(el); };
    el.addEventListener('animationend', remove, { once: true });
    el.addEventListener('transitionend', remove, { once: true });
    // Fallback: remove after 400ms regardless
    setTimeout(remove, 400);
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('app-toast')) {
  customElements.define('app-toast', AppToast);
}

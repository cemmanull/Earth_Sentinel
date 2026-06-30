// severity-indicator.js — <severity-indicator value="3">
// Primitiva folha: renderiza 5 pontos, preenchidos até `value` com --sev-N.
// Sem shadow DOM, sem fetch interno.

export class SeverityIndicator extends HTMLElement {
  static get observedAttributes() { return ['value']; }

  connectedCallback() {
    this._render();
  }

  attributeChangedCallback(_name, oldVal, newVal) {
    if (oldVal !== newVal) this._render();
  }

  _render() {
    const value = parseInt(this.getAttribute('value'), 10) || 0;
    const clamped = Math.min(5, Math.max(0, value));

    this.setAttribute('aria-label', `Severidade ${clamped} de 5`);
    this.setAttribute('role', 'img');

    let html = '<span class="si">';
    for (let i = 1; i <= 5; i++) {
      if (i <= clamped) {
        html += `<span class="si__dot si__dot--filled" style="background:var(--sev-${i})"></span>`;
      } else {
        html += '<span class="si__dot"></span>';
      }
    }
    html += '</span>';
    this.innerHTML = html;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('severity-indicator')) {
  customElements.define('severity-indicator', SeverityIndicator);
}

// index.js — barrel de side-effects: importa e registra todas as primitivas UI.
// Carregado como <script type="module"> em index.html antes de app.js.
// Cada módulo chama customElements.define com guarda de duplicata.

import './type-badge.js';
import './severity-indicator.js';
import './metric-chip.js';
import './content-card.js';
import './empty-state.js';
import './app-toast.js';
import './detail-panel.js';

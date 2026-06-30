// registry.js — ThemeRegistry do frontend.
// Mantém o conjunto de temas registrados e qual está ativo. Funções puras de
// estado em memória; sem I/O. O shell (app.js) registra temas no boot e usa
// getActive()/setActive() para coordenar o tema corrente.

const _themes = [];          // ordem de registro preservada
const _byId   = new Map();
let   _activeId = null;

export const ThemeRegistry = {
  // register valida theme.id, guarda; ignora duplicado.
  register(theme) {
    if (!theme || typeof theme.id !== 'string' || theme.id === '') {
      console.warn('[ThemeRegistry] tema inválido — id ausente');
      return;
    }
    if (_byId.has(theme.id)) {
      console.warn(`[ThemeRegistry] tema duplicado ignorado: ${theme.id}`);
      return;
    }
    _byId.set(theme.id, theme);
    _themes.push(theme);
  },

  // get → theme | undefined
  get(id) {
    return _byId.get(id);
  },

  // all → theme[] (ordem de registro)
  all() {
    return [..._themes];
  },

  // getActive → theme | undefined
  getActive() {
    return _activeId != null ? _byId.get(_activeId) : undefined;
  },

  // setActive marca o tema ativo corrente (não monta — isso é responsabilidade
  // do shell). Ignora id desconhecido.
  setActive(id) {
    if (!_byId.has(id)) {
      console.warn(`[ThemeRegistry] setActive: tema desconhecido ${id}`);
      return;
    }
    _activeId = id;
  },
};

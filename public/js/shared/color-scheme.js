// color-scheme.js — helpers puros da alternância claro/escuro (Fase 5.6 W3.5).
// Sem DOM, sem I/O: testáveis em node:test. O app.js aplica o resultado.

// nextScheme — alterna entre os dois esquemas válidos.
export function nextScheme(current) {
  return current === 'dark' ? 'light' : 'dark';
}

// resolveInitialScheme — escolha inicial: preferência salva válida vence;
// senão segue o hint do sistema (prefers-color-scheme).
export function resolveInitialScheme(saved, prefersDark) {
  if (saved === 'light' || saved === 'dark') return saved;
  return prefersDark ? 'dark' : 'light';
}

// schemeButtonIcon — classe Font Awesome do botão; o ícone indica o DESTINO
// da alternância: lua = ir para o escuro; sol = voltar ao claro.
export function schemeButtonIcon(scheme) {
  return scheme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
}

// schemeThemeColor — valor da <meta name="theme-color"> por esquema
// (primary no claro, background no escuro — DESIGN.md).
export function schemeThemeColor(scheme) {
  return scheme === 'dark' ? '#0a1010' : '#00575c';
}

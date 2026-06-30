// utils.js — utilitários puros compartilhados entre shell e temas.
// Sem I/O além de fetchJSON (reexportado). Todas as funções são testáveis.

// escapeHtml protege contra injeção ao montar innerHTML com dados externos.
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// truncate corta `str` em `max` caracteres, anexando reticências quando excede.
export function truncate(str, max) {
  const s = String(str ?? '');
  if (max == null || s.length <= max) return s;
  if (max <= 1) return s.slice(0, Math.max(0, max));
  return s.slice(0, max - 1).trimEnd() + '…';
}

// fetchJSON — wrapper HTTP com timeout. Propaga erro quando status não-ok.
export async function fetchJSON(url, { timeoutMs = 20_000 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

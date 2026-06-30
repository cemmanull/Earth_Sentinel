// date-range.js — conversão dos inputs de data do overlay de período (puro, sem
// DOM). O filtro em si é server-side (params since/until do feed); aqui só
// traduzimos o value de <input type="date"> em epoch ms, num único lugar testável.

// dateInputToStartMs converte o value de um <input type="date"> ("YYYY-MM-DD")
// no epoch ms da meia-noite LOCAL desse dia. Vazio/ inválido → null (lado ilimitado).
export function dateInputToStartMs(str) {
  if (!str) return null;
  const ms = new Date(`${str}T00:00:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// dateInputToEndMs converte o value de um <input type="date"> no epoch ms do
// FIM do dia local (23:59:59.999) — fim inclusivo, para o dia escolhido contar
// por inteiro. Vazio/ inválido → null.
export function dateInputToEndMs(str) {
  if (!str) return null;
  const ms = new Date(`${str}T23:59:59.999`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

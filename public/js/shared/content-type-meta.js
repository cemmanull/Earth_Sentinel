// CONTENT_TYPE_META — metadados visuais por ContentItem.type, válidos para todos os temas.
// Chaveado por `type` (snake_case). Cada entrada: { icon, color, label, category }.
// Portado e estendido (campo `category`) a partir do legado EVENT_META em events.js.
//
// Cores: dual-mode (W4 / Fase 5.6). Cada cor é ÚNICA — sem troca por esquema — e
// DEVE ter contraste ≥ 3:1 (WCAG 1.4.11) contra os dois extremos de fundo do sistema:
// claro #f7fdfd e escuro #0a1010 (e as surfaces #f2f8f8 / #101919 do DESIGN.md).
// Isso restringe a luminância relativa à banda ≈ [0.127, 0.276] — tons médios saturados.
// Cores da paleta Aegis (DESIGN.md) usadas quando caem na banda: #1c989d (success),
// #528ac4 (telemetry-2), #a77e39 (warning), #d4434f (danger dark). Demais tons são
// derivados harmonizados, preservando a família de matiz original de cada tipo.
// Regressão executável: tests/unit/content-type-meta-contrast.test.js.

export const CONTENT_TYPE_META = {
  // ── extreme-events ────────────────────────────────────────────────────────
  // meteorológico
  hurricane:         { icon: '🌀', color: '#7a5cf0', label: 'Furacão',                 category: 'meteorológico' },
  tornado:           { icon: '🌪️', color: '#0b8fa8', label: 'Tornado',                 category: 'meteorológico' },
  severe_storm:      { icon: '⛈️', color: '#6b74e0', label: 'Tempestade severa',       category: 'meteorológico' },
  heat_wave:         { icon: '🌡️', color: '#b87a00', label: 'Onda de calor',           category: 'meteorológico' },
  cold_wave:         { icon: '❄️',  color: '#528ac4', label: 'Onda de frio',            category: 'meteorológico' },
  flood:             { icon: '💧', color: '#0080cc', label: 'Inundação',               category: 'meteorológico' },
  drought:           { icon: '🏜️', color: '#a77e39', label: 'Seca',                     category: 'meteorológico' },
  // geológico
  earthquake:        { icon: '🌍', color: '#d4434f', label: 'Terremoto',               category: 'geológico' },
  volcano:           { icon: '🌋', color: '#c2491c', label: 'Vulcão',                   category: 'geológico' },
  tsunami:           { icon: '🌊', color: '#2a6fdf', label: 'Tsunami',                  category: 'geológico' },
  // atmosférico
  wildfire:          { icon: '🔥', color: '#c75e00', label: 'Incêndio',                category: 'atmosférico' },
  dust_storm:        { icon: '💨', color: '#93795a', label: 'Tempestade de areia',     category: 'atmosférico' },
  air_pollution:     { icon: '🌫️', color: '#80804d', label: 'Poluição do ar',          category: 'atmosférico' },
  // espacial
  solar_flare:       { icon: '✨', color: '#a08c00', label: 'Erupção solar',           category: 'espacial' },
  cme:               { icon: '☀️', color: '#b06a2e', label: 'Ejeção de massa coronal', category: 'espacial' },
  geomagnetic_storm: { icon: '⚡', color: '#00935c', label: 'Tempestade geomagnética', category: 'espacial' },
  radiation_storm:   { icon: '☢️', color: '#cf5240', label: 'Tempestade de radiação',  category: 'espacial' },
  radio_blackout:    { icon: '📡', color: '#767f7f', label: 'Apagão de rádio',          category: 'espacial' },

  // ── weather ───────────────────────────────────────────────────────────────
  forecast:          { icon: '🌤️', color: '#528ac4', label: 'Previsão',    category: 'clima' },
  weather_alert:     { icon: '⚠️',  color: '#a77e39', label: 'Alerta',      category: 'clima' },

  // ── news ──────────────────────────────────────────────────────────────────
  article:           { icon: '📰', color: '#528ac4', label: 'Artigo',      category: 'notícias' },
  report:            { icon: '📊', color: '#7f74e8', label: 'Relatório',   category: 'notícias' },
  press_release:     { icon: '📢', color: '#8a84c4', label: 'Comunicado',  category: 'notícias' },

  // ── finance ───────────────────────────────────────────────────────────────
  price_update:       { icon: '📈', color: '#1c989d', label: 'Cotação',    category: 'mercado' },
  price_alert:        { icon: '🚨', color: '#c25800', label: 'Alerta',     category: 'mercado' },
  economic_indicator: { icon: '📊', color: '#528ac4', label: 'Indicador',  category: 'mercado' },
}

// getTypeMeta — resolve metadados com fallback seguro para tipos desconhecidos.
export function getTypeMeta(type) {
  return CONTENT_TYPE_META[type] ?? { icon: '❓', color: '#888888', label: type, category: 'desconhecido' }
}

// THEME_TYPES — lista canônica de tipos por tema. Fonte de verdade para testes de completude.
export const THEME_TYPES = {
  'extreme-events': [
    'hurricane', 'tornado', 'severe_storm', 'heat_wave', 'cold_wave', 'flood', 'drought',
    'earthquake', 'volcano', 'tsunami',
    'wildfire', 'dust_storm', 'air_pollution',
    'solar_flare', 'cme', 'geomagnetic_storm', 'radiation_storm', 'radio_blackout',
  ],
  weather:  ['forecast', 'weather_alert'],
  news:     ['article', 'report', 'press_release'],
  finance:  ['price_update', 'price_alert', 'economic_indicator'],
}

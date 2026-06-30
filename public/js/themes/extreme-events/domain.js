// domain.js — ponto de entrada de domínio do tema extreme-events.
// Re-exporta as funções e constantes canônicas de events.js.
// Outros módulos do tema importam daqui; nunca diretamente de events.js.

export {
  analyzeRisk,
  EVENT_META,
  EVENT_LIFESPAN,
  isEventExpired,
  haversineKm,
  getDecayFactor,
  calculateEventScore,
} from '../../events.js';

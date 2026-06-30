import { CONTENT_TYPE_META, THEME_TYPES } from './shared/content-type-meta.js'

export const EVENT_LIFESPAN = {
  // meteorológico
  hurricane:         [18, 240],
  tornado:           [6,  48],
  severe_storm:      [12, 96],
  heat_wave:         [24, 240],
  cold_wave:         [24, 240],
  flood:             [12, 168],
  drought:           [720, 8760],
  // geológico
  earthquake:        [12, 168],
  volcano:           [48, 4380],
  tsunami:           [2,  24],
  // atmosférico
  wildfire:          [48, 720],
  dust_storm:        [8,  96],
  air_pollution:     [12, 120],
  // espacial
  solar_flare:       [4,  24],
  cme:               [24, 96],
  geomagnetic_storm: [12, 168],
  radiation_storm:   [12, 72],
  radio_blackout:    [4,  24],
  // fallback
  _default:          [24, 168],
}

// EVENT_META (legado) — derivado da fonte canônica CONTENT_TYPE_META em
// shared/content-type-meta.js (direção de dependência: legado → canônico).
// Não editar cores/ícones aqui: toda mudança visual acontece no canônico.
export const EVENT_META = Object.fromEntries(
  THEME_TYPES['extreme-events'].map(type => [type, CONTENT_TYPE_META[type]])
)

// Distância em km entre dois pontos geográficos (fórmula de haversine)
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

export function getDecayFactor(elapsedHours, halfLifeHours) {
  if (elapsedHours <= 0) return 1.0
  return Math.pow(2, -elapsedHours / halfLifeHours)
}

export function isEventExpired(event) {
  if (event.endTime && event.endTime <= new Date()) return true
  const [, maxAgeH] = EVENT_LIFESPAN[event.type] ?? EVENT_LIFESPAN._default
  const ageH = (Date.now() - event.startTime) / 3_600_000
  return ageH > maxAgeH
}

export function calculateEventScore(event, userLat, userLng, decayFactor = 1.0) {
  const distKm = haversineKm(event.latitude, event.longitude, userLat, userLng)
  const radius = event.radiusKm ?? 300
  // Eventos fora do raio de efeito não contribuem para o risco local
  if (distKm > radius) return 0
  const proximity  = 1 - distKm / radius   // 1 = epicentro, 0 = borda do raio
  const confidence = event.confidence ?? 0.75
  return Math.max(0,
    event.severity * 0.8 +
    proximity      * 0.8 +
    confidence     * 0.2 +
    decayFactor    * 0.1
  )
}

export function analyzeRisk(latitude, longitude, events = []) {
  const valid = events.filter(e => !isEventExpired(e))
  const byType = {}

  // Eventos espaciais vão para o painel de clima espacial — excluídos do risco local
  const SPACE_TYPES = new Set(['solar_flare', 'cme', 'geomagnetic_storm', 'radiation_storm', 'radio_blackout'])

  const scored = valid.map(e => {
    const [halfLifeH] = EVENT_LIFESPAN[e.type] ?? EVENT_LIFESPAN._default
    const elapsedH    = (Date.now() - e.startTime) / 3_600_000
    const decay       = getDecayFactor(elapsedH, halfLifeH)
    const score       = calculateEventScore(e, latitude, longitude, decay)
    byType[e.type]    = (byType[e.type] ?? 0) + 1
    return { e, score, distKm: haversineKm(e.latitude, e.longitude, latitude, longitude) }
  })

  // Soma decrescente: evento mais grave com peso total, seguintes com 40%, 16%...
  // Impede que centenas de eventos globais distantes inflem o score local.
  const totalScore = scored
    .filter(s => s.score > 0 && !SPACE_TYPES.has(s.e.type))
    .sort((a, b) => b.score - a.score)
    .reduce((acc, { score }, i) => acc + score * Math.pow(0.4, i), 0)

  const level = totalScore >= 4.0 ? 'crítico'
              : totalScore >= 2.5 ? 'alto'
              : totalScore >= 1.5 ? 'moderado'
              : 'baixo'

  const nearbyEvents = scored
    .filter(({ distKm, e }) => !SPACE_TYPES.has(e.type) && distKm <= (e.radiusKm ?? 300))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ e, distKm }) => ({ event: e, distKm: Math.round(distKm) }))

  return {
    score:       parseFloat(totalScore.toFixed(2)),
    level,
    eventCount:  valid.length,
    eventsByType: byType,
    nearbyEvents,
  }
}

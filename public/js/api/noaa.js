/**
 * NOAA SWPC — Space Weather Prediction Center (clima espacial)
 * https://www.swpc.noaa.gov/products/alerts-watches-and-warnings
 *
 * Endpoints (todos CORS ✅):
 *   products/alerts.json             — alertas textuais
 *   json/planetary_k_index_1m.json  — índice KP em tempo real
 *   json/goes/primary/xrays-1-day.json — fluxo raios-X 24h
 *
 * Retorna { events, clima } — campo clima alimenta o painel de espaço no app.js
 *
 * GEO_ANCHORS: 8 pontos aurorais para distribuir eventos espaciais no mapa.
 * Eventos espaciais afetam regiões polares com maior intensidade.
 */
import { mapCategory, truncate } from './utils.js'

const BASE = 'https://services.swpc.noaa.gov'

export const GEO_ANCHORS = [
  { lat:  70, lng: -100 },  // Canadá / Aurora Boreal
  { lat:  70, lng:   25 },  // Escandinávia
  { lat:  70, lng:  130 },  // Rússia / Sibéria
  { lat:  67, lng: -150 },  // Alasca
  { lat:  65, lng:  -20 },  // Islândia
  { lat: -70, lng:  -90 },  // Antártida / Chile
  { lat: -70, lng:   30 },  // Antártida / África do Sul
  { lat: -70, lng:  150 },  // Antártida / Austrália
]

// Mapeia product_id / código de mensagem para EventType
export function parseAlertType(productId) {
  if (!productId) return null
  const id = productId.toUpperCase()
  if (/ALTEF/.test(id))                    return 'radiation_storm'
  if (/ALTTP|WARK\d/.test(id))             return 'radio_blackout'
  if (/ALTK|ALTG|WATA|GEOMET/.test(id))   return 'geomagnetic_storm'
  if (/ALTXMF|ALTXRF|ALTXRB|PRF/.test(id))return 'solar_flare'
  if (/CME|ALTCME|WATA20/.test(id))        return 'cme'
  if (/WATPOR|ALTPOR/.test(id))            return 'radiation_storm'
  return null
}

// Extrai nível numérico do código (ex: "ALTEF3" → 3, "ALTG5" → 5)
export function codeToSeverity(productId) {
  const n = parseInt(/(\d+)$/.exec(productId ?? '')?.[1] ?? '2', 10)
  return Math.min(5, Math.max(1, n))
}

export function kpToSeverity(kp) {
  if (kp >= 8) return 5
  if (kp >= 7) return 4
  if (kp >= 6) return 3
  if (kp >= 5) return 2
  return 1
}

// Classificação GOES: A<1e-7, B≥1e-7, C≥1e-6, M≥1e-5, X≥1e-4 (W/m²)
export function classifyXRay(flux) {
  if (typeof flux !== 'number' || flux <= 0) return { cls: 'A', severity: 1 }
  if (flux >= 1e-4) return { cls: 'X', severity: 5 }
  if (flux >= 1e-5) return { cls: 'M', severity: 4 }
  if (flux >= 1e-6) return { cls: 'C', severity: 3 }
  if (flux >= 1e-7) return { cls: 'B', severity: 2 }
  return { cls: 'A', severity: 1 }
}

export function kpToStormLevel(kp) {
  if (kp >= 9)  return 'Extremo (G5)'
  if (kp >= 8)  return 'Severo (G4)'
  if (kp >= 7)  return 'Forte (G3)'
  if (kp >= 6)  return 'Moderado (G2)'
  if (kp >= 5)  return 'Menor (G1)'
  return 'Quieto'
}

export function alertToEvent(alert, anchorIdx = 0) {
  const pid  = alert?.product_id ?? ''
  const type = parseAlertType(pid)
  if (!type) return null

  const anchor   = GEO_ANCHORS[anchorIdx % GEO_ANCHORS.length]
  const severity = codeToSeverity(pid)
  const issued   = alert.issue_datetime ? new Date(alert.issue_datetime) : new Date()

  // Extrai primeira linha útil da mensagem como title
  const lines = (alert.message ?? '').split('\n').map(l => l.trim()).filter(Boolean)
  const title = lines.find(l => !l.startsWith('Space Weather') && l.length > 5)
    ?? `NOAA SWPC ${type}`

  return {
    id:          `noaa-${pid.replace(/[^a-zA-Z0-9-]/g, '_')}`,
    type,
    category:    mapCategory(type),
    severity,
    confidence:  0.90,
    latitude:    anchor.lat,
    longitude:   anchor.lng,
    radiusKm:    20000,   // clima espacial afeta escala global
    startTime:   issued,
    source:      'NOAA SWPC',
    title:       truncate(title, 80),
    description: truncate(alert.message ?? '', 300),
    metadata:    { product_id: pid, anchor: anchorIdx % GEO_ANCHORS.length },
  }
}

async function fetchJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`NOAA HTTP ${res.status} em ${url}`)
  return res.json()
}

export async function fetchNOAAEvents() {
  const [alerts, kpRaw, xrayRaw] = await Promise.all([
    fetchJSON(`${BASE}/products/alerts.json`),
    fetchJSON(`${BASE}/json/planetary_k_index_1m.json`),
    fetchJSON(`${BASE}/json/goes/primary/xrays-1-day.json`),
  ])

  // Alertas → eventos
  const events = (Array.isArray(alerts) ? alerts : [])
    .map((a, i) => alertToEvent(a, i))
    .filter(Boolean)

  // KP mais recente — API retorna objetos { time_tag, kp_index, estimated_kp, kp }
  const kpArr    = Array.isArray(kpRaw) ? kpRaw : []
  const kpLast   = kpArr.at(-1)
  const latestKp = parseFloat(kpLast?.estimated_kp ?? kpLast?.kp_index ?? kpLast?.[1] ?? 0)

  // Fluxo raios-X mais recente
  const xArr  = Array.isArray(xrayRaw) ? xrayRaw : []
  const xLast = xArr.at(-1)
  const xFlux = typeof xLast?.flux === 'number' ? xLast.flux
    : typeof xLast?.[1] === 'number' ? xLast[1] : 0
  const { cls: xCls } = classifyXRay(xFlux)

  const clima = {
    kp:         isNaN(latestKp) ? 0 : latestKp,
    xray:       xCls,
    stormLevel: kpToStormLevel(latestKp),
  }

  const byType = events.reduce((a, e) => { a[e.type] = (a[e.type] ?? 0) + 1; return a }, {})
  console.log(`[NOAA SWPC] ${events.length} alertas | KP: ${clima.kp} | X-ray: ${clima.xray} | tipos:`, byType)

  return { events, clima }
}

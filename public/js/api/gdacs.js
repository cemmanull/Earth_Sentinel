/**
 * GDACS — Global Disaster Alerting and Coordination System (multiriscos globais)
 * https://www.gdacs.org/About/API.aspx
 *
 * Endpoint: /api/gdacs/events (proxy local em server.js — GDACS não tem CORS)
 * CORS: ❌ proxy obrigatório
 *
 * Estratégia de fetch: 3 requisições paralelas por grupo de tipo para superar
 * o limite hard de 100 resultados/request da API GDACS:
 *   EQ (terremotos)          — 100 resultados
 *   VO (vulcões)             — separado para não ser suprimido
 *   TC;FL;DR;WF              — eventos restantes
 *
 * Regras especiais:
 *   episodealertlevel = estado atual do episódio (usar para severity)
 *   alertlevel        = pico histórico do evento   (fallback)
 *   endTime           = NUNCA definir com todate — GDACS encerra antes do risco real
 *   startTime         = max(fromdate, todate)       — última atividade registrada
 */
import { mapCategory, truncate } from './utils.js'

const PROXY_BASE = '/api/gdacs/events'

const TYPE_MAP = {
  EQ: 'earthquake',
  TC: 'hurricane',
  FL: 'flood',
  VO: 'volcano',
  DR: 'drought',
  WF: 'wildfire',
  TS: 'tsunami',
}

export function alertLevelToSeverity(level) {
  switch (level?.toLowerCase()) {
    case 'red':    return 5
    case 'orange': return 3
    case 'green':  return 1
    default:       return 1
  }
}

export function parseGdacsDate(str) {
  if (!str) return null
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

export function gdacsToEvent(feature) {
  const p   = feature?.properties
  const geo = feature?.geometry
  if (!p || !geo) return null

  const coords = Array.isArray(geo.coordinates) ? geo.coordinates : null
  if (!coords) return null
  const [lng, lat] = coords
  if (typeof lat !== 'number' || typeof lng !== 'number') return null

  const type = TYPE_MAP[p.eventtype]
  if (!type) return null

  // episodealertlevel = estado atual; alertlevel = pico histórico (fallback)
  const level    = p.episodealertlevel || p.alertlevel || 'Green'
  const severity = alertLevelToSeverity(level)

  // startTime = max(fromdate, todate) — última atividade registrada
  const fromDate  = parseGdacsDate(p.fromdate)
  const toDate    = parseGdacsDate(p.todate)
  const startTime = (fromDate && toDate)
    ? (toDate > fromDate ? toDate : fromDate)
    : (toDate ?? fromDate ?? new Date())

  return {
    id:          `gdacs-${p.eventtype}-${p.eventid}`,
    type,
    category:    mapCategory(type),
    severity,
    confidence:  0.90,
    latitude:    lat,
    longitude:   lng,
    radiusKm:    severity >= 4 ? 500 : severity >= 3 ? 300 : 150,
    startTime,
    // Sem endTime — GDACS encerra registros antes do risco real dissipar
    source:      'GDACS',
    title:       truncate(p.name ?? p.eventname ?? `${p.eventtype} evento`, 80),
    description: truncate(
      p.description ?? `Nível: ${level}. País: ${p.country ?? '?'}`,
      300,
    ),
    metadata: {
      alertLevel: level,
      country:    p.country,
      eventtype:  p.eventtype,
      episodeid:  p.episodeid,
    },
  }
}

const TYPES  = ['EQ', 'VO', 'TC', 'FL', 'DR', 'WF', 'TS']
const LEVELS = ['Green', 'Orange', 'Red']

async function fetchSlice(type, level) {
  const url = `${PROXY_BASE}?types=${type}&alertlevel=${level}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`GDACS proxy HTTP ${res.status}`)
  return res.json()
}

const SLICE_DELAY_MS = 500   // pausa entre grupos de tipo para respeitar rate limit

export async function fetchGDACSEvents() {
  // 7 tipos sequenciais × 3 níveis paralelos = máx 3 req simultâneas ao GDACS
  const allFeatures = []
  let   failCount   = 0

  for (let i = 0; i < TYPES.length; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, SLICE_DELAY_MS))

    const typeResults = await Promise.allSettled(
      LEVELS.map(level => fetchSlice(TYPES[i], level))
    )
    for (const r of typeResults) {
      if (r.status === 'fulfilled') allFeatures.push(...(r.value.features ?? []))
      else failCount++
    }
  }
  if (failCount) console.warn(`[GDACS] ${failCount}/${TYPES.length * LEVELS.length} slices falharam`)

  // Deduplica por eventtype-eventid
  const seen   = new Set()
  const unique = allFeatures.filter(f => {
    const key = `${f.properties?.eventtype}-${f.properties?.eventid}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const total  = unique.length
  const events = unique.map(gdacsToEvent).filter(Boolean)

  const byType  = events.reduce((a, e) => { a[e.type]  = (a[e.type]  ?? 0) + 1; return a }, {})
  const byLevel = events.reduce((a, e) => {
    const l = e.metadata.alertLevel; a[l] = (a[l] ?? 0) + 1; return a
  }, {})
  console.log(`[GDACS] ${events.length}/${total} eventos | tipos:`, byType, '| níveis:', byLevel)

  return events
}

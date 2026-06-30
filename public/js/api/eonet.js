/**
 * NASA EONET — Earth Observatory Natural Event Tracker
 * https://eonet.gsfc.nasa.gov/docs/v3
 *
 * Endpoint: https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=200
 * CORS: ✅ direto
 *
 * Campo de geometria: ev.geometry (array), NÃO ev.geometries
 */
import { mapCategory, truncate } from './utils.js'

const BASE = 'https://eonet.gsfc.nasa.gov/api/v3/events'

const EONET_CATEGORY_MAP = {
  wildfires:    'wildfire',
  severeStorms: 'severe_storm',
  volcanoes:    'volcano',
  earthquakes:  'earthquake',
  floods:       'flood',
  landslides:   'earthquake',
  snow:         'severe_storm',
  tempExtremes: 'heat_wave',
  drought:      'drought',
  dustHaze:     'dust_storm',
}

export function eonetCategoryToType(categories) {
  if (!Array.isArray(categories)) return null
  for (const cat of categories) {
    const type = EONET_CATEGORY_MAP[cat.id]
    if (type) return type
  }
  return null
}

export function eonetToEvent(ev) {
  if (!ev?.id || !ev.title) return null

  const type = eonetCategoryToType(ev.categories)
  if (!type) return null

  const geometries = Array.isArray(ev.geometry) ? ev.geometry : []
  if (geometries.length === 0) return null

  const geom = geometries.at(-1)
  if (!geom?.coordinates) return null

  let lat, lng
  if (geom.type === 'Point') {
    ;[lng, lat] = geom.coordinates
  } else if (geom.type === 'Polygon') {
    const ring = geom.coordinates[0]
    lat = ring.reduce((s, c) => s + c[1], 0) / ring.length
    lng = ring.reduce((s, c) => s + c[0], 0) / ring.length
  } else {
    return null
  }

  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return null

  return {
    id:          `eonet-${ev.id}`,
    type,
    category:    mapCategory(type),
    severity:    2,
    confidence:  0.75,
    latitude:    lat,
    longitude:   lng,
    radiusKm:    150,
    startTime:   geom.date ? new Date(geom.date) : new Date(),
    source:      'NASA EONET',
    title:       truncate(ev.title, 80),
    description: truncate(ev.description ?? ev.title, 300),
    metadata:    { eonetId: ev.id, categories: ev.categories?.map(c => c.id) },
  }
}

export async function fetchEONETEvents() {
  const url = `${BASE}?status=open&limit=200`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`NASA EONET HTTP ${res.status}`)
  const data = await res.json()

  const evList = data.events ?? []
  const total  = evList.length
  const events = evList.map(ev => eonetToEvent(ev)).filter(Boolean)

  const byType = events.reduce((a, e) => { a[e.type] = (a[e.type] ?? 0) + 1; return a }, {})
  console.log(`[NASA EONET] ${events.length}/${total} eventos | tipos:`, byType)

  return events
}

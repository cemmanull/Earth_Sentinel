/**
 * USGS Earthquake Hazards Program — terremotos M≥4.5
 * https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
 *
 * Endpoint: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson
 * CORS: ✅ direto
 */
import { mapCategory, truncate } from './utils.js'

const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson'

export function magnitudeToSeverity(mag) {
  if (mag >= 8) return 5
  if (mag >= 7) return 4
  if (mag >= 6) return 3
  if (mag >= 5) return 2
  return 1
}

export function featureToEvent(feature) {
  const p   = feature?.properties
  const geo = feature?.geometry
  if (!p || !geo || !Array.isArray(geo.coordinates)) return null

  const [lng, lat, depth] = geo.coordinates
  if (typeof lat !== 'number' || typeof lng !== 'number') return null

  const mag = typeof p.mag === 'number' ? p.mag : null
  if (mag === null || mag < 4.5) return null

  const severity = magnitudeToSeverity(mag)
  const radiusKm = mag >= 7 ? 500 : mag >= 6 ? 200 : 100

  return {
    id:          `usgs-${feature.id}`,
    type:        'earthquake',
    category:    mapCategory('earthquake'),
    severity,
    confidence:  0.99,
    latitude:    lat,
    longitude:   lng,
    radiusKm,
    startTime:   new Date(p.time),
    source:      'USGS',
    title:       truncate(p.title ?? `M${mag.toFixed(1)} terremoto`, 80),
    description: truncate(
      `Magnitude ${mag.toFixed(1)}, profundidade ${Math.round(depth ?? 0)} km. ${p.place ?? ''}`,
      300,
    ),
    metadata: { mag, depth, place: p.place, status: p.status },
  }
}

export async function fetchUSGSEarthquakes() {
  const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`USGS HTTP ${res.status}`)

  const data   = await res.json()
  const total  = data.features?.length ?? 0
  const events = (data.features ?? []).map(featureToEvent).filter(Boolean)

  const maxMag = events.reduce((m, e) => Math.max(m, e.metadata.mag ?? 0), 0)
  const bySev  = events.reduce((a, e) => {
    const k = `sev${e.severity}`; a[k] = (a[k] ?? 0) + 1; return a
  }, {})
  console.log(`[USGS] ${events.length}/${total} terremotos M4.5+ (máx M${maxMag.toFixed(1)}) | sev:`, bySev)

  return events
}

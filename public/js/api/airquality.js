/**
 * Open-Meteo Air Quality — qualidade do ar global
 * https://open-meteo.com/en/docs/air-quality-api
 *
 * Endpoint: https://air-quality-api.open-meteo.com/v1/air-quality
 * CORS: ✅ direto
 *
 * Reutiliza PROBE_GRID de openmeteo.js — não duplicar a grade.
 * Limiares: dust ≥ 500 µg/m³ → dust_storm; AQI ≥ 101 → air_pollution
 */
import { mapCategory, truncate } from './utils.js'
import { PROBE_GRID }            from './openmeteo.js'

const BASE = 'https://air-quality-api.open-meteo.com/v1/air-quality'

const DUST_THRESHOLD = 500    // µg/m³
const AQI_THRESHOLD  = 101    // US AQI

export function aqiToSeverity(aqi) {
  if (aqi >= 301) return 5   // Hazardous
  if (aqi >= 201) return 4   // Very Unhealthy
  if (aqi >= 151) return 3   // Unhealthy
  return 2                   // Unhealthy for Sensitive Groups (101–150)
}

export function dustToSeverity(dust) {
  if (dust >= 2000) return 5
  if (dust >= 1200) return 4
  if (dust >= 800)  return 3
  return 2
}

export function hourlyToEvents(point, hourly, hourIndex) {
  const events = []
  const date   = new Date(hourly.time[hourIndex])

  const dust = hourly.dust?.[hourIndex]
  const aqi  = hourly.us_aqi?.[hourIndex]

  if (typeof dust === 'number' && dust >= DUST_THRESHOLD) {
    events.push({
      id:          `aq-dust-${point.lat.toFixed(1)}-${point.lng.toFixed(1)}-${hourly.time[hourIndex]}`,
      type:        'dust_storm',
      category:    mapCategory('dust_storm'),
      severity:    dustToSeverity(dust),
      confidence:  0.75,
      latitude:    point.lat,
      longitude:   point.lng,
      radiusKm:    400,
      startTime:   date,
      source:      'Open-Meteo AQ',
      title:       truncate(`Tempestade de Areia — ${dust.toFixed(0)} µg/m³`, 80),
      description: truncate(`Concentração de poeira de ${dust.toFixed(0)} µg/m³.`, 300),
      metadata:    { dust_ugm3: dust },
    })
  }

  if (typeof aqi === 'number' && aqi >= AQI_THRESHOLD) {
    events.push({
      id:          `aq-aqi-${point.lat.toFixed(1)}-${point.lng.toFixed(1)}-${hourly.time[hourIndex]}`,
      type:        'air_pollution',
      category:    mapCategory('air_pollution'),
      severity:    aqiToSeverity(aqi),
      confidence:  0.75,
      latitude:    point.lat,
      longitude:   point.lng,
      radiusKm:    200,
      startTime:   date,
      source:      'Open-Meteo AQ',
      title:       truncate(`Qualidade do Ar Degradada — AQI ${aqi}`, 80),
      description: truncate(`Índice de qualidade do ar US AQI: ${aqi}.`, 300),
      metadata:    { us_aqi: aqi },
    })
  }

  return events
}

export async function fetchAirQualityEvents() {
  const lats = PROBE_GRID.map(p => p.lat).join(',')
  const lngs = PROBE_GRID.map(p => p.lng).join(',')
  const url  = `${BASE}?latitude=${lats}&longitude=${lngs}&hourly=dust,us_aqi&timezone=UTC&forecast_days=1`

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Open-Meteo AQ HTTP ${res.status}`)
  const data = await res.json()

  const results = Array.isArray(data) ? data : [data]
  const events  = []

  for (let pi = 0; pi < results.length; pi++) {
    const hourly = results[pi]?.hourly
    if (!hourly?.time) continue
    const point = PROBE_GRID[pi]
    for (let hi = 0; hi < hourly.time.length; hi++) {
      events.push(...hourlyToEvents(point, hourly, hi))
    }
  }

  const total  = PROBE_GRID.length
  const active = results.filter(r => r?.hourly?.time).length
  const byType = events.reduce((a, e) => { a[e.type] = (a[e.type] ?? 0) + 1; return a }, {})
  console.log(`[Open-Meteo AQ] ${events.length} alertas em ${active}/${total} pontos | tipos:`, byType)

  return events
}

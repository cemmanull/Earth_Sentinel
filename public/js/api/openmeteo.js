/**
 * Open-Meteo — Previsão do tempo global (clima extremo e alertas)
 * https://open-meteo.com/en/docs
 *
 * Endpoint: https://api.open-meteo.com/v1/forecast
 * CORS: ✅ direto
 *
 * Dois tiers de evento:
 *   ALERTA  — evento grave com marcador padrão (severity 3-5)
 *   AVISO   — risco potencial com marcador menor (severity 1-2, metadata.warning=true)
 *
 * PROBE_GRID exportado e reutilizado por airquality.js — não duplicar.
 */
import { mapCategory, truncate } from './utils.js'

const BASE = 'https://api.open-meteo.com/v1/forecast'

// 55 pontos distribuídos globalmente para cobertura representativa
export const PROBE_GRID = [
  // América do Norte
  { lat:  60.0, lng: -135.0 }, { lat:  55.0, lng: -120.0 },
  { lat:  45.0, lng: -100.0 }, { lat:  35.0, lng:  -95.0 },
  { lat:  30.0, lng:  -90.0 }, { lat:  25.0, lng:  -80.0 },
  { lat:  45.0, lng:  -75.0 }, { lat:  50.0, lng:  -60.0 },

  // América Central e Caribe
  { lat:  20.0, lng:  -75.0 }, { lat:  15.0, lng:  -85.0 },
  { lat:  10.0, lng:  -65.0 },

  // América do Sul
  { lat:  -5.0, lng:  -55.0 }, { lat: -15.0, lng:  -50.0 },
  { lat: -23.5, lng:  -46.6 }, { lat: -33.5, lng:  -70.7 },
  { lat: -40.0, lng:  -63.0 }, { lat: -55.0, lng:  -68.0 },
  { lat: -12.0, lng:  -77.0 },

  // Europa
  { lat:  65.0, lng:   25.0 }, { lat:  55.0, lng:   10.0 },
  { lat:  52.0, lng:    0.0 }, { lat:  48.0, lng:    2.4 },
  { lat:  41.0, lng:   29.0 }, { lat:  40.4, lng:   -3.7 },
  { lat:  59.0, lng:   28.0 },

  // África
  { lat:  36.0, lng:    3.0 }, { lat:  15.0, lng:   30.0 },
  { lat:   0.0, lng:   20.0 }, { lat: -10.0, lng:   25.0 },
  { lat: -26.0, lng:   28.0 }, { lat: -34.0, lng:   18.5 },
  { lat:  -3.0, lng:   37.0 },

  // Oriente Médio e Ásia Central
  { lat:  30.0, lng:   45.0 }, { lat:  25.0, lng:   55.0 },
  { lat:  35.0, lng:   60.0 }, { lat:  40.0, lng:   70.0 },

  // Ásia do Sul
  { lat:  28.6, lng:   77.2 }, { lat:  23.0, lng:   80.0 },
  { lat:  12.0, lng:   80.0 }, { lat:   7.0, lng:   80.0 },

  // Ásia Oriental
  { lat:  35.7, lng:  139.7 }, { lat:  31.2, lng:  121.5 },
  { lat:  22.0, lng:  114.0 }, { lat:  55.0, lng:   82.0 },

  // Sudeste Asiático e Pacífico
  { lat:   1.3, lng:  103.8 }, { lat:  14.0, lng:  120.0 },
  { lat:  -6.0, lng:  107.0 }, { lat: -25.0, lng:  130.0 },
  { lat: -37.8, lng:  145.0 },

  // Oceano / Polos
  { lat:  70.0, lng:  -20.0 }, { lat:  65.0, lng: -170.0 },
  { lat: -60.0, lng:   10.0 }, { lat: -70.0, lng:  -60.0 },

  // Zona tropical
  { lat:  -8.0, lng:  115.0 }, { lat:  20.0, lng:  100.0 },
]

// ── Thresholds por tier ──────────────────────────────────────────────────────

const HEAT = { warn: 33, alert: 42 }    // °C
const COLD = { warn: -8, alert: -20 }   // °C
const WIND = { warn: 14, alert: 28 }    // m/s (~50 e ~100 km/h)
const PREC = { warn: 30, alert: 80 }    // mm/dia

// ── Funções de severidade ────────────────────────────────────────────────────

export function tempToSeverity(tempC, isHeat) {
  if (isHeat) {
    if (tempC >= 50) return 5
    if (tempC >= 47) return 4
    if (tempC >= 44) return 3
    if (tempC >= 42) return 2
    return 1
  } else {
    const abs = Math.abs(tempC)
    if (abs >= 40) return 5
    if (abs >= 35) return 4
    if (abs >= 30) return 3
    if (abs >= 20) return 2
    return 1
  }
}

export function windToSeverity(gusts) {
  if (gusts >= 55) return 5
  if (gusts >= 44) return 4
  if (gusts >= 36) return 3
  if (gusts >= 28) return 2
  return 1
}

export function precipToSeverity(mm) {
  if (mm >= 200) return 5
  if (mm >= 150) return 4
  if (mm >= 100) return 3
  if (mm >= 80)  return 2
  return 1
}

// ── Geração de eventos ───────────────────────────────────────────────────────

function makeEvent(type, point, value, date, dateStr, isWarn, extraTitle, extraDesc) {
  return {
    id:          `openmeteo-${type}-${isWarn?'w':'a'}-${point.lat.toFixed(1)}-${point.lng.toFixed(1)}-${dateStr}`,
    type,
    category:    mapCategory(type),
    severity:    isWarn ? 1 : undefined,   // override abaixo
    confidence:  isWarn ? 0.65 : 0.75,
    latitude:    point.lat,
    longitude:   point.lng,
    radiusKm:    isWarn ? 150 : 300,
    startTime:   date,
    source:      'Open-Meteo',
    title:       truncate(extraTitle, 80),
    description: truncate(extraDesc, 300),
    metadata:    { warning: isWarn, value },
  }
}

export function forecastDayToEvents(point, daily, dayIndex) {
  const events  = []
  const date    = new Date(daily.time[dayIndex])
  const dateStr = daily.time[dayIndex]

  const tMax  = daily.temperature_2m_max?.[dayIndex]
  const tMin  = daily.temperature_2m_min?.[dayIndex]
  const prec  = daily.precipitation_sum?.[dayIndex]
  const wind  = daily.wind_gusts_10m_max?.[dayIndex]

  // Calor: apenas o tier mais alto aplicável
  if (typeof tMax === 'number') {
    if (tMax >= HEAT.alert) {
      const sev = tempToSeverity(tMax, true)
      const e = makeEvent('heat_wave', point, tMax, date, dateStr, false,
        `Onda de Calor — ${tMax.toFixed(1)}°C`,
        `Temperatura máxima de ${tMax.toFixed(1)}°C prevista.`)
      e.severity = sev
      e.radiusKm = sev >= 4 ? 500 : 300
      events.push(e)
    } else if (tMax >= HEAT.warn) {
      const e = makeEvent('heat_wave', point, tMax, date, dateStr, true,
        `Calor Intenso — ${tMax.toFixed(1)}°C`,
        `Temperatura elevada de ${tMax.toFixed(1)}°C prevista.`)
      events.push(e)
    }
  }

  // Frio: apenas o tier mais alto aplicável
  if (typeof tMin === 'number') {
    if (tMin <= COLD.alert) {
      const sev = tempToSeverity(tMin, false)
      const e = makeEvent('cold_wave', point, tMin, date, dateStr, false,
        `Onda de Frio — ${tMin.toFixed(1)}°C`,
        `Temperatura mínima de ${tMin.toFixed(1)}°C prevista.`)
      e.severity = sev
      e.radiusKm = sev >= 4 ? 500 : 300
      events.push(e)
    } else if (tMin <= COLD.warn) {
      const e = makeEvent('cold_wave', point, tMin, date, dateStr, true,
        `Frio Intenso — ${tMin.toFixed(1)}°C`,
        `Temperatura mínima de ${tMin.toFixed(1)}°C prevista.`)
      events.push(e)
    }
  }

  // Precipitação: apenas o tier mais alto aplicável
  if (typeof prec === 'number' && prec > 0) {
    if (prec >= PREC.alert) {
      const sev = precipToSeverity(prec)
      const e = makeEvent('flood', point, prec, date, dateStr, false,
        `Chuva Intensa — ${prec.toFixed(0)} mm`,
        `Precipitação acumulada de ${prec.toFixed(0)} mm prevista.`)
      e.severity = sev
      events.push(e)
    } else if (prec >= PREC.warn) {
      const e = makeEvent('flood', point, prec, date, dateStr, true,
        `Chuva Elevada — ${prec.toFixed(0)} mm`,
        `Precipitação de ${prec.toFixed(0)} mm prevista.`)
      events.push(e)
    }
  }

  // Vento: apenas o tier mais alto aplicável
  if (typeof wind === 'number') {
    if (wind >= WIND.alert) {
      const sev = windToSeverity(wind)
      const e = makeEvent('severe_storm', point, wind, date, dateStr, false,
        `Vento Severo — ${(wind * 3.6).toFixed(0)} km/h`,
        `Rajadas de vento de ${(wind * 3.6).toFixed(0)} km/h previstas.`)
      e.severity = sev
      events.push(e)
    } else if (wind >= WIND.warn) {
      const e = makeEvent('severe_storm', point, wind, date, dateStr, true,
        `Vento Forte — ${(wind * 3.6).toFixed(0)} km/h`,
        `Rajadas de ${(wind * 3.6).toFixed(0)} km/h previstas.`)
      events.push(e)
    }
  }

  return events
}

export async function fetchOpenMeteoEvents() {
  const lats = PROBE_GRID.map(p => p.lat).join(',')
  const lngs = PROBE_GRID.map(p => p.lng).join(',')
  const vars = 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_gusts_10m_max'
  const url  = `${BASE}?latitude=${lats}&longitude=${lngs}&daily=${vars}&timezone=UTC&forecast_days=3`

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`)
  const data = await res.json()

  const results = Array.isArray(data) ? data : [data]
  const events  = []

  for (let pi = 0; pi < results.length; pi++) {
    const daily = results[pi]?.daily
    if (!daily?.time) continue
    const point = PROBE_GRID[pi]
    for (let di = 0; di < daily.time.length; di++) {
      events.push(...forecastDayToEvents(point, daily, di))
    }
  }

  const total  = PROBE_GRID.length
  const active = results.filter(r => r?.daily?.time).length
  const warn   = events.filter(e => e.metadata?.warning).length
  const byType = events.reduce((a, e) => { a[e.type] = (a[e.type] ?? 0) + 1; return a }, {})
  console.log(`[Open-Meteo] ${events.length} eventos (${warn} avisos) em ${active}/${total} pontos | tipos:`, byType)

  return events
}

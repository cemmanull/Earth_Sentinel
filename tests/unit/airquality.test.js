import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { aqiToSeverity, dustToSeverity, hourlyToEvents } from '../../public/js/api/airquality.js'
import { PROBE_GRID } from '../../public/js/api/openmeteo.js'

// ── aqiToSeverity ─────────────────────────────────────────────────────────────

describe('aqiToSeverity', () => {
  it('aqiToSeverity: 101 → 2 (Unhealthy for Sensitive)',  () => assert.strictEqual(aqiToSeverity(101), 2))
  it('aqiToSeverity: 151 → 3 (Unhealthy)',                () => assert.strictEqual(aqiToSeverity(151), 3))
  it('aqiToSeverity: 201 → 4 (Very Unhealthy)',           () => assert.strictEqual(aqiToSeverity(201), 4))
  it('aqiToSeverity: 301 → 5 (Hazardous)',                () => assert.strictEqual(aqiToSeverity(301), 5))
})

// ── dustToSeverity ────────────────────────────────────────────────────────────

describe('dustToSeverity', () => {
  it('dustToSeverity: 500 µg/m³ → 2 (limiar)',  () => assert.strictEqual(dustToSeverity(500),  2))
  it('dustToSeverity: 800 µg/m³ → 3',           () => assert.strictEqual(dustToSeverity(800),  3))
  it('dustToSeverity: 1200 µg/m³ → 4',          () => assert.strictEqual(dustToSeverity(1200), 4))
  it('dustToSeverity: 2000 µg/m³ → 5',          () => assert.strictEqual(dustToSeverity(2000), 5))
})

// ── PROBE_GRID reutilizado ─────────────────────────────────────────────────────

describe('PROBE_GRID (importado de openmeteo)', () => {
  it('airquality reutiliza o mesmo PROBE_GRID (55 pontos)', () => {
    assert.strictEqual(PROBE_GRID.length, 55)
  })
})

// ── hourlyToEvents ────────────────────────────────────────────────────────────

const POINT = { lat: 15.0, lng: 30.0 }

const HOURLY_DUST = {
  time:   ['2024-01-15T12:00'],
  dust:   [1500],
  us_aqi: [80],
}

const HOURLY_AQI = {
  time:   ['2024-01-15T12:00'],
  dust:   [50],
  us_aqi: [175],
}

const HOURLY_BOTH = {
  time:   ['2024-01-15T12:00'],
  dust:   [900],
  us_aqi: [210],
}

const HOURLY_CLEAN = {
  time:   ['2024-01-15T12:00'],
  dust:   [10],
  us_aqi: [30],
}

describe('hourlyToEvents', () => {
  it('hourlyToEvents: dust 1500 → dust_storm', () => {
    const evs = hourlyToEvents(POINT, HOURLY_DUST, 0)
    assert.ok(evs.some(e => e.type === 'dust_storm'), 'deve gerar dust_storm')
  })

  it('hourlyToEvents: AQI 175 → air_pollution severity 3', () => {
    const evs = hourlyToEvents(POINT, HOURLY_AQI, 0)
    const ap  = evs.find(e => e.type === 'air_pollution')
    assert.ok(ap)
    assert.strictEqual(ap.severity, 3)
  })

  it('hourlyToEvents: ambos acima do limiar → 2 eventos', () => {
    const evs = hourlyToEvents(POINT, HOURLY_BOTH, 0)
    assert.strictEqual(evs.length, 2)
  })

  it('hourlyToEvents: ar limpo → nenhum evento', () => {
    const evs = hourlyToEvents(POINT, HOURLY_CLEAN, 0)
    assert.strictEqual(evs.length, 0)
  })

  it('hourlyToEvents: source = "Open-Meteo AQ"', () => {
    const evs = hourlyToEvents(POINT, HOURLY_DUST, 0)
    assert.ok(evs.every(e => e.source === 'Open-Meteo AQ'))
  })

  it('hourlyToEvents: sem endTime', () => {
    const evs = hourlyToEvents(POINT, HOURLY_AQI, 0)
    assert.ok(evs.every(e => e.endTime === undefined))
  })
})

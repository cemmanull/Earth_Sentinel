import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  PROBE_GRID,
  tempToSeverity,
  windToSeverity,
  precipToSeverity,
  forecastDayToEvents,
} from '../../public/js/api/openmeteo.js'

// ── PROBE_GRID ─────────────────────────────────────────────────────────────────

describe('PROBE_GRID', () => {
  it('PROBE_GRID: exatamente 55 pontos', () => assert.strictEqual(PROBE_GRID.length, 55))

  it('PROBE_GRID: todos têm lat e lng válidos', () => {
    for (const p of PROBE_GRID) {
      assert.ok(typeof p.lat === 'number' && Math.abs(p.lat) <= 90,  `lat inválido: ${p.lat}`)
      assert.ok(typeof p.lng === 'number' && Math.abs(p.lng) <= 180, `lng inválido: ${p.lng}`)
    }
  })

  it('PROBE_GRID: cobertura de ambos os hemisférios', () => {
    assert.ok(PROBE_GRID.some(p => p.lat > 0),  'deve ter pontos no hemisfério norte')
    assert.ok(PROBE_GRID.some(p => p.lat < 0),  'deve ter pontos no hemisfério sul')
    assert.ok(PROBE_GRID.some(p => p.lng > 0),  'deve ter pontos no hemisfério leste')
    assert.ok(PROBE_GRID.some(p => p.lng < 0),  'deve ter pontos no hemisfério oeste')
  })
})

// ── tempToSeverity ─────────────────────────────────────────────────────────────

describe('tempToSeverity', () => {
  it('tempToSeverity: calor 42°C → 2 (limiar)',   () => assert.strictEqual(tempToSeverity(42, true), 2))
  it('tempToSeverity: calor 44°C → 3',            () => assert.strictEqual(tempToSeverity(44, true), 3))
  it('tempToSeverity: calor 47°C → 4',            () => assert.strictEqual(tempToSeverity(47, true), 4))
  it('tempToSeverity: calor 50°C → 5',            () => assert.strictEqual(tempToSeverity(50, true), 5))
  it('tempToSeverity: frio -20°C → 2 (limiar)',   () => assert.strictEqual(tempToSeverity(-20, false), 2))
  it('tempToSeverity: frio -30°C → 3',            () => assert.strictEqual(tempToSeverity(-30, false), 3))
  it('tempToSeverity: frio -35°C → 4',            () => assert.strictEqual(tempToSeverity(-35, false), 4))
  it('tempToSeverity: frio -40°C → 5',            () => assert.strictEqual(tempToSeverity(-40, false), 5))
})

// ── windToSeverity ─────────────────────────────────────────────────────────────

describe('windToSeverity', () => {
  it('windToSeverity: 28 m/s → 2 (limiar)',  () => assert.strictEqual(windToSeverity(28),  2))
  it('windToSeverity: 36 m/s → 3',           () => assert.strictEqual(windToSeverity(36),  3))
  it('windToSeverity: 44 m/s → 4',           () => assert.strictEqual(windToSeverity(44),  4))
  it('windToSeverity: 55 m/s → 5',           () => assert.strictEqual(windToSeverity(55),  5))
})

// ── precipToSeverity ───────────────────────────────────────────────────────────

describe('precipToSeverity', () => {
  it('precipToSeverity: 80 mm → 2 (limiar)',  () => assert.strictEqual(precipToSeverity(80),  2))
  it('precipToSeverity: 100 mm → 3',          () => assert.strictEqual(precipToSeverity(100), 3))
  it('precipToSeverity: 150 mm → 4',          () => assert.strictEqual(precipToSeverity(150), 4))
  it('precipToSeverity: 200 mm → 5',          () => assert.strictEqual(precipToSeverity(200), 5))
})

// ── forecastDayToEvents ────────────────────────────────────────────────────────

const POINT = { lat: -23.5, lng: -46.6 }

const DAILY_HEAT = {
  time:                  ['2024-01-15'],
  temperature_2m_max:    [45.0],
  temperature_2m_min:    [32.0],
  precipitation_sum:     [5.0],
  wind_gusts_10m_max:    [15.0],
}

const DAILY_FLOOD = {
  time:                  ['2024-01-15'],
  temperature_2m_max:    [25.0],
  temperature_2m_min:    [20.0],
  precipitation_sum:     [120.0],
  wind_gusts_10m_max:    [10.0],
}

const DAILY_WIND = {
  time:                  ['2024-01-15'],
  temperature_2m_max:    [20.0],
  temperature_2m_min:    [15.0],
  precipitation_sum:     [2.0],
  wind_gusts_10m_max:    [50.0],
}

const DAILY_NORMAL = {
  time:                  ['2024-01-15'],
  temperature_2m_max:    [22.0],
  temperature_2m_min:    [15.0],
  precipitation_sum:     [3.0],
  wind_gusts_10m_max:    [8.0],
}

describe('forecastDayToEvents', () => {
  it('forecastDayToEvents: temperatura 45°C → heat_wave', () => {
    const evs = forecastDayToEvents(POINT, DAILY_HEAT, 0)
    assert.ok(evs.some(e => e.type === 'heat_wave'), 'deve gerar heat_wave')
  })

  it('forecastDayToEvents: precipitação 120 mm → flood', () => {
    const evs = forecastDayToEvents(POINT, DAILY_FLOOD, 0)
    assert.ok(evs.some(e => e.type === 'flood'), 'deve gerar flood')
  })

  it('forecastDayToEvents: vento 50 m/s → severe_storm', () => {
    const evs = forecastDayToEvents(POINT, DAILY_WIND, 0)
    assert.ok(evs.some(e => e.type === 'severe_storm'), 'deve gerar severe_storm')
  })

  it('forecastDayToEvents: condições normais → nenhum evento', () => {
    const evs = forecastDayToEvents(POINT, DAILY_NORMAL, 0)
    assert.strictEqual(evs.length, 0)
  })

  it('forecastDayToEvents: id inclui coordenadas e data (estável)', () => {
    const evs = forecastDayToEvents(POINT, DAILY_HEAT, 0)
    const heat = evs.find(e => e.type === 'heat_wave')
    assert.ok(heat)
    assert.ok(heat.id.includes('-23.5'), 'id deve conter lat')
    assert.ok(heat.id.includes('-46.6'), 'id deve conter lng')
    assert.ok(heat.id.includes('2024-01-15'), 'id deve conter data')
  })

  it('forecastDayToEvents: source = "Open-Meteo"', () => {
    const evs = forecastDayToEvents(POINT, DAILY_HEAT, 0)
    assert.ok(evs.every(e => e.source === 'Open-Meteo'))
  })

  it('forecastDayToEvents: sem endTime', () => {
    const evs = forecastDayToEvents(POINT, DAILY_HEAT, 0)
    assert.ok(evs.every(e => e.endTime === undefined))
  })
})

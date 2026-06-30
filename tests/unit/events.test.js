import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  haversineKm,
  getDecayFactor,
  isEventExpired,
  calculateEventScore,
  analyzeRisk,
  EVENT_META,
  EVENT_LIFESPAN,
} from '../../public/js/events.js'
import { getMockEvents, EVENTO_EXPIRADO, EVENTO_TERREMOTO, EVENTO_FURACAO } from '../helpers/fixtures.js'

// ── haversineKm ───────────────────────────────────────────────────────────────

describe('haversineKm', () => {
  it('haversineKm: mesmo ponto → 0 km', () => {
    assert.strictEqual(haversineKm(0, 0, 0, 0), 0)
  })

  it('haversineKm: São Paulo → Rio de Janeiro ≈ 357 km', () => {
    const d = haversineKm(-23.55, -46.63, -22.91, -43.18)
    assert.ok(d > 340 && d < 380, `esperado ~357 km, obtido ${d.toFixed(0)} km`)
  })

  it('haversineKm: pólos opostos ≈ 20015 km (metade da circunferência)', () => {
    const d = haversineKm(90, 0, -90, 0)
    assert.ok(d > 19900 && d < 20100, `obtido ${d.toFixed(0)} km`)
  })
})

// ── getDecayFactor ────────────────────────────────────────────────────────────

describe('getDecayFactor', () => {
  it('getDecayFactor: elapsed=0 → 1.0 (sem decaimento)', () => {
    assert.strictEqual(getDecayFactor(0, 12), 1.0)
  })

  it('getDecayFactor: elapsed=halfLife → 0.5 (metade)', () => {
    assert.ok(Math.abs(getDecayFactor(12, 12) - 0.5) < 0.0001)
  })

  it('getDecayFactor: elapsed=2×halfLife → 0.25', () => {
    assert.ok(Math.abs(getDecayFactor(24, 12) - 0.25) < 0.0001)
  })

  it('getDecayFactor: elapsed negativo → 1.0', () => {
    assert.strictEqual(getDecayFactor(-5, 12), 1.0)
  })
})

// ── isEventExpired ────────────────────────────────────────────────────────────

describe('isEventExpired', () => {
  it('isEventExpired: evento recente → false', () => {
    assert.strictEqual(isEventExpired(EVENTO_TERREMOTO), false)
  })

  it('isEventExpired: evento além do maxAge → true', () => {
    assert.strictEqual(isEventExpired(EVENTO_EXPIRADO), true)
  })

  it('isEventExpired: endTime no passado → true', () => {
    const event = { ...EVENTO_TERREMOTO, endTime: new Date(Date.now() - 1000) }
    assert.strictEqual(isEventExpired(event), true)
  })

  it('isEventExpired: endTime no futuro → false', () => {
    const event = { ...EVENTO_TERREMOTO, endTime: new Date(Date.now() + 3_600_000) }
    assert.strictEqual(isEventExpired(event), false)
  })
})

// ── calculateEventScore ───────────────────────────────────────────────────────

describe('calculateEventScore', () => {
  it('calculateEventScore: evento no ponto exato → proximidade máxima', () => {
    const score = calculateEventScore(EVENTO_TERREMOTO, EVENTO_TERREMOTO.latitude, EVENTO_TERREMOTO.longitude)
    // severity=4 → 4*0.8=3.2; proximity=1 → 0.8; confidence=0.99 → 0.198; decay=1 → 0.1; total≈4.30
    assert.ok(score > 4.0, `score esperado >4.0, obtido ${score.toFixed(2)}`)
  })

  it('calculateEventScore: evento além do radiusKm → score=0', () => {
    const score = calculateEventScore(EVENTO_TERREMOTO, 80, 0, 1.0)
    // distância ~12.500 km >> radiusKm=200 → sem contribuição local
    assert.strictEqual(score, 0, `score fora do raio deve ser 0, obtido ${score.toFixed(2)}`)
  })

  it('calculateEventScore: score nunca negativo', () => {
    const score = calculateEventScore(EVENTO_TERREMOTO, 89, 179, 0)
    assert.ok(score >= 0)
  })
})

// ── analyzeRisk ───────────────────────────────────────────────────────────────

describe('analyzeRisk', () => {
  it('analyzeRisk: sem eventos → score=0, level=baixo', () => {
    const result = analyzeRisk(0, 0, [])
    assert.strictEqual(result.score, 0)
    assert.strictEqual(result.level, 'baixo')
    assert.strictEqual(result.eventCount, 0)
  })

  it('analyzeRisk: evento expirado não conta', () => {
    const result = analyzeRisk(0, 0, [EVENTO_EXPIRADO])
    assert.strictEqual(result.eventCount, 0)
  })

  it('analyzeRisk: nearbyEvents filtrados pelo radiusKm do evento', () => {
    // nearbyEvents agora retorna [{ event, distKm }] e filtra por event.radiusKm
    const result = analyzeRisk(-15.78, -47.93, [EVENTO_TERREMOTO, EVENTO_FURACAO])
    assert.ok(Array.isArray(result.nearbyEvents))
    assert.ok(result.nearbyEvents.length <= 8)
    // Cada item deve ter { event, distKm }
    for (const item of result.nearbyEvents) {
      assert.ok(item.event, 'deve ter .event')
      assert.ok(typeof item.distKm === 'number', 'deve ter .distKm numérico')
    }
  })

  it('analyzeRisk: nível aumenta com eventos críticos próximos', () => {
    // Analisar no mesmo ponto do furacão severo
    const result = analyzeRisk(EVENTO_FURACAO.latitude, EVENTO_FURACAO.longitude, getMockEvents())
    assert.ok(['moderado', 'alto', 'crítico'].includes(result.level),
      `esperado moderado/alto/crítico, obtido "${result.level}"`)
  })
})

// ── EVENT_META cobertura completa ─────────────────────────────────────────────

describe('EVENT_META', () => {
  const EXPECTED_TYPES = [
    'hurricane', 'tornado', 'severe_storm', 'heat_wave', 'cold_wave', 'flood', 'drought',
    'earthquake', 'volcano', 'tsunami',
    'wildfire', 'dust_storm', 'air_pollution',
    'solar_flare', 'cme', 'geomagnetic_storm', 'radiation_storm', 'radio_blackout',
  ]

  for (const type of EXPECTED_TYPES) {
    it(`EVENT_META['${type}'] existe com icon e color`, () => {
      assert.ok(EVENT_META[type], `tipo '${type}' ausente do EVENT_META`)
      assert.ok(EVENT_META[type].icon,  `icon ausente em EVENT_META['${type}']`)
      assert.ok(EVENT_META[type].color, `color ausente em EVENT_META['${type}']`)
    })
  }
})

// ── EVENT_LIFESPAN cobertura completa ─────────────────────────────────────────

describe('EVENT_LIFESPAN', () => {
  const EXPECTED_TYPES = [
    'hurricane', 'tornado', 'severe_storm', 'heat_wave', 'cold_wave', 'flood', 'drought',
    'earthquake', 'volcano', 'tsunami',
    'wildfire', 'dust_storm', 'air_pollution',
    'solar_flare', 'cme', 'geomagnetic_storm', 'radiation_storm', 'radio_blackout',
  ]

  for (const type of EXPECTED_TYPES) {
    it(`EVENT_LIFESPAN['${type}'] existe com [halfLife, maxAge]`, () => {
      assert.ok(EVENT_LIFESPAN[type], `tipo '${type}' ausente do EVENT_LIFESPAN`)
      assert.strictEqual(EVENT_LIFESPAN[type].length, 2)
      assert.ok(EVENT_LIFESPAN[type][0] > 0, 'halfLife deve ser positivo')
      assert.ok(EVENT_LIFESPAN[type][1] > EVENT_LIFESPAN[type][0], 'maxAge deve ser maior que halfLife')
    })
  }
})

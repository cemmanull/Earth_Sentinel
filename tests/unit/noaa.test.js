import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  GEO_ANCHORS,
  parseAlertType,
  codeToSeverity,
  kpToSeverity,
  classifyXRay,
  kpToStormLevel,
  alertToEvent,
} from '../../public/js/api/noaa.js'

// ── parseAlertType ────────────────────────────────────────────────────────────

describe('parseAlertType', () => {
  it('parseAlertType: ALTEF3 → radiation_storm',     () => assert.strictEqual(parseAlertType('ALTEF3'),     'radiation_storm'))
  it('parseAlertType: ALTTP5 → radio_blackout',      () => assert.strictEqual(parseAlertType('ALTTP5'),     'radio_blackout'))
  it('parseAlertType: ALTK7 → geomagnetic_storm',    () => assert.strictEqual(parseAlertType('ALTK7'),      'geomagnetic_storm'))
  it('parseAlertType: ALTG5 → geomagnetic_storm',    () => assert.strictEqual(parseAlertType('ALTG5'),      'geomagnetic_storm'))
  it('parseAlertType: WATA20 → geomagnetic_storm',   () => assert.strictEqual(parseAlertType('WATA20'),     'geomagnetic_storm'))
  it('parseAlertType: ALTXMF → solar_flare',         () => assert.strictEqual(parseAlertType('ALTXMF'),     'solar_flare'))
  it('parseAlertType: ALTXRF → solar_flare',         () => assert.strictEqual(parseAlertType('ALTXRF'),     'solar_flare'))
  it('parseAlertType: null → null',                  () => assert.strictEqual(parseAlertType(null),         null))
  it('parseAlertType: código desconhecido → null',   () => assert.strictEqual(parseAlertType('SUMXXX'),     null))
})

// ── codeToSeverity ────────────────────────────────────────────────────────────

describe('codeToSeverity', () => {
  it('codeToSeverity: ALTEF3 → 3', () => assert.strictEqual(codeToSeverity('ALTEF3'), 3))
  it('codeToSeverity: ALTG5 → 5',  () => assert.strictEqual(codeToSeverity('ALTG5'),  5))
  it('codeToSeverity: sem número → 2 (default)',  () => assert.strictEqual(codeToSeverity('ALTXMF'), 2))
  it('codeToSeverity: clampado em 5',  () => assert.strictEqual(codeToSeverity('ALTEF9'), 5))
})

// ── kpToSeverity ──────────────────────────────────────────────────────────────

describe('kpToSeverity', () => {
  it('kpToSeverity: kp=0 → 1', () => assert.strictEqual(kpToSeverity(0), 1))
  it('kpToSeverity: kp=4 → 1', () => assert.strictEqual(kpToSeverity(4), 1))
  it('kpToSeverity: kp=5 → 2', () => assert.strictEqual(kpToSeverity(5), 2))
  it('kpToSeverity: kp=6 → 3', () => assert.strictEqual(kpToSeverity(6), 3))
  it('kpToSeverity: kp=7 → 4', () => assert.strictEqual(kpToSeverity(7), 4))
  it('kpToSeverity: kp=8 → 5', () => assert.strictEqual(kpToSeverity(8), 5))
  it('kpToSeverity: kp=9 → 5', () => assert.strictEqual(kpToSeverity(9), 5))
})

// ── classifyXRay ──────────────────────────────────────────────────────────────

describe('classifyXRay', () => {
  it('classifyXRay: 5e-8 → A, severity 1', () => {
    const r = classifyXRay(5e-8); assert.strictEqual(r.cls, 'A'); assert.strictEqual(r.severity, 1)
  })
  it('classifyXRay: 5e-7 → B, severity 2', () => {
    const r = classifyXRay(5e-7); assert.strictEqual(r.cls, 'B'); assert.strictEqual(r.severity, 2)
  })
  it('classifyXRay: 5e-6 → C, severity 3', () => {
    const r = classifyXRay(5e-6); assert.strictEqual(r.cls, 'C'); assert.strictEqual(r.severity, 3)
  })
  it('classifyXRay: 5e-5 → M, severity 4', () => {
    const r = classifyXRay(5e-5); assert.strictEqual(r.cls, 'M'); assert.strictEqual(r.severity, 4)
  })
  it('classifyXRay: 2e-3 → X, severity 5', () => {
    const r = classifyXRay(2e-3); assert.strictEqual(r.cls, 'X'); assert.strictEqual(r.severity, 5)
  })
  it('classifyXRay: flux=0 → A, severity 1', () => {
    const r = classifyXRay(0); assert.strictEqual(r.cls, 'A'); assert.strictEqual(r.severity, 1)
  })
})

// ── GEO_ANCHORS ───────────────────────────────────────────────────────────────

describe('GEO_ANCHORS', () => {
  it('GEO_ANCHORS: 8 pontos aurorais', () => assert.strictEqual(GEO_ANCHORS.length, 8))

  it('GEO_ANCHORS: todos têm lat/lng válidos', () => {
    for (const a of GEO_ANCHORS) {
      assert.ok(typeof a.lat === 'number' && Math.abs(a.lat) <= 90,  `lat inválido: ${a.lat}`)
      assert.ok(typeof a.lng === 'number' && Math.abs(a.lng) <= 180, `lng inválido: ${a.lng}`)
    }
  })

  it('GEO_ANCHORS: nenhum ponto em 0,0 (never in equator/prime meridian)', () => {
    for (const a of GEO_ANCHORS) {
      assert.ok(!(a.lat === 0 && a.lng === 0), 'ponto em 0,0 não é auroral')
    }
  })

  it('GEO_ANCHORS: cobertura de ambos os hemisférios', () => {
    const hasNorth = GEO_ANCHORS.some(a => a.lat > 0)
    const hasSouth = GEO_ANCHORS.some(a => a.lat < 0)
    assert.ok(hasNorth, 'deve ter pontos no hemisfério norte')
    assert.ok(hasSouth, 'deve ter pontos no hemisfério sul')
  })
})

// ── alertToEvent ──────────────────────────────────────────────────────────────

describe('alertToEvent', () => {
  const mockAlert = {
    product_id:     'ALTK7',
    issue_datetime: '2024-01-15 12:00:00.000',
    message:        'Space Weather Message Code: ALTK7\nGeomagnetic Storm Level Kp=7',
  }

  it('alertToEvent: ALTK7 → geomagnetic_storm severity 7 (clampado a 5)', () => {
    const e = alertToEvent(mockAlert, 0)
    assert.ok(e)
    assert.strictEqual(e.type,     'geomagnetic_storm')
    assert.strictEqual(e.source,   'NOAA SWPC')
    assert.strictEqual(e.severity, 5)   // "7" → clampado a 5
  })

  it('alertToEvent: usa âncora correta pelo índice', () => {
    const e0 = alertToEvent(mockAlert, 0)
    const e2 = alertToEvent(mockAlert, 2)
    assert.deepStrictEqual({ lat: e0.latitude, lng: e0.longitude }, GEO_ANCHORS[0])
    assert.deepStrictEqual({ lat: e2.latitude, lng: e2.longitude }, GEO_ANCHORS[2])
  })

  it('alertToEvent: product_id sem tipo mapeado → null', () => {
    const bad = { ...mockAlert, product_id: 'SUMXXX' }
    assert.strictEqual(alertToEvent(bad, 0), null)
  })

  it('alertToEvent: radiusKm global (20000)', () => {
    const e = alertToEvent(mockAlert, 0)
    assert.ok(e)
    assert.strictEqual(e.radiusKm, 20000)
  })
})

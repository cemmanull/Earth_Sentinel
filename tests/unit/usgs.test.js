import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { magnitudeToSeverity, featureToEvent } from '../../public/js/api/usgs.js'
import { FEATURE_USGS_M6, FEATURE_USGS_M8, FEATURE_USGS_M3 } from '../helpers/fixtures.js'

// ── magnitudeToSeverity ───────────────────────────────────────────────────────

describe('magnitudeToSeverity', () => {
  it('magnitudeToSeverity: M4.5 → severity 1', () => assert.strictEqual(magnitudeToSeverity(4.5), 1))
  it('magnitudeToSeverity: M5.0 → severity 2', () => assert.strictEqual(magnitudeToSeverity(5.0), 2))
  it('magnitudeToSeverity: M5.9 → severity 2', () => assert.strictEqual(magnitudeToSeverity(5.9), 2))
  it('magnitudeToSeverity: M6.0 → severity 3', () => assert.strictEqual(magnitudeToSeverity(6.0), 3))
  it('magnitudeToSeverity: M7.0 → severity 4', () => assert.strictEqual(magnitudeToSeverity(7.0), 4))
  it('magnitudeToSeverity: M8.0 → severity 5', () => assert.strictEqual(magnitudeToSeverity(8.0), 5))
  it('magnitudeToSeverity: M9.1 → severity 5', () => assert.strictEqual(magnitudeToSeverity(9.1), 5))
})

// ── featureToEvent ────────────────────────────────────────────────────────────

describe('featureToEvent', () => {
  it('featureToEvent: feature M6.2 → evento válido com campos corretos', () => {
    const event = featureToEvent(FEATURE_USGS_M6)
    assert.ok(event, 'deve retornar um evento')
    assert.strictEqual(event.id,       'usgs-us2024abc123')
    assert.strictEqual(event.type,     'earthquake')
    assert.strictEqual(event.category, 'geológico')
    assert.strictEqual(event.severity, 3)          // M6.2 → sev 3
    assert.strictEqual(event.confidence, 0.99)
    assert.strictEqual(event.latitude,  -33.9)     // lat do GeoJSON (índice 1)
    assert.strictEqual(event.longitude, -70.6)     // lng do GeoJSON (índice 0)
    assert.ok(event.startTime instanceof Date)
    assert.strictEqual(event.source, 'USGS')
  })

  it('featureToEvent: feature M8.1 → severity 5', () => {
    const event = featureToEvent(FEATURE_USGS_M8)
    assert.ok(event)
    assert.strictEqual(event.severity, 5)
    assert.strictEqual(event.radiusKm, 500)        // M≥7 → 500 km
  })

  it('featureToEvent: feature M3.1 → retorna null (abaixo do limiar M4.5)', () => {
    assert.strictEqual(featureToEvent(FEATURE_USGS_M3), null)
  })

  it('featureToEvent: sem geometry → retorna null', () => {
    const bad = { ...FEATURE_USGS_M6, geometry: null }
    assert.strictEqual(featureToEvent(bad), null)
  })

  it('featureToEvent: sem properties → retorna null', () => {
    const bad = { ...FEATURE_USGS_M6, properties: null }
    assert.strictEqual(featureToEvent(bad), null)
  })

  it('featureToEvent: id estável — mesmo feature → mesmo id', () => {
    const a = featureToEvent(FEATURE_USGS_M6)
    const b = featureToEvent(FEATURE_USGS_M6)
    assert.strictEqual(a.id, b.id)
  })

  it('featureToEvent: title truncado em 80 chars', () => {
    const feature = {
      ...FEATURE_USGS_M6,
      properties: { ...FEATURE_USGS_M6.properties, title: 'A'.repeat(100) },
    }
    const event = featureToEvent(feature)
    assert.ok(event)
    assert.ok(event.title.length <= 80, `title tem ${event.title.length} chars`)
  })
})

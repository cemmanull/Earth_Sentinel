import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { contentItemToEvent } from '../../public/js/shared/api-client.js'

describe('contentItemToEvent', () => {
  const baseItem = {
    id: 'usgs-abc123',
    theme_id: 'extreme-events',
    type: 'earthquake',
    source_id: 'usgs',
    title: 'M5.2 - 10km W of Somewhere',
    description: 'Magnitude 5.2, profundidade 12 km.',
    published_at: '2026-06-10T12:00:00Z',
    geo: { lat: -23.5, lng: -46.6, radius_km: 250 },
    severity: 2,
    confidence: 0.99,
    metadata: { mag: 5.2, depth: 12 },
    tags: ['earthquake'],
  }

  it('maps nested geo to flat lat/lng/radiusKm', () => {
    const ev = contentItemToEvent(baseItem)
    assert.equal(ev.latitude, -23.5)
    assert.equal(ev.longitude, -46.6)
    assert.equal(ev.radiusKm, 250)
  })

  it('preserves identity, type and severity', () => {
    const ev = contentItemToEvent(baseItem)
    assert.equal(ev.id, 'usgs-abc123')
    assert.equal(ev.type, 'earthquake')
    assert.equal(ev.severity, 2)
    assert.equal(ev.source, 'usgs')
  })

  it('parses published_at into a Date (startTime)', () => {
    const ev = contentItemToEvent(baseItem)
    assert.ok(ev.startTime instanceof Date)
    assert.equal(ev.startTime.toISOString(), '2026-06-10T12:00:00.000Z')
  })

  it('maps expires_at to endTime when present, undefined otherwise', () => {
    assert.equal(contentItemToEvent(baseItem).endTime, undefined)
    const withExpiry = { ...baseItem, expires_at: '2026-06-11T00:00:00Z' }
    const ev = contentItemToEvent(withExpiry)
    assert.ok(ev.endTime instanceof Date)
    assert.equal(ev.endTime.toISOString(), '2026-06-11T00:00:00.000Z')
  })

  it('defaults severity to 1 and radiusKm to 300 when geo/severity absent', () => {
    const noGeo = {
      id: 'finance-aapl',
      type: 'price_update',
      source_id: 'stooq',
      title: 'AAPL',
      published_at: '2026-06-10T12:00:00Z',
    }
    const ev = contentItemToEvent(noGeo)
    assert.equal(ev.latitude, undefined)
    assert.equal(ev.longitude, undefined)
    assert.equal(ev.radiusKm, 300)
    assert.equal(ev.severity, 1)
  })

  it('never throws on missing optional fields', () => {
    const minimal = { id: 'x', type: 't', source_id: 's', published_at: '2026-06-10T12:00:00Z' }
    const ev = contentItemToEvent(minimal)
    assert.equal(ev.title, '')
    assert.equal(ev.description, '')
    assert.deepEqual(ev.metadata, {})
  })
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  eonetCategoryToType,
  eonetToEvent,
} from '../../public/js/api/eonet.js'

// ── eonetCategoryToType ───────────────────────────────────────────────────────

describe('eonetCategoryToType', () => {
  it('eonetCategoryToType: wildfires → wildfire',       () => assert.strictEqual(eonetCategoryToType([{ id: 'wildfires' }]),    'wildfire'))
  it('eonetCategoryToType: severeStorms → severe_storm',() => assert.strictEqual(eonetCategoryToType([{ id: 'severeStorms' }]), 'severe_storm'))
  it('eonetCategoryToType: volcanoes → volcano',        () => assert.strictEqual(eonetCategoryToType([{ id: 'volcanoes' }]),    'volcano'))
  it('eonetCategoryToType: earthquakes → earthquake',   () => assert.strictEqual(eonetCategoryToType([{ id: 'earthquakes' }]),  'earthquake'))
  it('eonetCategoryToType: floods → flood',             () => assert.strictEqual(eonetCategoryToType([{ id: 'floods' }]),       'flood'))
  it('eonetCategoryToType: drought → drought',          () => assert.strictEqual(eonetCategoryToType([{ id: 'drought' }]),      'drought'))
  it('eonetCategoryToType: dustHaze → dust_storm',      () => assert.strictEqual(eonetCategoryToType([{ id: 'dustHaze' }]),     'dust_storm'))
  it('eonetCategoryToType: categoria desconhecida → null', () => assert.strictEqual(eonetCategoryToType([{ id: 'waterColor' }]), null))
  it('eonetCategoryToType: array vazio → null',         () => assert.strictEqual(eonetCategoryToType([]),                      null))
  it('eonetCategoryToType: null → null',                () => assert.strictEqual(eonetCategoryToType(null),                    null))
})

// ── eonetToEvent ──────────────────────────────────────────────────────────────

const EONET_WILDFIRE = {
  id:          'EONET_6052',
  title:       'Wildfire - Oregon',
  description: 'Active wildfire in Central Oregon',
  categories:  [{ id: 'wildfires', title: 'Wildfires' }],
  sources:     [{ id: 'PDC', url: 'https://example.com/1' }],
  geometry: [
    { date: '2024-07-10T00:00:00Z', type: 'Point', coordinates: [-120.5, 43.2] },
    { date: '2024-07-12T00:00:00Z', type: 'Point', coordinates: [-120.8, 43.5] },
  ],
}

const EONET_VOLCANO = {
  id:          'EONET_9001',
  title:       'Kilauea Volcano - Hawaii',
  description: null,
  categories:  [{ id: 'volcanoes', title: 'Volcanoes' }],
  sources:     [],
  geometry: [
    { date: '2024-01-01T00:00:00Z', type: 'Point', coordinates: [-155.3, 19.4] },
  ],
}

const EONET_UNKNOWN_CAT = {
  id:         'EONET_1234',
  title:      'Water Discoloration',
  categories: [{ id: 'waterColor', title: 'Water Color' }],
  geometry:   [{ date: '2024-01-01T00:00:00Z', type: 'Point', coordinates: [0, 0] }],
}

describe('eonetToEvent', () => {
  it('eonetToEvent: wildfire → evento wildfire válido', () => {
    const e = eonetToEvent(EONET_WILDFIRE)
    assert.ok(e, 'deve retornar evento')
    assert.strictEqual(e.id,       'eonet-EONET_6052')
    assert.strictEqual(e.type,     'wildfire')
    assert.strictEqual(e.category, 'atmosférico')
    assert.strictEqual(e.source,   'NASA EONET')
    assert.strictEqual(e.confidence, 0.75)
  })

  it('eonetToEvent: usa geometry mais recente (último elemento)', () => {
    const e = eonetToEvent(EONET_WILDFIRE)
    assert.ok(e)
    assert.strictEqual(e.latitude,   43.5)    // último ponto
    assert.strictEqual(e.longitude, -120.8)
  })

  it('eonetToEvent: startTime do geometry mais recente', () => {
    const e = eonetToEvent(EONET_WILDFIRE)
    assert.ok(e)
    assert.strictEqual(e.startTime.toISOString().slice(0, 10), '2024-07-12')
  })

  it('eonetToEvent: sem endTime (EONET — sem expiração formal)', () => {
    const e = eonetToEvent(EONET_WILDFIRE)
    assert.ok(e)
    assert.strictEqual(e.endTime, undefined)
  })

  it('eonetToEvent: id estável entre chamadas', () => {
    assert.strictEqual(eonetToEvent(EONET_WILDFIRE).id, eonetToEvent(EONET_WILDFIRE).id)
  })

  it('eonetToEvent: volcano com description null usa title', () => {
    const e = eonetToEvent(EONET_VOLCANO)
    assert.ok(e)
    assert.strictEqual(e.type, 'volcano')
    assert.ok(e.description.length > 0, 'description não deve ser vazia')
  })

  it('eonetToEvent: categoria desconhecida (waterColor) → null', () => {
    assert.strictEqual(eonetToEvent(EONET_UNKNOWN_CAT), null)
  })

  it('eonetToEvent: geometry vazia → null', () => {
    const bad = { ...EONET_WILDFIRE, geometry: [] }
    assert.strictEqual(eonetToEvent(bad), null)
  })

  it('eonetToEvent: sem id → null', () => {
    const bad = { ...EONET_WILDFIRE, id: undefined }
    assert.strictEqual(eonetToEvent(bad), null)
  })

  it('eonetToEvent: radiusKm 150', () => {
    const e = eonetToEvent(EONET_WILDFIRE)
    assert.ok(e)
    assert.strictEqual(e.radiusKm, 150)
  })
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { alertLevelToSeverity, parseGdacsDate, gdacsToEvent } from '../../public/js/api/gdacs.js'

// ── alertLevelToSeverity ──────────────────────────────────────────────────────

describe('alertLevelToSeverity', () => {
  it('alertLevelToSeverity: "Red" → 5',    () => assert.strictEqual(alertLevelToSeverity('Red'),    5))
  it('alertLevelToSeverity: "Orange" → 3', () => assert.strictEqual(alertLevelToSeverity('Orange'), 3))
  it('alertLevelToSeverity: "Green" → 1',  () => assert.strictEqual(alertLevelToSeverity('Green'),  1))
  it('alertLevelToSeverity: case insensitive "RED" → 5', () => assert.strictEqual(alertLevelToSeverity('RED'), 5))
  it('alertLevelToSeverity: undefined → 1 (default)',    () => assert.strictEqual(alertLevelToSeverity(undefined), 1))
})

// ── parseGdacsDate ────────────────────────────────────────────────────────────

describe('parseGdacsDate', () => {
  it('parseGdacsDate: ISO string válida → Date', () => {
    const d = parseGdacsDate('2024-01-15T12:00:00')
    assert.ok(d instanceof Date)
    assert.ok(!isNaN(d.getTime()))
  })

  it('parseGdacsDate: null → null', () => {
    assert.strictEqual(parseGdacsDate(null), null)
  })

  it('parseGdacsDate: string inválida → null', () => {
    assert.strictEqual(parseGdacsDate('not-a-date'), null)
  })
})

// ── gdacsToEvent ──────────────────────────────────────────────────────────────

const GDACS_EQ_RED = {
  type: 'Feature',
  properties: {
    eventtype:         'EQ',
    eventid:           1234567,
    episodeid:         7654321,
    alertlevel:        'Orange',
    episodealertlevel: 'Red',
    name:              'M 6.5 Earthquake',
    country:           'Japan',
    fromdate:          '2024-01-01T00:00:00',
    todate:            '2024-01-02T00:00:00',
  },
  geometry: { type: 'Point', coordinates: [142.0, 38.0] },
}

const GDACS_TC_ORANGE = {
  type: 'Feature',
  properties: {
    eventtype:         'TC',
    eventid:           9999,
    episodeid:         8888,
    alertlevel:        'Red',
    episodealertlevel: 'Orange',
    name:              'Tropical Cyclone HAL',
    country:           'Australia',
    fromdate:          '2024-01-10T00:00:00',
    todate:            '2024-01-12T00:00:00',
  },
  geometry: { type: 'Point', coordinates: [150.0, -15.0] },
}

describe('gdacsToEvent', () => {
  it('gdacsToEvent: EQ Red → earthquake severity 5', () => {
    const event = gdacsToEvent(GDACS_EQ_RED)
    assert.ok(event, 'deve retornar evento')
    assert.strictEqual(event.id,       'gdacs-EQ-1234567')
    assert.strictEqual(event.type,     'earthquake')
    assert.strictEqual(event.category, 'geológico')
    assert.strictEqual(event.severity, 5)   // episodealertlevel=Red → 5
    assert.strictEqual(event.latitude,   38.0)
    assert.strictEqual(event.longitude, 142.0)
    assert.strictEqual(event.source,   'GDACS')
    assert.strictEqual(event.confidence, 0.90)
  })

  it('gdacsToEvent: TC Orange usa episodealertlevel (não alertlevel)', () => {
    const event = gdacsToEvent(GDACS_TC_ORANGE)
    assert.ok(event)
    assert.strictEqual(event.type,     'hurricane')
    assert.strictEqual(event.severity, 3)   // episodealertlevel=Orange → 3 (não Red→5)
  })

  it('gdacsToEvent: startTime = max(fromdate, todate)', () => {
    const event = gdacsToEvent(GDACS_EQ_RED)
    assert.ok(event)
    // todate (Jan 2) > fromdate (Jan 1) → startTime = todate
    assert.strictEqual(event.startTime.toISOString().slice(0, 10), '2024-01-02')
  })

  it('gdacsToEvent: sem endTime (GDACS encerra antes do risco real)', () => {
    const event = gdacsToEvent(GDACS_EQ_RED)
    assert.ok(event)
    assert.strictEqual(event.endTime, undefined)
  })

  it('gdacsToEvent: tipo desconhecido → null', () => {
    const bad = { ...GDACS_EQ_RED, properties: { ...GDACS_EQ_RED.properties, eventtype: 'XX' } }
    assert.strictEqual(gdacsToEvent(bad), null)
  })

  it('gdacsToEvent: sem geometry → null', () => {
    const bad = { ...GDACS_EQ_RED, geometry: null }
    assert.strictEqual(gdacsToEvent(bad), null)
  })

  it('gdacsToEvent: id estável entre chamadas', () => {
    assert.strictEqual(gdacsToEvent(GDACS_EQ_RED).id, gdacsToEvent(GDACS_EQ_RED).id)
  })
})

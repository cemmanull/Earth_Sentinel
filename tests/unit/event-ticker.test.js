import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildTickerHTML } from '../../public/js/shared/components/event-ticker.js'

describe('buildTickerHTML', () => {
  const items = [
    { icon: '🌍', text: 'M6.1 terremoto', source: 'usgs' },
    { icon: '🔥', text: 'Incêndio florestal', source: 'eonet' },
  ]

  it('duplica a lista para o loop de marquee', () => {
    const html = buildTickerHTML(items)
    const count = (html.match(/class="ticker-item"/g) ?? []).length
    assert.equal(count, items.length * 2)
  })

  it('escapa HTML em icon, text e source', () => {
    const html = buildTickerHTML([{ icon: '<b>', text: '<script>alert(1)</script>', source: '"x"' }])
    assert.ok(!html.includes('<script>'))
    assert.ok(html.includes('&lt;script&gt;'))
    assert.ok(html.includes('&lt;b&gt;'))
    assert.ok(html.includes('&quot;x&quot;'))
  })

  it('lista vazia ou inválida produz string vazia', () => {
    assert.equal(buildTickerHTML([]), '')
    assert.equal(buildTickerHTML(null), '')
    assert.equal(buildTickerHTML(undefined), '')
  })

  it('campos ausentes não quebram', () => {
    const html = buildTickerHTML([{}])
    assert.ok(html.includes('ticker-item'))
  })
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ThemeFeedController } from '../../public/js/shared/feed-controller.js'

describe('ThemeFeedController', () => {
  it('refresh com sucesso atualiza items, lastUpdate e error null', async () => {
    const c = new ThemeFeedController({ fetcher: async () => [1, 2, 3] })
    const result = await c.refresh()
    assert.deepEqual(result.items, [1, 2, 3])
    assert.equal(result.error, null)
    assert.ok(result.lastUpdate instanceof Date)
    assert.deepEqual(c.items, [1, 2, 3])
  })

  it('refresh com falha preserva items anteriores e expõe o erro', async () => {
    let fail = false
    const c = new ThemeFeedController({
      fetcher: async () => {
        if (fail) throw new Error('boom')
        return ['a']
      },
    })
    await c.refresh()
    fail = true
    const result = await c.refresh()
    assert.deepEqual(result.items, ['a'])
    assert.equal(result.error.message, 'boom')
    assert.deepEqual(c.items, ['a'])
  })

  it('resultado não-array vira lista vazia', async () => {
    const c = new ThemeFeedController({ fetcher: async () => null })
    const result = await c.refresh()
    assert.deepEqual(result.items, [])
    assert.equal(result.error, null)
  })

  it('subscribe notifica a cada refresh; unsubscribe interrompe', async () => {
    const calls = []
    const c = new ThemeFeedController({ fetcher: async () => ['x'] })
    const unsubscribe = c.subscribe(p => calls.push(p))
    await c.refresh()
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].items, ['x'])
    unsubscribe()
    await c.refresh()
    assert.equal(calls.length, 1)
  })

  it('subscriber que lança não derruba os demais', async () => {
    const calls = []
    const c = new ThemeFeedController({ fetcher: async () => [] })
    c.subscribe(() => { throw new Error('subscriber ruim') })
    c.subscribe(p => calls.push(p))
    await c.refresh()
    assert.equal(calls.length, 1)
  })

  it('start dispara refresh imediato; segundo start não duplica; stop idempotente', async () => {
    let count = 0
    const c = new ThemeFeedController({
      fetcher: async () => { count++; return [] },
      intervalMs: 3_600_000,
    })
    c.start()
    assert.equal(count, 1)   // imediato, sem esperar o timer
    c.start()
    assert.equal(count, 1)   // start repetido é no-op
    c.stop()
    c.stop()                 // não lança
    await new Promise(r => setTimeout(r, 10))  // deixa a microtask do refresh terminar
  })

  it('fetcher inválido lança TypeError na construção', () => {
    assert.throws(() => new ThemeFeedController({ fetcher: null }), TypeError)
    assert.throws(() => new ThemeFeedController({}), TypeError)
  })
})

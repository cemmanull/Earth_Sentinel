/**
 * Testes de integração — requer `npm start` rodando em http://localhost:3000
 * Executar com: npm run test:int
 */
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'

const BASE = 'http://localhost:3000'

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(5000) })
  return res
}

// ── Saúde do servidor ─────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('/api/health → 200 com { status: "ok" }', async () => {
    const res  = await get('/api/health')
    const body = await res.json()
    assert.strictEqual(res.status, 200)
    assert.strictEqual(body.status, 'ok')
  })
})

// ── Arquivos estáticos ────────────────────────────────────────────────────────

describe('Arquivos estáticos JS', () => {
  const JS_FILES = [
    '/js/app.js',
    '/js/map.js',
    '/js/globe.js',
    '/js/events.js',
    '/js/sources.js',
    '/js/api/utils.js',
    '/js/api/usgs.js',
  ]

  for (const file of JS_FILES) {
    it(`GET ${file} → 200`, async () => {
      const res = await get(file)
      assert.strictEqual(res.status, 200, `${file} não encontrado`)
    })
  }
})

describe('Arquivos estáticos CSS', () => {
  const CSS_FILES = ['/css/base.css', '/css/layout.css', '/css/panels.css', '/css/loader.css', '/css/risk-panel.css']

  for (const file of CSS_FILES) {
    it(`GET ${file} → 200`, async () => {
      const res = await get(file)
      assert.strictEqual(res.status, 200, `${file} não encontrado`)
    })
  }
})

describe('index.html', () => {
  it('GET / → 200 HTML com charset utf-8', async () => {
    const res  = await get('/')
    const body = await res.text()
    assert.strictEqual(res.status, 200)
    assert.ok(body.includes('<html'), 'resposta deve conter HTML')
    assert.ok(body.includes('utf-8'), 'deve declarar charset utf-8')
  })
})

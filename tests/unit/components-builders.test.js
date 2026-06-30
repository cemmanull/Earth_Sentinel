// components-builders.test.js — testes das funções puras exportadas pelos componentes.
// Roda em Node SEM DOM (node:test + assert/strict).
// buildCardHTML é função pura — não acessa document/customElements.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCardHTML } from '../../public/js/shared/components/content-card.js';

// ── buildCardHTML — estrutura básica ─────────────────────────────────────────

describe('buildCardHTML', () => {

  it('retorna string não vazia', () => {
    const html = buildCardHTML({ type: 'earthquake', title: 'Teste' });
    assert.strictEqual(typeof html, 'string');
    assert.ok(html.length > 0, 'HTML não deve estar vazio');
  });

  it('inclui o título escapado corretamente', () => {
    const html = buildCardHTML({ type: 'earthquake', title: 'Terremoto M6.7' });
    assert.ok(html.includes('Terremoto M6.7'), 'título deve estar presente no HTML');
  });

  // ── XSS / escapeHtml ─────────────────────────────────────────────────────

  it('escapa título com tag <script> (XSS prevention)', () => {
    const html = buildCardHTML({ title: '<script>alert(1)</script>' });
    assert.ok(!html.includes('<script>'),
      'tag <script> não deve aparecer crua no HTML');
    assert.ok(html.includes('&lt;script&gt;'),
      'deve conter versão escapada &lt;script&gt;');
  });

  it('escapa aspas duplas no título', () => {
    const html = buildCardHTML({ title: 'A "quoted" title' });
    assert.ok(!html.includes('"quoted"') || html.includes('&quot;quoted&quot;'),
      'aspas devem ser escapadas');
  });

  it('escapa & no título', () => {
    const html = buildCardHTML({ title: 'Fire & Flood' });
    assert.ok(html.includes('&amp;') || !html.includes(' & '),
      '& deve ser escapado como &amp;');
  });

  it('escapa descrição com payload XSS', () => {
    const html = buildCardHTML({
      title: 'T',
      desc: '<img src=x onerror=alert(1)>',
    });
    assert.ok(!html.includes('<img'),
      '<img> não deve aparecer cru na descrição');
  });

  it('escapa meta com payload XSS', () => {
    const html = buildCardHTML({
      title: 'T',
      meta: '<b>bold</b>',
    });
    assert.ok(!html.includes('<b>'),
      '<b> não deve aparecer cru no meta');
  });

  // ── Badge ─────────────────────────────────────────────────────────────────

  it('badge presente quando fornecido', () => {
    const html = buildCardHTML({ title: 'T', badge: '45 km' });
    assert.ok(html.includes('45 km'), 'badge deve aparecer no HTML');
    assert.ok(html.includes('card__badge'), 'deve usar classe card__badge');
  });

  it('badge ausente quando null', () => {
    const html = buildCardHTML({ title: 'T', badge: null });
    assert.ok(!html.includes('card__badge'), 'card__badge não deve aparecer quando badge é null');
  });

  it('badge ausente quando undefined', () => {
    const html = buildCardHTML({ title: 'T' });
    assert.ok(!html.includes('card__badge'), 'card__badge não deve aparecer quando badge é undefined');
  });

  it('badge é escapado (XSS)', () => {
    const html = buildCardHTML({ title: 'T', badge: '<script>x</script>' });
    assert.ok(!html.includes('<script>'), 'badge com XSS deve ser escapado');
  });

  // ── Severity ──────────────────────────────────────────────────────────────

  it('severity-indicator presente quando severity fornecido', () => {
    const html = buildCardHTML({ title: 'T', severity: 3 });
    assert.ok(html.includes('severity-indicator'),
      'deve renderizar <severity-indicator> quando severity está presente');
    assert.ok(html.includes('value="3"'),
      'deve ter value="3"');
  });

  it('severity-indicator ausente quando severity é null', () => {
    const html = buildCardHTML({ title: 'T', severity: null });
    assert.ok(!html.includes('severity-indicator'),
      'severity-indicator não deve aparecer quando severity é null');
  });

  it('severity-indicator ausente quando severity é undefined', () => {
    const html = buildCardHTML({ title: 'T' });
    assert.ok(!html.includes('severity-indicator'),
      'severity-indicator não deve aparecer quando severity é undefined');
  });

  // ── Desc ──────────────────────────────────────────────────────────────────

  it('descrição presente quando fornecida', () => {
    const html = buildCardHTML({ title: 'T', desc: 'Uma descrição de teste.' });
    assert.ok(html.includes('Uma descrição de teste.'), 'desc deve aparecer no HTML');
    assert.ok(html.includes('card__desc'), 'deve usar classe card__desc');
  });

  it('bloco de desc ausente quando desc não fornecido', () => {
    const html = buildCardHTML({ title: 'T' });
    assert.ok(!html.includes('card__desc'), 'card__desc não deve aparecer sem desc');
  });

  // ── type-badge ────────────────────────────────────────────────────────────

  it('inclui <type-badge> com o type correto', () => {
    const html = buildCardHTML({ type: 'volcano', title: 'T' });
    assert.ok(html.includes('type-badge'), 'deve incluir elemento type-badge');
    assert.ok(html.includes('type="volcano"'), 'type deve ser passado como atributo');
  });

  it('escapa o type no atributo', () => {
    const html = buildCardHTML({ type: 'x"><script>', title: 'T' });
    assert.ok(!html.includes('<script>'), 'type injetável deve ser escapado');
  });

  // ── data null / vazio ─────────────────────────────────────────────────────

  it('não lança com data null', () => {
    assert.doesNotThrow(() => buildCardHTML(null));
  });

  it('não lança com data undefined', () => {
    assert.doesNotThrow(() => buildCardHTML(undefined));
  });

  it('não lança com objeto vazio', () => {
    assert.doesNotThrow(() => buildCardHTML({}));
  });
});

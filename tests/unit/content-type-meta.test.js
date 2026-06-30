// content-type-meta.test.js — testes de completude e sanidade de CONTENT_TYPE_META.
// Roda em Node sem DOM (node:test + assert/strict).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_TYPE_META,
  THEME_TYPES,
  getTypeMeta,
} from '../../public/js/shared/content-type-meta.js';

// ── Hex color helper ──────────────────────────────────────────────────────────
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function isHexColor(str) {
  return HEX_RE.test(str);
}

// ── Completude por tema ───────────────────────────────────────────────────────

describe('THEME_TYPES × CONTENT_TYPE_META completude', () => {
  for (const [theme, types] of Object.entries(THEME_TYPES)) {
    describe(`tema: ${theme}`, () => {
      it('lista de tipos não está vazia', () => {
        assert.ok(Array.isArray(types) && types.length > 0,
          `THEME_TYPES['${theme}'] deve ter ao menos 1 tipo`);
      });

      for (const type of types) {
        describe(`tipo: ${type}`, () => {
          it('tem entrada em CONTENT_TYPE_META', () => {
            assert.ok(
              Object.prototype.hasOwnProperty.call(CONTENT_TYPE_META, type),
              `CONTENT_TYPE_META não tem entrada para '${type}' (tema '${theme}')`
            );
          });

          it('icon não está vazio', () => {
            const meta = CONTENT_TYPE_META[type];
            assert.ok(meta && typeof meta.icon === 'string' && meta.icon.length > 0,
              `icon de '${type}' está vazio`);
          });

          it('color é hex #rrggbb', () => {
            const meta = CONTENT_TYPE_META[type];
            assert.ok(meta && isHexColor(meta.color),
              `color de '${type}' não é hex #rrggbb: '${meta?.color}'`);
          });

          it('label não está vazio', () => {
            const meta = CONTENT_TYPE_META[type];
            assert.ok(meta && typeof meta.label === 'string' && meta.label.length > 0,
              `label de '${type}' está vazio`);
          });

          it('category não está vazio', () => {
            const meta = CONTENT_TYPE_META[type];
            assert.ok(meta && typeof meta.category === 'string' && meta.category.length > 0,
              `category de '${type}' está vazio`);
          });
        });
      }
    });
  }
});

// ── Todos os tipos em CONTENT_TYPE_META são válidos (cobertura bidirecional) ───

describe('CONTENT_TYPE_META — toda entrada é válida', () => {
  for (const [type, meta] of Object.entries(CONTENT_TYPE_META)) {
    it(`${type}: icon/color/label/category presentes`, () => {
      assert.ok(typeof meta.icon     === 'string' && meta.icon.length     > 0, `icon faltando em '${type}'`);
      assert.ok(isHexColor(meta.color),                                         `color inválida em '${type}': '${meta.color}'`);
      assert.ok(typeof meta.label    === 'string' && meta.label.length    > 0, `label faltando em '${type}'`);
      assert.ok(typeof meta.category === 'string' && meta.category.length > 0, `category faltando em '${type}'`);
    });
  }
});

// ── getTypeMeta ───────────────────────────────────────────────────────────────

describe('getTypeMeta', () => {
  it('tipo conhecido retorna metadados corretos', () => {
    const meta = getTypeMeta('earthquake');
    assert.strictEqual(meta.label, 'Terremoto');
    assert.ok(isHexColor(meta.color));
  });

  it('tipo desconhecido retorna fallback seguro', () => {
    const meta = getTypeMeta('tipo_inexistente_xyz');
    assert.ok(meta, 'fallback deve existir');
    assert.strictEqual(typeof meta.icon,     'string');
    assert.strictEqual(typeof meta.label,    'string');
    assert.strictEqual(typeof meta.category, 'string');
    assert.strictEqual(meta.category, 'desconhecido');
  });

  it('type undefined retorna fallback sem lançar', () => {
    assert.doesNotThrow(() => getTypeMeta(undefined));
    const meta = getTypeMeta(undefined);
    assert.ok(meta && typeof meta.icon === 'string');
  });

  it('type vazio retorna fallback sem lançar', () => {
    assert.doesNotThrow(() => getTypeMeta(''));
    const meta = getTypeMeta('');
    assert.ok(meta && typeof meta.icon === 'string');
  });
});

// ── THEME_TYPES total count sanity ────────────────────────────────────────────

describe('THEME_TYPES — contagens mínimas', () => {
  it('extreme-events tem exatamente 18 tipos', () => {
    assert.strictEqual(THEME_TYPES['extreme-events'].length, 18);
  });

  it('weather tem exatamente 2 tipos', () => {
    assert.strictEqual(THEME_TYPES['weather'].length, 2);
  });

  it('news tem exatamente 3 tipos', () => {
    assert.strictEqual(THEME_TYPES['news'].length, 3);
  });

  it('finance tem exatamente 3 tipos', () => {
    assert.strictEqual(THEME_TYPES['finance'].length, 3);
  });
});

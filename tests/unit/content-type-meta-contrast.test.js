// content-type-meta-contrast.test.js — auditoria AA dual-mode como regressão executável (W4).
//
// Toda cor de CONTENT_TYPE_META é única (sem troca por esquema) e DEVE ter contraste
// ≥ 3:1 (WCAG 1.4.11 — componentes não-textuais) contra os DOIS extremos de fundo:
//   oceano claro #f7fdfd e oceano escuro #0a1010 (fundos do mapa/globo),
// e contra as duas surfaces do DESIGN.md (#f2f8f8 / #101919), onde a cor aparece
// em badges e bordas de card via --type-color.
//
// Matemática WCAG implementada aqui como funções puras (uso exclusivo deste teste).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT_TYPE_META, getTypeMeta } from '../../public/js/shared/content-type-meta.js';

// ── WCAG 2.x — luminância relativa e razão de contraste ──────────────────────

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// sRGB → linear: c ≤ 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4
function linearize(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

// L = 0.2126R + 0.7152G + 0.0722B (canais linearizados)
export function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

// Contraste = (Lmax + 0.05) / (Lmin + 0.05)
export function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ── Fundos do sistema ─────────────────────────────────────────────────────────

const BACKGROUNDS = {
  'oceano claro (#f7fdfd)':   '#f7fdfd',
  'oceano escuro (#0a1010)':  '#0a1010',
  'surface clara (#f2f8f8)':  '#f2f8f8',
  'surface escura (#101919)': '#101919',
};

const MIN_CONTRAST = 3.0; // WCAG 1.4.11 — non-text contrast

// ── Sanidade da matemática (valores de referência conhecidos) ─────────────────

describe('WCAG — sanidade da implementação', () => {
  it('luminância de #ffffff = 1.0', () => {
    assert.ok(Math.abs(relativeLuminance('#ffffff') - 1.0) < 1e-9);
  });

  it('luminância de #000000 = 0.0', () => {
    assert.strictEqual(relativeLuminance('#000000'), 0);
  });

  it('contraste branco × preto = 21:1', () => {
    assert.ok(Math.abs(contrastRatio('#ffffff', '#000000') - 21) < 1e-9);
  });

  it('contraste é simétrico e mínimo 1:1', () => {
    assert.strictEqual(contrastRatio('#528ac4', '#528ac4'), 1);
    assert.strictEqual(
      contrastRatio('#528ac4', '#0a1010'),
      contrastRatio('#0a1010', '#528ac4'),
    );
  });
});

// ── Regressão: toda cor de CONTENT_TYPE_META é dual-mode ─────────────────────

describe('CONTENT_TYPE_META — contraste ≥ 3:1 nas duas surfaces (dual-mode)', () => {
  for (const [type, meta] of Object.entries(CONTENT_TYPE_META)) {
    describe(`tipo: ${type} (${meta.color})`, () => {
      for (const [name, bg] of Object.entries(BACKGROUNDS)) {
        it(`≥ 3:1 contra ${name}`, () => {
          const ratio = contrastRatio(meta.color, bg);
          assert.ok(
            ratio >= MIN_CONTRAST,
            `'${type}' ${meta.color} tem contraste ${ratio.toFixed(2)}:1 contra ${bg} ` +
            `(mínimo ${MIN_CONTRAST}:1 — WCAG 1.4.11)`,
          );
        });
      }
    });
  }
});

// ── Fallback de tipo desconhecido também é dual-mode ──────────────────────────

describe('getTypeMeta — fallback de tipo desconhecido', () => {
  const fallback = getTypeMeta('tipo_inexistente_xyz');

  for (const [name, bg] of Object.entries(BACKGROUNDS)) {
    it(`cor de fallback ${fallback.color} ≥ 3:1 contra ${name}`, () => {
      const ratio = contrastRatio(fallback.color, bg);
      assert.ok(
        ratio >= MIN_CONTRAST,
        `fallback ${fallback.color} tem contraste ${ratio.toFixed(2)}:1 contra ${bg}`,
      );
    });
  }
});

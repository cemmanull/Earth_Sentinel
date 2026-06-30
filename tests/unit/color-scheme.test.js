import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextScheme, resolveInitialScheme, schemeButtonIcon, schemeThemeColor,
} from '../../public/js/shared/color-scheme.js';

describe('nextScheme', () => {
  it('alterna light → dark', () => assert.equal(nextScheme('light'), 'dark'));
  it('alterna dark → light', () => assert.equal(nextScheme('dark'), 'light'));
  it('valor desconhecido cai para dark (default é light)', () => {
    assert.equal(nextScheme(undefined), 'dark');
  });
});

describe('resolveInitialScheme', () => {
  it('preferência salva válida vence o hint do sistema', () => {
    assert.equal(resolveInitialScheme('dark', false), 'dark');
    assert.equal(resolveInitialScheme('light', true), 'light');
  });
  it('sem preferência salva, segue prefers-color-scheme', () => {
    assert.equal(resolveInitialScheme(null, true), 'dark');
    assert.equal(resolveInitialScheme(null, false), 'light');
  });
  it('valor salvo inválido é ignorado', () => {
    assert.equal(resolveInitialScheme('blue', true), 'dark');
    assert.equal(resolveInitialScheme('', false), 'light');
  });
});

describe('schemeButtonIcon', () => {
  it('indica o destino da alternância (classe Font Awesome)', () => {
    assert.equal(schemeButtonIcon('light'), 'fa-solid fa-moon');
    assert.equal(schemeButtonIcon('dark'), 'fa-solid fa-sun');
  });
});

describe('schemeThemeColor', () => {
  it('primary no claro, background no escuro', () => {
    assert.equal(schemeThemeColor('light'), '#00575c');
    assert.equal(schemeThemeColor('dark'), '#0a1010');
  });
});

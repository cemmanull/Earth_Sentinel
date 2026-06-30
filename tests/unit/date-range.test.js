import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateInputToStartMs, dateInputToEndMs,
} from '../../public/js/shared/date-range.js';

describe('dateInputToStartMs', () => {
  it('vazio → null (lado ilimitado)', () => {
    assert.equal(dateInputToStartMs(''), null);
    assert.equal(dateInputToStartMs(undefined), null);
  });
  it('data válida → meia-noite local desse dia', () => {
    assert.equal(
      dateInputToStartMs('2026-06-14'),
      new Date('2026-06-14T00:00:00').getTime(),
    );
  });
  it('string inválida → null', () => {
    assert.equal(dateInputToStartMs('not-a-date'), null);
  });
});

describe('dateInputToEndMs', () => {
  it('vazio → null', () => {
    assert.equal(dateInputToEndMs(''), null);
  });
  it('fim de dia é inclusivo: end − start do mesmo dia = 86399999 ms', () => {
    const day = '2026-06-14';
    assert.equal(dateInputToEndMs(day) - dateInputToStartMs(day), 86_399_999);
  });
  it('string inválida → null', () => {
    assert.equal(dateInputToEndMs('xx'), null);
  });
});

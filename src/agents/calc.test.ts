import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, formatNumber } from './calc.ts';

test('arithmetic and precedence', () => {
  assert.equal(evaluate('1 + 2 * 3'), 7);
  assert.equal(evaluate('(1 + 2) * 3'), 9);
  assert.equal(evaluate('10 / 4'), 2.5);
  assert.equal(evaluate('10 % 4'), 2);
  assert.equal(evaluate('-3 + 5'), 2);
});

test('powers are right associative and accept unary minus', () => {
  assert.equal(evaluate('2 ^ 3 ^ 2'), 512);
  assert.equal(evaluate('2 ** 10'), 1024);
  assert.equal(evaluate('2 ^ -1'), 0.5);
  assert.equal(evaluate('-2 ^ 2'), -4);
});

test('functions and constants', () => {
  assert.equal(evaluate('sqrt(16) + abs(-2)'), 6);
  assert.ok(Math.abs(evaluate('sin(pi / 2)') - 1) < 1e-12);
  assert.equal(evaluate('max(1, 5, 3)'), 5);
  assert.equal(evaluate('round(2.6)'), 3);
});

test('thousand separators and unicode operators', () => {
  assert.equal(evaluate('1,200 + 300'), 1500);
  assert.equal(evaluate('6 × 7'), 42);
  assert.equal(evaluate('9 ÷ 3'), 3);
});

test('rejects anything that is not arithmetic', () => {
  for (const bad of ['process.exit()', 'alert(1)', '1 +', '2 $ 3', 'foo', '(1', '1 2']) {
    assert.throws(() => evaluate(bad), undefined, bad);
  }
});

test('formatting avoids float noise', () => {
  assert.equal(formatNumber(0.1 + 0.2), '0.3');
  assert.equal(formatNumber(42), '42');
  assert.equal(formatNumber(1 / 3), '0.333333333333');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWhen, toLocalIso } from './when.ts';

// Thursday 2026-10-29 14:30
const NOW = new Date(2026, 9, 29, 14, 30);
const w = (s: string) => {
  const d = parseWhen(s, NOW);
  return d ? toLocalIso(d) : null;
};

test('relative times', () => {
  assert.equal(w('in 20 minutes'), '2026-10-29T14:50');
  assert.equal(w('in 1 hour 30 minutes'), '2026-10-29T16:00');
  assert.equal(w('in half an hour'), '2026-10-29T15:00');
  assert.equal(w('in 2 days'), '2026-10-31T14:30');
  assert.equal(w('45 min'), '2026-10-29T15:15');
});

test('days and clock times', () => {
  assert.equal(w('tomorrow 9am'), '2026-10-30T09:00');
  assert.equal(w('tomorrow'), '2026-10-30T09:00');
  assert.equal(w('friday 6pm'), '2026-10-30T18:00');
  assert.equal(w('monday'), '2026-11-02T09:00');
  assert.equal(w('next thursday 10:15 am'), '2026-11-05T10:15');
  assert.equal(w('tonight'), '2026-10-29T20:00');
  assert.equal(w('this evening'), '2026-10-29T18:00');
  assert.equal(w('day after tomorrow at 7 p.m.'), '2026-10-31T19:00');
  assert.equal(w('tomorrow noon'), '2026-10-30T12:00');
  assert.equal(w('2026-11-01 08:15'), '2026-11-01T08:15');
  assert.equal(w('2026-11-01T18:00'), '2026-11-01T18:00');
});

test('a bare time means the next time that clock shows', () => {
  assert.equal(w('5pm'), '2026-10-29T17:00');
  assert.equal(w('17:45'), '2026-10-29T17:45');
  assert.equal(w('11:30'), '2026-10-29T23:30'); // 11:30 am has passed, so tonight
  assert.equal(w('5'), '2026-10-29T17:00');
  assert.equal(w('12'), '2026-10-30T00:00'); // noon has passed; midnight is next
  assert.equal(w('today 11:30'), '2026-10-29T23:30');
  const morning = new Date(2026, 9, 29, 9, 4);
  assert.equal(toLocalIso(parseWhen('12', morning)!), '2026-10-29T12:00');
  assert.equal(toLocalIso(parseWhen('by 12', morning)!), '2026-10-29T12:00');
});

test('nonsense is not a time', () => {
  assert.equal(w(''), null);
  assert.equal(w('whenever'), null);
  assert.equal(w('soon'), null);
});

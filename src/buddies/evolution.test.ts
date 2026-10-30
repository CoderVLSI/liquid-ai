import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, evolvedBetween, formFor, megaCharges, nextStreak, progress, stageFor } from './evolution.ts';

test('stages follow XP', () => {
  assert.equal(stageFor(0), 1);
  assert.equal(stageFor(149), 1);
  assert.equal(stageFor(150), 2);
  assert.equal(stageFor(499), 2);
  assert.equal(stageFor(500), 3);
});

test('progress inside a stage', () => {
  assert.deepEqual(progress(0), { stage: 1, into: 0, need: 150, pct: 0 });
  assert.deepEqual(progress(75), { stage: 1, into: 75, need: 150, pct: 0.5 });
  assert.deepEqual(progress(150), { stage: 2, into: 0, need: 350, pct: 0 });
  assert.deepEqual(progress(900), { stage: 3, into: 400, need: 0, pct: 1 });
});

test('evolving is reported exactly when a stage line is crossed', () => {
  assert.equal(evolvedBetween(148, 149), null);
  assert.equal(evolvedBetween(148, 151), 'stage2');
  assert.equal(evolvedBetween(499, 500), 'stage3');
  assert.equal(evolvedBetween(10, 600), 'stage3'); // a big jump lands on the final form
  assert.equal(evolvedBetween(600, 700), null);
});

test('Mega charges start with Stage 2, come every 250 XP and are spent one by one', () => {
  assert.equal(megaCharges(100, 0), 0);
  assert.equal(megaCharges(150, 0), 1);
  assert.equal(megaCharges(150, 1), 0);
  assert.equal(megaCharges(400, 0), 2);
  assert.equal(megaCharges(5000, 0), 3); // capped
  assert.equal(megaCharges(5000, 20), 0);
});

test('the displayed form', () => {
  assert.equal(formFor(10, false), 'base');
  assert.equal(formFor(200, false), 'stage2');
  assert.equal(formFor(600, false), 'stage3');
  assert.equal(formFor(600, true), 'mega');
  assert.equal(formFor(10, true), 'base'); // Mega needs Stage 2
});

test('streaks: consecutive days count up, a gap resets, the same day does nothing', () => {
  assert.deepEqual(nextStreak('', 0, '2026-10-30'), { streak: 1, bonus: true });
  assert.deepEqual(nextStreak('2026-10-29', 4, '2026-10-30'), { streak: 5, bonus: true });
  assert.deepEqual(nextStreak('2026-10-27', 4, '2026-10-30'), { streak: 1, bonus: true });
  assert.deepEqual(nextStreak('2026-10-30', 5, '2026-10-30'), { streak: 5, bonus: false });
  assert.deepEqual(nextStreak('2026-09-30', 2, '2026-10-01'), { streak: 3, bonus: true }); // month boundary
  assert.equal(dayKey(new Date(2026, 9, 3, 23, 59)), '2026-10-03');
});

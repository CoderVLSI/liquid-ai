import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZONES, fromWall, resolveZone, toWall, zoneLabel, zoneValid } from './tz.ts';

const at = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];

test('the clock in another zone', () => {
  const noonUtc = new Date(Date.UTC(2026, 9, 29, 9, 0)); // 09:00 UTC
  assert.deepEqual(at(toWall(noonUtc, 'Asia/Kolkata')), [2026, 10, 29, 14, 30]);
  assert.deepEqual(at(toWall(noonUtc, 'UTC')), [2026, 10, 29, 9, 0]);
  assert.deepEqual(at(toWall(noonUtc, 'America/Los_Angeles')), [2026, 10, 29, 2, 0]); // PDT, UTC-7
  assert.deepEqual(at(toWall(new Date(Date.UTC(2026, 11, 1, 9, 0)), 'America/Los_Angeles')), [2026, 12, 1, 1, 0]); // PST, UTC-8
});

test('fromWall is the inverse of toWall', () => {
  for (const zone of ['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/Paris', 'Australia/Sydney', 'Pacific/Auckland']) {
    for (const ms of [Date.UTC(2026, 0, 15, 3, 7), Date.UTC(2026, 6, 4, 18, 45), Date.UTC(2026, 9, 29, 9, 0), Date.UTC(2026, 10, 2, 23, 59)]) {
      const back = fromWall(toWall(new Date(ms), zone), zone);
      assert.equal(back.getTime(), Math.floor(ms / 60000) * 60000, `${zone} ${new Date(ms).toISOString()}`);
    }
  }
});

test('9:00 on the wall in Kolkata is 03:30 UTC', () => {
  const wall = new Date(2026, 9, 30, 9, 0);
  assert.equal(fromWall(wall, 'Asia/Kolkata').toISOString(), '2026-10-30T03:30:00.000Z');
  assert.equal(fromWall(wall, 'UTC').toISOString(), '2026-10-30T09:00:00.000Z');
});

test('zone helpers', () => {
  assert.ok(zoneValid('Asia/Kolkata'));
  assert.ok(!zoneValid('Mars/Olympus'));
  assert.equal(resolveZone('Mars/Olympus'), resolveZone('auto'));
  assert.equal(zoneLabel('Asia/Kolkata'), 'IST');
  assert.equal(zoneLabel('auto'), 'local time');
  assert.equal(zoneLabel('Africa/Cairo'), 'Africa/Cairo');
  assert.ok(ZONES.every((z) => z.id === 'auto' || zoneValid(z.id)), 'every preset is a real zone');
});

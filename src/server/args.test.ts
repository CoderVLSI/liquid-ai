import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildServerArgs } from './args.ts';
import { getModel } from '../models/catalog.ts';
import { DEFAULT_SETTINGS, mergeSettings, pickThreads } from '../state/settings.ts';

test('omni gets weights, projector, loopback binding and reasoning off', () => {
  const a = buildServerArgs(getModel('omni'), '/d/models', DEFAULT_SETTINGS, 8);
  const at = (flag: string) => a[a.indexOf(flag) + 1];
  assert.equal(at('-m'), '/d/models/omni/LFM3-Omni-2B-Q4_0.gguf');
  assert.equal(at('--mmproj'), '/d/models/omni/mmproj-LFM3-Omni-2B-Q8_0.gguf');
  assert.equal(at('--host'), '127.0.0.1');
  assert.equal(at('--port'), '18080');
  assert.equal(at('--reasoning'), 'off');
  assert.equal(at('-np'), '2');
  assert.ok(a.includes('--no-webui'));
});

test('text model has no projector', () => {
  const a = buildServerArgs(getModel('text'), '/d/models', DEFAULT_SETTINGS, 8);
  assert.ok(!a.includes('--mmproj'));
});

test('thinking toggle and thread override', () => {
  const a = buildServerArgs(getModel('vl'), '/m', { ...DEFAULT_SETTINGS, thinking: true, threads: 3 }, 8);
  assert.equal(a[a.indexOf('--reasoning') + 1], 'on');
  assert.equal(a[a.indexOf('-t') + 1], '3');
});

test('auto threads suit an 8-core phone and tiny ones', () => {
  assert.equal(pickThreads(0, 8), 5);
  assert.equal(pickThreads(0, 4), 2);
  assert.equal(pickThreads(0, 16), 6);
  assert.equal(pickThreads(7, 8), 7);
});

test('mergeSettings ignores junk and keeps valid saved values', () => {
  const s = mergeSettings({ port: 19000, thinking: 'yes', activeModel: 'vl', bogus: 1, silenceMs: null });
  assert.equal(s.port, 19000);
  assert.equal(s.thinking, DEFAULT_SETTINGS.thinking);
  assert.equal(s.activeModel, 'vl');
  assert.equal(s.silenceMs, DEFAULT_SETTINGS.silenceMs);
  assert.deepEqual(mergeSettings(null), DEFAULT_SETTINGS);
});

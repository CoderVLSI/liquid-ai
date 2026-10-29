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
  assert.equal(at('-np'), '4'); // chat/voice + 3 parallel agents
  assert.equal(at('-c'), String(6144 * 4));
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

test('voice models leave cores free for audio, text models use more', () => {
  const at = (m: string) => {
    const a = buildServerArgs(getModel(m as any), '/m', DEFAULT_SETTINGS, 8);
    return Number(a[a.indexOf('-t') + 1]);
  };
  assert.equal(at('omni'), 4);
  assert.equal(at('audio'), 4);
  assert.equal(at('text'), 5);
  // an explicit thread count always wins
  const a = buildServerArgs(getModel('omni'), '/m', { ...DEFAULT_SETTINGS, threads: 6 }, 8);
  assert.equal(a[a.indexOf('-t') + 1], '6');
});

test('swarm size sets the number of server slots', () => {
  const a = buildServerArgs(getModel('text'), '/m', { ...DEFAULT_SETTINGS, agentParallel: 1 }, 8);
  assert.equal(a[a.indexOf('-np') + 1], '2');
  const b = buildServerArgs(getModel('text'), '/m', { ...DEFAULT_SETTINGS, agentParallel: 9 }, 8);
  assert.equal(b[b.indexOf('-np') + 1], '5');
});

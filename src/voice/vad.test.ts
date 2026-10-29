import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vad, DEFAULT_VAD, vadFromSensitivity } from './vad.ts';

const feed = (v: Vad, level: number, frames: number, assistant = false) => {
  const events: (string | null)[] = [];
  for (let i = 0; i < frames; i++) events.push(v.push(level, assistant));
  return events.filter(Boolean);
};

test('silence never triggers', () => {
  const v = new Vad();
  assert.deepEqual(feed(v, 0.002, 200), []);
});

test('speech then silence produces start and end', () => {
  const v = new Vad();
  feed(v, 0.002, 20);
  assert.deepEqual(feed(v, 0.1, 15), ['speechStart']);
  assert.ok(v.speaking);
  const end = feed(v, 0.002, 30);
  assert.deepEqual(end, ['speechEnd']);
  assert.ok(!v.speaking);
  assert.ok(v.lastSpeechMs >= DEFAULT_VAD.minSpeechMs);
});

test('a short click does not start speech', () => {
  const v = new Vad();
  feed(v, 0.002, 20);
  assert.deepEqual(feed(v, 0.2, 2), []);
  assert.deepEqual(feed(v, 0.002, 30), []);
});

test('a too-short utterance is aborted instead of answered', () => {
  const v = new Vad({ ...DEFAULT_VAD, minSpeechMs: 1000 });
  feed(v, 0.002, 20);
  assert.deepEqual(feed(v, 0.1, 4), ['speechStart']);
  assert.deepEqual(feed(v, 0.002, 30), ['speechAbort']);
});

test('a level that starts a normal turn does not interrupt the assistant', () => {
  const v = new Vad();
  feed(v, 0.002, 20);
  const level = v.threshold(false) * 1.2;
  assert.deepEqual(feed(new Vad(), level, 5, false), ['speechStart']);
  assert.deepEqual(feed(v, level, 20, true), []);
});

test('clearly loud speech held long enough does interrupt the assistant', () => {
  const v = new Vad();
  feed(v, 0.002, 20);
  const level = v.threshold(false) * 4;
  assert.deepEqual(feed(v, level, 3, true), []); // too short to confirm a barge-in
  assert.deepEqual(feed(v, level, 10, true), ['speechStart']);
});

test('pauses shorter than the end-silence window do not end the turn', () => {
  const v = new Vad();
  feed(v, 0.002, 20);
  feed(v, 0.1, 10);
  assert.deepEqual(feed(v, 0.002, 10), []); // 400 ms pause < 800 ms
  assert.deepEqual(feed(v, 0.1, 10), []);
  assert.ok(v.speaking);
});

test('noise floor adapts so a noisy room does not trigger', () => {
  const v = new Vad();
  assert.deepEqual(feed(v, 0.011, 100), []); // below minAbs, learned as noise
  assert.ok(v.noise > 0.008);
});

test('higher sensitivity lowers the threshold', () => {
  const lo = vadFromSensitivity(0, 800);
  const hi = vadFromSensitivity(1, 800);
  assert.ok(hi.minAbs < lo.minAbs);
  assert.ok(hi.startRatio < lo.startRatio);
});

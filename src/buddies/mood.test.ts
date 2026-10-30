import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POSES, choosePose, moodFromVoice } from './mood.ts';
import type { Pose } from './mood.ts';

const all = () => true;
const only = (...ps: Pose[]) => (p: Pose) => ps.includes(p);
const calm = { blink: false, mouth: false };

test('each mood has its own pose', () => {
  assert.equal(choosePose('idle', calm, all), 'idle');
  assert.equal(choosePose('asleep', calm, all), 'sleep');
  assert.equal(choosePose('working', calm, all), 'think');
  assert.equal(choosePose('waiting', calm, all), 'wait');
  assert.equal(choosePose('happy', calm, all), 'happy');
  assert.equal(choosePose('sad', calm, all), 'sad');
});

test('blinking and talking flicker between poses', () => {
  assert.equal(choosePose('idle', { blink: true, mouth: false }, all), 'blink');
  assert.equal(choosePose('talking', { blink: false, mouth: true }, all), 'talk');
  assert.equal(choosePose('talking', { blink: false, mouth: false }, all), 'idle');
  assert.equal(choosePose('talking', { blink: true, mouth: false }, all), 'blink');
  // no blinking while asleep or working
  assert.equal(choosePose('asleep', { blink: true, mouth: false }, all), 'sleep');
  assert.equal(choosePose('working', { blink: true, mouth: false }, all), 'think');
});

test('a buddy with missing poses falls back to idle', () => {
  const few = only('idle', 'happy');
  assert.equal(choosePose('working', calm, few), 'idle');
  assert.equal(choosePose('talking', { blink: false, mouth: true }, few), 'idle');
  assert.equal(choosePose('happy', calm, few), 'happy');
  assert.equal(choosePose('idle', { blink: true, mouth: false }, few), 'idle');
  assert.equal(choosePose('idle', calm, only('sad')), 'sad'); // nothing but one pose: use it
});

test('voice states map to moods', () => {
  assert.equal(moodFromVoice('speaking', false), 'talking');
  assert.equal(moodFromVoice('hearing', false), 'waiting');
  assert.equal(moodFromVoice('thinking', false), 'working');
  assert.equal(moodFromVoice('listening', false), 'listening');
  assert.equal(moodFromVoice('listening', true), 'asleep');
  assert.equal(moodFromVoice('error', false), 'sad');
  assert.equal(POSES.length, 8);
});

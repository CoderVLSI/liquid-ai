import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceSession } from './VoiceSession.ts';
import type { AudioPort, VoiceCallbacks, VoiceState } from './VoiceSession.ts';
import { RealtimeClient } from '../net/RealtimeClient.ts';
import type { RealtimeLike, RtEvent, SessionInfo, WebSocketLike } from '../net/RealtimeClient.ts';
import { DEFAULT_SETTINGS } from '../state/settings.ts';
import type { Settings } from '../state/settings.ts';

class FakeClient implements RealtimeLike {
  onEvent: (e: RtEvent) => void = () => {};
  onClose: (r: string) => void = () => {};
  sent: string[] = [];
  info: SessionInfo = { inputRate: 16000, outputRate: 24000 };
  async connect() {
    return this.info;
  }
  sessionUpdate(s: Record<string, unknown>) {
    this.sent.push('update:' + JSON.stringify(s));
  }
  appendAudio(b: string) {
    this.sent.push('append:' + b);
  }
  commit() {
    this.sent.push('commit');
  }
  createResponse() {
    this.sent.push('create');
  }
  cancel() {
    this.sent.push('cancel');
  }
  close() {
    this.sent.push('close');
  }
  emit(e: RtEvent) {
    this.onEvent(e);
  }
}

class FakeAudio implements AudioPort {
  calls: string[] = [];
  played: string[] = [];
  pending = 0;
  frameCb: (f: { data: string; rms: number }) => void = () => {};
  async enterVoiceMode(c: boolean) {
    this.calls.push('enter:' + c);
    return {};
  }
  async leaveVoiceMode() {
    this.calls.push('leave');
  }
  async startMic(rate: number) {
    this.calls.push('mic:' + rate);
    return { sampleRate: rate, aec: true, ns: true };
  }
  async stopMic() {
    this.calls.push('micStop');
  }
  async startPlayer(rate: number) {
    this.calls.push('player:' + rate);
  }
  async stopPlayer() {
    this.calls.push('playerStop');
  }
  playPcm(b: string) {
    this.played.push(b);
    this.pending += 500;
  }
  flushPlayer() {
    this.calls.push('flush');
    this.pending = 0;
  }
  playerPendingMs() {
    return this.pending;
  }
  onMicFrame(cb: (f: { data: string; rms: number }) => void) {
    this.frameCb = cb;
    return () => {};
  }
  onMicError() {
    return () => {};
  }
}

function setup(over: Partial<Settings> = {}) {
  const client = new FakeClient();
  const audio = new FakeAudio();
  const states: VoiceState[] = [];
  const texts: string[] = [];
  const errors: string[] = [];
  let interrupted = 0;
  let userTurns = 0;
  const cb: VoiceCallbacks = {
    onState: (s) => states.push(s),
    onLevel: () => {},
    onUserTurn: () => userTurns++,
    onResponseStart: () => {},
    onAssistantText: (d) => texts.push(d),
    onResponseDone: () => {},
    onInterrupted: () => interrupted++,
    onError: (m) => errors.push(m),
    log: () => {},
  };
  const session = new VoiceSession(client, audio, { ...DEFAULT_SETTINGS, ...over }, cb);
  let n = 0;
  const frame = (rms: number) => session.onFrame({ data: `f${n++}`, rms });
  const frames = (rms: number, count: number) => {
    for (let i = 0; i < count; i++) frame(rms);
  };
  return { client, audio, session, states, texts, errors, frame, frames, get interrupted() { return interrupted; }, get userTurns() { return userTurns; } };
}

test('start configures the session, audio route, speaker and mic at the model rates', async () => {
  const t = setup();
  await t.session.start();
  assert.match(t.client.sent[0], /^update:.*"output_modalities":\["text","audio"\]/);
  assert.deepEqual(t.audio.calls, ['enter:true', 'player:24000', 'mic:16000']);
  assert.equal(t.session.state, 'listening');
  await t.session.stop();
});

test('audio-only reply setting asks for speech without text', async () => {
  const t = setup({ speechReply: 'audio' });
  await t.session.start();
  assert.match(t.client.sent[0], /"output_modalities":\["audio"\]/);
  await t.session.stop();
});

test('a model that cannot speak falls back to text and no player', async () => {
  const t = setup();
  t.client.info = { inputRate: 16000, outputRate: null };
  await t.session.start();
  assert.match(t.client.sent[0], /"output_modalities":\["text"\]/);
  assert.ok(!t.audio.calls.some((c) => c.startsWith('player')));
  await t.session.stop();
});

test('a spoken turn sends pre-roll + speech + trailing silence, then asks for a reply', async () => {
  const t = setup();
  await t.session.start();
  t.client.sent.length = 0;

  t.frames(0.002, 12); // quiet room, pre-roll fills (kept to 10)
  t.frames(0.1, 8); // speech: confirmed on the 3rd loud frame
  t.frames(0.002, 30); // silence long enough to end the turn

  const sent = t.client.sent;
  assert.equal(sent[sent.length - 1], 'create');
  assert.equal(sent.filter((s) => s === 'create').length, 1);
  const appended = sent.filter((s) => s.startsWith('append:'));
  // 10 pre-roll frames (incl. the confirming one) are sent before later frames, in order
  assert.ok(appended.length >= 10 + 5);
  const order = appended.map((s) => Number(s.slice('append:f'.length)));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.equal(t.userTurns, 1);
  assert.equal(t.session.state, 'thinking');
  await t.session.stop();
});

test('quiet-room noise never reaches the server', async () => {
  const t = setup();
  await t.session.start();
  t.client.sent.length = 0;
  t.frames(0.004, 100);
  assert.deepEqual(t.client.sent, []);
  await t.session.stop();
});

test('assistant text and audio flow to the UI and the speaker; state returns to listening', async () => {
  const t = setup();
  await t.session.start();
  t.frames(0.002, 12);
  t.frames(0.1, 8);
  t.frames(0.002, 30);

  t.client.emit({ type: 'response.created', response: { id: 'r1' } });
  t.client.emit({ type: 'response.output_text.delta', response_id: 'r1', delta: 'Hi ' });
  t.client.emit({ type: 'response.output_text.delta', response_id: 'r1', delta: 'there' });
  t.client.emit({ type: 'response.output_audio.delta', response_id: 'r1', delta: 'AUDIO1' });
  assert.deepEqual(t.texts, ['Hi ', 'there']);
  assert.deepEqual(t.audio.played, ['AUDIO1']);
  assert.equal(t.session.state, 'speaking');

  t.client.emit({ type: 'response.done', response: { id: 'r1', status: 'completed' } });
  t.session.tick();
  assert.equal(t.session.state, 'speaking'); // audio still queued on the speaker
  t.audio.pending = 0;
  t.session.tick();
  assert.equal(t.session.state, 'listening');
  await t.session.stop();
});

test('barge-in cancels the response, flushes playback and ignores its late audio', async () => {
  const t = setup();
  await t.session.start();
  t.frames(0.002, 12);
  t.frames(0.1, 8);
  t.frames(0.002, 30);
  t.client.emit({ type: 'response.created', response: { id: 'r1' } });
  t.client.emit({ type: 'response.output_audio.delta', response_id: 'r1', delta: 'A' });

  t.client.sent.length = 0;
  t.frames(0.5, 10); // loud, sustained speech over the assistant
  assert.ok(t.client.sent.includes('cancel'));
  assert.ok(t.audio.calls.includes('flush'));
  assert.equal(t.interrupted, 1);
  assert.equal(t.session.state, 'hearing');

  // audio and text from the cancelled response that were already in flight are dropped
  const before = t.audio.played.length;
  t.client.emit({ type: 'response.output_audio.delta', response_id: 'r1', delta: 'LATE' });
  t.client.emit({ type: 'response.output_text.delta', response_id: 'r1', delta: 'late' });
  assert.equal(t.audio.played.length, before);
  assert.ok(!t.texts.includes('late'));
  await t.session.stop();
});

test('interrupting during "thinking" cancels the response that is still being created', async () => {
  const t = setup();
  await t.session.start();
  t.frames(0.002, 12);
  t.frames(0.1, 8);
  t.frames(0.002, 30); // create sent, no response.created yet
  t.frames(0.5, 10); // user talks again immediately
  assert.ok(t.client.sent.includes('cancel'));

  // the server now reports the response we cancelled: it must stay silent
  t.client.emit({ type: 'response.created', response: { id: 'rX' } });
  t.client.emit({ type: 'response.output_audio.delta', response_id: 'rX', delta: 'NOPE' });
  assert.deepEqual(t.audio.played, []);
  await t.session.stop();
});

test('with barge-in off the mic is ignored while the assistant talks', async () => {
  const t = setup({ bargeIn: false });
  await t.session.start();
  t.frames(0.002, 12);
  t.frames(0.1, 8);
  t.frames(0.002, 30);
  t.client.emit({ type: 'response.created', response: { id: 'r1' } });
  t.client.emit({ type: 'response.output_audio.delta', response_id: 'r1', delta: 'A' });
  t.client.sent.length = 0;
  t.frames(0.5, 20);
  assert.deepEqual(t.client.sent, []);
  await t.session.stop();
});

test('muting stops sending audio', async () => {
  const t = setup();
  await t.session.start();
  t.client.sent.length = 0;
  t.session.mute(true);
  t.frames(0.5, 20);
  assert.deepEqual(t.client.sent, []);
  await t.session.stop();
});

test('stop releases mic, speaker and audio route exactly once', async () => {
  const t = setup();
  await t.session.start();
  await t.session.stop();
  await t.session.stop();
  assert.equal(t.audio.calls.filter((c) => c === 'micStop').length, 1);
  assert.equal(t.audio.calls.filter((c) => c === 'leave').length, 1);
  assert.equal(t.client.sent.filter((c) => c === 'close').length, 1);
  assert.equal(t.session.state, 'ended');
});

test('harmless empty-buffer errors are swallowed, real errors reach the user', async () => {
  const t = setup();
  await t.session.start();
  t.client.emit({ type: 'error', error: { type: 'invalid_request_error', message: 'input_audio_buffer.commit: the buffer is empty' } });
  assert.deepEqual(t.errors, []);
  t.client.emit({ type: 'error', error: { type: 'server_error', message: 'decode failed' } });
  t.client.emit({ type: 'error', error: { type: 'invalid_request_error', message: 'The current model does not support realtime transcription.' } });
  assert.deepEqual(t.errors, ['decode failed', 'The current model does not support realtime transcription.']);
  await t.session.stop();
});

// ---- RealtimeClient against a fake socket ---------------------------------------------------

class FakeSocket implements WebSocketLike {
  readyState = 1;
  onopen: any = null;
  onmessage: any = null;
  onerror: any = null;
  onclose: any = null;
  sent: any[] = [];
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {
    this.readyState = 3;
  }
}

test('RealtimeClient resolves with the rates from session.created and serialises events', async () => {
  const sock = new FakeSocket();
  const c = new RealtimeClient('ws://x/v1/realtime', () => sock);
  const p = c.connect();
  sock.onmessage({
    data: JSON.stringify({
      type: 'session.created',
      session: { audio: { input: { format: { rate: 16000 } }, output: { format: { rate: 24000 } } } },
    }),
  });
  assert.deepEqual(await p, { inputRate: 16000, outputRate: 24000 });
  c.appendAudio('AAAA');
  c.createResponse();
  c.cancel();
  assert.deepEqual(sock.sent, [
    { type: 'input_audio_buffer.append', audio: 'AAAA' },
    { type: 'response.create' },
    { type: 'response.cancel' },
  ]);
});

test('RealtimeClient rejects when the socket fails before the session exists', async () => {
  const sock = new FakeSocket();
  const c = new RealtimeClient('ws://x/v1/realtime', () => sock);
  const p = c.connect(1000);
  sock.onerror({ message: 'refused' });
  await assert.rejects(p, /refused/);
});

test('RealtimeClient reports the model as mute when no output format is advertised', async () => {
  const sock = new FakeSocket();
  const c = new RealtimeClient('ws://x', () => sock);
  const p = c.connect();
  sock.onmessage({ data: JSON.stringify({ type: 'session.created', session: { audio: { input: { format: { rate: 16000 } } } } }) });
  assert.deepEqual(await p, { inputRate: 16000, outputRate: null });
});

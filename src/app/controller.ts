import { AppState as RNAppState, PermissionsAndroid } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { native, nativeAvailable } from '../native';
import { log, stringify } from '../lib/log';
import { installCrashHandlers } from '../lib/crash';
import { appStore } from '../state/app';
import type { Attachment, ChatMsg, Sheet } from '../state/app';
import { DEFAULT_SETTINGS, mergeSettings } from '../state/settings';
import type { Settings } from '../state/settings';
import { DEFAULT_ORDER, getModel, has, pickDefaultModel } from '../models/catalog';
import type { Capability, ModelId } from '../models/catalog';
import { downloads } from '../models/downloads';
import { server } from '../server/ServerManager';
import { streamChat } from '../net/ChatClient';
import { RealtimeClient } from '../net/RealtimeClient';
import { VoiceSession } from '../voice/VoiceSession';
import type { AudioPort } from '../voice/VoiceSession';
import { buildRequest } from '../chat/history';

let filesDir = '';
let genAbort: AbortController | null = null;
let voice: VoiceSession | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let uid = 0;
const newId = () => `${Date.now().toString(36)}-${(uid++).toString(36)}`;

const settingsFile = () => `${filesDir}/settings.json`;
const chatFile = () => `${filesDir}/chat.json`;

// ---- boot --------------------------------------------------------------------------------------

export async function boot() {
  installCrashHandlers();
  if (!nativeAvailable) {
    appStore.set({ booted: true, nativeMissing: true });
    return;
  }

  const info = native.info();
  filesDir = info.filesDir;
  log.setSink((line, e) => {
    native.writeText(`${filesDir}/logs/app.log`, line, true);
    // everything except noisy debug lines also goes to `adb logcat -s LiquidVoice`
    if (e.level !== 'debug' && e.tag !== 'console') native.log(e.level, `[${e.tag}] ${e.msg}`);
  });
  log.info('boot', `${info.device}, Android SDK ${info.sdk}, ${info.cores} cores, ${Math.round(info.totalRamBytes / 1e9)} GB RAM`);
  log.info('boot', `server binary present=${info.serverBinaryPresent} (${Math.round(info.serverBinarySize / 1e6)} MB), abis=${info.abis.join(',')}`);

  let settings: Settings = DEFAULT_SETTINGS;
  try {
    const raw = await native.readText(settingsFile());
    if (raw) settings = mergeSettings(JSON.parse(raw));
  } catch (e) {
    log.warn('boot', 'could not read settings', stringify(e));
  }

  let messages: ChatMsg[] = [];
  try {
    const raw = await native.readText(chatFile());
    if (raw) messages = (JSON.parse(raw) as ChatMsg[]).map((m) => ({ ...m, streaming: false }));
  } catch (e) {
    log.warn('boot', 'could not read chat', stringify(e));
  }

  downloads.init();
  const ready = downloads.readyIds();
  if (!settings.activeModel || !ready.includes(settings.activeModel)) {
    settings = { ...settings, activeModel: pickDefaultModel(ready) };
  }

  appStore.set({
    booted: true,
    settings,
    messages,
    crashes: native.crashReports(),
    exitReasons: native.exitReasons(),
  });
  if (appStore.get().crashes.length) log.warn('boot', `${appStore.get().crashes.length} crash report(s) from earlier runs`);

  RNAppState.addEventListener('change', onAppState);

  // Warm the model so the first message is fast.
  if (settings.activeModel) {
    server.ensure(settings.activeModel, settings).catch((e) => log.warn('boot', 'preload failed', stringify(e)));
  }
}

function onAppState(next: string) {
  if (next === 'active') {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    return;
  }
  // Android only lets foreground apps use the microphone, so a live session ends when we leave.
  if (voice) void stopVoice();
  const mins = appStore.get().settings.idleStopMinutes;
  if (mins > 0 && !idleTimer) {
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!appStore.get().generating) {
        log.info('lifecycle', `idle for ${mins} min in background, stopping the model server`);
        void server.stop();
      }
    }, mins * 60_000);
  }
}

// ---- small helpers -----------------------------------------------------------------------------

export function toast(msg: string, ms = 3500) {
  appStore.set({ toast: msg });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => appStore.set({ toast: null }), ms);
}

export function openSheet(sheet: Sheet) {
  appStore.set({ sheet });
  if (sheet === 'models') downloads.refresh();
}

export function setSettings(patch: Partial<Settings>) {
  const settings = { ...appStore.get().settings, ...patch };
  appStore.set({ settings });
  try {
    native.writeText(settingsFile(), JSON.stringify(settings, null, 2), false);
  } catch (e) {
    log.warn('settings', 'save failed', stringify(e));
  }
}

function persistChatSoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const slim = appStore.get().messages.slice(-200).map((m) => ({ ...m, streaming: false }));
      native.writeText(chatFile(), JSON.stringify(slim), false);
    } catch (e) {
      log.warn('chat', 'save failed', stringify(e));
    }
  }, 800);
}

function updateMsg(id: string, patch: Partial<ChatMsg> | ((m: ChatMsg) => Partial<ChatMsg>)) {
  appStore.set((s) => ({
    messages: s.messages.map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)),
  }));
  persistChatSoon();
}

function addMsg(m: Omit<ChatMsg, 'id' | 't'>): string {
  const msg: ChatMsg = { ...m, id: newId(), t: Date.now() };
  appStore.set((s) => ({ messages: [...s.messages, msg] }));
  persistChatSoon();
  return msg.id;
}

export function newChat() {
  stopGenerating();
  if (voice) void stopVoice();
  appStore.set({ messages: [], attachment: null });
  persistChatSoon();
}

// ---- models ------------------------------------------------------------------------------------

/** Pick the model to use for a capability, switching the active one if needed. */
function modelFor(cap: Capability): ModelId | null {
  const ready = downloads.readyIds();
  const { activeModel } = appStore.get().settings;
  if (activeModel && ready.includes(activeModel) && has(getModel(activeModel), cap)) return activeModel;
  for (const id of DEFAULT_ORDER) {
    if (ready.includes(id) && has(getModel(id), cap)) {
      setSettings({ activeModel: id });
      if (activeModel && activeModel !== id) toast(`Switched to ${getModel(id).name} for ${cap === 'voice' ? 'voice' : 'images'}`);
      return id;
    }
  }
  const need = cap === 'voice' ? 'Omni or Audio' : cap === 'vision' ? 'Omni or VL' : 'any';
  toast(`Download a model first (${need}).`);
  openSheet('models');
  return null;
}

export async function chooseModel(id: ModelId) {
  if (!downloads.readyIds().includes(id)) return;
  if (voice) await stopVoice();
  setSettings({ activeModel: id });
  try {
    await server.ensure(id, appStore.get().settings);
  } catch (e) {
    log.error('models', 'load failed', stringify(e));
  }
}

export async function deleteModel(id: ModelId) {
  if (appStore.get().settings.activeModel === id) {
    if (voice) await stopVoice();
    await server.stop();
    setSettings({ activeModel: null });
  }
  await downloads.remove(id);
  const next = pickDefaultModel(downloads.readyIds());
  if (!appStore.get().settings.activeModel && next) setSettings({ activeModel: next });
}

export async function restartServer() {
  const id = appStore.get().settings.activeModel;
  if (!id) return;
  if (voice) await stopVoice();
  await server.stop();
  try {
    await server.ensure(id, appStore.get().settings);
  } catch (e) {
    log.error('server', 'restart failed', stringify(e));
  }
}

// ---- text + image chat -------------------------------------------------------------------------

export async function pickImage(source: 'library' | 'camera') {
  try {
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted && source === 'camera') {
      toast('Camera permission denied');
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, base64: true, allowsEditing: false };
    const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]?.base64) return;
    const a = res.assets[0];
    const attachment: Attachment = { uri: a.uri, dataUri: `data:image/jpeg;base64,${a.base64}` };
    appStore.set({ attachment });
    log.info('image', `attached ${a.width}x${a.height}, ${Math.round((a.base64?.length ?? 0) / 1024)} KB base64`);
  } catch (e) {
    log.error('image', 'pick failed', stringify(e));
    toast('Could not load the image');
  }
}

export function clearAttachment() {
  appStore.set({ attachment: null });
}

export function stopGenerating() {
  genAbort?.abort();
  genAbort = null;
}

export async function sendMessage(rawText: string) {
  const s = appStore.get();
  const text = rawText.trim();
  const attachment = s.attachment;
  if ((!text && !attachment) || s.generating) return;

  const id = modelFor(attachment ? 'vision' : 'text');
  if (!id) return;
  if (voice) await stopVoice();

  const history = s.messages.map((m) => ({
    role: m.role,
    text: m.text,
    hasImage: !!m.imageUri,
    voice: m.voice,
    error: m.error,
    interrupted: m.interrupted,
  }));
  const req = buildRequest(s.settings.systemPrompt, history, { text, imageDataUri: attachment?.dataUri });

  addMsg({ role: 'user', text, imageUri: attachment?.uri });
  const replyId = addMsg({ role: 'assistant', text: '', streaming: true });
  appStore.set({ generating: true, attachment: null });
  native.setWakeLock(true);

  const ctl = new AbortController();
  genAbort = ctl;
  let buf = '';
  let reasoning = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    flushTimer = null;
    updateMsg(replyId, { text: buf, reasoning: reasoning || undefined });
  };
  const schedule = () => {
    if (!flushTimer) flushTimer = setTimeout(flush, 60);
  };

  try {
    await server.ensure(id, appStore.get().settings);
    const t0 = Date.now();
    let firstAt = 0;
    const res = await streamChat({
      baseUrl: server.baseUrl(appStore.get().settings),
      messages: req,
      signal: ctl.signal,
      onText: (d) => {
        if (!firstAt) firstAt = Date.now();
        buf += d;
        schedule();
      },
      onReasoning: (d) => {
        reasoning += d;
        schedule();
      },
    });
    if (flushTimer) clearTimeout(flushTimer);
    updateMsg(replyId, { text: buf.trim() || '(no answer)', reasoning: reasoning || undefined, streaming: false });
    log.info('chat', `answered in ${Date.now() - t0} ms (first token ${firstAt ? firstAt - t0 : '-'} ms), finish=${res.finish}, ${buf.length} chars`);
  } catch (e: any) {
    if (flushTimer) clearTimeout(flushTimer);
    if (ctl.signal.aborted) {
      updateMsg(replyId, { text: buf.trim() || '(stopped)', interrupted: true, streaming: false });
    } else {
      log.error('chat', 'request failed', stringify(e));
      updateMsg(replyId, { text: `${buf}${buf ? '\n\n' : ''}⚠️ ${e?.message ?? e}`, error: true, streaming: false });
    }
  } finally {
    genAbort = null;
    appStore.set({ generating: false });
    native.setWakeLock(false);
  }
}

// ---- live voice --------------------------------------------------------------------------------

const audioPort: AudioPort = {
  enterVoiceMode: (c) => native.enterVoiceMode(c),
  leaveVoiceMode: () => native.leaveVoiceMode(),
  startMic: (r, v) => native.startMic(r, v),
  stopMic: () => native.stopMic(),
  startPlayer: (r, c) => native.startPlayer(r, c),
  stopPlayer: () => native.stopPlayer(),
  playPcm: (b) => native.playPcm(b),
  flushPlayer: () => native.flushPlayer(),
  playerPendingMs: () => native.playerPendingMs(),
  onMicFrame: (cb) => native.on('micFrame', cb),
  onMicError: (cb) => native.on('micError', (e) => cb(e.message)),
};

export function voiceActive() {
  return voice != null;
}

export async function toggleVoice() {
  if (voice) await stopVoice();
  else await startVoice();
}

export async function startVoice() {
  if (voice) return;
  if (appStore.get().generating) stopGenerating();
  const id = modelFor('voice');
  if (!id) return;

  const perm = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
  if (perm !== PermissionsAndroid.RESULTS.GRANTED) {
    toast('Microphone permission is needed for live voice');
    return;
  }

  appStore.set({ voice: { active: true, state: 'connecting', level: 0, muted: false } });
  const settings = appStore.get().settings;
  const assistantMsgs = new Map<string, string>();
  let lastLevelAt = 0;

  try {
    await server.ensure(id, settings);
    const client = new RealtimeClient(`ws://127.0.0.1:${settings.port}/v1/realtime`);
    const session = new VoiceSession(client, audioPort, settings, {
      onState: (state) => appStore.set((s) => ({ voice: { ...s.voice, state } })),
      onLevel: (rms) => {
        const now = Date.now();
        if (now - lastLevelAt < 70) return;
        lastLevelAt = now;
        appStore.set((s) => ({ voice: { ...s.voice, level: rms } }));
      },
      onUserTurn: (ms) => addMsg({ role: 'user', text: `🎤 Voice message · ${(ms / 1000).toFixed(1)} s`, voice: true }),
      onResponseStart: (rid) => {
        assistantMsgs.set(rid, addMsg({ role: 'assistant', text: '', streaming: true }));
      },
      onAssistantText: (delta, rid) => {
        const mid = assistantMsgs.get(rid);
        if (mid) updateMsg(mid, (m) => ({ text: m.text + delta }));
      },
      onResponseDone: (rid, status) => {
        const mid = assistantMsgs.get(rid);
        if (!mid) return;
        updateMsg(mid, (m) => ({ streaming: false, text: m.text.trim() || '🔊 (spoken reply)', interrupted: status === 'cancelled' || m.interrupted }));
        assistantMsgs.delete(rid);
      },
      onInterrupted: () => {
        for (const mid of assistantMsgs.values()) updateMsg(mid, { interrupted: true, streaming: false });
      },
      onError: (message) => {
        log.error('voice', message);
        toast(message, 6000);
      },
      log: (m) => log.info('voice', m),
    });
    voice = session;
    await activateKeepAwakeAsync('voice');
    native.setWakeLock(true);
    await session.start();
    log.info('voice', 'live session started');
  } catch (e) {
    log.error('voice', 'start failed', stringify(e));
    await cleanupVoice();
  }

  // the session can also end by itself (connection lost, mic error)
  const watch = setInterval(() => {
    if (!voice || voice.state === 'ended' || voice.state === 'error') {
      clearInterval(watch);
      void cleanupVoice();
    }
  }, 500);
}

async function cleanupVoice() {
  const v = voice;
  voice = null;
  try {
    await v?.stop();
  } catch (e) {
    log.warn('voice', 'stop failed', stringify(e));
  }
  deactivateKeepAwake('voice');
  native.setWakeLock(false);
  appStore.set({ voice: { active: false, state: 'off', level: 0, muted: false } });
}

export async function stopVoice() {
  await cleanupVoice();
  log.info('voice', 'live session ended');
}

export function setMuted(on: boolean) {
  voice?.mute(on);
  appStore.set((s) => ({ voice: { ...s.voice, muted: on } }));
}

export function interruptAssistant() {
  voice?.interrupt();
}

// ---- diagnostics -------------------------------------------------------------------------------

export function dismissCrashes() {
  native.clearCrashReports();
  appStore.set({ crashes: [] });
}

import { AppState as RNAppState, PermissionsAndroid, Platform } from 'react-native';
import { native } from '../native';

/**
 * Things that must keep running while the app is minimised (model downloads, agent tasks) register
 * here. While any of them has work, an Android foreground service keeps the process alive and shows
 * one ongoing notification summarising it ("Downloading 2 models · 43% · 3 agent tasks").
 */
type Source = () => string | null;
const sources = new Map<string, Source>();
let last: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let onSince = 0;
/** Android crashes an app that stops a foreground service right after starting it, so never switch off sooner than this. */
const MIN_ON_MS = 8000;

export function registerBackgroundSource(name: string, source: Source) {
  sources.set(name, source);
}

function compute(): string | null {
  const parts: string[] = [];
  for (const s of sources.values()) {
    const t = s();
    if (t) parts.push(t);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** Recomputes the notification text. Cheap to call often; updates the system at most every 1.2 s. */
export function refreshBackground() {
  if (timer) return;
  schedule(1200);
}

function schedule(ms: number) {
  timer = setTimeout(() => {
    timer = null;
    const text = compute();
    if (text === last) return;
    if (text == null && last != null && Date.now() - onSince < MIN_ON_MS) {
      schedule(MIN_ON_MS - (Date.now() - onSince) + 200); // try again once it has been on long enough
      return;
    }
    if (text != null && last == null) onSince = Date.now();
    last = text;
    native.keepAlive(text != null, text ?? '');
  }, ms);
}

export function inBackground(): boolean {
  return RNAppState.currentState !== 'active';
}

let asked = false;
/** Android 13+ needs a runtime permission before any notification (including the foreground one) shows. */
export async function ensureNotificationPermission() {
  if (asked) return;
  asked = true;
  try {
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS' as any);
    }
  } catch {
    // optional
  }
}

export function notifyPhone(id: number, title: string, body: string) {
  native.notify(id, title, body);
}

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
  timer = setTimeout(() => {
    timer = null;
    const text = compute();
    if (text === last) return;
    last = text;
    native.keepAlive(text != null, text ?? '');
  }, 1200);
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

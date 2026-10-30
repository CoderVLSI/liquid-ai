import { appStore } from '../state/app';

export type HapticKind = 'light' | 'medium' | 'success' | 'warning';

let mod: any;

/** A short vibration for taps and results. Silent when the setting is off or the module is unavailable. */
export function tap(kind: HapticKind = 'light') {
  try {
    if (!appStore.get().settings.haptics) return;
    if (mod === undefined) mod = require('expo-haptics');
    if (!mod) return;
    if (kind === 'success') void mod.notificationAsync(mod.NotificationFeedbackType.Success);
    else if (kind === 'warning') void mod.notificationAsync(mod.NotificationFeedbackType.Warning);
    else void mod.impactAsync(kind === 'medium' ? mod.ImpactFeedbackStyle.Medium : mod.ImpactFeedbackStyle.Light);
  } catch {
    mod = null;
  }
}

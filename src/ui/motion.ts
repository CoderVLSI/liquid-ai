import { AccessibilityInfo } from 'react-native';

/** True when the user turned animations off in Android settings; every animation duration becomes 0 then. */
export const motion = { reduce: false };

try {
  AccessibilityInfo.isReduceMotionEnabled()
    .then((v) => {
      motion.reduce = v;
    })
    .catch(() => {});
  AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
    motion.reduce = v;
  });
} catch {
  // not available (tests / very old Android): animate normally
}

export const ms = (n: number): number => (motion.reduce ? 0 : n);

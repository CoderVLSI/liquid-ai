// Which picture of a buddy to show. Every buddy has up to eight expression poses (all the same canvas size); the app
// swaps between them and moves the whole picture (breathing, hopping, wobbling) to bring it to life.

export const POSES = ['idle', 'blink', 'talk', 'happy', 'think', 'wait', 'sleep', 'sad'] as const;
export type Pose = (typeof POSES)[number];

export type Mood = 'asleep' | 'idle' | 'listening' | 'working' | 'waiting' | 'talking' | 'happy' | 'sad';

const PRIMARY: Record<Mood, Pose> = {
  asleep: 'sleep',
  idle: 'idle',
  listening: 'idle',
  working: 'think',
  waiting: 'wait',
  talking: 'idle',
  happy: 'happy',
  sad: 'sad',
};

/** moods in which the eyes may blink */
const BLINKS = new Set<Mood>(['idle', 'listening', 'waiting', 'talking']);

/**
 * The pose for a mood. `blink` and `mouth` are the two little flickers the view drives with timers.
 * A buddy without some poses still works: anything missing falls back to idle.
 */
export function choosePose(mood: Mood, flick: { blink: boolean; mouth: boolean }, has: (p: Pose) => boolean): Pose {
  let want: Pose = PRIMARY[mood];
  if (mood === 'talking' && flick.mouth) want = 'talk';
  else if (flick.blink && BLINKS.has(mood)) want = 'blink';
  if (has(want)) return want;
  if (has('idle')) return 'idle';
  return POSES.find((p) => has(p)) ?? 'idle';
}

/** The app's agent/voice states as buddy moods. */
export function moodFromVoice(state: string, muted: boolean): Mood {
  if (muted) return 'asleep';
  switch (state) {
    case 'hearing':
      return 'waiting';
    case 'thinking':
      return 'working';
    case 'speaking':
      return 'talking';
    case 'error':
      return 'sad';
    default:
      return 'listening';
  }
}

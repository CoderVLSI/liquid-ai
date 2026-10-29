// Energy-based voice activity detection over the RMS level of 40 ms mic frames.
// The model server does no turn detection of its own ("turn_detection": null), so we do it here.
//
// Design notes:
//  - Audio is only sent to the server once speech is *confirmed*, because audio already sent
//    cannot be taken back (the server prefills it into the conversation as it arrives).
//  - While the assistant is talking we require louder + longer speech before treating it as
//    a barge-in, so its own voice leaking into the mic does not cut it off.

export interface VadOptions {
  frameMs: number;
  /** Absolute floor of the speech threshold (RMS, 0..1). */
  minAbs: number;
  /** Speech must exceed noiseFloor * startRatio. */
  startRatio: number;
  /** Consecutive loud frames to confirm the start of speech. */
  confirmFrames: number;
  /** Silence needed to end the user's turn. */
  endSilenceMs: number;
  /** Turns shorter than this are treated as noise and do not trigger a response. */
  minSpeechMs: number;
  /** Threshold multiplier while the assistant is speaking. */
  bargeInFactor: number;
  /** Confirm frames while the assistant is speaking. */
  bargeInConfirmFrames: number;
}

export const DEFAULT_VAD: VadOptions = {
  frameMs: 40,
  minAbs: 0.012,
  startRatio: 3,
  confirmFrames: 3,
  endSilenceMs: 800,
  minSpeechMs: 240,
  bargeInFactor: 2,
  bargeInConfirmFrames: 6,
};

/** sensitivity 0 (needs loud speech) .. 1 (picks up whispers) */
export function vadFromSensitivity(sensitivity: number, endSilenceMs: number): VadOptions {
  const s = Math.min(1, Math.max(0, sensitivity));
  return {
    ...DEFAULT_VAD,
    minAbs: 0.03 - s * 0.024, // 0.030 .. 0.006
    startRatio: 4 - s * 2, // 4 .. 2
    endSilenceMs,
  };
}

export type VadEvent = 'speechStart' | 'speechEnd' | 'speechAbort' | null;

export class Vad {
  noise = 0.004;
  speaking = false;
  lastSpeechMs = 0;
  private run = 0;
  private silentMs = 0;
  private speechMs = 0;

  opts: VadOptions;

  constructor(opts: VadOptions = DEFAULT_VAD) {
    this.opts = opts;
  }

  reset(): void {
    this.speaking = false;
    this.run = 0;
    this.silentMs = 0;
    this.speechMs = 0;
  }

  threshold(assistantSpeaking: boolean): number {
    const base = Math.max(this.opts.minAbs, this.noise * this.opts.startRatio);
    return assistantSpeaking ? base * this.opts.bargeInFactor : base;
  }

  push(rms: number, assistantSpeaking: boolean): VadEvent {
    const o = this.opts;
    const thr = this.threshold(assistantSpeaking);
    const loud = rms > thr;

    if (!this.speaking) {
      if (loud) {
        this.run++;
        const need = assistantSpeaking ? o.bargeInConfirmFrames : o.confirmFrames;
        if (this.run >= need) {
          this.speaking = true;
          this.speechMs = this.run * o.frameMs;
          this.silentMs = 0;
          this.run = 0;
          return 'speechStart';
        }
      } else {
        this.run = 0;
        // learn the room's noise floor from quiet frames only
        this.noise = Math.min(0.05, this.noise * 0.95 + rms * 0.05);
      }
      return null;
    }

    this.speechMs += o.frameMs;
    // hysteresis: a frame only counts as silence once it is well under the threshold
    if (rms > thr * 0.6) this.silentMs = 0;
    else this.silentMs += o.frameMs;

    if (this.silentMs >= o.endSilenceMs) {
      this.speaking = false;
      this.lastSpeechMs = this.speechMs - this.silentMs;
      this.silentMs = 0;
      this.speechMs = 0;
      return this.lastSpeechMs >= o.minSpeechMs ? 'speechEnd' : 'speechAbort';
    }
    return null;
  }
}

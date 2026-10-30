// Buddy evolution: using your buddy earns XP; enough XP evolves it (Stage 1 -> 2 -> 3). From Stage 2 it also earns
// Mega charges; spending one turns it into a temporary, stronger-looking Mega form.

export type Form = 'base' | 'stage2' | 'stage3' | 'mega';
export type Stage = 1 | 2 | 3;

/** total XP needed to reach stage 1, 2 and 3 */
export const STAGE_XP = [0, 150, 500] as const;
/** a Mega charge for every this much XP beyond Stage 2 */
export const MEGA_EVERY = 250;
export const MEGA_MAX_CHARGES = 3;
export const MEGA_MINUTES = 60;

/** what the user's activity is worth */
export const XP = { message: 1, voiceTurn: 2, task: 3, dailyBonus: 5 } as const;

export function stageFor(xp: number): Stage {
  return xp >= STAGE_XP[2] ? 3 : xp >= STAGE_XP[1] ? 2 : 1;
}

export function formFor(xp: number, megaActive: boolean): Form {
  if (megaActive && stageFor(xp) >= 2) return 'mega';
  const s = stageFor(xp);
  return s === 3 ? 'stage3' : s === 2 ? 'stage2' : 'base';
}

export interface Progress {
  stage: Stage;
  /** XP inside this stage */
  into: number;
  /** XP this stage needs (0 at the last stage) */
  need: number;
  /** 0..1 towards the next stage (1 at the last stage) */
  pct: number;
}

export function progress(xp: number): Progress {
  const stage = stageFor(xp);
  if (stage === 3) return { stage, into: xp - STAGE_XP[2], need: 0, pct: 1 };
  const from = STAGE_XP[stage - 1];
  const to = STAGE_XP[stage];
  return { stage, into: xp - from, need: to - from, pct: Math.max(0, Math.min(1, (xp - from) / (to - from))) };
}

/** The form it just evolved into when XP crosses a stage line, else null. */
export function evolvedBetween(before: number, after: number): 'stage2' | 'stage3' | null {
  const a = stageFor(before);
  const b = stageFor(after);
  return b > a ? (b === 3 ? 'stage3' : 'stage2') : null;
}

/** Unspent Mega charges. */
export function megaCharges(xp: number, used: number): number {
  if (stageFor(xp) < 2) return 0;
  const earned = Math.floor((xp - STAGE_XP[1]) / MEGA_EVERY) + 1; // the first one comes with Stage 2
  return Math.max(0, Math.min(MEGA_MAX_CHARGES, earned - used));
}

export const isMegaActive = (megaUntil: number, now: number) => megaUntil > now;

/** "2026-10-30" for the day on the user's clock (pass a wall date from toWall). */
export function dayKey(wall: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${wall.getFullYear()}-${p(wall.getMonth() + 1)}-${p(wall.getDate())}`;
}

/** Streak of consecutive active days. `bonus` is true the first time today. */
export function nextStreak(lastDay: string, streak: number, today: string): { streak: number; bonus: boolean } {
  if (lastDay === today) return { streak, bonus: false };
  const y = new Date(today + 'T00:00:00Z');
  y.setUTCDate(y.getUTCDate() - 1);
  const yesterday = y.toISOString().slice(0, 10);
  return { streak: lastDay === yesterday ? streak + 1 : 1, bonus: true };
}

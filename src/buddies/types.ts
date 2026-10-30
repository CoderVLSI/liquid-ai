import type { Pose } from './mood';

/** One mascot. `poses` are bundled images (what require() returns); `idle` is always present. */
export interface BuddyForm {
  name: string;
  poses: Partial<Record<Pose, number>>;
  /** evolved forms, when their art exists; missing poses fall back to the base art */
  forms?: Partial<Record<'stage2' | 'stage3' | 'mega', BuddyForm>>;
}

export interface BuddyData {
  id: string;
  name: string;
  tagline: string;
  /** accent colour for the card and glow */
  color: string;
  poses: Partial<Record<Pose, number>>;
  /** evolved forms, when their art exists; missing poses fall back to the base art */
  forms?: Partial<Record<'stage2' | 'stage3' | 'mega', BuddyForm>>;
}

import type { Pose } from './mood';

/** One mascot. `poses` are bundled images (what require() returns); `idle` is always present. */
export interface BuddyData {
  id: string;
  name: string;
  tagline: string;
  /** accent colour for the card and glow */
  color: string;
  poses: Partial<Record<Pose, number>>;
}

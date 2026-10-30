import { GENERATED } from './generated';
import type { BuddyData } from './types';

/** The original glowing orb: drawn by the app itself (no pose images). */
export const ORB: BuddyData = { id: 'orb', name: 'Aurora', tagline: 'The original glowing orb.', color: '#27E8F6', poses: {} };

export const BUDDIES: BuddyData[] = [ORB, ...GENERATED];

export function getBuddy(id: string | undefined): BuddyData {
  return BUDDIES.find((b) => b.id === id) ?? ORB;
}

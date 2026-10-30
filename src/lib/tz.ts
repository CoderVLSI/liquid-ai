// Time zones without a library. A "wall" Date is a Date whose LOCAL getters (getHours()...) show the clock in a chosen
// zone; the date parser and formatter work on wall dates, and fromWall() turns the result back into a real instant.

export interface ZoneOption {
  id: string; // IANA name, or 'auto'
  label: string;
  short: string;
}

export const ZONES: ZoneOption[] = [
  { id: 'auto', label: 'Automatic (this phone)', short: '' },
  { id: 'Asia/Kolkata', label: 'India', short: 'IST' },
  { id: 'UTC', label: 'UTC', short: 'UTC' },
  { id: 'America/Los_Angeles', label: 'US Pacific', short: 'PT' },
  { id: 'America/Denver', label: 'US Mountain', short: 'MT' },
  { id: 'America/Chicago', label: 'US Central', short: 'CT' },
  { id: 'America/New_York', label: 'US Eastern', short: 'ET' },
  { id: 'Europe/London', label: 'United Kingdom', short: 'UK' },
  { id: 'Europe/Paris', label: 'Central Europe', short: 'CET' },
  { id: 'Asia/Dubai', label: 'Gulf (Dubai)', short: 'GST' },
  { id: 'Asia/Dhaka', label: 'Bangladesh', short: 'BST' },
  { id: 'Asia/Singapore', label: 'Singapore', short: 'SGT' },
  { id: 'Asia/Shanghai', label: 'China', short: 'CST' },
  { id: 'Asia/Tokyo', label: 'Japan', short: 'JST' },
  { id: 'Australia/Sydney', label: 'Sydney', short: 'AEST' },
  { id: 'Pacific/Auckland', label: 'New Zealand', short: 'NZST' },
];

export function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function zoneValid(id: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: id });
    return true;
  } catch {
    return false;
  }
}

/** 'auto' (or anything unknown) becomes the phone's own zone. */
export function resolveZone(id: string | undefined): string {
  if (!id || id === 'auto') return deviceZone();
  return zoneValid(id) ? id : deviceZone();
}

export function zoneLabel(id: string | undefined): string {
  if (!id || id === 'auto') return 'local time';
  return ZONES.find((z) => z.id === id)?.short || id;
}

interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function parts(instant: number, zone: string): Parts {
  let f = fmtCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    fmtCache.set(zone, f);
  }
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(instant))) if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10);
  return { y: o.year, mo: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, mi: o.minute, s: o.second };
}

/** how far the zone's clock is ahead of UTC at that instant, in ms */
function offsetMs(instant: number, zone: string): number {
  const p = parts(instant, zone);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(instant / 1000) * 1000;
}

/** The moment `date` as a clock reading in `zone`, packed into a Date's local fields. */
export function toWall(date: Date, zone: string): Date {
  if (zone === deviceZone()) return new Date(date.getTime());
  try {
    const p = parts(date.getTime(), zone);
    return new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s, 0);
  } catch {
    return new Date(date.getTime());
  }
}

/** Inverse of toWall: the real instant at which `zone`'s clock shows the wall date's local fields. */
export function fromWall(wall: Date, zone: string): Date {
  if (zone === deviceZone()) return new Date(wall.getTime());
  try {
    const asUtc = Date.UTC(wall.getFullYear(), wall.getMonth(), wall.getDate(), wall.getHours(), wall.getMinutes(), wall.getSeconds(), 0);
    let t = asUtc - offsetMs(asUtc, zone);
    t = asUtc - offsetMs(t, zone); // second pass settles the answer around daylight-saving changes
    return new Date(t);
  } catch {
    return new Date(wall.getTime());
  }
}

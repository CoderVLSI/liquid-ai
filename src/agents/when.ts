const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
};

function unitKey(u: string): string {
  const c = u[0];
  return c === 's' || c === 'm' || c === 'h' || c === 'd' || c === 'w' ? c : '';
}

const at = (base: Date, dayOffset: number, h: number, m: number): Date => new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, h, m, 0, 0);

/**
 * Turns the words a person would say into a moment: "in 20 minutes", "tomorrow 9am", "friday 6pm", "11:30",
 * "2026-11-01 08:15". Small models are bad at date arithmetic, so the tools do it instead of the model.
 * A bare hour with no am/pm ("by 12", "at 5") means whichever of the two readings comes next.
 */
export function parseWhen(input: string, now: Date): Date | null {
  const s = String(input ?? '')
    .toLowerCase()
    .replace(/\b([ap])\.m\.?/g, '$1m')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2}))?/);
  if (iso) {
    const d = new Date(+iso[1], +iso[2] - 1, +iso[3], iso[4] ? +iso[4] : 9, iso[5] ? +iso[5] : 0, 0, 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // relative: "in 20 minutes", "in 1 hour 30 minutes", "in half an hour", "2 days"
  if (/^in /.test(s) || /^\d+(\.\d+)? ?(s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)$/.test(s)) {
    let ms = 0;
    let found = false;
    const re = /(half an?|an?|\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|[smhdw])\b/g;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      const k = unitKey(m[2]);
      if (!k) continue;
      const n = m[1].startsWith('half') ? 0.5 : /^an?$/.test(m[1]) ? 1 : parseFloat(m[1]);
      ms += n * UNIT_MS[k];
      found = true;
    }
    if (found && ms > 0) return new Date(now.getTime() + ms);
  }

  // which day?
  let dayOffset: number | null = null;
  let dayWord = false;
  if (/\bday after tomorrow\b/.test(s)) dayOffset = 2;
  else if (/\btomorrow\b|\btmrw\b/.test(s)) dayOffset = 1;
  else if (/\btoday\b|\btonight\b|\bthis (morning|afternoon|evening)\b/.test(s)) dayOffset = 0;
  if (dayOffset != null) dayWord = true;

  let weekday = -1;
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b(${DAYS[i]}|${DAY_ABBR[i]})\\b`).test(s)) {
      weekday = i;
      break;
    }
  }
  const nextWord = /\bnext\b/.test(s);

  // which time of day?
  let part: 'am' | 'pm' | null = null;
  let defaultTime: [number, number] | null = null;
  if (/\bnoon\b/.test(s)) defaultTime = [12, 0];
  else if (/\bmidnight\b/.test(s)) defaultTime = [0, 0];
  else if (/\btonight\b/.test(s)) (part = 'pm'), (defaultTime = [20, 0]);
  else if (/\bevening\b/.test(s)) (part = 'pm'), (defaultTime = [18, 0]);
  else if (/\bafternoon\b/.test(s)) (part = 'pm'), (defaultTime = [15, 0]);
  else if (/\bmorning\b/.test(s)) (part = 'am'), (defaultTime = [9, 0]);

  let candidates: [number, number][] = [];
  const t = s.match(/(?:^|[^\d:])(\d{1,2})(?::(\d{2}))?\s*(am|pm|a m|p m)?(?![\d:])/);
  if (t) {
    let h = +t[1];
    const min = t[2] ? +t[2] : 0;
    const mer = t[3] ? t[3].replace(' ', '') : null;
    if (h <= 24 && min <= 59) {
      if (mer === 'am') candidates = [[h % 12, min]];
      else if (mer === 'pm') candidates = [[(h % 12) + 12, min]];
      else if (h >= 13 || h === 0) candidates = [[h % 24, min]];
      else if (part === 'pm') candidates = [[(h % 12) + 12, min]];
      else if (part === 'am') candidates = [[h % 12, min]];
      else if ((dayWord && dayOffset !== 0) || weekday >= 0) candidates = h === 12 ? [[12, min]] : [[h, min]]; // "tomorrow 9" means 9 in the morning
      else candidates = [[h % 12, min], [(h % 12) + 12, min]]; // bare "5" or "12": whichever comes next
    }
  }
  if (!candidates.length && defaultTime) candidates = [defaultTime];
  const hasDay = dayOffset != null || weekday >= 0;
  if (!candidates.length && hasDay) candidates = [[9, 0]];
  if (!candidates.length) return null;

  const pick = (offset: number): Date => {
    const all = candidates.map(([h, m]) => at(now, offset, h, m)).sort((a, b) => a.getTime() - b.getTime());
    // "today" with two possible readings: the one that is still ahead
    const ahead = offset === 0 ? all.filter((d) => d.getTime() > now.getTime()) : all;
    return (ahead.length ? ahead : all)[0];
  };

  if (dayOffset != null) return pick(dayOffset);
  if (weekday >= 0) {
    let ahead = (weekday - now.getDay() + 7) % 7;
    if (ahead === 0 && (nextWord || pick(0).getTime() <= now.getTime())) ahead = 7;
    return pick(ahead);
  }
  // no day given: the soonest future time among the readings
  const options = candidates.flatMap(([h, m]) => [at(now, 0, h, m), at(now, 1, h, m)]).filter((d) => d.getTime() > now.getTime() + 1000);
  options.sort((a, b) => a.getTime() - b.getTime());
  return options[0] ?? null;
}

export function describeIn(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'less than a minute';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}${m ? ` ${m} min` : ''}`;
  const d = Math.round(ms / 86_400_000);
  return `${d} days`;
}

/** 2026-10-30T09:00, the form calendar tools want */
export function toLocalIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

import type { Settings, Tone } from './settings.ts';

export const TONES: { id: Tone; label: string; line: string }[] = [
  { id: 'friendly', label: 'Friendly', line: 'Be warm and friendly, but keep answers short.' },
  { id: 'concise', label: 'Straight to the point', line: 'Be brief and direct. No small talk.' },
  { id: 'formal', label: 'Professional', line: 'Be polite and professional.' },
];

export const INTERESTS = [
  'Reminders and to-dos',
  'Notes and ideas',
  'Studying and homework',
  'Research and facts',
  'Email and calendar',
  'Coding and tech',
  'Daily planning',
  'Just chatting',
];

/** What the assistant should know about itself and the user. Empty fields are left out. */
export function personaLine(s: Pick<Settings, 'agentName' | 'userName' | 'goals' | 'interests' | 'tone'>): string {
  const parts: string[] = [];
  if (s.agentName.trim()) parts.push(`Your name is ${s.agentName.trim()}.`);
  if (s.userName.trim()) parts.push(`The user's name is ${s.userName.trim()}; use it now and then, not in every sentence.`);
  const topics = [...s.interests, s.goals.trim()].filter(Boolean);
  if (topics.length) parts.push(`The user mainly wants help with: ${topics.join('; ')}.`);
  const tone = TONES.find((t) => t.id === s.tone);
  if (tone) parts.push(tone.line);
  return parts.join(' ');
}

/** A base prompt plus the persona line. */
export function withPersona(prompt: string, s: Parameters<typeof personaLine>[0]): string {
  const line = personaLine(s);
  return line ? `${prompt.trim()} ${line}` : prompt;
}

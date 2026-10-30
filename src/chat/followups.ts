/** One-tap things to say after a reply. Static on purpose: no extra model call, so they appear instantly. */
export function suggestFollowUps(reply: string): string[] {
  const r = reply.trim();
  if (!r || r === '(no answer)') return [];
  if (/\?\s*$/.test(r)) return []; // it asked you something: your answer is the follow-up
  if (r.length < 90) return ['Tell me more', 'Give an example'];
  return ['Summarise that', 'Explain simply', 'Give an example'];
}

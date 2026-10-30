// Turns the model's streamed text into chunks the phone's speech engine can say: whole sentences, spoken as soon as
// they are complete, with markdown, links and emoji removed (a TTS engine would read them out).

const ABBREV = /(?:^|\s)(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|approx|no)\.$/i;
const FIRST_CHUNK_MIN = 18;
const MAX_CHUNK = 220;

/** What to say for a piece of model text: no markdown, no links, no emoji, one line. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[*_~#>|]+/g, ' ')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\.\s*\.(\s*\.)*/g, '.')
    .replace(/([.!?])\s*\./g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export interface SpeechSplit {
  /** complete chunks, already cleaned and ready to speak */
  chunks: string[];
  /** text still waiting for its sentence to finish */
  rest: string;
}

/**
 * Takes the text buffered so far and splits off every finished sentence.
 * `first` lets the very first chunk of a reply end early at a comma, so speech starts sooner.
 * `final` flushes whatever is left when the reply is over.
 */
export function splitSpeech(buffer: string, opts: { final?: boolean; first?: boolean } = {}): SpeechSplit {
  const chunks: string[] = [];
  let rest = buffer;
  let first = !!opts.first;

  for (;;) {
    let cut = -1;
    // a sentence ends at . ! ? … (or a line break) followed by whitespace
    const re = /[.!?…]+["')\]]*\s|\n/g;
    for (let m = re.exec(rest); m; m = re.exec(rest)) {
      const end = m.index + m[0].length;
      const head = rest.slice(0, m.index + 1);
      if (m[0][0] === '.' && ABBREV.test(head)) continue;
      cut = end;
      break;
    }
    // the first chunk may also end at a comma or dash so the voice starts early
    if (cut < 0 && first) {
      const soft = /[,;:—–]\s/g;
      for (let m = soft.exec(rest); m; m = soft.exec(rest)) {
        if (m.index >= FIRST_CHUNK_MIN) {
          cut = m.index + m[0].length;
          break;
        }
      }
    }
    // no boundary but a very long run: cut at the last space
    if (cut < 0 && rest.length > MAX_CHUNK) {
      const sp = rest.lastIndexOf(' ', MAX_CHUNK);
      cut = sp > 40 ? sp + 1 : MAX_CHUNK;
    }
    if (cut < 0) break;
    const piece = cleanForSpeech(rest.slice(0, cut));
    rest = rest.slice(cut);
    if (piece) {
      chunks.push(piece);
      first = false;
    }
  }

  if (opts.final) {
    const tail = cleanForSpeech(rest);
    if (tail) chunks.push(tail);
    rest = '';
  }
  return { chunks, rest };
}

// Turning web pages into text a small model can read.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(0x10ffff, parseInt(n, 10))))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(0x10ffff, parseInt(n, 16))))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Readable text of an HTML page: drops scripts/styles/nav chrome, keeps paragraph breaks. */
export function htmlToText(html: string, maxChars = 6000): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|head|nav|footer|form|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s)
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s.length > maxChars ? s.slice(0, maxChars) + '\n…[truncated]' : s;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** Parses the lightweight DuckDuckGo HTML results page. */
export function parseDuckDuckGo(html: string, max = 6): SearchHit[] {
  const hits: SearchHit[] = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="[^"]*result__a|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && hits.length < max) {
    let url = decodeEntities(m[1]);
    const redirect = /[?&]uddg=([^&]+)/.exec(url);
    if (redirect) {
      try {
        url = decodeURIComponent(redirect[1]);
      } catch {
        // keep as is
      }
    }
    if (url.startsWith('//')) url = 'https:' + url;
    if (!/^https?:\/\//.test(url)) continue;
    const snip = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(m[3]);
    hits.push({
      title: decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim(),
      url,
      snippet: snip ? decodeEntities(snip[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : '',
    });
  }
  return hits;
}

export function formatHits(hits: SearchHit[]): string {
  if (!hits.length) return 'No results.';
  return hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join('\n');
}

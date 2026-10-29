// Tiny encoding helpers (no Buffer / TextDecoder needed on React Native).

const STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += STD[(n >> 18) & 63] + STD[(n >> 12) & 63];
    out += i + 1 < bytes.length ? STD[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? STD[n & 63] : '=';
  }
  return out;
}

export function base64urlToBytes(s: string): Uint8Array {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    buf = (buf << 6) | STD.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return new Uint8Array(out);
}

export function bytesToUtf8(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c >= 0xc0 && c < 0xe0) out += String.fromCharCode(((c & 31) << 6) | (b[i++] & 63));
    else if (c >= 0xe0 && c < 0xf0) out += String.fromCharCode(((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63));
    else if (c >= 0xf0) out += String.fromCodePoint(((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63));
  }
  return out;
}

export const decodeBase64Url = (s: string) => bytesToUtf8(base64urlToBytes(s));

/** RFC 2047 encoded-word, so non-ASCII subjects survive email. */
export function encodeHeader(text: string, utf8: (s: string) => Uint8Array): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${base64(utf8(text))}?=`;
}

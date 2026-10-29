import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { base64url, challengeFor, newVerifier, sha256, utf8 } from './pkce.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

test('sha256 matches the standard test vectors', () => {
  assert.equal(hex(sha256(utf8(''))), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hex(sha256(utf8('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    hex(sha256(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test('sha256 agrees with node for many lengths (padding edge cases)', () => {
  for (let n = 0; n < 200; n++) {
    const data = new Uint8Array(n).map((_, i) => (i * 7 + n) & 255);
    assert.equal(hex(sha256(data)), createHash('sha256').update(data).digest('hex'), `length ${n}`);
  }
});

test('utf8 encodes multi-byte characters like Buffer', () => {
  for (const s of ['héllo', '日本語', '🙂 emoji', 'plain']) assert.deepEqual(Buffer.from(utf8(s)), Buffer.from(s, 'utf8'));
});

test('base64url has no padding or unsafe characters', () => {
  for (let n = 0; n < 40; n++) {
    const data = new Uint8Array(n).map((_, i) => (i * 31 + 5) & 255);
    assert.equal(base64url(data), Buffer.from(data).toString('base64url'));
  }
});

test('the RFC 7636 example challenge is reproduced', () => {
  assert.equal(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('verifiers are url-safe, long enough and different each time', () => {
  const a = newVerifier();
  const b = newVerifier();
  assert.match(a, /^[A-Za-z0-9\-_]{43,128}$/);
  assert.notEqual(a, b);
});

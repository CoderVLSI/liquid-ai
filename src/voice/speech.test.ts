import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanForSpeech, splitSpeech } from './speech.ts';

test('markdown, links and emoji are not read out', () => {
  assert.equal(cleanForSpeech('**Sure!** Here is `code` and a [link](http://x.y) 😀'), 'Sure! Here is code and a link');
  assert.equal(cleanForSpeech('# Title\n- one\n- two\n1. three'), 'Title. one. two. three');
  assert.equal(cleanForSpeech('see https://example.com/a?b=1 now'), 'see link now');
});

test('splits finished sentences and keeps the unfinished one', () => {
  const r = splitSpeech('Hello there. How are you? I am fi');
  assert.deepEqual(r.chunks, ['Hello there.', 'How are you?']);
  assert.equal(r.rest, 'I am fi');
});

test('a sentence is not finished until whitespace follows the full stop (3.5 stays whole)', () => {
  assert.deepEqual(splitSpeech('It is 3.5 degrees').chunks, []);
  assert.deepEqual(splitSpeech('Version 3.5 is out. Next').chunks, ['Version 3.5 is out.']);
  assert.deepEqual(splitSpeech('Wait for it.').chunks, []); // the next token may continue it
  assert.deepEqual(splitSpeech('Wait for it.', { final: true }).chunks, ['Wait for it.']);
});

test('abbreviations do not end a sentence', () => {
  const r = splitSpeech('Ask Dr. Rao about it. Then go. ');
  assert.deepEqual(r.chunks, ['Ask Dr. Rao about it.', 'Then go.']);
});

test('the first chunk may end at a comma so speech starts early', () => {
  const r = splitSpeech('Well, that is a really good question about this, and more', { first: true });
  assert.deepEqual(r.chunks, ['Well, that is a really good question about this,']);
  assert.equal(r.rest, 'and more');
  // later chunks wait for the sentence end
  assert.deepEqual(splitSpeech('Well, that is a really good question about this, and more').chunks, []);
  // a too-short first clause is not worth a separate utterance
  assert.deepEqual(splitSpeech('Yes, and then', { first: true }).chunks, []);
});

test('a very long run without punctuation is cut at a space', () => {
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const r = splitSpeech(long);
  assert.ok(r.chunks.length >= 1);
  assert.ok(r.chunks.every((c) => c.length <= 230));
  assert.equal([...r.chunks, r.rest].join(' ').replace(/\s+/g, ' ').trim(), long);
});

test('final flushes everything and line breaks end a sentence', () => {
  const r = splitSpeech('First line\nSecond line', { final: true });
  assert.deepEqual(r.chunks, ['First line.', 'Second line']);
  assert.equal(r.rest, '');
  assert.deepEqual(splitSpeech('', { final: true }).chunks, []);
});

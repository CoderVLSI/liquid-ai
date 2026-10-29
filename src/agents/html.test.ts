import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, parseDuckDuckGo, decodeEntities } from './html.ts';

test('htmlToText drops scripts, styles and tags but keeps structure', () => {
  const t = htmlToText(`<html><head><title>x</title><style>p{}</style></head><body>
    <nav>menu</nav><h1>Title</h1><p>Hello &amp; welcome</p><script>alert(1)</script>
    <ul><li>one</li><li>two</li></ul><footer>foot</footer></body></html>`);
  assert.ok(t.includes('Title'));
  assert.ok(t.includes('Hello & welcome'));
  assert.ok(t.includes('• one') && t.includes('• two'));
  assert.ok(!/alert|menu|foot|<|p\{\}/.test(t));
});

test('htmlToText truncates long pages', () => {
  const t = htmlToText('<p>' + 'a'.repeat(10000) + '</p>', 100);
  assert.ok(t.length < 130 && t.endsWith('[truncated]'));
});

test('entities decode, including numeric ones', () => {
  assert.equal(decodeEntities('a&nbsp;b &#8212; &#x41; &unknown;'), 'a b — A &unknown;');
});

const DDG = `
<div class="result"><h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1&amp;rut=abc">First <b>result</b></a></h2>
<a class="result__snippet" href="//x">A snippet about <b>things</b> &amp; stuff.</a></div>
<div class="result"><h2 class="result__title"><a class="result__a" href="https://direct.org/page">Second</a></h2>
<a class="result__snippet" href="//x">Another snippet.</a></div>`;

test('parses DuckDuckGo results, unwrapping redirect links', () => {
  const hits = parseDuckDuckGo(DDG);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits[0], { title: 'First result', url: 'https://example.com/a?x=1', snippet: 'A snippet about things & stuff.' });
  assert.equal(hits[1].url, 'https://direct.org/page');
  assert.equal(hits[1].snippet, 'Another snippet.');
});

test('no results gives an empty list', () => {
  assert.deepEqual(parseDuckDuckGo('<html>nothing</html>'), []);
});

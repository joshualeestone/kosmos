'use strict';
/**
 * kosmos#7861 (Josh): a bare web address the chat makes a link (joshualeestone.com) gets the same preview as one
 * typed with http://, fetched as https:// first and as http:// only when https was not reached.
 *
 * Three things are checked here:
 *   1. the engine finds a bare address by the SAME rule the page links one by (web/index.html pjBareWeb and
 *      pjBareSplit are lifted and run beside the engine's copies on one list of words);
 *   2. which link in a message is the one previewed;
 *   3. the https-then-http order, and that a refusal from the address gate never falls back.
 * Nothing touches the network: the fetcher and the resolver are the module's own seams.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const unfurl = require('./unfurl');
const page = require('../test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8'));
const pageFns = new Function(page.lift(SCRIPT, 'pjBareWeb') + '\n' + page.lift(SCRIPT, 'pjBareSplit') + '\nreturn { pjBareWeb, pjBareSplit };')();

function fakeResponse({ status = 200, type = 'text/html; charset=utf-8', body = '' } = {}) {
  const bytes = Buffer.from(String(body));
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) },
    body: { getReader() { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(bytes) })), cancel: async () => {} }; } },
    arrayBuffer: async () => bytes,
  };
}
/* pages: url -> a response spec, 'unreachable' (the fetch throws), or absent (the test fails loudly). */
function world({ pages = {}, resolve = {} } = {}) {
  const calls = [];
  unfurl.setFetcher(async (url) => {
    calls.push(url);
    const p = pages[url];
    if (p === 'unreachable') throw new TypeError('fetch failed');
    if (!p) throw new Error('no such page in the fixture: ' + url);
    return fakeResponse(p);
  });
  unfurl.setResolver(async (host) => (host in resolve
    ? resolve[host].map((address) => ({ address, family: 4 }))
    : [{ address: '93.184.216.34', family: 4 }]));
  return calls;
}
test.afterEach(() => unfurl.resetForTests());

const WORDS = [
  'joshualeestone.com', 'joshualeestone.com.', '(joshualeestone.com)', '"meridianworks.kosmosplus.com"', 'example.com\'s',
  'www.example.com/path?q=1#x', 'example.com:8080', 'en.wikipedia.org/wiki/Foo_(bar)', 'GitHub.com', 'docs.example.dev',
  'claude.ai', 'claude.ai/settings', 'www.claude.ai', 'notes.md', 'Kosmos.app', 'setup.sh', 'main.py', 'store.ROOT',
  'logger.info', '0.7.70', 'x@example.com', 'example.COM', 'a.b', '', '...', 'foo.', '.com', 'sub.example.co.uk',
  'self.me', 'done.it', 'example.no/x', '*example.com*', '“example.org”', 'example.org)', 'example.org)),',
  'https://example.com', 'example.xyz/' + 'a'.repeat(40),
];

test('#7861: the engine finds a bare address exactly where the page links one (the page\'s own functions, lifted)', () => {
  assert.equal(typeof pageFns.pjBareWeb, 'function', 'CONTROL: the page function was lifted');
  let linked = 0;
  for (const w of WORDS) {
    assert.equal(unfurl.bareWeb(w), pageFns.pjBareWeb(w), 'bareWeb disagrees with the page on ' + JSON.stringify(w));
    assert.deepEqual(unfurl.bareSplit(w), pageFns.pjBareSplit(w), 'bareSplit disagrees with the page on ' + JSON.stringify(w));
    if (pageFns.pjBareWeb(w)) linked += 1;
  }
  // CONTROL: the list has both kinds, so agreement is not two functions that both say no.
  assert.ok(linked >= 6 && linked <= WORDS.length - 10, 'the list should hold links and non-links, got ' + linked + ' links');
});

test('#7861: which link in a message is previewed: the first, bare or explicit; code and other schemes are not', () => {
  const cases = [
    ['look at joshualeestone.com today', { url: 'https://joshualeestone.com', bare: true }],
    ['http://joshualeestone.com', { url: 'http://joshualeestone.com', bare: false }],
    ['https://a.example.com/x, then b.org', { url: 'https://a.example.com/x', bare: false }],
    ['first example.org then https://b.example.com', { url: 'https://example.org', bare: true }],
    ['(meridianworks.kosmosplus.com).', { url: 'https://meridianworks.kosmosplus.com', bare: true }],
    ['run `curl example.com` first', null],
    ['```\nexample.com\n```', null],
    ['ftp://files.example.com and notes.md', null],
    ['mail x@example.com', null],
    ['claude.ai alone', null],
    ['no link here', null],
  ];
  for (const [text, want] of cases) assert.deepEqual(unfurl.firstLinkInfo(text), want, JSON.stringify(text));
});

test('#7861: a bare address is fetched over https first, and http is never asked when https answers', async () => {
  const calls = world({ pages: { 'https://bare.example.com/': { body: '<title>Over https</title>' } } });
  const got = await unfurl.previewBare('https://bare.example.com/');
  assert.equal(got.ok, true);
  assert.equal(got.title, 'Over https');
  assert.deepEqual(calls, ['https://bare.example.com/']);
});

for (const [why, https] of [['could not be reached', 'unreachable'], ['answered 503', { status: 503, body: '' }]]) {
  test(`#7861: https that ${why} falls back to http, and the answer is kept under the https address`, async () => {
    const calls = world({ pages: { 'https://old.example.com/': https, 'http://old.example.com/': { body: '<title>Over http</title>' } } });
    const got = await unfurl.previewBare('https://old.example.com/');
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.equal(got.title, 'Over http');
    assert.deepEqual(calls, ['https://old.example.com/', 'http://old.example.com/']);
    assert.equal(unfurl.peek('https://old.example.com/').title, 'Over http', 'the payload helper peeks the https address');
  });
}

test('#7861: no fallback when https answered with something (not a page, nothing to show)', async () => {
  const calls = world({ pages: { 'https://pdf.example.com/': { type: 'application/pdf', body: '%PDF' }, 'https://plain.example.com/': { body: '<p>no tags</p>' } } });
  assert.equal((await unfurl.previewBare('https://pdf.example.com/')).ok, false);
  assert.equal((await unfurl.previewBare('https://plain.example.com/')).ok, false);
  assert.deepEqual(calls, ['https://pdf.example.com/', 'https://plain.example.com/'], 'http was asked after https answered');
});

test('#7861: the address gate is never sidestepped: a private address is refused over https and http is not tried', async () => {
  const calls = world({ resolve: { 'inside.example.com': ['10.0.0.5'] } });
  const got = await unfurl.previewBare('https://inside.example.com/');
  assert.equal(got.ok, false);
  assert.equal(got.because, 'links to this computer or this network are not fetched');
  assert.deepEqual(calls, [], 'a byte moved to a private address');
});

test('#7861: when both fail, the https refusal is what is kept', async () => {
  world({ pages: { 'https://gone.example.com/': 'unreachable', 'http://gone.example.com/': 'unreachable' } });
  const got = await unfurl.previewBare('https://gone.example.com/');
  assert.equal(got.ok, false);
  assert.equal(got.because, 'that site could not be reached');
});

test('#7861: warm with bare:true takes the https-then-http path; without it an explicit https link never falls back', async () => {
  const calls = world({ pages: { 'https://w.example.com/': 'unreachable', 'http://w.example.com/': { body: '<title>W</title>' } } });
  unfurl.warm('https://w.example.com/', { bare: true });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(unfurl.peek('https://w.example.com/').title, 'W');
  assert.deepEqual(calls, ['https://w.example.com/', 'http://w.example.com/']);
  unfurl.resetForTests();
  const calls2 = world({ pages: { 'https://x.example.com/': 'unreachable', 'http://x.example.com/': { body: '<title>X</title>' } } });
  unfurl.warm('https://x.example.com/');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(unfurl.peek('https://x.example.com/').ok, false, 'a link the person typed as https:// was quietly fetched over http');
  assert.deepEqual(calls2, ['https://x.example.com/']);
});

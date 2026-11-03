'use strict';
/**
 * kosmos#7861 (Josh): a bare web address the chat makes a link (joshualeestone.com) gets the same preview as one
 * typed with http://, fetched as https:// first and as http:// only when https was not reached.
 *
 * Four things are checked here:
 *   1. the engine finds a bare address by the SAME rule the page links one by (web/index.html pjBareWeb and
 *      pjBareSplit are lifted and run beside the engine's copies on one list of words);
 *   2. on whole messages, a fixed list and generated ones, a bare address the engine previews is always a link the
 *      page's own renderer (pjRich, lifted) draws: the board never fetches a word the chat shows as text;
 *   3. which link in a message is the one previewed;
 *   4. the https-then-http order, and that a refusal from the address gate never falls back.
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
const RICH = ['esc', 'pjRich', 'pjRichSpans', 'pjListDepth', 'pjBareWeb', 'pjBareSplit', 'pjTableAligns', 'pjTableCells', 'pjTableHtml'];
const pjRich = new Function(RICH.map((n) => page.lift(SCRIPT, n)).join('\n') + '\nreturn pjRich;')();
/* The project room's renderer, with no project file names (a file named like a host is a stated exception). */
const pjBody = new Function('let PJ_DOC_NAMES = null;\n' + RICH.concat(['pjBody', 'pjProse']).map((n) => page.lift(SCRIPT, n)).join('\n') + '\nreturn pjBody;')();
const roomLinks = (text) => [...pjBody(text).matchAll(/<a class="xlink" href="([^"]*)"/g)].map((m) => unesc(m[1]));
/* The addresses the page links in a message, in order. */
const unesc = (h) => h.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const pageLinks = (text) => [...pjRich(text).matchAll(/<a class="xlink" href="([^"]*)"/g)].map((m) => unesc(m[1]));
/* Until `ready()` holds or two seconds pass, so a loaded machine is not a red. */
async function until(ready) {
  for (let i = 0; i < 200 && !ready(); i += 1) await new Promise((r) => setTimeout(r, 10));
}

function fakeResponse({ status = 200, type = 'text/html; charset=utf-8', body = '' } = {}) {
  const bytes = Buffer.from(String(body));
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) },
    body: { getReader() { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array(bytes) })), cancel: async () => {} }; } },
    arrayBuffer: async () => bytes,
  };
}
/* pages: url -> a response spec, or 'unreachable' (the fetch throws). An absent page also throws, which the module reads
   as unreachable, so every test asserts the exact list of fetches it expects. */
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

const MESSAGES = [
  'see joshualeestone.com today', 'joshualeestone.com', 'go to www.example.com/path?q=1.', '(meridianworks.kosmosplus.com)',
  '[docs](example.com)', '[a example.com b](https://e.example.org)', '[x](https://y.example.org) then example.net',
  '| a | b |\n|---|---|\n| example.org | x |', '# Head example.net', '> quote example.io', '- item example.com',
  '1. first example.com', '**example.com**', '_example.com_', 'a `x`example.com', '```\nexample.com', '`` example.com',
  '```\nexample.com\n```\nthen example.org', 'run `curl example.com` first', 'notes.md and setup.sh', 'claude.ai alone',
  'claude.ai/settings', 'mail x@example.com', 'ftp://files.example.com then example.org', 'v0.7.70 is out',
  'first example.org then https://b.example.com', 'https://a.example.com/x, then b.org', 'store.ROOT and logger.info',
  'example.com\'s page', '"example.com"', 'line one\nline two example.dev/docs', 'see http://typed.example.com',
  'evil.example.com[x](y.org)', 'see evil.example.com[x](https://y.example.org)', 'evil.example.com[x](notalink)',
  '**example.com**[z.com](q.com)', '[l](t)x.example.com', '[docs](example.com).', '>example.com', '|a.example.com|b.org|',
  '| a |\n|---|\n| x | evil.example.com |', 'a | b\n--|--\nx | y | evil.example.com', '| [a|b](c.example.com) |\n|---|---|',
  '| h |\n|---|\n[a|b](c.example.com)', 'see example.com: it works', 'x.example.com:', 'example.com:8080/x',
  'example.com:x', 'javascript:alert(1) and mailto:a@b.co',
  '[' + 'a'.repeat(520) + ' evil-label.example.com ](https://ok.example.org)', '[x](' + 'b'.repeat(2100) + ' evil-target.example.com c)',
];

test('#7861: on a fixed list of whole messages, a bare address previewed is always a link the page itself draws', () => {
  let bare = 0;
  let missed = 0;
  for (const text of MESSAGES) {
    const got = unfurl.firstLinkInfo(text);
    const drawn = pageLinks(text);
    if (got && got.bare) {
      assert.ok(drawn.includes(got.url), 'previewed ' + got.url + ' but the page draws ' + JSON.stringify(drawn) + ' for ' + JSON.stringify(text));
      bare += 1;
    }
    if (!got && drawn.length) missed += 1;
  }
  assert.ok(bare >= 10, 'CONTROL: the list holds bare addresses the engine previews, got ' + bare);
  assert.ok(missed >= 1, 'CONTROL: the list holds a link the page draws that the conservative scan skips');
});

/* A small fixed-seed generator, so a red names a message that reproduces. */
function rng(seed) { let x = seed >>> 0; return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const PIECES = ['example.com', 'x.example.org', 'docs.example.dev/a', 'claude.ai', 'notes.md', 'https://e.example.net',
  'mailto:a@b.co', '[', ']', '(', ')', '[l](t.example.com)', '[a b](https://f.example.io)', '*', '**', '_', '~', '>', '#', '-',
  '|', '.', ',', '"', '\'', '\n', ' ', ' ', ' ', '1.', '---', 'word', 'www.example.uk/x?y=1',
  '\n|---|', '\n---|---', '\n| x | y |', '[a|b](c.example.com)', '| ', ' |', ':', ':8080', ': ', 'x:'];

test('#7861: on generated messages (no code), a bare address previewed is always a link the page itself draws', () => {
  const next = rng(7861);
  let checked = 0;
  for (let n = 0; n < 20000; n += 1) {
    let text = '';
    const len = 1 + Math.floor(next() * 9);
    for (let k = 0; k < len; k += 1) text += PIECES[Math.floor(next() * PIECES.length)];
    const got = unfurl.firstLinkInfo(text);
    if (!got || !got.bare) continue;
    checked += 1;
    const drawn = pageLinks(text);
    assert.ok(drawn.includes(got.url), 'previewed ' + got.url + ' but the page draws ' + JSON.stringify(drawn) + ' for ' + JSON.stringify(text));
    const room = roomLinks(text);
    assert.ok(room.includes(got.url), 'previewed ' + got.url + ' but the project room draws ' + JSON.stringify(room) + ' for ' + JSON.stringify(text));
  }
  assert.ok(checked >= 1000, 'CONTROL: enough generated messages had a bare address, got ' + checked);
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
    ['```\nexample.com', null],
    ['`` example.com', null],
    ['a `x`example.com', null],
    ['[docs](example.com)', null],
    ['see example.com, and [docs](https://d.example.org)', { url: 'https://d.example.org', bare: false }],
    ['[a example.com b](https://e.example.org)', { url: 'https://e.example.org', bare: false }],
    ['see joshualeestone.com: here it is', { url: 'https://joshualeestone.com', bare: true }],
    ['example.com:8080/x', { url: 'https://example.com:8080/x', bare: true }],
    ['mailto:a@b.co', null],
    ['ftp://files.example.com and notes.md', null],
    ['mail x@example.com', null],
    ['claude.ai alone', null],
    ['no link here', null],
  ];
  for (const [text, want] of cases) assert.deepEqual(unfurl.firstLinkInfo(text), want, JSON.stringify(text));
  // bare:false (a row carrying files) turns the bare scan off and leaves the explicit one.
  assert.equal(unfurl.firstLinkInfo('report.com', { bare: false }), null);
  assert.deepEqual(unfurl.firstLinkInfo('report.com https://e.example.org', { bare: false }), { url: 'https://e.example.org', bare: false });
});

test('#7861: a bare address is fetched over https first, and http is never asked when https answers', async () => {
  const calls = world({ pages: { 'https://bare.example.com/': { body: '<title>Over https</title>' } } });
  const got = await unfurl.previewBare('https://bare.example.com/');
  assert.equal(got.ok, true);
  assert.equal(got.title, 'Over https');
  assert.deepEqual(calls, ['https://bare.example.com/']);
});

for (const [why, https] of [['could not be reached', 'unreachable'], ['answered 503', { status: 503, body: '' }]]) {
  test(`#7861: https that ${why} falls back to http, kept under the bare key and never under the typed-https key`, async () => {
    const calls = world({ pages: { 'https://old.example.com/': https, 'http://old.example.com/': { body: '<title>Over http</title>' } } });
    const got = await unfurl.previewBare('https://old.example.com/');
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.equal(got.title, 'Over http');
    assert.equal(got.url, 'https://old.example.com/', 'the card opens the https address the word links to, never plain http');
    assert.deepEqual(calls, ['https://old.example.com/', 'http://old.example.com/']);
    assert.equal(unfurl.peekBare('https://old.example.com/').title, 'Over http', 'the payload helper peeks the bare key');
    const typed = unfurl.peek('https://old.example.com/');
    assert.ok(!typed || typed.ok === false, 'a typed https:// link would show the preview fetched over http: ' + JSON.stringify(typed));
  });
}

test('#7861: no fallback when https answered with something (not a page, nothing to show, a 404)', async () => {
  const calls = world({ pages: { 'https://pdf.example.com/': { type: 'application/pdf', body: '%PDF' }, 'https://plain.example.com/': { body: '<p>no tags</p>' }, 'https://lost.example.com/': { status: 404, body: '' } } });
  assert.equal((await unfurl.previewBare('https://pdf.example.com/')).ok, false);
  assert.equal((await unfurl.previewBare('https://plain.example.com/')).ok, false);
  assert.equal((await unfurl.previewBare('https://lost.example.com/')).ok, false);
  assert.deepEqual(calls, ['https://pdf.example.com/', 'https://plain.example.com/', 'https://lost.example.com/'], 'http was asked after https answered');
});

test('#7861: the address gate is never sidestepped: a private address is refused over https and http is not tried', async () => {
  const calls = world({ resolve: { 'inside.example.com': ['10.0.0.5'] } });
  const got = await unfurl.previewBare('https://inside.example.com/');
  assert.equal(got.ok, false);
  assert.equal(got.because, 'links to this computer or this network are not fetched');
  assert.deepEqual(calls, [], 'a byte moved to a private address');
});

test('#7861: an http page that sends us to ANOTHER host over plain http is not this address\'s preview', async () => {
  const calls = [];
  unfurl.setResolver(async () => [{ address: '93.184.216.34', family: 4 }]);
  unfurl.setFetcher(async (url) => {
    calls.push(url);
    if (url === 'https://hop.example.com/') throw new TypeError('fetch failed');
    if (url === 'http://hop.example.com/') return { status: 302, ok: false, headers: { get: (k) => (k.toLowerCase() === 'location' ? 'http://elsewhere.example.net/' : null) }, body: { cancel: async () => {} } };
    if (url === 'http://elsewhere.example.net/') return fakeResponse({ body: '<title>Someone else</title>' });
    throw new Error('unexpected ' + url);
  });
  const got = await unfurl.previewBare('https://hop.example.com/');
  assert.deepEqual(calls, ['https://hop.example.com/', 'http://hop.example.com/', 'http://elsewhere.example.net/'], 'CONTROL: the redirect was followed');
  assert.equal(got.ok, false, 'another host\'s page was kept as this address\'s preview: ' + JSON.stringify(got));
});

test('#7861: an http page that sends us to ANOTHER host over https is not this address\'s preview either', async () => {
  const calls = [];
  unfurl.setResolver(async () => [{ address: '93.184.216.34', family: 4 }]);
  unfurl.setFetcher(async (url) => {
    calls.push(url);
    if (url === 'https://hop2.example.com/') throw new TypeError('fetch failed');
    if (url === 'http://hop2.example.com/') return { status: 302, ok: false, headers: { get: (k) => (k.toLowerCase() === 'location' ? 'https://evil.example.net/' : null) }, body: { cancel: async () => {} } };
    if (url === 'https://evil.example.net/') return fakeResponse({ body: '<title>Someone else</title>' });
    throw new Error('unexpected ' + url);
  });
  const got = await unfurl.previewBare('https://hop2.example.com/');
  assert.deepEqual(calls, ['https://hop2.example.com/', 'http://hop2.example.com/', 'https://evil.example.net/'], 'CONTROL: the redirect was followed');
  assert.equal(got.ok, false, 'another host\'s https page was kept as this address\'s preview: ' + JSON.stringify(got));
});

test('#7861: a message just under the scan cap is scanned quickly, and a longer one is not scanned for bare addresses', () => {
  const under = ['['.repeat(7980) + ' example.com', '[a]('.repeat(1995) + ' example.com', '[a](b) '.repeat(1140) + 'example.com', 'x '.repeat(3990) + 'example.com'];
  for (const text of under) {
    assert.ok(text.length <= 8000, 'CONTROL: this input is under the cap, so the scan really runs: ' + text.length);
    const t0 = process.hrtime.bigint();
    unfurl.firstLinkInfo(text);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 250, 'firstLinkInfo took ' + ms.toFixed(1) + ' ms on a ' + text.length + '-character message');
  }
  assert.deepEqual(unfurl.firstLinkInfo('x '.repeat(3990) + 'example.com'), { url: 'https://example.com', bare: true }, 'CONTROL: under the cap a bare address is found');
  assert.equal(unfurl.firstLinkInfo('x '.repeat(4010) + 'example.com'), null, 'a message past the cap was scanned for a bare address');
  assert.deepEqual(unfurl.firstLinkInfo('x '.repeat(4010) + 'https://e.example.org'), { url: 'https://e.example.org', bare: false }, 'CONTROL: the explicit scan still runs');
});

test('#7861: a bare address https answers takes one cache slot: peekBare reads the typed-link entry', async () => {
  const calls = world({ pages: { 'https://one.example.com/': { body: '<title>One</title>' } } });
  await unfurl.previewBare('https://one.example.com/');
  assert.equal(unfurl.peekBare('https://one.example.com/').title, 'One');
  assert.equal(unfurl.peek('https://one.example.com/').title, 'One', 'CONTROL: the typed-link entry holds it');
  unfurl.warm('https://one.example.com/', { bare: true });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(calls, ['https://one.example.com/'], 'a cached answer was fetched again');
});

test('#7861: https that takes too long falls back to http too', async () => {
  const calls = [];
  unfurl.setResolver(async () => [{ address: '93.184.216.34', family: 4 }]);
  unfurl.setFetcher(async (url) => {
    calls.push(url);
    if (url === 'https://slow.example.com/') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    if (url === 'http://slow.example.com/') return fakeResponse({ body: '<title>Slow over http</title>' });
    throw new Error('unexpected ' + url);
  });
  assert.equal((await unfurl.preview('https://slow.example.com/')).because, 'that site took too long to answer', 'CONTROL: the refusal is the timeout one');
  unfurl.resetForTests();
  unfurl.setResolver(async () => [{ address: '93.184.216.34', family: 4 }]);
  unfurl.setFetcher(async (url) => {
    calls.push(url);
    if (url === 'https://slow.example.com/') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    return fakeResponse({ body: '<title>Slow over http</title>' });
  });
  const got = await unfurl.previewBare('https://slow.example.com/');
  assert.equal(got.title, 'Slow over http');
});

test('#7861: an http page that redirects to its own www. host is kept', async () => {
  const calls = [];
  unfurl.setResolver(async () => [{ address: '93.184.216.34', family: 4 }]);
  unfurl.setFetcher(async (url) => {
    calls.push(url);
    if (url === 'https://old.example.org/') throw new TypeError('fetch failed');
    if (url === 'http://old.example.org/') return { status: 301, ok: false, headers: { get: (k) => (k.toLowerCase() === 'location' ? 'http://www.old.example.org/' : null) }, body: { cancel: async () => {} } };
    if (url === 'http://www.old.example.org/') return fakeResponse({ body: '<title>Old www</title>' });
    throw new Error('unexpected ' + url);
  });
  const got = await unfurl.previewBare('https://old.example.org/');
  assert.deepEqual(calls, ['https://old.example.org/', 'http://old.example.org/', 'http://www.old.example.org/']);
  assert.equal(got.title, 'Old www');
  assert.equal(got.url, 'https://old.example.org/', 'the card opens the https address, never plain http');
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
  await until(() => unfurl.peekBare('https://w.example.com/'));
  assert.equal(unfurl.peekBare('https://w.example.com/').title, 'W');
  assert.deepEqual(calls, ['https://w.example.com/', 'http://w.example.com/']);
  unfurl.resetForTests();
  const calls2 = world({ pages: { 'https://x.example.com/': 'unreachable', 'http://x.example.com/': { body: '<title>X</title>' } } });
  unfurl.warm('https://x.example.com/');
  await until(() => unfurl.peek('https://x.example.com/'));
  assert.equal(unfurl.peek('https://x.example.com/').ok, false, 'a link the person typed as https:// was quietly fetched over http');
  assert.deepEqual(calls2, ['https://x.example.com/']);
});

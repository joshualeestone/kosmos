'use strict';
/**
 * A link is a link everywhere a person's message is drawn (#355).
 *
 * `pjInline` was written for the project room and was correct: a pasted URL
 * became a real link with trailing punctuation excluded. The other three rows
 * kept `esc(text)`, so the same paste was a link in one box and dead
 * characters in the next box along. Nobody chose that. These run the real
 * renderers, lifted from the page, and check two things at each site: a URL
 * is an anchor, and markup is still escaped, because linking must not become
 * a way in for HTML.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

// Sandbox before the fixture is required: it writes a real worker instruction file.
const os = require('node:os');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-links-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
const fleet = require('./test-support/fleet');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
/* The card the renderers read CURRENT from: a real one from the real reader
   (house rule), reduced to the two fields they use. */
const DANA = (() => {
  const board = fleet.install([fleet.agent('dana', { displayName: 'Dana', state: 'idle' })]);
  try { const { sessionName, name } = board.agents[0]; return { sessionName, name }; } finally { board.restore(); }
})();
const lift = (names) => names.map((n) => page.lift(SCRIPT, n)).join('\n');

const TEXT = 'see https://example.test/page. and <b>not bold</b>';
const expectLinked = (html, where) => {
  assert.match(html, /<a class="xlink" href="https:\/\/example\.test\/page" target="_blank" rel="noreferrer noopener">https:\/\/example\.test\/page<\/a>\./,
    where + ': the URL is not a link, or the trailing full stop was swallowed into it');
  assert.doesNotMatch(html, /<b>not bold<\/b>/, where + ': markup reached the page unescaped');
  assert.match(html, /&lt;b&gt;not bold&lt;\/b&gt;/, where + ': the markup was dropped rather than escaped');
};

test('pjInline links a URL and escapes everything else', () => {
  const fn = new Function(lift(['esc', 'pjInline']) + '\nreturn pjInline;')();
  expectLinked(fn(TEXT), 'pjInline');
  assert.equal(fn('no links here <i>x</i>'), 'no links here &lt;i&gt;x&lt;/i&gt;', 'a message with no URL changed');
});


test('direct messages link a URL (dmRow), both directions', () => {
  const fn = new Function('CURRENT', lift(['esc', 'pjInline', 'pjPreviewCard', 'pjWhen', 'pjWhenPart', 'pjSentence', 'pjVerdict', 'dmWho', 'dmRow']) + '\nreturn dmRow;')(DANA);
  expectLinked(fn({ from: 'dana', text: TEXT, at: new Date().toISOString() }, 'Dana'), 'dmRow theirs');
  expectLinked(fn({ from: 'you', you: true, text: TEXT, at: new Date().toISOString() }, 'Dana'), 'dmRow mine');
});

test('a project message row links a URL (pjMsg)', () => {
  const src = lift(['esc', 'pjInline', 'pjPreviewCard', 'pjWhen', 'pjWhenPart', 'pjSentence', 'pjVerdict', 'pjMsg']);
  const fn = new Function('document', 'pjAnnounce', src + '\nreturn pjMsg;')({ getElementById: () => null }, () => {});
  expectLinked(fn({ from: 'dana', text: TEXT, at: new Date().toISOString() }, 'Dana'), 'pjMsg');
});

test('no render site escapes a message text directly any more', () => {
  // The regression this card is about: a fifth row added with esc(text) would
  // be dead text again. Every row that draws a person's or agent's message
  // text goes through pjInline.
  for (const fn of ['dmRow', 'pjMsg', 'pjRoomRow']) {
    const body = page.lift(SCRIPT, fn);
    assert.doesNotMatch(body, /esc\((r|m)\.text\)/, fn + ' draws message text with esc() instead of pjInline()');
  }
});

/* ---- the link preview card (#357), page half --------------------------- */
test('a preview card renders from the engine shape, escaped, and refuses what it must', () => {
  const fn = new Function(lift(['esc', 'pjPreviewCard']) + '\nreturn pjPreviewCard;')();
  const full = fn({ url: 'https://example.test/p.', title: 'A <b>page</b>', description: 'Two <i>lines</i>', image: '/api/preview-image/abc', site: 'example.test' });
  assert.match(full, /^<a class="lpv" href="https:\/\/example\.test\/p\." target="_blank" rel="noreferrer noopener">/);
  assert.match(full, /<img src="\/api\/preview-image\/abc" alt="" loading="lazy">/);
  assert.match(full, /lpv-title">A &lt;b&gt;page&lt;\/b&gt;</, 'the title reached the page unescaped or was dropped');
  assert.match(full, /lpv-desc">Two &lt;i&gt;lines&lt;\/i&gt;</);
  assert.match(full, /lpv-site">example\.test</);
  // Text-only card, host derived from the URL when the engine gave none.
  const text = fn({ url: 'https://docs.example.test/a/b', title: 'Docs' });
  assert.match(text, /lpv-site">docs\.example\.test</);
  assert.doesNotMatch(text, /lpv-img/);
  // Absence is absence: no preview, no tags, a non-http URL, all render nothing.
  for (const bad of [undefined, null, 'x', {}, { url: 'https://x.test' }, { url: 'javascript:alert(1)', title: 't' }, { url: 'ftp://x.test/f', title: 't' }]) {
    assert.equal(fn(bad), '', 'rendered a card for ' + JSON.stringify(bad));
  }
  // The image is board-served or nothing: a remote image would make the
  // viewer's browser fetch from the linked host, which is the leak Josh
  // ruled out.
  const remote = fn({ url: 'https://x.test', title: 't', image: 'https://evil.test/i.png' });
  assert.doesNotMatch(remote, /evil\.test/, 'a remote image URL reached the page');
  assert.doesNotMatch(remote, /lpv-img/);
});

test('every message row draws the preview card under its text', () => {
  for (const fn of ['dmRow', 'pjMsg', 'pjRoomRow']) {
    const body = page.lift(SCRIPT, fn);
    assert.match(body, /pjPreviewCard\((r|m)\.preview\)/, fn + ' does not draw the preview card');
  }
  // And a row with a preview really carries it (the real dmRow, both directions).
  const dm = new Function('CURRENT', lift(['esc', 'pjInline', 'pjPreviewCard', 'pjWhen', 'pjWhenPart', 'pjSentence', 'pjVerdict', 'dmWho', 'dmRow']) + '\nreturn dmRow;')(DANA);
  const preview = { url: 'https://example.test/p', title: 'Page', site: 'example.test' };
  for (const m of [{ from: 'dana', text: 'see https://example.test/p', at: new Date().toISOString(), preview }, { from: 'you', you: true, text: 'see https://example.test/p', at: new Date().toISOString(), preview }]) {
    const html = dm(m, 'Dana');
    assert.match(html, /class="lpv"/, 'the card is missing from a row that carries a preview');
    assert.match(html, /class="xlink"/, 'the inline link went missing when the card arrived');
  }
  const plain = dm({ from: 'dana', text: 'hello', at: new Date().toISOString() }, 'Dana');
  assert.doesNotMatch(plain, /lpv/, 'a row with no preview drew a card');
});

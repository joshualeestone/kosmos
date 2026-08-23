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

test('the agent page conversation links a URL (convoRow)', () => {
  const fn = new Function('CURRENT', lift(['esc', 'pjInline', 'pjWhen', 'pjWhenPart', 'pjSentence', 'pjVerdict', 'convoRow']) + '\nreturn convoRow;')(DANA);
  // Both arms of convoRow: the agent's own words, and the person's.
  expectLinked(fn({ from: 'dana', text: TEXT, at: new Date().toISOString() }, 'Dana'), 'convoRow theirs');
  expectLinked(fn({ from: 'you', you: true, text: TEXT, at: new Date().toISOString() }, 'Dana'), 'convoRow mine');
});

test('direct messages link a URL (dmRow), both directions', () => {
  const fn = new Function('CURRENT', lift(['esc', 'pjInline', 'pjWhen', 'pjWhenPart', 'pjSentence', 'pjVerdict', 'dmWho', 'dmRow']) + '\nreturn dmRow;')(DANA);
  expectLinked(fn({ from: 'dana', text: TEXT, at: new Date().toISOString() }, 'Dana'), 'dmRow theirs');
  expectLinked(fn({ from: 'you', you: true, text: TEXT, at: new Date().toISOString() }, 'Dana'), 'dmRow mine');
});

test('a project message row links a URL (pjMsg)', () => {
  const src = lift(['esc', 'pjInline', 'pjWhen', 'pjWhenPart', 'pjSentence', 'pjVerdict', 'pjMsg']);
  const fn = new Function('document', 'pjAnnounce', src + '\nreturn pjMsg;')({ getElementById: () => null }, () => {});
  expectLinked(fn({ from: 'dana', text: TEXT, at: new Date().toISOString() }, 'Dana'), 'pjMsg');
});

test('no render site escapes a message text directly any more', () => {
  // The regression this card is about: a fifth row added with esc(text) would
  // be dead text again. Every row that draws a person's or agent's message
  // text goes through pjInline.
  for (const fn of ['convoRow', 'dmRow', 'pjMsg', 'pjRoomRow']) {
    const body = page.lift(SCRIPT, fn);
    assert.doesNotMatch(body, /esc\((r|m)\.text\)/, fn + ' draws message text with esc() instead of pjInline()');
  }
});

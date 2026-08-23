'use strict';
/**
 * The @ picker in the project composer (#312).
 *
 * Josh asked for convenience; the card's stronger reason is correctness. The
 * matcher (engine/messages.js) is EXACT: "@Scarlett" for Scarlet matches
 * nobody and the message silently becomes background. A picker cannot produce
 * a name that does not exist, provided it lists the same set the matcher
 * checks and inserts the key in the form the matcher expects. These run the
 * shipped functions lifted from the page, and one of them checks the picker's
 * boundary rule against the matcher's own regex so the two cannot drift.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Sandbox first, before any require that reads its roots: the fleet fixture
// writes a real worker instruction file for a display name.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-mention-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
const { scriptOf, liftAll } = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = scriptOf(PAGE);
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

function lifted() {
  const src = liftAll(SCRIPT, ['mentionCandidates', 'mentionAt', 'mentionMatches']);
  const re = /const MENTION_TOKEN = (\/.*\/);/.exec(SCRIPT);
  assert.ok(re, 'MENTION_TOKEN left the page');
  return new Function(`const MENTION_TOKEN = ${re[1]};\n${src}\nreturn { mentionCandidates, mentionAt, mentionMatches, MENTION_TOKEN };`)();
}

/* Members as the projects route describes them: real cards from the real
   reader (the house rule: no roster rows by hand), reduced to the two fields
   `describe` carries per member, plus one bare key as older records held. */
const fleet = require('./test-support/fleet');
const PROJECT = (() => {
  const board = fleet.install([
    fleet.agent('scarlet', { displayName: 'Scarlet', state: 'idle' }),
    fleet.agent('mara', { displayName: 'Mara', state: 'idle' }),
    fleet.agent('sam-two', { displayName: 'Sam', state: 'idle' }),
  ]);
  try {
    return { agents: board.agents.map(({ sessionName, name }) => ({ sessionName, name })).concat(['bare-key']) };
  } finally { board.restore(); }
})();

test('the candidates are the project members by session key, which is what the matcher holds', () => {
  const { mentionCandidates } = lifted();
  const byKey = (a, b) => a.key.localeCompare(b.key);
  assert.deepEqual(mentionCandidates(PROJECT).sort(byKey), [
    { key: 'bare-key', shown: 'bare-key' }, { key: 'mara', shown: 'Mara' }, { key: 'sam-two', shown: 'Sam' }, { key: 'scarlet', shown: 'Scarlet' },
  ]);
  assert.deepEqual(mentionCandidates(null), []);
  // Records can hold junk; none of it becomes a candidate.
  const junk = [null, '', Object.fromEntries([['sessionName', '']])];
  assert.deepEqual(mentionCandidates({ agents: junk }), [], 'an empty key was offered');
});

test('the picker opens on the matcher\'s boundary and nowhere else', () => {
  const { mentionAt, MENTION_TOKEN } = lifted();
  // Opens: start of text, after a space, after punctuation the matcher allows.
  assert.deepEqual(mentionAt('@', 1), { start: 0, end: 1, typed: '' });
  assert.deepEqual(mentionAt('hi @sc', 6), { start: 3, end: 6, typed: 'sc' });
  assert.deepEqual(mentionAt('(@m', 3), { start: 1, end: 3, typed: 'm' });
  // Never mid-address: the left boundary is absolute, same as the matcher.
  assert.equal(mentionAt('admin@mara', 10), null, 'a menu opened inside an email address');
  assert.equal(mentionAt('x@', 2), null);
  // Only the token at the caret; a finished mention earlier does not reopen.
  assert.equal(mentionAt('@mara hello', 11), null);
  assert.deepEqual(mentionAt('@mara hello @s', 14), { start: 12, end: 14, typed: 's' });
  // The charset is the matcher's: the same classes, so what is typed after @
  // is what the matcher would read. Checked against the engine's own regex.
  const engine = fs.readFileSync(path.join(__dirname, 'engine', 'messages.js'), 'utf8');
  const theirs = /matchAll\(\/\(\^\|\[\^([^\]]+)\]\)@\(\[([^\]]+)\]\+\)\/g\)/.exec(engine);
  assert.ok(theirs, 'the matcher regex moved; re-point this pin');
  assert.ok(String(MENTION_TOKEN).includes('[^' + theirs[1] + '])@([' + theirs[2] + ']*)'),
    'the picker and the matcher disagree about what a mention is');
});

test('typing narrows by key or shown name, case-insensitively, and nothing typed lists everyone', () => {
  const { mentionCandidates, mentionMatches } = lifted();
  const all = mentionCandidates(PROJECT);
  assert.equal(mentionMatches(all, '').length, 4);
  assert.deepEqual(mentionMatches(all, 's').map((c) => c.key).sort(), ['sam-two', 'scarlet']);
  assert.deepEqual(mentionMatches(all, 'SC').map((c) => c.key), ['scarlet']);
  assert.deepEqual(mentionMatches(all, 'sam').map((c) => c.key), ['sam-two'], 'the shown name did not match');
  assert.deepEqual(mentionMatches(all, 'zzz'), []);
});

test('what is inserted is the exact key, the hint names the key, and the list is the matcher\'s set', () => {
  // The insertion is a one-liner in mentionPick; pinned at the source so a
  // "helpful" change to insert the display name fails here.
  const pick = SCRIPT.slice(SCRIPT.indexOf('function mentionPick('), SCRIPT.indexOf('function mentionPick(') + 900);
  assert.match(pick, /const ins = '@' \+ c\.key \+ ' ';/, 'the picker no longer inserts the session key');
  const words = PAGE.replace(/<!--[\s\S]*?-->/g, '');
  assert.match(words, /Type @ and a name to ask one agent directly\./, 'the hint (#142) lost its sentence');
  assert.ok(!/<b>@<\/b> an agent/.test(words), 'the smudge is back');
  assert.match(words, /<div class="mention" id="pj-mention" role="listbox"/, 'the listbox is gone');
});

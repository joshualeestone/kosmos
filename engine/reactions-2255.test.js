'use strict';

/**
 * #2255: emoji REACTIONS on room posts - the engine layer.
 *
 * Reactions are mutable but the log is append-only, so a reaction is a
 * `kind:'reaction'` EVENT and the current state is replayed from the events
 * (same shape as #185 unanswered / #460 quotes). This suite pins:
 *   - normalizeReactionEmoji: an actual emoji, short, no danger character.
 *   - reactionsFor: the replay - last op per (emoji, reactor) wins, a toggled-off
 *     emoji vanishes, order follows the log, the viewer's own pills are marked,
 *     and one post's reactions never leak into another's.
 *   - react: refuses a bad emoji, a missing project/post, and a post that does
 *     not exist (a reaction to nothing is never silently stored).
 */

const os = require('node:os');
// Sandbox BEFORE the engine require, like every sibling suite (react() appends
// to the real message log otherwise).
process.env.AGENT_WORKFORCE_DATA = require('node:path').join(os.tmpdir(), 'kosmos-reactions-test-' + process.pid);

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const messages = require('./messages');

const THUMB = '\u{1F44D}';
const FIRE = '\u{1F525}';
const SKIN = '\u{1F44D}\u{1F3FD}';

function wipeLog() { try { fs.rmSync(messages.LOG, { force: true }); } catch { /* fresh */ } }
test.beforeEach(() => { messages.resetForTests(); wipeLog(); });

test('normalizeReactionEmoji keeps a real emoji and refuses the rest', () => {
  const N = messages.normalizeReactionEmoji;
  assert.equal(N(THUMB), THUMB, 'a plain emoji is kept');
  assert.equal(N(SKIN), SKIN, 'a skin-tone (multi-codepoint) sequence is kept');
  assert.equal(N(FIRE + '  '), FIRE, 'surrounding whitespace is trimmed');
  assert.equal(N(''), null, 'empty is refused');
  assert.equal(N('   '), null, 'whitespace-only is refused');
  assert.equal(N('a'), null, 'an ASCII letter is not an emoji');
  assert.equal(N(':fire:'), null, 'an ASCII shortcode is not an emoji');
  assert.equal(N('<'), null, 'an HTML-dangerous character is refused');
  assert.equal(N(THUMB + '<b>'), null, 'an emoji carrying HTML is refused whole');
  assert.equal(N(THUMB.repeat(20)), null, 'an over-long string is refused');
  assert.equal(N(THUMB + FIRE + ' x'), null, 'an internal space is refused');
  assert.equal(N(null), null, 'a non-string is refused, not coerced');
});

test('reactionsFor replays events: last op wins, a toggled-off emoji vanishes, order follows the log', () => {
  const rows = [
    { kind: 'post', id: 'm1', project: 'p', from: 'leo' },
    { kind: 'reaction', of: 'm1', emoji: FIRE, from: 'ada', op: 'add' },   // FIRE first
    { kind: 'reaction', of: 'm1', emoji: THUMB, from: 'ada', op: 'add' },
    { kind: 'reaction', of: 'm1', emoji: THUMB, operator: true, op: 'add' },
    { kind: 'reaction', of: 'm1', emoji: FIRE, from: 'ada', op: 'remove' }, // ada toggles FIRE off
  ];
  const r = messages.reactionsFor('m1', rows, 'you');
  // FIRE now has zero live reactors -> gone. THUMB has ada + you.
  assert.equal(r.length, 1, 'a toggled-off emoji leaves no pill');
  assert.equal(r[0].emoji, THUMB);
  assert.equal(r[0].count, 2);
  assert.deepEqual(r[0].who, ['ada', 'you']);
  assert.equal(r[0].mine, true, "the viewer's own reaction is marked");
});

test('reactionsFor marks `mine` per viewer and does not leak across posts', () => {
  const rows = [
    { kind: 'post', id: 'm1', project: 'p', from: 'leo' },
    { kind: 'post', id: 'm2', project: 'p', from: 'leo' },
    { kind: 'reaction', of: 'm1', emoji: THUMB, from: 'ada', op: 'add' },
    { kind: 'reaction', of: 'm2', emoji: FIRE, from: 'bob', op: 'add' },
  ];
  const m1 = messages.reactionsFor('m1', rows, 'ada');
  assert.equal(m1.length, 1);
  assert.equal(m1[0].emoji, THUMB);
  assert.equal(m1[0].mine, true, 'ada reacted to m1');
  assert.equal(messages.reactionsFor('m1', rows, 'bob')[0].mine, false, 'bob did not react to m1');
  const m2 = messages.reactionsFor('m2', rows);
  assert.equal(m2.length, 1, "m1's reaction does not appear on m2");
  assert.equal(m2[0].emoji, FIRE);
  assert.equal(m2[0].mine, false, 'no viewer supplied -> mine is false');
});

test('reactionsFor ignores malformed reaction rows without throwing', () => {
  const rows = [
    { kind: 'post', id: 'm1', project: 'p' },
    { kind: 'reaction', of: 'm1', emoji: THUMB, op: 'add' },            // no reactor -> dropped
    { kind: 'reaction', of: 'm1', from: 'ada', op: 'add' },             // no emoji -> dropped
    { kind: 'reaction', of: 'm1', emoji: THUMB, from: 'ada', op: 'add' }, // the one real row
  ];
  const r = messages.reactionsFor('m1', rows, null);
  assert.equal(r.length, 1);
  assert.equal(r[0].count, 1);
});

test('react refuses a bad emoji, a missing target, and a post that does not exist', () => {
  // Empty store: no posts exist, so even a well-formed react has nothing to land on.
  assert.equal(messages.react({ project: 'p', of: 'm1', emoji: 'a', operator: true }).ok, false, 'an ASCII "emoji" is refused');
  assert.equal(messages.react({ project: 'p', of: 'm1', emoji: THUMB, from: '' }).ok, false, 'no reactor is refused');
  assert.equal(messages.react({ project: '', of: 'm1', emoji: THUMB, operator: true }).ok, false, 'no project is refused');
  assert.equal(messages.react({ project: 'p', of: '', emoji: THUMB, operator: true }).ok, false, 'no post id is refused');
  const r = messages.react({ project: 'p', of: 'nope', emoji: THUMB, operator: true });
  assert.equal(r.ok, false, 'a reaction to a nonexistent post is refused, never silently stored');
  assert.match(r.because, /no post/i);
  // And nothing was written: the log has no reaction row.
  const rows = messages.record().rows.filter((m) => m.kind === 'reaction');
  assert.equal(rows.length, 0, 'a refused react writes no event');
});

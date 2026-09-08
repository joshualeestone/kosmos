'use strict';
/*
 * kosmos#2456 -- the needs_you FALSE-POSITIVE at scale.
 *
 * Josh, 2026-09-07: "a TON of agents" showed "needs me" while NOT waiting on
 * anything; clicking in, the board could not say why, and the agent had no real
 * question. The 7.01.14 diagnostic (FClaude-Casey) is the sharpest instance: the
 * agent's OWN text said it was NOT blocked ("Nothing is stalled ... I am not
 * sitting waiting on you") and only posed an OPTIONAL your-call question ("File
 * it, or keep it local?"), yet the card read needs_you AND the banner admitted
 * "we cannot find the question on its screen right now."
 *
 * ROOT: `classify`'s scraped needs_you came from the old `asksSomething`, which
 * matched a `NEEDS_YOU_MARKERS` prose phrase ANYWHERE in the 25-line tail and sat
 * ABOVE the working checks. A freshly-imported / reactivated agent's first-breath
 * output is full of "Would you like to ...?" / "Do you want to proceed ...?"
 * prose drawn WHILE it is actively producing, so every such agent read needs_you.
 * The "cannot find the question" banner is the symptom: the pane has redrawn past
 * the transient prose line by the time the route's `questionIn` re-reads it.
 *
 * FIX: split the old function and POSITION-GATE the prose half.
 *   - `drawsOptionMenu` (structural `OPTION_LINE`) stays above the working checks
 *     -- a runner-drawn menu is genuinely waiting even mid-turn (#1155/#2146).
 *   - `blockingProseAtBottom` fires only when a prose marker is the LAST non-blank
 *     line of the tail. A live blocking prompt is the BOTTOM of the screen (its
 *     dialog replaced the composer); a prose question with the live status line,
 *     more output, or the composer footer BELOW it is the agent producing or
 *     idle, not blocked. It stays ABOVE the working checks so a real
 *     bottom-anchored prompt is never suppressed by a STALE work line above it
 *     (the false CALM a below-working placement would open, caught in review).
 *
 * So the discriminator is POSITION, not the working signal: the same prose reads
 * needs_you at the bottom of the screen and not-needs_you with anything below it.
 *
 *   node --test engine/status.needsyou-working-2456.test.js
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-nyw-2456-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, STATE } = require('./status');

// A pane the engine reads as a running fleet agent: a version string in
// `command` means Claude Code is up, and `session` ties it to an agent so
// classify reads the screen at all. Same shape as the other status suites.
const pane = (over = {}) => ({
  name: 'test',
  session: 'test-discord',
  target: 'test-discord:0.0',
  command: '2.1.263',
  title: '',
  ...over,
});

// The idle composer footer Claude draws under a live pane; present while
// working too, and -- crucially -- present when an agent has asked a prose
// question conversationally and is NOT blocked in a dialog.
const FOOTER = '\n  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents';

// Signals that say an agent is actively producing right now.
const SPINNER_TITLE = '⠋ Filing the finding';           // braille frame in title
const INTERRUPT = '⎿  running the check (5s · esc to interrupt)';
const GERUND = '· Improvising… (35s · ↓ 1.5k tokens)';

// The optional / your-call prose questions a first-breath agent draws. Each
// opens with a NEEDS_YOU_MARKER phrase and closes at `?`, so the OLD
// asksSomething flagged them anywhere in the tail.
const PROSE_Q = 'Would you like to keep going once the finding is filed?';
const PROSE_PROCEED = 'Do you want to proceed with the optional cleanup?';

// ---- ARM 1: the FIX -- a prose question that is NOT the bottom of the screen -
// (the live status line or composer footer sits below it) is never needs_you.

test('#2456 prose question with a live status line BELOW it reads WORKING', () => {
  // The realistic first-breath shape: the agent asked, then its live status
  // line redrew at the very bottom. Prose is not the last line.
  const r = classify(pane(), PROSE_Q + '\n' + GERUND);
  assert.equal(r.state, STATE.WORKING,
    'an actively-producing agent asking a prose question read as waiting');
});

test('#2456 prose question with a live "esc to interrupt" line BELOW it reads WORKING', () => {
  const r = classify(pane(), PROSE_Q + '\n' + INTERRUPT);
  assert.equal(r.state, STATE.WORKING,
    'a mid-task agent (interrupt line below the question) read as waiting');
});

test('#2456 prose question with a spinner title and the composer footer below reads WORKING', () => {
  const r = classify(pane({ title: SPINNER_TITLE }), PROSE_Q + FOOTER);
  assert.equal(r.state, STATE.WORKING,
    'a producing agent whose prose question sits above the footer read as waiting');
});

test('#2456 the FClaude-Casey 7.01.14 shape (first-breath, optional your-call question) is NOT needs_you', () => {
  // The agent is actively producing (the live gerund status line is the bottom
  // of the screen) and its output includes an optional "your call" question
  // above it. It is NOT blocked; the board must not say so.
  const casey = [
    'I wrote the finding to disk. Nothing is stalled either way -- the file',
    'already exists, and I am not sitting waiting on you.',
    'That is yours to decide, not mine.',
    'Would you like to file the report, or keep it local?',
    GERUND,
  ].join('\n');
  const r = classify(pane(), casey);
  assert.notEqual(r.state, STATE.NEEDS_YOU,
    'FClaude-Casey (the diagnostic screenshot) still reads needs_you -- the false positive is not fixed');
  assert.equal(r.state, STATE.WORKING);
});

test('#2456 a prose question with the composer footer below it (no work signal) is IDLE, not needs_you', () => {
  // The agent asked conversationally and returned to its composer. The footer
  // below the question means it is sitting at its prompt -- idle, not blocked.
  const r = classify(pane(), PROSE_PROCEED + FOOTER);
  assert.equal(r.state, STATE.IDLE,
    'a prose question above the composer footer read as a blocking prompt');
});

// ---- ARM 2: PRESERVED -- a real blocking prompt is still needs_you -----------

test('#2456 PRESERVED: a bottom-anchored prose prompt (nothing below it) is needs_you', () => {
  const r = classify(pane(), 'Some setup output.\n' + PROSE_PROCEED + '\n');
  assert.equal(r.state, STATE.NEEDS_YOU,
    'a prose prompt at the bottom of the screen stopped reading needs_you');
});

test('#2456 REVIEW-WARNING FIX: a bottom-anchored prose prompt with a STALE work line ABOVE it is still needs_you', () => {
  // The dangerous direction the review flagged: a real blocking prompt sharing
  // its tail with a work-shaped line must NOT be suppressed to working. Because
  // the prose is bottom-anchored, it wins ABOVE the working checks -- the stale
  // gerund above it does not outrank it.
  const r = classify(pane(), GERUND + '\nDo you want to proceed? (y/N)');
  assert.equal(r.state, STATE.NEEDS_YOU,
    'a real bottom prompt was suppressed by a stale work line above it (false calm)');
});

test('#2456 PRESERVED: a runner-drawn menu + a live working line is still needs_you (blocked beats busy)', () => {
  const r = classify(pane(),
    GERUND + '\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No' + FOOTER);
  assert.equal(r.state, STATE.NEEDS_YOU,
    'a real drawn menu was outranked by the live working line');
});

test('#2456 PRESERVED: a runner-drawn menu with NO working signal is still needs_you', () => {
  const r = classify(pane(), 'Do you want to proceed?\n❯ 1. Yes\n  2. No');
  assert.equal(r.state, STATE.NEEDS_YOU, 'a plain drawn menu stopped reading needs_you');
});

// ---- DISCRIMINATOR: position, not the working signal, decides ----------------

test('#2456 DISCRIMINATOR: the SAME prose reads needs_you at the bottom and not-needs_you with content below', () => {
  const atBottom = classify(pane(), 'Working on it.\n' + PROSE_PROCEED + '\n');
  const notAtBottom = classify(pane(), PROSE_PROCEED + '\n' + GERUND);
  assert.equal(atBottom.state, STATE.NEEDS_YOU, 'bottom-anchored prose should be needs_you');
  assert.notEqual(notAtBottom.state, STATE.NEEDS_YOU, 'prose with a live line below it should not be needs_you');
});

// ---- Controls the change must not disturb -----------------------------------

test('#2456 CONTROL: a working signal with NO question is plain working', () => {
  assert.equal(classify(pane(), 'some output\n' + GERUND).state, STATE.WORKING);
  assert.equal(classify(pane({ title: SPINNER_TITLE }), 'some output\n' + FOOTER).state, STATE.WORKING);
});

test('#2456 CONTROL: a quiet pane at its footer is idle, not flipped by the split', () => {
  assert.equal(classify(pane(), 'ran the suite, 0 failed' + FOOTER).state, STATE.IDLE);
});

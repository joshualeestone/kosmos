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
 * combined a STRUCTURAL drawn-menu check (`OPTION_LINE`, reliable) with a LOOSE
 * prose-marker check (`NEEDS_YOU_MARKERS` + ends-at-`?`, unreliable) and placed
 * BOTH above the working checks. A freshly-imported / reactivated agent's
 * first-breath output is full of "Would you like to ...?" / "Do you want to
 * proceed ...?" prose drawn WHILE it is actively producing, so every such agent
 * read needs_you. The "cannot find the question" banner is the symptom: the pane
 * has redrawn past the transient prose line by the time the route's `questionIn`
 * re-reads it.
 *
 * FIX: split the two halves. `drawsOptionMenu` (structural) stays ABOVE the
 * working checks -- a TUI-drawn menu means the agent is genuinely waiting even
 * mid-turn. `asksInProse` (loose) moves BELOW the working signals (spinner,
 * interrupt line, working line) and above the finished/footer idle rules -- a
 * genuinely blocked agent shows NONE of the working signals (its dialog has
 * replaced the composer, the same premise the idle-footer rule rests on), so a
 * static prose prompt is still needs_you, while a prose question drawn WHILE
 * working now reads working.
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
// working too, which is why it can sit beneath a working signal.
const FOOTER = '\n  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents';

// The three signals that say an agent is actively producing right now.
const SPINNER_TITLE = '⠋ Filing the finding';           // braille frame in title
const INTERRUPT = '⎿  running the check (5s · esc to interrupt)';
const GERUND = '· Improvising… (35s · ↓ 1.5k tokens)';

// The optional / your-call prose questions a first-breath agent draws. NONE of
// these is a runner-drawn menu; each opens with a NEEDS_YOU_MARKER phrase and
// closes at `?`, so the OLD asksSomething flagged them.
const PROSE_Q = 'Would you like to keep going once the finding is filed?';
const PROSE_PROCEED = 'Do you want to proceed with the optional cleanup?';

// ---- ARM 1: the FIX -- a prose question drawn WHILE working is `working` -----

test('#2456 spinner-in-title + a prose question reads WORKING, not needs_you', () => {
  const r = classify(pane({ title: SPINNER_TITLE }), PROSE_Q + '\n' + FOOTER);
  assert.equal(r.state, STATE.WORKING,
    'an actively-producing agent asking an optional prose question read as waiting');
});

test('#2456 a live "esc to interrupt" line + a prose question reads WORKING', () => {
  const r = classify(pane(), INTERRUPT + '\n' + PROSE_Q + '\n' + FOOTER);
  assert.equal(r.state, STATE.WORKING,
    'a mid-task agent (interrupt line on screen) asking a prose question read as waiting');
});

test('#2456 a live working line + a prose question reads WORKING', () => {
  const r = classify(pane(), GERUND + '\n' + PROSE_PROCEED + '\n' + FOOTER);
  assert.equal(r.state, STATE.WORKING,
    'an agent drawing the live gerund/timer line while asking a prose question read as waiting');
});

test('#2456 the FClaude-Casey 7.01.14 shape (first-breath, optional your-call question) reads WORKING', () => {
  // The agent is actively producing (the live gerund) and its output includes an
  // optional "your call" question. It is NOT blocked; the board must not say so.
  const casey = [
    GERUND,
    'I wrote the finding to disk. Nothing is stalled either way -- the file',
    'already exists, and I am not sitting waiting on you.',
    'That is yours to decide, not mine.',
    'Would you like to file the report, or keep it local?',
  ].join('\n') + '\n' + FOOTER;
  const r = classify(pane(), casey);
  assert.equal(r.state, STATE.WORKING,
    'FClaude-Casey (the diagnostic screenshot) still reads needs_you -- the false positive is not fixed');
});

// ---- ARM 2: PRESERVED -- a real blocking prompt is still needs_you ----------

test('#2456 CONTROL: the SAME prose question with NO working signal is still needs_you', () => {
  // This is the discriminator: the ONLY difference from ARM 1's gerund case is
  // that no working signal is present. It proves the working signal is doing the
  // work of the fix, not that prose detection was broken -- a genuinely idle
  // agent parked on a prose prompt is still flagged.
  const r = classify(pane(), PROSE_PROCEED + '\n' + FOOTER);
  assert.equal(r.state, STATE.NEEDS_YOU,
    'a static prose prompt with no working signal must still read needs_you');
});

test('#2456 PRESERVED: a runner-drawn menu + a live working line is still needs_you (blocked beats busy)', () => {
  // A structural `❯ 1. …` menu means the agent is genuinely waiting even mid-turn
  // with the spinner line still in the tail. This is the #1155/#2146 pin, and the
  // structural half stays ABOVE the working checks precisely to hold it.
  const r = classify(pane(),
    GERUND + '\n\nDo you want to proceed?\n❯ 1. Yes\n  2. No' + FOOTER);
  assert.equal(r.state, STATE.NEEDS_YOU,
    'a real drawn menu was outranked by the live working line');
});

test('#2456 PRESERVED: a runner-drawn menu with NO working signal is still needs_you', () => {
  const r = classify(pane(), 'Do you want to proceed?\n❯ 1. Yes\n  2. No' + FOOTER);
  assert.equal(r.state, STATE.NEEDS_YOU, 'a plain drawn menu stopped reading needs_you');
});

// ---- Controls the change must not disturb -----------------------------------

test('#2456 CONTROL: a working signal with NO question is plain working', () => {
  assert.equal(classify(pane(), GERUND + '\n' + FOOTER).state, STATE.WORKING);
  assert.equal(classify(pane({ title: SPINNER_TITLE }), 'some output\n' + FOOTER).state, STATE.WORKING);
});

test('#2456 CONTROL: a quiet pane at its footer is idle, not flipped by the split', () => {
  assert.equal(classify(pane(), 'ran the suite, 0 failed' + FOOTER).state, STATE.IDLE);
});

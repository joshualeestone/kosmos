'use strict';

/*
 * kosmos#1889 -- sweep the pane-scraper readers against a LIVE Claude Code
 * capture, the class behind #1884 (a version bump silently retired the auth
 * reader; the board said "Idle" over a blocked agent, no red, no error).
 *
 * This file pins the THREE states #1884/#1889 left un-captured live (the other
 * two on the card -- the working line and auth -- are pinned elsewhere). Every
 * screen below was driven into a REAL Claude Code 2.1.263 pane in an isolated
 * throwaway tmux session on this machine, 2026-09-07, and captured with the
 * reader's OWN command:
 *
 *     tmux capture-pane -p -J -t <target> -S -<lines>      (NO -e)
 *
 * -- the exact byte stream status.js:1330 consumes (colour stripped; -J joins
 * soft-wrapped rows). A separate `-e` capture was taken at the same moment for
 * eyes only and is NEVER a fixture. Captures were taken at wide (120) and
 * narrow (46) widths; -J normalises the soft-wraps, so the matchable rows are
 * width-stable and one fixture per state suffices.
 *
 * The card targets 2.1.258; the installed version drifted to 2.1.263. Captured
 * against what is installed and said so. A static sweep of the 2.1.263 binary
 * (~/.local/share/claude/versions/2.1.263, a single ~199MB executable, no
 * longer a bundle dir) confirms every reader key string still ships:
 *   "Quick safety check", "Enter to confirm", "usage-credits", "reached your",
 *   "Do you want to proceed", "Would you like to", "esc to interrupt"  -- all PRESENT.
 *
 * VERDICT: all three readers are CORRECT against live 2.1.263. No stale reader
 * found. These fixtures are regression pins so the next bump cannot retire one
 * silently the way 2.1.258 retired auth.
 *
 *   node --test engine/status.pane-states-1889.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { classify, trustPrompt, STATE, CONFIDENCE } = require('./status');

// The reader's own matcher definitions, lifted from status.js and evaluated,
// never re-typed -- the same discipline as status.awaiting-input-1320.test.js,
// so a targeted matcher assertion cannot silently drift from the live source.
const SRC = fs.readFileSync(path.join(__dirname, 'status.js'), 'utf8');
function needsYouMarkers() {
  const m = SRC.match(/const NEEDS_YOU_MARKERS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert.ok(m, 'NEEDS_YOU_MARKERS is gone from status.js');
  // eslint-disable-next-line no-eval
  return eval('[' + m[1] + ']');
}
function optionLine() {
  // End-anchored + greedy so a future OPTION_LINE with an internal `/` (e.g. a
  // character class) is captured whole, not silently truncated by a lazy match.
  const m = SRC.match(/^const OPTION_LINE = (\/.*\/[a-z]*);\s*$/m);
  assert.ok(m, 'OPTION_LINE is gone from status.js');
  // eslint-disable-next-line no-eval
  const re = eval(m[1]);
  assert.ok(re instanceof RegExp, 'OPTION_LINE did not lift to a RegExp');
  return re;
}
function rateLimitMarkers() {
  const m = SRC.match(/const RATE_LIMIT_MARKERS = \[([\s\S]*?)\];/);
  assert.ok(m, 'RATE_LIMIT_MARKERS is gone from status.js');
  // eslint-disable-next-line no-eval
  return eval('[' + m[1] + ']');
}

// A pane as the engine sees it, same shape as status.test.js's helper: a
// version string in `command` means Claude Code is running, and `session`
// ties it to an agent so classify will read the screen at all.
const pane = (over = {}) => ({
  name: 'test',
  session: 'test-discord',
  target: 'test-discord:0.0',
  command: '2.1.263',
  title: '',
  ...over,
});

// A full-width horizontal rule as Claude Code draws it (─ U+2500). The exact
// count plays no part in any matcher; built rather than pasted.
const RULE = '─'.repeat(124);

// ---------------------------------------------------------------------------
// TRUST DIALOG -- the folder-trust "Quick safety check:" prompt at startup.
// Most deterministic to reproduce: launch claude in a folder it has never
// trusted. The default answer (No, exit) ENDS the session, which is why the
// board must show this as needs_you and never as idle.
// ---------------------------------------------------------------------------

/* Verbatim off the live pane, one elision noted: the workspace-path line was
   this machine's throwaway tmp path (environment-specific, matched by NO
   reader pattern), generalised here. Every other row is exactly as captured. */
const TRUST_DIALOG = [
  RULE,
  ' Accessing workspace:',
  '',
  ' /path/to/an-untrusted-folder',
  '',
  ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a well-known open source',
  " project, or work from your team). If not, take a moment to review what's in this folder first.",
  '',
  " Claude Code'll be able to read, edit, and execute files here.",
  '',
  ' Security guide',
  '',
  ' ❯ No, exit',
  '   Yes, I trust this folder',
  '',
  ' Enter to confirm · Esc to cancel',
].join('\n');

/* The dialog sits at the TOP of a fresh 40-row pane, with the rest blank --
   the exact geometry status.js:2637 (#1155) exists for. The 23 trailing blank
   lines below reproduce tmux's pane-height padding: without the trust branch's
   trailing-whitespace strip, the shared last-25 tail would hold only the dialog's
   bottom rows (down to ` Enter to confirm`) and NOT the `Quick safety check:`
   question, so trustPrompt finds no question row and this screen reads `unknown`.
   Keeping the padding here means a regression of that strip turns this test red. */
const TRUST_SCREEN = TRUST_DIALOG + '\n' + '\n'.repeat(23);

test('the live trust dialog classifies needs_you, not idle', () => {
  const r = classify(pane(), TRUST_SCREEN);
  assert.equal(r.state, STATE.NEEDS_YOU,
    'a live 2.1.263 trust dialog read as ' + r.state + ' -- the #1884 false-calm direction');
  assert.equal(r.confidence, CONFIDENCE.SCRAPED);
});

test('trustPrompt reads the dialog directly, padding and all', () => {
  // The reader function on the padded screen. NB the #1155 fix that trims the
  // shared tail lives in classify (exercised by Test 1 above); this test drives
  // trustPrompt's OWN blank-row walk-back (its `while (raw[last] === '')` loop),
  // a distinct mechanism -- so the two tests cover the two layers, not one twice.
  // Tighter than a null-check: assert it returns THIS dialog's question row, so
  // the test also fails if the walk-back ever returned some other row's text.
  assert.match(trustPrompt(TRUST_SCREEN) || '', /^Quick safety check:/,
    'trustPrompt did not return the Quick safety check question row');
});

// ---------------------------------------------------------------------------
// PERMISSION PROMPT -- a tool call that needs approval. The card's residual:
// the numbered options (`❯ 1. Yes`) are COMPOSED at render time, so the bundle
// holds no literal "1. Yes" and `/❯\s*1\.\s*Yes/` can ONLY be settled against
// a rendered pane. Reproduced by forcing an `ask` rule (Bash(date:*)) via a
// throwaway --settings file over the machine's Bash(*) allow, in default
// ("manual") permission mode.
// ---------------------------------------------------------------------------

/* Verbatim off the live pane. ~12 blank rows followed the dialog on the real
   40-row screen (the prompt renders mid-pane, no composer below it); kept so
   the fixture's geometry matches what the reader actually receives. The dialog
   stays within classify's UNTRIMMED last-25 tail, as it did live. */
const PERMISSION_DIALOG = [
  '⏺ Printing the current date and time',
  '  ⎿  $ date',
  '',
  RULE,
  ' Bash command',
  '',
  '   date',
  '   Print the current date and time',
  '',
  ' Permission rule Bash(date:*) requires confirmation for this command.',
  ' /permissions to update rules',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No',
  '',
  ' Esc to cancel · Tab to amend',
].join('\n');

const PERMISSION_SCREEN = PERMISSION_DIALOG + '\n' + '\n'.repeat(12);

test('the live permission prompt classifies needs_you', () => {
  const r = classify(pane(), PERMISSION_SCREEN);
  assert.equal(r.state, STATE.NEEDS_YOU,
    'a live 2.1.263 permission prompt read as ' + r.state);
  assert.equal(r.confidence, CONFIDENCE.SCRAPED);
  assert.equal(r.because, 'it is asking you something');
});

/* The exact option row the live 2.1.263 pane drew, verbatim (leading space and
   all). This is the byte string the card says can only be settled by a render. */
const CAPTURED_OPTION_ROW = ' ❯ 1. Yes';

test('the rendered `❯ 1. Yes` row satisfies the matcher static analysis cannot confirm (the card residual)', () => {
  // The card's core point: the bundle holds no literal "1. Yes" (it is composed
  // at render time), so `/❯\s*1\.\s*Yes/` can ONLY be checked against a rendered
  // pane. Since #2456, classify() DOES pin OPTION_LINE for this dialog:
  // `blockingProseAtBottom` reads only the LAST non-blank line -- here
  // ` Esc to cancel · Tab to amend`, not the mid-dialog ` Do you want to
  // proceed?` -- so if the option-row matcher were retired, PERMISSION_DIALOG
  // would fall through to UNKNOWN and the first test above would go red. The
  // `❯ 1. Yes` NEEDS_YOU-marker half, though, stays classify-invisible (the prose
  // rule strips the glyph; `drawsOptionMenu` keys on OPTION_LINE, not that
  // marker). These assertions pin BOTH readers of the row against the real
  // captured bytes, so a regression of either turns this file red.
  const markers = needsYouMarkers();
  const optionMarker = markers.find((re) => /Yes/.test(re.source));
  assert.ok(optionMarker, 'the `❯ 1. Yes` marker is gone from NEEDS_YOU_MARKERS');
  assert.match(CAPTURED_OPTION_ROW, optionMarker,
    'the live-rendered option row no longer matches its NEEDS_YOU marker');
  assert.match(CAPTURED_OPTION_ROW, optionLine(),
    'the live-rendered option row no longer matches OPTION_LINE (drawsOptionMenu checks this first, per line)');
});

// ---------------------------------------------------------------------------
// USAGE LIMIT (rate_limited) -- NOT reproducible on demand (per Mikey: you
// cannot force the account to hit its limit). NO live pane capture exists.
// The lines below are the VENDOR'S OWN, extracted verbatim from the 2.1.263
// binary (grep -a on ~/.local/share/claude/versions/2.1.263), not typed from
// memory: "reached your Fable limit" and the "/usage-credits" remedy line both
// ship in 2.1.263, and each matches RATE_LIMIT_MARKERS. This pins that the
// reader's keys did not retire in the 2.1.258 -> 2.1.263 drift; replace with a
// real pane capture if one ever becomes available (card's own instruction).
// ---------------------------------------------------------------------------
/* Vendor lines extracted verbatim from the 2.1.263 binary. The "reached your"
   line has TWO shipping phrasings (both grepped out of the binary); both must
   match the same marker, and the /usage-credits remedy line matches the other. */
const RATE_LIMIT_REACHED = " You've reached your Fable limit.";
const RATE_LIMIT_REACHED_WEEKLY = " You've reached your weekly usage limit.";
const RATE_LIMIT_CREDITS = ' Run /usage-credits to continue or switch models with /model.';
const RATE_LIMIT_SCREEN = [
  '✻ Cooked for 12s',
  '',
  RULE,
  RATE_LIMIT_REACHED,
  RATE_LIMIT_CREDITS,
  '',
].join('\n') + '\n'.repeat(12);

test('a usage-limit screen classifies rate_limited (vendor strings from the 2.1.263 binary)', () => {
  const r = classify(pane(), RATE_LIMIT_SCREEN);
  assert.equal(r.state, STATE.RATE_LIMITED,
    'the rate-limit reader missed the 2.1.263 vendor phrasing');
  assert.equal(r.confidence, CONFIDENCE.SCRAPED);
});

test('EACH rate-limit marker is pinned individually, not the disjunction', () => {
  // classify()'s verdict is a disjunction over RATE_LIMIT_MARKERS (matchedLine
  // fires if EITHER marker matches). Asserting only the combined verdict lets a
  // future bump silently retire ONE phrasing while the test stays green on the
  // survivor -- the exact #1884 failure this file pins against. So pin each
  // marker against its own vendor line, lifted from source so it cannot drift.
  const markers = rateLimitMarkers();
  const reached = markers.find((re) => /reached your/.test(re.source));
  const credits = markers.find((re) => /usage-credits/.test(re.source));
  assert.ok(reached, 'the `reached your ... limit` marker is gone from RATE_LIMIT_MARKERS');
  assert.ok(credits, 'the `/usage-credits` marker is gone from RATE_LIMIT_MARKERS');
  assert.match(RATE_LIMIT_REACHED, reached, 'the "reached your Fable limit" phrasing no longer matches its marker');
  assert.match(RATE_LIMIT_REACHED_WEEKLY, reached, 'the newer "reached your weekly usage limit" phrasing no longer matches its marker');
  assert.match(RATE_LIMIT_CREDITS, credits, 'the /usage-credits remedy line no longer matches its marker');
});

// ---------------------------------------------------------------------------
// Negative control -- the classifier can, and must, return the OTHER answer.
// A false-calm bug (#1884) is a screen that SHOULD be needs_you reading as
// something benign; this proves the three tests above are not matching
// everything indiscriminately.
// ---------------------------------------------------------------------------
test('an ordinary screen is neither needs_you nor rate_limited', () => {
  const r = classify(pane(), 'some ordinary output that matches no prompt at all\n');
  assert.notEqual(r.state, STATE.NEEDS_YOU);
  assert.notEqual(r.state, STATE.RATE_LIMITED);
});

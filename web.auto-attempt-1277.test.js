/*
 * #1277: an UNATTENDED update result has to reach a screen.
 *
 * Until this card an install could only happen with somebody at the board, so
 * rendering the result inside the post-press overlay was enough. This card makes
 * the unattended path normal, and `updateAttempt` appeared exactly ONCE in
 * web/index.html, inside that overlay, gated on the attempt being the one this
 * tab started. So an install that failed at 03:00 and left the board down until
 * the next login said nothing at all on screen, three logins running, and then
 * automatic updates stopped for good and the screen still said nothing.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/**
 * Pull a top-level declaration out of the page by brace matching.
 *
 * Brace-matched, not regex-sliced: a lazy regex to the next closing brace cuts a
 * function mid-body and throws a SyntaxError, which reads exactly like the
 * function being broken rather than the extractor being wrong.
 */
function pick(startsWith) {
  const at = SRC.indexOf(startsWith);
  assert.ok(at > -1, `web/index.html no longer contains: ${startsWith}`);
  const semi = SRC.indexOf(';', at);
  const brace = SRC.indexOf('{', at);
  if (brace === -1 || (semi !== -1 && semi < brace)) return SRC.slice(at, semi + 1);
  let depth = 0;
  for (let i = brace; i < SRC.length; i += 1) {
    if (SRC[i] === '{') depth += 1;
    else if (SRC[i] === '}') { depth -= 1; if (depth === 0) return SRC.slice(at, i + 1); }
  }
  throw new Error(`could not brace-match: ${startsWith}`);
}

function paintWith(attempt, pref) {
  /* Runs the REAL function out of the page rather than a copy, so this cannot
     pass against a shape that merely resembles what ships. */
  const el = { hidden: null, textContent: null };
  const document = { getElementById: (id) => (id === 'auto-attempt' ? el : null) };
  const src = pick('let AUTO_LAST_ATTEMPT') + '\n'
    + pick('let AUTO_LAST_PREF') + '\n'
    + pick('function autoAttemptPaint(attempt, pref) {');
  // eslint-disable-next-line no-new-func
  new Function('document', src + '\nreturn autoAttemptPaint;')(document)(attempt, pref === undefined ? { on: true } : pref);
  return el;
}


test('#1277: a finished UNATTENDED failure is shown on the card that owns the preference', () => {
  const el = paintWith({ auto: true, endedAt: '2026-09-01T03:00:00Z', version: '0.7.0', code: 1 });
  assert.equal(el.hidden, false, 'an unattended failure rendered nothing, which is the whole defect');
  assert.match(String(el.textContent), /automatic update/i);
  assert.match(String(el.textContent), /0\.7\.0/, 'it must say WHICH version, or the person cannot tell '
    + 'a stale record from a fresh one');
});

test('#1277: an attempt STILL RUNNING says nothing, and a MANUAL one is left to the overlay', () => {
  /* A half-finished install is not news, and saying so would be the in-flight
     mistake one layer up. A manual press already has the overlay. */
  assert.equal(paintWith({ auto: true, endedAt: null, version: '0.7.0' }).hidden, true,
    'an in-flight attempt was announced as a result');
  assert.equal(paintWith({ auto: false, endedAt: '2026-09-01T03:00:00Z', version: '0.7.0' }).hidden, true,
    'a manual attempt was duplicated onto this card; the press overlay owns that one');
  assert.equal(paintWith(null).hidden, true, 'no attempt at all rendered something');
});

test('#1277: the card is wired to /api/status, and a DEAD call is caught', async () => {
  /* 🛑 THIS USED TO MATCH SOURCE TEXT AND COULD NOT FAIL. Measured by a reviewer:
     changing the call to `if (false) autoAttemptPaint(...)` left it GREEN, and so
     did wrapping the whole fetch block in a comment. In both cases nothing renders
     and the card is silent again, which is the entire defect it exists to catch.

     Worse, the sibling guard in server.update-poll-1277.test.js in this same
     branch already documents this exact failure and fixes it with LIVE_CODE. I
     fixed it there and not here, in the same afternoon.

     It now DRIVES the real refreshAutoUpdate with a stub fetch, so a dead call or
     a commented-out one produces no paint and this goes red. */
  const el = { hidden: true, textContent: '' };
  const doc = {
    getElementById: (id) => (id === 'auto-attempt' ? el
      : { textContent: '', setAttribute() {}, getAttribute: () => 'true', hidden: false, classList: { add() {}, remove() {} } }),
  };
  const fetched = [];
  const stubFetch = async (url) => {
    fetched.push(String(url));
    const body = String(url).includes('/api/autoupdate')
      ? { on: true, ok: true }
      : { version: '0.6.20', updateAttempt: { auto: true, endedAt: 'x', version: '0.7.0', attempts: 3, streak: 3 } };
    return { json: async () => body };
  };
  /* autoPaint is stubbed, not extracted: it reaches paintSwitch and a chain of
     other page helpers, none of which this guard is about. What must be REAL is
     the wiring from the status fetch to the paint, which is the thing a dead call
     breaks. */
  const src = [pick('let AUTO_LAST_ATTEMPT'), pick('let AUTO_LAST_PREF'),
    pick('function autoAttemptPaint(attempt, pref) {'),
    pick('async function refreshAutoUpdate() {')].join('\n');
  const run = new Function('document', 'fetch', 'AUTO_EPOCH', 'autoPaint',
    src + '\nreturn refreshAutoUpdate;');
  await run(doc, stubFetch, 0, () => {})();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(fetched.some((u) => u.includes('/api/status')),
    'refreshAutoUpdate never asked for the status, so the card can never learn what happened');
  assert.equal(el.hidden, false,
    'the served record reached nothing: the paint function exists and the wiring does not call it, '
    + 'which is exactly what a dead or commented-out call looks like');
  assert.match(SRC, /id="auto-attempt"/, 'the slot it paints into is gone');
});

test('#1277: the TERMINAL state says so, instead of telling a stopped board to try again', () => {
  /* The first version rendered one sentence for every failure, so a board that had
     given up said "it will try again later" while the automatic half was dead.
     The commit that shipped it claimed the person could now see their board gave
     up, and that was not true: they could see a failure, never the giving up. */
  const live = paintWith({ auto: true, endedAt: 'x', version: '0.7.0', attempts: 1, streak: 1 });
  const perVersion = paintWith({ auto: true, endedAt: 'x', version: '0.7.0', attempts: 3, streak: 1 });
  const perMachine = paintWith({ auto: true, endedAt: 'x', version: '0.7.0', attempts: 3, streak: 3 });

  assert.notEqual(perVersion.textContent, live.textContent,
    'a board that has used all three attempts on this version says the same thing as one that has '
    + 'failed once, so the terminal state reaches nobody');
  assert.notEqual(perMachine.textContent, perVersion.textContent,
    'three DIFFERENT versions failing says something about the MACHINE, and it reads identically to '
    + 'one bad version, which is a different fact and a different thing to do about it');
  assert.match(perMachine.textContent, /three different versions/i);
  assert.doesNotMatch(perVersion.textContent, /try again later/i,
    'a stopped board must not promise a retry that will never come');
  assert.match(live.textContent, /try again later|press install/i,
    'CONTROL: a single failure must still say the ordinary thing, or this arm passes by making '
    + 'every message terminal');
});

test('#1277: a failed MANUAL retry still shows the terminal state, because the brake still holds', () => {
  /* 🛑 THE CARD USED TO GO SILENT EXACTLY WHEN THE PERSON DID WHAT IT TOLD THEM.
     Three unattended failures, the card says press Install by hand, they press it,
     that fails too. The record is now auto:false, the old gate hid the element,
     and from then on the board never auto-updated again with no sentence anywhere.

     The BRAKE was deliberately widened past `durable.auto` for exactly this
     sequence. The screen was not, so the engine knew and the page did not. */
  const manualTerminal = paintWith({ auto: false, endedAt: 'x', version: '0.7.0', attempts: 3, streak: 1 });
  assert.equal(manualTerminal.hidden, false,
    'a failed hand retry after the cap rendered nothing, so the board is silently stopped and the '
    + 'person has no way to learn it');
  assert.match(manualTerminal.textContent, /stopped trying|stopped on this computer/i);

  /* CONTROL: a NON-terminal manual attempt is still the press overlay's, not this
     card's, or this fix has simply duplicated every manual failure onto Settings. */
  assert.equal(paintWith({ auto: false, endedAt: 'x', version: '0.7.0', attempts: 1, streak: 1 }).hidden, true,
    'CONTROL: an ordinary manual failure was duplicated onto this card');
});

test('#1277: with the switch OFF the card does not promise a retry that will not happen', () => {
  /* Reachable by the obvious reaction to seeing a failure: switch automatic
     updates off. The record is still worth showing; only the forecast is wrong. */
  const off = paintWith({ auto: true, endedAt: 'x', version: '0.7.0', attempts: 1, streak: 1 }, { on: false });
  assert.equal(off.hidden, false, 'the record should still be shown when the switch is off');
  assert.doesNotMatch(off.textContent, /try again later/i,
    'the switch says Off and the line beneath it promises an automatic retry');
  assert.match(off.textContent, /automatic updates are off/i,
    'it should say why there will be no retry, not just omit the promise');

  const offTerminal = paintWith({ auto: true, endedAt: 'x', version: '0.7.0', attempts: 3, streak: 3 }, { on: false });
  assert.doesNotMatch(offTerminal.textContent, /start again on their own/i,
    'with the switch off, automatic updates will NOT start again on their own');

  /* CONTROL: with the switch ON both promises must come back, or this arm passes
     by deleting the forecast entirely. */
  const on = paintWith({ auto: true, endedAt: 'x', version: '0.7.0', attempts: 1, streak: 1 }, { on: true });
  assert.match(on.textContent, /try again later/i, 'CONTROL: with the switch on it must still say it will retry');
  const onTerminal = paintWith({ auto: true, endedAt: 'x', version: '0.7.0', attempts: 3, streak: 3 }, { on: true });
  assert.match(onTerminal.textContent, /start again on their own/i,
    'CONTROL: with the switch on, the terminal sentence must still say recovery is automatic');
});

test('#1277: after a successful HAND repair the card stops announcing the old failure', () => {
  /* 🛑 THE ADVERTISED RECOVERY USED TO LEAVE A PERMANENT LIE ON SCREEN. Three
     failures of 0.7.0, the card says install it by hand, they do, IT SUCCEEDS,
     the board boots on 0.7.0. install/setup.sh never writes logs/install.status
     (zero occurrences, control install.log = 1), so the failure record survives
     and the card announced forever that Kosmos gave up on the version they are
     now running. It cleared only if a later AUTOMATIC install rewrote the file;
     a hand reinstall never does.

     The engine derives `superseded` once, where both brakes already compute it. */
  const done = paintWith({ auto: true, endedAt: 'x', version: '0.7.0', attempts: 3, streak: 3, superseded: true });
  assert.equal(done.hidden, true,
    'a record for a version we are NOW RUNNING still rendered. The install worked and the card '
    + 'says it gave up, permanently, and nothing the person does clears it');

  /* CONTROL: a record for a version we are still BEHIND is a live verdict and
     must still render, or this has simply switched the card off. */
  const live = paintWith({ auto: true, endedAt: 'x', version: '9.9.9', attempts: 3, streak: 3, superseded: false });
  assert.equal(live.hidden, false, 'CONTROL: a record we are still behind must still be shown');

  /* CONTROL: superseded must not silence an ORDINARY failure either way round,
     which is the same rule one branch down. */
  assert.equal(paintWith({ auto: true, endedAt: 'x', version: '0.7.0', attempts: 1, streak: 1, superseded: true }).hidden,
    true, 'CONTROL: an ordinary superseded failure is history too');
});

test('#1277: an UNREADABLE preference does not promise a retry, matching the engine', () => {
  /* engine/autoupdate.js answers the same uncertainty with { on: false }. The
     screen must not be more confident than the engine: promising an automatic
     retry in the one state where we have just admitted we cannot read the setting
     is the worst place to guess. */
  const unknown = paintWith({ auto: true, endedAt: 'x', version: '0.7.0', attempts: 1, streak: 1 }, null);
  assert.equal(unknown.hidden, false, 'the record should still be shown when the preference is unknown');
  assert.doesNotMatch(unknown.textContent, /try again later/i,
    'the preference could not be read and the card promised an automatic retry anyway');
  const known = paintWith({ auto: true, endedAt: 'x', version: '0.7.0', attempts: 1, streak: 1 }, { on: true });
  assert.match(known.textContent, /try again later/i,
    'CONTROL: with a readable ON preference it must still say it will retry');
});

test('#1277: the per-version sentence is grammatical, which reading it never showed', () => {
  /* `v` is " of <version>", built for a sentence ending in a noun, and it was
     reused after a VERB: "stopped trying to install of 0.7.0". Present for as long
     as that branch existed and invisible until somebody rendered it. */
  const t = paintWith({ auto: true, endedAt: 'x', version: '0.7.0', attempts: 3, streak: 1 }).textContent;
  assert.doesNotMatch(t, /install of /i, `reads ungrammatically: ${t}`);
  assert.match(t, /install 0\.7\.0/i, 'it should still name the version it gave up on');
});

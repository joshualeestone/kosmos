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

function paintWith(attempt) {
  /* Run the real function out of the page rather than a copy of it, so this
     cannot pass against a shape that merely resembles the shipped one. */
  const at = SRC.indexOf('function autoAttemptPaint(attempt) {');
  assert.ok(at > -1, 'autoAttemptPaint is gone from web/index.html, so nothing renders an unattended result');
  /* Brace-matched, not regex-sliced. A lazy regex to the next `  }` cut the
     function mid-body and threw a SyntaxError, which reads exactly like the
     function being broken rather than the extractor being wrong. */
  let depth = 0; let end = -1;
  for (let i = SRC.indexOf('{', at); i < SRC.length; i += 1) {
    if (SRC[i] === '{') depth += 1;
    else if (SRC[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > at, 'could not brace-match autoAttemptPaint out of the page');
  const m = [SRC.slice(at, end)];
  const el = { hidden: null, textContent: null };
  const document = { getElementById: (id) => (id === 'auto-attempt' ? el : null) };
  // eslint-disable-next-line no-new-func
  new Function('document', m[0] + '\nreturn autoAttemptPaint;')(document)(attempt);
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

test('#1277: the card is wired to /api/status, or the paint function is decoration', () => {
  assert.match(SRC, /autoAttemptPaint\(st && st\.updateAttempt\)/,
    'autoAttemptPaint exists but nothing calls it with the served record, so it renders never');
  assert.match(SRC, /id="auto-attempt"/, 'the slot it paints into is gone');
});

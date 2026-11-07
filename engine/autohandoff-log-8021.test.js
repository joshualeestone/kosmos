'use strict';
/* kosmos#8021 (a real seat's 85% handoff prompt sat unsent in its box, and nothing said what the board thought had
   happened to it): each prompt the auto-handoff sweep delivers gets one board-log line saying what the delivery read.
   The verdicts are built by chat.js's own confirmedVerdict where it makes them, and copied from chat.js's own return
   statements where it does not (the not-pressed and input-held shapes), so the test reads the shapes the sweep gets. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sweepOnce, promptLogLine } = require('./autohandoff-sweep');
const autohandoff = require('./autohandoff');
const chat = require('./chat');
const { DELIVERY, confirmedVerdict } = chat;

const ON = { enabled: true, threshold: 85 };
const run = (verdict) => sweepOnce({ setting: ON, roster: [{ sessionName: 'mara', context: { percent: 86 } }], lastBand: new Map(),
  deliver: () => verdict, pathFor: (k) => '/h/' + k + '.md', autohandoff, DELIVERY }).prompted[0];
const placed = { state: DELIVERY.PLACED, at: 'x', paneState: 'idle' };
const AGAIN = '; asked again on the next sweep while it stays over the threshold\n';

test('#8021: "read as sent" and "could not read the box" are two different lines (the question the card asks first)', () => {
  const sent = run(confirmedVerdict(placed, { outcome: 'sent', retried: false }));
  const unread = run(confirmedVerdict(placed, { outcome: 'unread', retried: false }));
  assert.equal(sent.verdict, 'placed'); assert.equal(unread.verdict, 'placed');   // CONTROL: the state alone is the same
  assert.equal(promptLogLine(sent), 'autohandoff: mara at 86%: handoff prompt sent (its box emptied after the Enter)\n');
  assert.equal(promptLogLine(unread), 'autohandoff: mara at 86%: handoff prompt probably sent, but its box could not be read after the Enter, so this is not confirmed\n');
});

test('#8021: an Enter that did not take, one pressed into other text, and one never pressed are each said as such', () => {
  const unsent = run({ ...confirmedVerdict(placed, { outcome: 'unsent', retried: true }), unsentSeq: 3 });   // settle adds the seq
  assert.equal(promptLogLine(unsent), 'autohandoff: mara at 86%: handoff prompt not sent: its Enter did not take; kept as a numbered unsent line, to be pressed later' + AGAIN);
  const other = run(confirmedVerdict(placed, { outcome: 'other', retried: false }));
  assert.equal(promptLogLine(other), 'autohandoff: mara at 86%: handoff prompt not sent: Enter was pressed and its box then held other text too' + AGAIN);
  // chat.js deliver, the box already held other text before the Enter (UNSENT_NOT_PRESSED_BECAUSE): never pressed.
  const notPressed = run({ state: DELIVERY.UNCONFIRMED, unsubmitted: true, confirm: 'not-pressed', because: 'x', at: 'x', paneState: 'idle' });
  assert.equal(promptLogLine(notPressed), 'autohandoff: mara at 86%: handoff prompt not sent: its box already held other text, so Enter was not pressed' + AGAIN);
});

test('#8021: held by text already in the box says so, not "not kept"; a plain could-not and an unknown verdict too', () => {
  // chat.js deliverAutomatic's input hold: { ...v, held: true, heldBy: 'input' } over a COULD_NOT with inputHeld.
  const held = run({ state: DELIVERY.COULD_NOT, because: 'x', inputHeld: true, busy: true, held: true, heldBy: 'input' });
  assert.equal(promptLogLine(held), 'autohandoff: mara at 86%: handoff prompt not typed: its box already holds unsent text' + AGAIN);
  assert.equal(promptLogLine(run({ state: DELIVERY.COULD_NOT, because: 'x' })), 'autohandoff: mara at 86%: handoff prompt could not be typed' + AGAIN);
  assert.equal(promptLogLine(run(undefined)), 'autohandoff: mara at 86%: handoff prompt verdict none' + AGAIN);
  assert.equal(promptLogLine(null), '');
});

test('#8021: the sweep still advances the band only on PLACED', () => {
  assert.equal(run(confirmedVerdict(placed, { outcome: 'sent' })).advanced, true);
  assert.equal(run(confirmedVerdict(placed, { outcome: 'unsent' })).advanced, false);
});

test('#8021: the server writes the line for every prompt the sweep returns (the wiring, read from server.js)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('const swept = autohandoffSweep.sweepOnce({');
  assert.ok(at > 0, 'the sweep result is no longer kept');
  const block = src.slice(at, src.indexOf('} catch { /* best-effort, like the nudge sweep */ }', at));
  const code = block.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');   // comments do not count
  assert.match(code, /for \(const p of \(swept && swept\.prompted\) \|\| \[\]\)/, 'the prompted list is not walked');
  assert.match(code, /autohandoffSweep\.promptLogLine\(p\)[^\n]*process\.stdout\.write\(line\)/, 'the line is not written to the board log');
});

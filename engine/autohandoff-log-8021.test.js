'use strict';
/* kosmos#8021 (a real seat's 85% handoff prompt sat unsent in its box, and nothing said what the board thought had
   happened to it): each prompt the auto-handoff sweep delivers gets one board-log line naming the delivery's verdict.
   The verdicts below are the shapes engine/chat.js returns (DELIVERY values; `unsubmitted: true` when the Enter did not
   take; `unsentSeq` when it kept the line as a numbered unsent line of its own). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sweepOnce, promptLogLine } = require('./autohandoff-sweep');
const autohandoff = require('./autohandoff');
const { DELIVERY } = require('./chat');

const ON = { enabled: true, threshold: 85 };
const run = (verdict) => sweepOnce({ setting: ON, roster: [{ sessionName: 'mara', context: { percent: 86 } }], lastBand: new Map(),
  deliver: () => verdict, pathFor: (k) => '/h/' + k + '.md', autohandoff, DELIVERY }).prompted[0];

test('#8021: the log line names what the delivery said', () => {
  assert.equal(promptLogLine(run({ state: DELIVERY.PLACED })), 'autohandoff: mara at 86%: handoff prompt sent\n');
  assert.equal(promptLogLine(run({ state: DELIVERY.UNCONFIRMED, unsubmitted: true, unsentSeq: 4 })),
    'autohandoff: mara at 86%: handoff prompt not confirmed as sent, its Enter did not take, kept as a numbered unsent line, to be pressed later, will be asked again next sweep\n');
  // The shape Renet's seat implies: not confirmed, and NOT kept as a numbered line (forgotten, or kept only lightly).
  assert.equal(promptLogLine(run({ state: DELIVERY.UNCONFIRMED })),
    'autohandoff: mara at 86%: handoff prompt not confirmed as sent, not kept as a numbered unsent line, will be asked again next sweep\n');
  assert.equal(promptLogLine(run({ state: DELIVERY.COULD_NOT })),
    'autohandoff: mara at 86%: handoff prompt could not be typed, not kept as a numbered unsent line, will be asked again next sweep\n');
  assert.equal(promptLogLine(run(undefined)), 'autohandoff: mara at 86%: handoff prompt verdict none, not kept as a numbered unsent line, will be asked again next sweep\n');
  assert.equal(promptLogLine(null), '');
});

test('#8021: the sweep carries unsubmitted and remembered, and still advances the band only on PLACED', () => {
  const p = run({ state: DELIVERY.UNCONFIRMED, unsubmitted: true, unsentSeq: 2 });
  assert.equal(p.unsubmitted, true);
  assert.equal(p.remembered, true);
  assert.equal(p.advanced, false);
  const q = run({ state: DELIVERY.PLACED });
  assert.deepEqual([q.unsubmitted, q.remembered, q.advanced], [false, false, true]);
});

test('#8021: the server writes the line for every prompt the sweep returns (the wiring, read from server.js)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at = src.indexOf('const swept = autohandoffSweep.sweepOnce({');
  assert.ok(at > 0, 'the sweep result is no longer kept');
  const after = src.slice(at, at + 2500);
  assert.match(after, /for \(const p of \(swept && swept\.prompted\) \|\| \[\]\)/, 'the prompted list is not walked');
  assert.match(after, /autohandoffSweep\.promptLogLine\(p\)[^\n]*process\.stdout\.write\(line\)/, 'the line is not written to the board log');
});

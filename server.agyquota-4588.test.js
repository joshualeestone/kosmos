'use strict';
/* #4588: the resume sweep is WIRED, not only written. engine/agyquota-4588.test.js drives the sweep itself; this
   pins that server.js builds its tick with the live-execution gate, the board's roster and chat.deliver, and runs
   it on a timer, so deleting the wiring reds a test instead of shipping a sweep nothing calls. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

test('#4588: server.js builds the agy quota resume tick and runs it on its own timer', () => {
  // The timer's own binding (#4588 PR B added an earlier require of the same module in givePart).
  const at = src.indexOf("const agyQuota = require('./engine/agyquota')");
  assert.ok(at > 0, 'server.js binds agyQuota to engine/agyquota');
  // #5154 slice B widened this: the makeTick call legitimately grew (a `log` callback that now also routes the
  // give-up to the board, plus `bound`/`cleared` wiring), pushing the setInterval/unref lines past the old
  // 1500-char window. 2600 comfortably spans the current block (setInterval ~+1944, unref ~+2227) while still
  // pinning that the timer binding sits right by the makeTick, not elsewhere in the file.
  const block = src.slice(at, at + 2600);
  assert.match(block, /agyQuota\.makeTick\(\{/);
  assert.match(block, /allowed: \(\) => liveExecution\.liveExecutionAllowed\(\)/);
  assert.match(block, /roster: \(\) => safeRoster\(\)/);
  assert.match(block, /chat\.deliver\(session, text, r, undefined, undefined\)/);
  // Anchored at the start of a line to the real assignment: a mention (a comment, `null && setInterval(...)`) is not a timer.
  assert.match(block, /^\s*const agyQuotaSweep = setInterval\(agyQuotaTick,/m);
  assert.match(block, /agyQuotaSweep\.unref\(\)/);
});

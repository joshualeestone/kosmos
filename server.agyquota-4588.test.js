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
  const at = src.indexOf("require('./engine/agyquota')");
  assert.ok(at > 0, 'server.js requires engine/agyquota');
  const block = src.slice(at, at + 1500);
  assert.match(block, /agyQuota\.makeTick\(\{/);
  assert.match(block, /allowed: \(\) => liveExecution\.liveExecutionAllowed\(\)/);
  assert.match(block, /roster: \(\) => safeRoster\(\)/);
  assert.match(block, /chat\.deliver\(session, text, r, undefined, undefined\)/);
  // Anchored at the start of a line to the real assignment: a mention (a comment, `null && setInterval(...)`) is not a timer.
  assert.match(block, /^\s*const agyQuotaSweep = setInterval\(agyQuotaTick,/m);
  assert.match(block, /agyQuotaSweep\.unref\(\)/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* kosmos#1726, the seam half. Separate FILE rather than a separate test, because
   `beginInstall` opens with `if (installStarted) return;` and exports no reset, so only the
   first call in a process reaches the real path. `node --test` isolates per file. */

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-1726-seam-'));
process.env.AGENT_WORKFORCE_DATA = sandbox;
const liveExec = require('./live-execution.js');
const update = require('./update.js');

test('#1726 CONTROL: the gate sits AFTER the installRunner seam, so injected runners are unaffected', () => {
  /* The seam at `installRunner` returns before the real path. Gating in front of it would
     break every existing test that injects a runner, which is a worse product than the gap. */
  assert.equal(update.alreadyInstalling(), false,
    'precondition: an earlier test already started an install, so this one cannot reach the seam');
  liveExec.resetForTests();
  let called = 0;
  update.setInstallRunner(() => { called++; return { ok: true }; });
  try { update.beginInstall({}); } catch { /* shape of the fake is not what is under test */ }
  update.setInstallRunner(null);
  assert.equal(called, 1, 'an injected runner was blocked by the gate, so the gate is in front of the seam');
});

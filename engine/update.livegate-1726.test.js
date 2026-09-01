'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* kosmos#1726. `beginInstall` spawns `/bin/sh -c 'curl -fsSL "$1" | sh'` DETACHED and
   unref'd, so once it is away nothing recalls it: a killed board, an aborted suite or a
   Ctrl-C stops none of it, and `stdio: 'ignore'` means no stream records what it did.
   Every other live-execution gate in this tree guards an action that is merely wrong.
   This one guards an action that CANNOT BE TAKEN BACK.

   🛑 WHY THE ASSERTION IS "NO STATUS FILE" RATHER THAN "DID NOT SPAWN": the only way to
   observe the spawn directly is to LET IT HAPPEN, which is the hazard itself. The status
   file is written by the spawned shell and by nothing else, so its absence is the
   cheapest observation that can only come out one way if the gate held. */

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-1726-'));
process.env.AGENT_WORKFORCE_DATA = sandbox;

const liveExec = require('./live-execution.js');
const update = require('./update.js');


/* ⚠️ ORDER MATTERS AND IT IS STATED RATHER THAN ASSUMED. `beginInstall` opens with
   `if (installStarted) return;` and there is no reset export, so the FIRST call in this
   file is the only one that reaches the real path. THAT IS WHY THE RUNNER-SEAM TEST LIVES
   IN ITS OWN FILE: `node --test` gives each file its own process, so each gets a fresh
   `installStarted`. Ordering them inside one file cannot work, and every test asserts
   `alreadyInstalling()` as a precondition so a future change says so rather than passing.
   🛑 I found this because my third control FAILED: the injected runner was never called,
   which would have meant my main assertion was passing for the wrong reason. A control
   that cannot fail would have hidden it. */

function statusPath() {
  return path.join(sandbox, 'install.status');
}

test('#1726: with no production opt-in, beginInstall does NOT reach the detached installer', () => {
  liveExec.resetForTests();
  assert.equal(liveExec.liveExecutionAllowed(), false, 'precondition: not authorized');
  assert.equal(update.alreadyInstalling(), false,
    'precondition: installStarted is already set, so this call would return before the gate');
  try { fs.unlinkSync(statusPath()); } catch { /* absent is the normal case */ }

  /* No installRunner is injected, so this takes the REAL path. Without the gate the very
     next statement is the detached spawn. */
  try { update.beginInstall({}); } catch { /* a refusal that throws is also a pass */ }

  assert.equal(fs.existsSync(statusPath()), false,
    'the installer ran: a status file exists, so the gate did not hold and the child has already escaped');
});

test('#1726 CONTROL: the gate is the thing being tested, not an absent code path', () => {
  /* If `liveExecutionAllowed` were stuck false for a reason unrelated to my gate, the
     test above would pass without testing anything. This proves the flag moves. */
  liveExec.resetForTests();
  assert.equal(liveExec.liveExecutionAllowed(), false);
  liveExec.allowLiveExecution();
  assert.equal(liveExec.liveExecutionAllowed(), true, 'the opt-in does not work, so the gate is untestable');
  liveExec.resetForTests();
  assert.equal(liveExec.liveExecutionAllowed(), false, 'resetForTests does not reset, so arms cannot be separated');
});


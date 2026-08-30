/**
 * #1556: A PROBE THAT DID NOT RUN IS NOT A PASS.
 *
 * 🛑 WHY THIS IS ITS OWN FILE, AND IT IS NOT TIDINESS.
 * `connect.setRunner(null)` forces DRY_RUN back ON, and `setDryRun(false)` refuses
 * without an injected runner. So once a test touches this seam the module CANNOT
 * return to "no runner, not dry" - that is a deliberate safety guard, not a bug.
 * An arm using the seam inside the main file would therefore poison every later
 * arm in it. Node gives each test FILE its own process, so isolating it here means
 * there is nothing to restore and no ordering to depend on.
 *
 * ⭐ WHAT THIS CATCHES THAT THE OTHER SIX ARMS CANNOT.
 * All six passed while the real /api/connect route answered willInstall=false for
 * a launcher that does not run. `run()` returns `{ok:true, dryRun:true}` WITHOUT
 * EXECUTING, so the probe scored a binary it had never invoked - and false means
 * "no install needed", which is the unannounced 281MB download this card exists to
 * prevent. The units never set dry-run; the boards I queried did.
 *
 * ⇒ The units and the route disagreed and THE ROUTE WAS RIGHT. This arm exists so
 * that stops being true. Perturbation, measured: drop `&& !probe.dryRun` from
 * connect.js and this file goes red while the other six stay green.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-wi-dry-1556-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_HOME = SB;
const connect = require('./connect');

const bin = path.join(SB, 'claude-broken');
fs.writeFileSync(bin, '#!/bin/sh\nexit 1\n');
fs.chmodSync(bin, 0o755);

test('#1556 a dry-run result is NOT a passing probe: nothing was executed', async () => {
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;
  /* Exactly the shape `run()` returns under dry-run. The binary EXISTS and is
     executable, so accessSync passes and only the probe can decide. */
  connect.setRunner(() => ({ ok: true, stdout: '', dryRun: true }));
  connect.resetWillInstallCache();
  assert.equal(await connect.willInstall(), true,
    'a probe that never executed was scored as a working install');
});

test('#1556 control: the same seam CAN return the other answer', async () => {
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;
  /* Same runner, same binary, dryRun flag absent. If this did not read false the
     test above would prove nothing - it would be green for any implementation. */
  connect.setRunner(() => ({ ok: true, stdout: '' }));
  connect.resetWillInstallCache();
  assert.equal(await connect.willInstall(), false,
    'the control arm cannot reach the false answer, so the assertion above is vacuous');
});

process.on('exit', () => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch {} });

'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

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
const path = require('node:path');

const { mkTemp } = require('../test-support/tmpdir.js');
const SB = mkTemp('aw-wi-dry-1556-');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_HOME = SB;
const connect = require('./connect');

/* kosmos#8378: a stub this platform counts as runnable (test-support/runnerstub.js: on Windows a .cmd beside it, since a
   file runs there by its extension). Its own exit code never matters: arm 1 executes nothing and arm 2's seam answers. */
const bin = require('../test-support/runnerstub').writeRunnerStub(SB, 'claude-broken');

test('#1556 a dry-run result is NOT a passing probe: nothing was executed', async () => {
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;
  /* 🛑 `setRunner(null)`, NOT a hand-rolled object, AND THAT IS THE WHOLE POINT OF
     THIS FILE. Clearing the runner is what forces `DRY_RUN` back on, so `run()` takes
     its REAL dry-run branch and produces the marker itself.

     An earlier version injected `{ok:true, dryRun:true}` by hand. That asserted the
     shape I had TYPED rather than the shape `run()` PRODUCES, so if `run()` ever
     renamed or dropped the marker, `willInstall()` would score an unexecuted probe as
     a pass, return the harmful `false`, and this file would stay green while the
     defect it exists to prevent came back.

     ⇒ The isolation this file was built for is exactly what makes the honest version
     free, and I built it and then did not use it. */
  connect.setRunner(null);
  connect.resetForTests();
  assert.equal(await connect.willInstall(), true,
    'a probe that never executed was scored as a working install');
});

test('#1556 control: the same seam CAN return the other answer', async () => {
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;
  /* Same binary, a probe that DID run and succeeded: `ok` true, no dryRun marker.
     If this did not read false the arm above would prove nothing, because it would
     be green for any implementation. This one has to inject, because the point is a
     result that is NOT dry-run. */
  connect.setRunner(() => ({ ok: true, stdout: '' }));
  connect.resetForTests();
  assert.equal(await connect.willInstall(), false,
    'the control arm cannot reach the false answer, so the assertion above is vacuous');
});

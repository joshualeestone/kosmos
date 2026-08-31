/**
 * #1633: `canRunClaude` is written by `becomeStuck` and read by the stuck
 * screen, and until this file it had no BEHAVIOURAL arm.
 *
 * The stuck screen's only way out is *"open Terminal, type `claude`"*, and
 * `web/index.html` gates that suggestion on `canRunClaude` (#1595). The value is
 * a filesystem answer (`accessSync(claudeBinPath(), X_OK)`) that reaches a
 * person's screen, so the failure it guards against is telling somebody who is
 * already stuck to run a program that answers `command not found` (#205).
 *
 * 🛑 WHY THIS DRIVES `start()` RATHER THAN CALLING `becomeStuck` DIRECTLY.
 * The card offered two shapes: export `becomeStuck` with a `setDriverForTests`,
 * or drive the real flow to failure. This is the second, and it needs NO new
 * production surface at all -- no new export, and in particular no seam that
 * weakens the identity guard.
 *
 * That guard is the point. `becomeStuck` early-returns on `driver !== owner` so
 * a flow the person CANCELLED cannot later write a STUCK record, and so a stale
 * flow's failure cannot tear down the healthy flow that replaced it. A test seam
 * that lets a caller set `driver` would weaken exactly the mechanism whose job is
 * refusing callers. Driving `start()` keeps the guard fully armed: the flow this
 * file creates is the legitimate owner, which is why it reaches the write at all.
 *
 * ⚠️ THE INJECTED RUNNER MUST RETURN A FAILURE, NEVER THROW, AND THIS IS NOT
 * STYLE. `becomeStuck` itself calls the runner on its way out (`killSession()`).
 * A runner that throws therefore throws again INSIDE the function under test,
 * after the interesting work but before the assertion can read it. Measured
 * while writing this file: the throwing version failed with the error raised at
 * `becomeStuck -> killSession -> tmux -> run`, which reads like the flow never
 * got there when in fact it had. `run()` resolving `{ok:false}` and never
 * rejecting is the contract the rest of the file already relies on.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const nodePath = require('node:path');
const { mkTemp } = require('../test-support/tmpdir');

const SANDBOX = mkTemp('becomestuck1633-');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
const CFG_DIR = nodePath.join(SANDBOX, 'claude-config');
fs.mkdirSync(CFG_DIR, { recursive: true });
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(CFG_DIR, '.claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = CFG_DIR;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
/* #527: without this, a default-dir scoped read in this file would reach the
   operator's real ~/.claude.json. Every cell overrides the bin path, but this
   arms the file against a future cell that does not. */
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');

const connect = require('./connect');

/**
 * Read the SETTLED state, not `start()`'s immediate return. `start()` returns
 * before `runFlow` has failed, so the immediate value cannot distinguish "wrote
 * the wrong verdict" from "has not written one yet".
 */
async function settled(ms = 8000) {
  const deadline = Date.now() + ms;
  const moving = [connect.PHASE.DOWNLOADING, connect.PHASE.INSTALLING, connect.PHASE.IDLE];
  while (Date.now() < deadline) {
    if (!moving.includes(connect.state().phase)) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  return connect.state();
}

/**
 * Drive the real `start()` to a real failure. The ONLY variable between the two
 * arms is whether an executable exists at the bin path, which is the exact
 * question `becomeStuck` asks the disk.
 */
async function stuckWith(t, { binaryExists }) {
  const bin = nodePath.join(SANDBOX, `claude-${Math.random().toString(36).slice(2, 8)}`);
  if (binaryExists) { fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n'); fs.chmodSync(bin, 0o755); }
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;
  fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({}));
  connect.setRunner(() => ({ ok: false, stdout: '', stderr: '', message: 'forced by #1633 arm' }));
  connect.setDryRun(false);
  t.after(() => {
    connect.setRunner(null);
    connect.resetForTests();
    connect.setDryRun(true);
    delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  });
  await connect.start();
  return settled();
}

test('#1633: a stuck flow WITH claude on disk records canRunClaude true', async (t) => {
  const st = await stuckWith(t, { binaryExists: true });
  assert.equal(st.phase, connect.PHASE.STUCK,
    'the arm never reached becomeStuck, so it proves nothing about canRunClaude');
  assert.equal(st.canRunClaude, true,
    'claude IS executable on disk, but the stuck screen would withhold the one way out it has');
});

test('#1633: a stuck flow with NO claude on disk records canRunClaude false', async (t) => {
  const st = await stuckWith(t, { binaryExists: false });
  assert.equal(st.phase, connect.PHASE.STUCK,
    'the arm never reached becomeStuck, so it proves nothing about canRunClaude');
  assert.equal(st.canRunClaude, false,
    'nothing is on disk, yet the stuck screen would tell somebody already stuck to type `claude` (#205)');
});

/**
 * ⭐ THE PAIR IS THE POINT. Either assertion alone is satisfied by a constant:
 * hardcode `true` and the first passes, hardcode `false` and the second does.
 * Only both together establish that the field TRACKS THE DISK, which is the
 * property the screen depends on. Both were proven red by mutation before this
 * file was committed; see the card for the transcript.
 */

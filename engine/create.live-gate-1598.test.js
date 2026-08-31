'use strict';

/**
 * #1598: create.js's run() must return { ok: false, ... } on the unauthorized
 * production path, NOT remove.js's { ok: true, dryRun: true }. installJob reads
 * `started = Boolean(r && r.ok !== false)`, so an ok:true refusal would flip an
 * honest not-started into a SILENT started:true, reporting an agent started when
 * nothing registered it. This is the OK-polarity trap (Renet): a future
 * "harmonize create.js with remove.js" change to ok:true would reintroduce it.
 *
 * 🔑 WHY THE MONKEYPATCH IS LOAD-BEARING, NOT A SHORTCUT. In a real `node --test`
 * process refuseOrWarn THROWS, so run() throws before it ever reaches its refuse
 * return, and installJob's catch sets started:false either way. That means a test
 * that lets refuseOrWarn throw passes regardless of the return shape and guards
 * NOTHING. Standing in for the PRODUCTION warn-and-return path (refuseOrWarn
 * returns instead of throwing) is the only way run() reaches its refuse return,
 * and therefore the only way the polarity of that return can be asserted.
 *
 * 🔑 ONE test with two arms ON PURPOSE. The polarity arm needs the module-load
 * default (DRY_RUN false, no runner) to reach the gate, and the public setters
 * cannot restore that state (setDryRun(false) throws without a runner;
 * setRunner(null) forces DRY_RUN true). The control arm sets a runner, which
 * cannot be undone back to the gate-reachable state. Keeping them as separate
 * top-level tests would make the polarity arm depend on running first; folding
 * both into one test makes the order intrinsic and immune to a future
 * concurrency/order change in the runner.
 *
 * SAFETY: the gate is left unauthorized (resetForTests), so even if the
 * monkeypatch failed, the real refuseOrWarn would throw and nothing would reach
 * live launchctl. Every directory is sandboxed to a temp dir; the polarity arm
 * sets no runner, on purpose, so run() reaches the gate rather than a seam.
 *
 *   node --test engine/create.live-gate-1598.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-livegate-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(SB, 'bin', 'claude');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(SB, 'bin', 'tmux');
process.env.AGENT_WORKFORCE_HOME = path.join(SB, 'home');
process.env.AGENT_WORKFORCE_CODEX_HOME = path.join(SB, 'home', '.codex');
/* 🛑 DELETE, do not set to '0'. create.js reads DRY_RUN as
   `process.env.AGENT_WORKFORCE_DRY_RUN === '1'` at load. It must be false at load
   AND stay false with NO runner, which the public setters cannot express
   (setDryRun(false) throws without a runner; setRunner(null) forces DRY_RUN=true).
   The only state where run() reaches the gate with no seam is the module-load
   default, so the polarity arm relies on it and sets no runner before asserting. */
delete process.env.AGENT_WORKFORCE_DRY_RUN;

fs.mkdirSync(path.join(SB, 'bin'), { recursive: true });
fs.writeFileSync(path.join(SB, 'bin', 'claude'), '#!/bin/sh\n', { mode: 0o755 });
fs.writeFileSync(path.join(SB, 'bin', 'tmux'), '#!/bin/sh\n', { mode: 0o755 });

const create = require('./create');
const liveExec = require('./live-execution');

function freshWorker(name) {
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  try { fs.rmSync(create.plistPath(name), { force: true }); } catch { /* none yet */ }
}

test('#1598 create.js run() gate polarity: unauthorized -> started:false, and a seam -> started:true', () => {
  /* ARM 1, the guard: no runner, module-default DRY_RUN false, gate unauthorized.
     Stand in for the production warn-and-return path so run() reaches its refuse
     return (see the header for why this is load-bearing). */
  freshWorker('gateoff');
  liveExec.resetForTests();
  const realRefuse = liveExec.refuseOrWarn;
  liveExec.refuseOrWarn = () => {};
  try {
    const res = create.installJob('gateoff');
    assert.equal(res.ok, true, 'installJob should reach the start stage (bins + supervisor ok)');
    assert.equal(res.started, false,
      'unauthorized run() must yield started:false; a silent started:true here is the OK-polarity trap');
  } finally {
    liveExec.refuseOrWarn = realRefuse;
    liveExec.resetForTests();
  }

  /* ARM 2, the control: a seam wins at `if (runner)` before the gate, proving the
     harness CAN report started:true, so ARM 1's started:false is a real signal and
     not a setup artifact. This runs AFTER ARM 1 by construction; it sets a runner,
     which is why it cannot precede ARM 1 (a runner defeats the gate). */
  freshWorker('gateon');
  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  try {
    const res = create.installJob('gateon');
    assert.equal(res.ok, true);
    assert.equal(res.started, true, 'a runner returning ok:true must yield started:true');
  } finally {
    create.setRunner(null); // clears the runner; forces DRY_RUN back to true
  }
});

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
 * SAFETY: the gate is left unauthorized (resetForTests), so even if the
 * monkeypatch failed, the real refuseOrWarn would throw and nothing would reach
 * live launchctl. Every directory is sandboxed to a temp dir; no runner is set,
 * on purpose, so run() reaches the gate rather than a seam.
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
   default, so this test relies on it and calls no setter before the gate test. */
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

test('#1598 installJob reports started:false on the unauthorized path (ok:false polarity)', () => {
  freshWorker('gateoff');
  liveExec.resetForTests();               // gate NOT authorized (allowed = false)
  const realRefuse = liveExec.refuseOrWarn;
  liveExec.refuseOrWarn = () => {};        // stand in for the production warn-and-return path
  try {
    const res = create.installJob('gateoff');
    assert.equal(res.ok, true, 'installJob should reach the start stage (bins + supervisor ok)');
    assert.equal(res.started, false,
      'unauthorized run() must yield started:false; a silent started:true here is the OK-polarity trap');
  } finally {
    liveExec.refuseOrWarn = realRefuse;
    liveExec.resetForTests();
  }
});

test('control: a seam returning ok:true yields started:true, so started:false above is a real signal', () => {
  freshWorker('gateon');
  /* setRunner wins at `if (runner)` before the gate, so this exercises installJob's
     started logic with a positive result, proving the harness CAN report started:true
     and the false above is not a setup artifact. */
  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  try {
    const res = create.installJob('gateon');
    assert.equal(res.ok, true);
    assert.equal(res.started, true,
      'a runner returning ok:true must yield started:true');
  } finally {
    create.setRunner(null);               // clears the runner; forces DRY_RUN back to true
  }
});

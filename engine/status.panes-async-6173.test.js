'use strict';

/**
 * #6173: the pane roster read without blocking the board's thread (an account move's restarts ask it). One body
 * yields each tmux call and two drivers answer it; these pin that the async driver gives the sync one's answer, from a
 * real tmux process (a stand-in shell script, so a Mac and Linux file: it is not in tools/windows-tests.js), while the
 * board's thread keeps turning.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

// ⚠️ SANDBOX BEFORE REQUIRING `./status`, because it reads these at module load.
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'status-panes-async-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = nodePath.join(SANDBOX, 'claude');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');

const status = require('./status');
const fleet = require('../test-support/fleet');

/* A tmux that takes its time: `sleep` then the panes file, or a no-server answer. */
function slowTmux(body) {
  const bin = nodePath.join(SANDBOX, `tmux-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(bin, `#!/bin/sh\nsleep 0.3\n${body}\n`, { mode: 0o755 });
  return bin;
}
function withTmux(bin, fn) {
  const was = process.env.AGENT_WORKFORCE_TMUX_BIN;
  process.env.AGENT_WORKFORCE_TMUX_BIN = bin;
  status.setPaneSource(null);
  const done = () => { if (was === undefined) delete process.env.AGENT_WORKFORCE_TMUX_BIN; else process.env.AGENT_WORKFORCE_TMUX_BIN = was; };
  return Promise.resolve().then(fn).finally(done);
}

test('#6173: the async roster reads the same agents as the sync one, and the board keeps turning while tmux answers', async () => {
  const panes = nodePath.join(SANDBOX, 'panes.txt');
  fs.writeFileSync(panes, `${fleet.line({ session: 'dana', claim: 'dana', title: '✳ Claude Code' })}\n`);
  await withTmux(slowTmux(`cat '${panes}'`), async () => {
    let turns = 0;
    const iv = setInterval(() => { turns++; }, 5);
    const got = await status.paneRosterAsync();
    clearInterval(iv);
    assert.ok(turns > 5, `the board's thread barely turned while tmux answered (${turns}); the sync read turns it 0 times`);
    assert.deepEqual(got, status.paneRoster(), 'the two drivers read the panes differently');
    assert.deepEqual(got.map((p) => p.sessionName), ['dana']);
  });
});

test('#6173 control: the sync roster holds the board while tmux answers', async () => {
  const panes = nodePath.join(SANDBOX, 'panes2.txt');
  fs.writeFileSync(panes, '');
  await withTmux(slowTmux(`cat '${panes}'`), () => {
    let turns = 0;
    const iv = setInterval(() => { turns++; }, 5);
    status.paneRoster();
    clearInterval(iv);
    assert.equal(turns, 0, 'a timer fired during a synchronous read: the control measures nothing');
  });
});

test('#6173: a tmux that cannot be asked fails the async roster the way it fails the sync one', async () => {
  await withTmux(slowTmux('echo nope >&2; exit 7'), async () => {
    let syncErr = null;
    try { status.paneRoster(); } catch (e) { syncErr = e; }
    await assert.rejects(status.paneRosterAsync(), (e) => {
      assert.ok(syncErr, 'the control: the sync read did not refuse');
      assert.equal(e.message, syncErr.message);
      return true;
    });
  });
});

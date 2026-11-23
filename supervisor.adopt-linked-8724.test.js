'use strict';
/**
 * kosmos#8724: "Set up and restart" writes a launch job for a window the person linked to Kosmos by hand, and writing
 * the job starts its supervisor at once, while that window is still live. The supervisor must adopt the window (leave it
 * running and watch it), never close it or start a second agent beside it. A linked window is a Claude window
 * (engine/linkwindow.js refuses any other) whose session carries Kosmos's mark naming itself, so this runs the real
 * bin/agent-supervisor.sh against a recording fake tmux reporting exactly that: one claimed session, its pane running
 * Claude under each name the board counts as a running Claude agent. The harness is supervisor.adopt-grok-3953.test.js's.
 *
 *   node --test supervisor.adopt-linked-8724.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { spawnSync } = require('node:child_process');
const status = require('./engine/status');
const fleet = require('./test-support/fleet');

const SUP = nodePath.join(__dirname, 'bin', 'agent-supervisor.sh');
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-sup-adopt-linked-8724-'));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

// has-session answers "yes" once (the linked window is there when the job starts) and "no" after, so an adopting
// supervisor's watch loop ends at once. show-options answers the mark linkwindow set. Every verb is recorded.
const FAKE_TMUX = nodePath.join(SANDBOX, 'fake-tmux.sh');
fs.writeFileSync(FAKE_TMUX, [
  '#!/bin/bash',
  'printf "%s\\n" "$*" >> "$REC"',
  'case "$1" in',
  '  has-session) if [ -e "$REC.seen" ]; then exit 1; fi; : > "$REC.seen"; exit 0 ;;',
  '  show-options) printf "%s\\n" "$MARK"; exit 0 ;;',
  '  list-panes) printf "%s\\n" "$PANE_CMD"; exit 0 ;;',
  '  *) exit 0 ;;',
  'esac',
].join('\n') + '\n', { mode: 0o755 });

function runOver(paneCmd, mark) {
  const rec = nodePath.join(SANDBOX, `rec-${Math.random().toString(36).slice(2)}.txt`);
  const r = spawnSync('/bin/bash', [SUP, 'zara', SANDBOX, '/usr/bin/true', FAKE_TMUX], {
    env: { PATH: process.env.PATH, HOME: SANDBOX, AGENT_WORKFORCE_HOME: SANDBOX, AGENT_WORKFORCE_DATA: nodePath.join(SANDBOX, 'data'), REC: rec, MARK: mark, PANE_CMD: paneCmd },
    encoding: 'utf8', timeout: 20000,
  });
  const calls = fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : '';
  return {
    r, calls,
    killed: /^kill-session/m.test(calls),
    launched: /^new-session/m.test(calls),
    adopted: /is already running -- leaving it alone/.test(r.stderr),
  };
}

test('#8724: a job started for a linked Claude window adopts it; nothing is closed and no second agent is started', () => {
  for (const cmd of [fleet.CLAUDE_COMMAND, '2.0.1']) {
    assert.equal(status.isAgentSession({ command: cmd, session: 'zara', claim: 'zara' }), true,
      `the board does not count ${cmd} as a running agent, so this row tests nothing`);
    const out = runOver(cmd, 'zara');
    assert.equal(out.r.error, undefined, String(out.r.error));
    assert.ok(/^list-panes/m.test(out.calls), `the supervisor never looked at the pane (${cmd}): ${out.calls}`);
    assert.equal(out.killed, false, `the linked window (${cmd}) was closed: ${out.calls}`);
    assert.equal(out.launched, false, `a second agent was started beside the linked window (${cmd}): ${out.calls}`);
    assert.equal(out.adopted, true, `the linked window (${cmd}) was not adopted: ${out.r.stderr}`);
  }
});

test('#8724 CONTROL: the same marked session holding only a shell is closed and relaunched, so the rows above can fail', () => {
  const out = runOver('zsh', 'zara');
  assert.equal(out.killed, true, 'the control could not show a kill: ' + out.calls);
  assert.equal(out.adopted, false);
});

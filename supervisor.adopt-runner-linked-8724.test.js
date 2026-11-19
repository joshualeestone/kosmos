'use strict';
/**
 * kosmos#8724 item 3: a Codex, Antigravity or Grok window linked by hand carries Kosmos's mark and its runner. A
 * supervisor started for that agent later (a launch job written afterwards, or a restart of the board) must adopt the
 * live window, never close it or start a second agent beside it. Runs the real bin/agent-supervisor.sh against a
 * recording fake tmux reporting one session marked with its own name whose pane runs each runner's program, with the
 * runner argument the job would carry. The harness is supervisor.adopt-grok-3953.test.js's.
 *
 *   node --test supervisor.adopt-runner-linked-8724.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { spawnSync } = require('node:child_process');

const SUP = nodePath.join(__dirname, 'bin', 'agent-supervisor.sh');
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-sup-adopt-runner-8724-'));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

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

function runOver(paneCmd, runner, model) {
  const rec = nodePath.join(SANDBOX, `rec-${Math.random().toString(36).slice(2)}.txt`);
  const r = spawnSync('/bin/bash', [SUP, 'zara', SANDBOX, '/usr/bin/true', FAKE_TMUX, '', model, runner], {
    env: { PATH: process.env.PATH, HOME: SANDBOX, AGENT_WORKFORCE_HOME: SANDBOX, REC: rec, MARK: 'zara', PANE_CMD: paneCmd },
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

test('#8724: a job started for a linked Codex, Antigravity or Grok window adopts it; nothing is closed, no second agent', () => {
  for (const [cmd, runner, model] of [['codex', 'codex', 'gpt-5'], ['codex.exe', 'codex', 'gpt-5'], ['agy', 'antigravity', 'gemini-3-pro'], ['grok-native', 'grok', 'grok-4.6']]) {
    const out = runOver(cmd, runner, model);
    assert.equal(out.r.error, undefined, String(out.r.error));
    assert.ok(/^list-panes/m.test(out.calls), `the supervisor never looked at the pane (${cmd}): ${out.calls}`);
    assert.equal(out.killed, false, `the linked ${cmd} window was closed: ${out.calls}`);
    assert.equal(out.launched, false, `a second agent was started beside the linked ${cmd} window: ${out.calls}`);
    assert.equal(out.adopted, true, `the linked ${cmd} window was not adopted: ${out.r.stderr}`);
  }
});

test('#8724 CONTROL: the same marked session holding only a shell is closed and relaunched, so the rows above can fail', () => {
  const out = runOver('zsh', 'codex', 'gpt-5');
  assert.equal(out.killed, true, 'the control could not show a kill: ' + out.calls);
  assert.equal(out.adopted, false);
});

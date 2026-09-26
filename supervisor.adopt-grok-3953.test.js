'use strict';
/**
 * #3953: the supervisor's own "a live agent is running here" allowlist (bin/agent-supervisor.sh) had no
 * Grok names, so a supervisor re-run against a live Grok agent read its `grok-native` pane as a crashed
 * shell and killed the session. Runs the real script against a recording fake tmux that reports one
 * existing, claimed session whose pane runs the given command.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { spawnSync } = require('node:child_process');
const status = require('./engine/status');

const SUP = nodePath.join(__dirname, 'bin', 'agent-supervisor.sh');
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-sup-adopt-grok-3953-'));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

// has-session answers "yes" once (the session is there when the supervisor starts) and "no" after, so an
// adopting supervisor's watch loop ends at once. Every other verb is recorded.
const FAKE_TMUX = nodePath.join(SANDBOX, 'fake-tmux.sh');
fs.writeFileSync(FAKE_TMUX, [
  '#!/bin/bash',
  'printf "%s\\n" "$*" >> "$REC"',
  'case "$1" in',
  '  has-session) if [ -e "$REC.seen" ]; then exit 1; fi; : > "$REC.seen"; exit 0 ;;',
  '  show-options) printf "%s\\n" "$SESSION_NAME"; exit 0 ;;',
  '  list-panes) printf "%s\\n" "$PANE_CMD"; exit 0 ;;',
  '  *) exit 0 ;;',
  'esac',
].join('\n') + '\n', { mode: 0o755 });

function runOver(paneCmd) {
  const rec = nodePath.join(SANDBOX, `rec-${paneCmd}-${Math.random().toString(36).slice(2)}.txt`);
  const r = spawnSync('/bin/bash', [SUP, 'elon', SANDBOX, '/usr/bin/true', FAKE_TMUX, '', 'grok-4.6', 'grok'], {
    env: { PATH: process.env.PATH, HOME: SANDBOX, AGENT_WORKFORCE_HOME: SANDBOX, REC: rec, SESSION_NAME: 'elon', PANE_CMD: paneCmd },
    encoding: 'utf8', timeout: 20000,
  });
  const calls = fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : '';
  return { r, calls, killed: /^kill-session/m.test(calls), adopted: /is already running -- leaving it alone/.test(r.stderr) };
}

test('#3953: a supervisor re-run adopts a LIVE Grok agent instead of killing it, for every name the board counts as Grok', () => {
  for (const cmd of ['grok-native', 'grok', 'grok.exe']) {
    assert.equal(status.isGrokCommand(cmd), true, `the board does not count ${cmd} as Grok, so this row tests nothing`);
    const out = runOver(cmd);
    assert.equal(out.r.error, undefined, String(out.r.error));
    assert.ok(/^list-panes/m.test(out.calls), `the supervisor never looked at the pane (${cmd}): ${out.calls}`);
    assert.equal(out.killed, false, `a live Grok agent (${cmd}) was killed as crashed: ${out.calls}`);
    assert.equal(out.adopted, true, `a live Grok agent (${cmd}) was not adopted: ${out.r.stderr}`);
  }
});

test('#3953 CONTROL: the same session crashed back to a shell is still killed and relaunched', () => {
  const out = runOver('zsh');
  assert.equal(out.killed, true, 'the control could not show a kill, so the rows above prove nothing: ' + out.calls);
  assert.equal(out.adopted, false);
});

/* #3953 (second half): the Grok and Gemini report hooks run `node "<bridge>"`, and Codex runs its bridge through
   `#!/usr/bin/env node`. A pane inherits the tmux server's PATH, which on a Mac whose server launchd started (and on
   any Kosmos-only Mac) has no node, so those agents' self-reports failed silently. The supervisor now APPENDS the
   node it resolved (NODE_BIN) to the server's PATH for those runners: a person's own node still comes first. */
const LAUNCH_TMUX = nodePath.join(SANDBOX, 'launch-tmux.sh');
fs.writeFileSync(LAUNCH_TMUX, [
  '#!/bin/bash',
  'case "$1" in',
  '  has-session) exit 1 ;;',
  '  show-environment) printf "PATH=/usr/bin:/bin\\n"; exit 0 ;;',
  '  new-session) printf "%s\\n" "$*" >> "$REC"; exit 0 ;;',
  '  *) exit 0 ;;',
  'esac',
].join('\n') + '\n', { mode: 0o755 });

function launch(runner) {
  const rec = nodePath.join(SANDBOX, `launch-${runner}-${Math.random().toString(36).slice(2)}.txt`);
  const r = spawnSync('/bin/bash', [SUP, `a-${runner}`, SANDBOX, '/usr/bin/true', LAUNCH_TMUX, '', runner === 'claude' ? '' : 'm', runner], {
    env: { PATH: process.env.PATH, HOME: SANDBOX, AGENT_WORKFORCE_HOME: SANDBOX, REC: rec },
    encoding: 'utf8', timeout: 20000,
  });
  return { r, rec: fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : '' };
}

test('#3953: a Grok, Gemini or Codex pane gets node on its PATH, after the server\'s own PATH', () => {
  const nodeDir = nodePath.dirname(spawnSync('/bin/bash', ['-c', 'command -v node'], { encoding: 'utf8' }).stdout.trim());
  assert.ok(nodeDir && nodeDir !== '.', 'this machine has no node on PATH, so the supervisor resolves none and the test proves nothing');
  for (const runner of ['grok', 'gemini', 'codex']) {
    const out = launch(runner);
    assert.ok(/new-session/.test(out.rec), `the ${runner} arm did not launch: ${out.r.stderr}`);
    assert.ok(out.rec.includes(`-e PATH=/usr/bin:/bin:${nodeDir} `),
      `a ${runner} pane's report bridge cannot find node: ${out.rec}`);
  }
});

test('#3953 CONTROL: a Claude pane\'s PATH is left alone (its hook finds node itself)', () => {
  const out = launch('claude');
  assert.ok(/new-session/.test(out.rec), 'the claude arm did not launch: ' + out.r.stderr);
  assert.ok(!/-e PATH=/.test(out.rec), 'a Claude pane had its PATH rewritten: ' + out.rec);
});

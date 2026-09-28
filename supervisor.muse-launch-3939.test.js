'use strict';
/**
 * #3939 slice 3c-3a: a Meta Muse agent's pane runs Kosmos's own front (engine/musefront.js) under node, not a
 * vendor TUI, and is told where the report bridge is. Runs the real bin/agent-supervisor.sh against a fake tmux
 * that records the new-session it is asked for.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { spawnSync } = require('node:child_process');

const SUP = nodePath.join(__dirname, 'bin', 'agent-supervisor.sh');
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-sup-muse-3939-'));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const FAKE_TMUX = nodePath.join(SANDBOX, 'fake-tmux.sh');
fs.writeFileSync(FAKE_TMUX, [
  '#!/bin/bash',
  'case "$1" in',
  '  has-session) exit 1 ;;',
  '  new-session) printf "%s\\n" "$*" >> "$REC"; exit 0 ;;',
  '  *) exit 0 ;;',
  'esac',
].join('\n') + '\n', { mode: 0o755 });

function launch(runner, sup = SUP) {
  const rec = nodePath.join(SANDBOX, `rec-${runner}-${Math.random().toString(36).slice(2)}.txt`);
  const r = spawnSync('/bin/bash', [sup, `a-${runner}`, SANDBOX, '/usr/bin/true', FAKE_TMUX, '', '', runner], {
    env: { PATH: process.env.PATH, HOME: SANDBOX, AGENT_WORKFORCE_HOME: SANDBOX, REC: rec },
    encoding: 'utf8', timeout: 20000,
  });
  return { r, rec: fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : '' };
}

test('#3939: a muse agent\'s pane runs node on engine/musefront.js in its folder, with the report bridge beside the script', () => {
  const out = launch('muse');
  assert.equal(out.r.error, undefined, String(out.r.error));
  const line = out.rec.split('\n').find((l) => /^new-session/.test(l)) || '';
  assert.ok(line, 'the muse arm did not launch: ' + out.r.stderr);
  assert.ok(line.includes(nodePath.join(__dirname, 'engine') + '/musefront.js ' + SANDBOX),
    'the pane does not run the Muse front on this agent\'s folder: ' + line);
  assert.ok(line.includes('-e KOSMOS_MUSE_BRIDGE=' + nodePath.join(__dirname, 'bin', 'agy-report-bridge.js')),
    'the front is not told where the report bridge is: ' + line);
  assert.ok(!line.includes('/usr/bin/true'), 'the pane runs the runner binary itself, not the front: ' + line);
});

test('#3939: with no engine to run the front from, a muse agent is refused in a sentence and no pane starts', () => {
  // The script alone in a folder with no engine beside it and no engine-path pointer.
  const lone = nodePath.join(SANDBOX, 'lone', 'bin');
  fs.mkdirSync(lone, { recursive: true });
  fs.copyFileSync(SUP, nodePath.join(lone, 'agent-supervisor.sh'));
  const out = launch('muse', nodePath.join(lone, 'agent-supervisor.sh'));
  assert.equal(out.rec, '', 'a pane was started with no Muse front to run: ' + out.rec);
  assert.match(out.r.stderr + out.r.stdout, /Muse front or node is not on this computer/);
  assert.notEqual(out.r.status, 0);
});

test('#3939 CONTROL: a claude agent\'s pane does not run the Muse front', () => {
  const out = launch('claude');
  assert.ok(/new-session/.test(out.rec), 'the claude arm did not launch, so this control shows nothing: ' + out.r.stderr);
  assert.ok(!/musefront\.js|KOSMOS_MUSE_BRIDGE/.test(out.rec), 'a claude pane got the Muse front: ' + out.rec);
});

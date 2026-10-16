'use strict';
/**
 * #5812 item 3: the Mac supervisor refreshes the grok hook file Kosmos owns ($GROK_HOME/hooks/kosmos-report-bridge.json)
 * at every launch, so a grok agent made before the file-edit hook gets it. EXECUTES the shipped bin/agent-supervisor.sh
 * with the recorder fake tmux supervisor.qwen-endpoint-5977 uses.
 */
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { spawnSync } = require('node:child_process');

const SUP = nodePath.join(__dirname, 'bin', 'agent-supervisor.sh');
const settings = require('./engine/groksettings');
const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-sup-grokkeep-5812-')));
const FAKE_TMUX = nodePath.join(SANDBOX, 'rec-tmux.sh');
fs.writeFileSync(FAKE_TMUX, [
  '#!/bin/bash',
  'case "$1" in',
  '  new-session) printf "%s\\n" "$*" >> "$REC"; exit 0 ;;',
  '  has-session) exit 1 ;;',
  '  *) exit 0 ;;',
  'esac',
].join('\n') + '\n', { mode: 0o755 });

let n = 0;
function grokHome() {
  const dir = nodePath.join(SANDBOX, `grok-h${++n}`);
  fs.mkdirSync(nodePath.join(dir, 'hooks'), { recursive: true });
  return dir;
}
function run(name, home) {
  const rec = nodePath.join(SANDBOX, `rec-${++n}.txt`);
  const env = { PATH: process.env.PATH, HOME: SANDBOX, REC: rec, AGENT_WORKFORCE_HOME: SANDBOX, AGENT_WORKFORCE_DATA: nodePath.join(SANDBOX, 'data'), GROK_HOME: home };
  const r = spawnSync('/bin/bash', [SUP, name, SANDBOX, '/usr/bin/true', FAKE_TMUX, '', '', 'grok'], { env, encoding: 'utf8', timeout: 30000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), argv: fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : '' };
}
const BRIDGE = fs.realpathSync.native(nodePath.join(__dirname, 'bin', 'grok-report-bridge.js'));

test('a grok launch brings an older hook file of ours up to date with the file-edit hook', () => {
  const home = grokHome();
  const file = nodePath.join(home, 'hooks', 'kosmos-report-bridge.json');
  const old = { hooks: {} };
  for (const e of settings.HOOK_EVENTS) old.hooks[e] = [settings.definitionFor(BRIDGE, { platform: 'darwin' })];
  fs.writeFileSync(file, JSON.stringify(old, null, 2) + '\n');
  const r = run('agent-grok1', home);
  assert.match(r.argv, /new-session/, r.out);
  const now = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(now.hooks.PreToolUse, [{ matcher: settings.TOOL_MATCHER, hooks: [{ type: 'command', command: `node "${BRIDGE}"` }] }]);
  assert.equal(/report hooks were not refreshed/.test(r.out), false, r.out);
});

test('review 1: a hook file the person deleted is NOT brought back at launch (their own ~/.grok)', () => {
  const home = grokHome();
  const r = run('agent-grok2', home);
  assert.match(r.argv, /new-session/, r.out);
  assert.equal(fs.existsSync(nodePath.join(home, 'hooks', 'kosmos-report-bridge.json')), false);
});

test('CONTROL: a file at that name that is not ours is left alone, the launch goes ahead, and the log says why', () => {
  const home = grokHome();
  const file = nodePath.join(home, 'hooks', 'kosmos-report-bridge.json');
  fs.writeFileSync(file, '{"hooks":{"Stop":[]}}');
  const r = run('agent-grok3', home);
  assert.match(r.argv, /new-session/, r.out);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"hooks":{"Stop":[]}}');
  assert.match(r.out, /grok: its report hooks were not refreshed \(the hook file was changed by hand/);
});

test('review 2: our file as the person edited it (a hook of their own added) is left as they left it', () => {
  const home = grokHome();
  const file = nodePath.join(home, 'hooks', 'kosmos-report-bridge.json');
  const edited = { hooks: {} };
  for (const e of settings.HOOK_EVENTS) edited.hooks[e] = [settings.definitionFor(BRIDGE, { platform: 'darwin' })];
  edited.hooks.Stop.push({ hooks: [{ type: 'command', command: '/their/own.sh' }] });
  const text = JSON.stringify(edited, null, 2) + '\n';
  fs.writeFileSync(file, text);
  const r = run('agent-grok4', home);
  assert.match(r.argv, /new-session/, r.out);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert.match(r.out, /changed by hand/);
});

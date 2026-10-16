'use strict';
/**
 * #5812 item 2: the Mac supervisor puts the Codex file-edit hook (engine/codexhooks.js) into the agent's private Codex
 * home, only for the pinned Codex version, and leaves NO hooks.json when it cannot (review 1: Codex has hooks on by
 * default and its TUI stops on an untrusted one). EXECUTES the shipped bin/agent-supervisor.sh with the recorder fake
 * tmux supervisor.qwen-endpoint-5977 uses, and a fake codex that answers --version.
 */
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { spawnSync } = require('node:child_process');

const SUP = nodePath.join(__dirname, 'bin', 'agent-supervisor.sh');
const BRIDGE = nodePath.join(__dirname, 'bin', 'codex-report-bridge.js');
const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-sup-codexhook-5812-')));

const FAKE_TMUX = nodePath.join(SANDBOX, 'rec-tmux.sh');
fs.writeFileSync(FAKE_TMUX, [
  '#!/bin/bash',
  'case "$1" in',
  '  new-session) printf "%s\\n" "$*" >> "$REC"; exit 0 ;;',
  '  has-session) exit 1 ;;',
  '  *) exit 0 ;;',
  'esac',
].join('\n') + '\n', { mode: 0o755 });

const PINNED = require('./engine/runners').MANIFEST.openai.version;
function fakeCodex(version) {
  const f = nodePath.join(SANDBOX, `codex-${version || 'none'}.sh`);
  // It notes the CODEX_HOME its --version ran under (review 6: --version writes into that home).
  fs.writeFileSync(f, `#!/bin/sh\nif [ "$1" = --version ]; then echo "$CODEX_HOME" >> "$REC.version-home"; echo "codex-cli ${version}"; fi\nexit 0\n`, { mode: 0o755 });
  return f;
}

let n = 0;
function accountHome() {
  const dir = nodePath.join(SANDBOX, `.codex-h${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'), '{"OPENAI_API_KEY":null,"tokens":{}}', { mode: 0o600 });
  return dir;
}
function run(name, codexHome, version = PINNED) {
  const rec = nodePath.join(SANDBOX, `rec-${++n}.txt`);
  const env = { PATH: process.env.PATH, HOME: SANDBOX, REC: rec, AGENT_WORKFORCE_HOME: SANDBOX, AGENT_WORKFORCE_DATA: nodePath.join(SANDBOX, 'data'), CODEX_HOME: codexHome };
  const r = spawnSync('/bin/bash', [SUP, name, SANDBOX, fakeCodex(version), FAKE_TMUX, '', 'gpt-5.2', 'codex'], { env, encoding: 'utf8', timeout: 30000 });
  const argv = fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : '';
  const runtime = (/-e CODEX_HOME=(\S+)/.exec(argv) || [])[1] || '';
  const versionHome = fs.existsSync(`${rec}.version-home`) ? fs.readFileSync(`${rec}.version-home`, 'utf8').trim() : '';
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), argv, runtime, versionHome };
}

test('a codex launch installs the hook and its trust record in the private home', () => {
  const r = run('agent-hook1', accountHome());
  assert.match(r.argv, /new-session/, r.out);
  assert.ok(r.runtime && fs.existsSync(r.runtime), `the private home is named in the launch: ${r.argv}`);
  assert.equal(/features\.hooks/.test(r.argv), false, 'no flag: hooks are on by default in this Codex');
  const hooksJson = JSON.parse(fs.readFileSync(nodePath.join(r.runtime, 'hooks.json'), 'utf8'));
  assert.equal(hooksJson.hooks.PreToolUse[0].matcher, 'apply_patch');
  assert.equal(hooksJson.hooks.PreToolUse[0].hooks[0].command, `'${fs.realpathSync.native(BRIDGE)}'`);
  const cfg = fs.readFileSync(nodePath.join(r.runtime, 'config.toml'), 'utf8');
  assert.ok(cfg.includes(`[hooks.state."${nodePath.join(r.runtime, 'hooks.json')}:pre_tool_use:0:0"]\ntrusted_hash = "sha256:`), cfg);
  assert.match(cfg, /trust_level = "trusted"/, 'the folder trust the launch already wrote is still there');
  assert.equal(/file-edit hook was not set up/.test(r.out), false);
  assert.equal(r.versionHome, r.runtime, 'review 6: codex --version ran against the private home, not the account\'s');
});

test('CONTROL: a hook record changed by hand is left alone, and the agent launches with NO hooks.json, saying so', () => {
  const name = 'agent-hook2';
  const first = run(name, accountHome());
  assert.ok(fs.existsSync(nodePath.join(first.runtime, 'hooks.json')), first.out);
  const cfgFile = nodePath.join(first.runtime, 'config.toml');
  const edited = fs.readFileSync(cfgFile, 'utf8').replace(/(trusted_hash = "sha256:[0-9a-f]{64}"\n)/, '$1enabled = false\n');
  fs.writeFileSync(cfgFile, edited);
  const r = run(name, accountHome());
  assert.match(r.argv, /new-session/, r.out);
  assert.equal(r.runtime, first.runtime);
  assert.match(r.out, /its file-edit hook was not set up \(.*by hand.*\)/);
  assert.equal(fs.readFileSync(cfgFile, 'utf8'), edited, 'the person\'s edit is untouched');
  assert.equal(fs.existsSync(nodePath.join(r.runtime, 'hooks.json')), false, 'nothing for the TUI to stop on');
});

test('review 1: a Codex other than the pinned version launches with NO hooks.json, saying so', () => {
  const name = 'agent-hook3';
  const first = run(name, accountHome());
  assert.ok(fs.existsSync(nodePath.join(first.runtime, 'hooks.json')), first.out);
  const r = run(name, accountHome(), '9.9.9');
  assert.match(r.argv, /new-session/, r.out);
  assert.match(r.out, /its file-edit hook was not set up \(this Codex is 9\.9\.9/);
  assert.equal(fs.existsSync(nodePath.join(r.runtime, 'hooks.json')), false);
});

test('review 5: a private home that resolves to the account home itself gets NO hook (never the person\'s own home)', () => {
  const name = 'agent-hook4';
  const first = run(name, accountHome());
  assert.ok(first.runtime, first.out);
  assert.ok(fs.existsSync(nodePath.join(first.runtime, 'hooks.json')), 'an earlier launch left our hooks.json');
  fs.writeFileSync(nodePath.join(first.runtime, 'auth.json'), '{"OPENAI_API_KEY":null,"tokens":{}}', { mode: 0o600 });
  const r = run(name, first.runtime);   // the "account home" IS the agent's private home
  assert.match(r.out, /refused a private Codex home that resolves to the selected account home/);
  assert.match(r.out, /its file-edit hook was not set up \(its Codex home is the account's own\)/);
  assert.equal(fs.existsSync(nodePath.join(first.runtime, 'hooks.json')), false, 'review 6: ours is removed there too');
});

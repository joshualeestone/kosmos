'use strict';
/**
 * #7976: the report hooks of a grok agent are put back at every launch, not only at birth. create.js wrote the file once,
 * so a wiped grok home, a new account home, or a file from before a later hook (measured on a real Mac 11-04: its file,
 * written 09-27, had no PreToolUse) stayed that way, and the agent reported nothing with no sign of why. EXECUTES the
 * shipped bin/agent-supervisor.sh with the recorder fake tmux supervisor.codexhook-5812 uses, and a fake grok.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { spawnSync } = require('node:child_process');

const SUP = nodePath.join(__dirname, 'bin', 'agent-supervisor.sh');
const BRIDGE = fs.realpathSync.native(nodePath.join(__dirname, 'bin', 'grok-report-bridge.js'));
const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-sup-grokhook-7976-')));
const FILE = 'kosmos-report-bridge.json';

const FAKE_TMUX = nodePath.join(SANDBOX, 'rec-tmux.sh');
fs.writeFileSync(FAKE_TMUX, [
  '#!/bin/bash',
  'case "$1" in',
  '  new-session) printf "%s\\n" "$*" >> "$REC"; exit 0 ;;',
  '  has-session) exit 1 ;;',
  '  *) exit 0 ;;',
  'esac',
].join('\n') + '\n', { mode: 0o755 });
const FAKE_GROK = nodePath.join(SANDBOX, 'grok.sh');
fs.writeFileSync(FAKE_GROK, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

let n = 0;
/* One launch, with a home of its own so no case reads another's file. `grokHome`: a per-account agent's home, or null for
   a default agent (<AGENT_WORKFORCE_HOME>/.grok). */
function run({ grokHome = null, runner = 'grok', model = 'grok-4.6', root = null } = {}) {
  const home = root || nodePath.join(SANDBOX, `h${++n}`);
  fs.mkdirSync(home, { recursive: true });
  const rec = nodePath.join(SANDBOX, `rec-${++n}.txt`);
  const env = { PATH: process.env.PATH, HOME: home, REC: rec, AGENT_WORKFORCE_HOME: home, AGENT_WORKFORCE_DATA: nodePath.join(home, 'data') };
  if (grokHome) env.GROK_HOME = grokHome;
  const r = spawnSync('/bin/bash', [SUP, `agent-g${n}`, home, FAKE_GROK, FAKE_TMUX, '', model, runner], { env, encoding: 'utf8', timeout: 30000 });
  return { home, code: r.status, out: (r.stdout || '') + (r.stderr || ''), argv: fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : '' };
}
const hooksOf = (dir) => JSON.parse(fs.readFileSync(nodePath.join(dir, 'hooks', FILE), 'utf8')).hooks;

test('a default grok agent with no hook file gets it at launch, with every event, pointing at the bridge', () => {
  const r = run();
  assert.match(r.argv, /new-session/, r.out);
  const hooks = hooksOf(nodePath.join(r.home, '.grok'));
  for (const e of ['SessionStart', 'UserPromptSubmit', 'Stop', 'StopCancelled', 'StopFailure', 'SessionEnd', 'PreToolUse']) assert.ok(hooks[e], `${e} is wired`);
  assert.ok(hooks.UserPromptSubmit[0].hooks[0].command.includes(BRIDGE), hooks.UserPromptSubmit[0].hooks[0].command);
});

test('a per-account home gets it in that home, and not in the default one', () => {
  const account = nodePath.join(SANDBOX, `account-${++n}`);
  fs.mkdirSync(account, { recursive: true });
  const r = run({ grokHome: account });
  assert.match(r.argv, /new-session/, r.out);
  assert.ok(hooksOf(account).Stop, 'in the account home');
  assert.equal(fs.existsSync(nodePath.join(r.home, '.grok', 'hooks', FILE)), false, 'not in the default home');
});

test('a file from before a later hook is brought up to date (the measured case: no PreToolUse)', () => {
  const root = nodePath.join(SANDBOX, `h${++n}`);
  const dir = nodePath.join(root, '.grok', 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  const old = { hooks: { Stop: [{ hooks: [{ type: 'command', command: `node "${BRIDGE}"` }] }] } };
  fs.writeFileSync(nodePath.join(dir, FILE), JSON.stringify(old));
  assert.equal(JSON.parse(fs.readFileSync(nodePath.join(dir, FILE), 'utf8')).hooks.PreToolUse, undefined, 'control: the old file has none');
  run({ root });
  const hooks = hooksOf(nodePath.join(root, '.grok'));
  assert.ok(hooks.PreToolUse && hooks.UserPromptSubmit, JSON.stringify(Object.keys(hooks)));
});

test('the person\'s other hook files in that folder are left exactly as they were', () => {
  const root = nodePath.join(SANDBOX, `h${++n}`);
  const dir = nodePath.join(root, '.grok', 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  const theirs = nodePath.join(dir, 'mine.json');
  fs.writeFileSync(theirs, '{"hooks":{"Stop":[]}}\n');
  run({ root });
  assert.equal(fs.readFileSync(theirs, 'utf8'), '{"hooks":{"Stop":[]}}\n');
  assert.ok(hooksOf(nodePath.join(root, '.grok')).Stop, 'and ours is there beside it');
});

test('a hook file that cannot be written never stops the launch, and says why', () => {
  const root = nodePath.join(SANDBOX, `h${++n}`);
  const dir = nodePath.join(root, '.grok', 'hooks');
  fs.mkdirSync(dir, { recursive: true });
  // A link pointing at nothing is somebody's arrangement: ensurePrepared refuses to write over it.
  fs.symlinkSync(nodePath.join(SANDBOX, 'nowhere-at-all.json'), nodePath.join(dir, FILE));
  const r = run({ root });
  assert.match(r.argv, /new-session/, `the agent still started: ${r.out}`);
  assert.match(r.out, /grok report hooks were not put in place \(.*link.*\)/);
  assert.equal(fs.lstatSync(nodePath.join(dir, FILE)).isSymbolicLink(), true, 'the link is untouched');
});

test('CONTROL: another runner writes no grok hook file', () => {
  const r = run({ runner: 'gemini', model: 'gemini-2.5-flash' });
  assert.match(r.argv, /new-session/, r.out);
  assert.equal(fs.existsSync(nodePath.join(r.home, '.grok', 'hooks', FILE)), false);
});

test('the file written at launch is the one birth writes, so the two cannot drift', () => {
  const settings = require('./engine/groksettings');
  const r = run();
  const want = settings.desiredContent(BRIDGE, { platform: process.platform, node: null });
  assert.deepEqual(hooksOf(nodePath.join(r.home, '.grok')), want.hooks);
});

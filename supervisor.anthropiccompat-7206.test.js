'use strict';
/**
 * #7206: a claude agent whose account home is a vendor account (~/.kosmos-deepseek-<label>, engine/anthropiccompat.js)
 * is launched against that vendor. This EXECUTES the shipped bin/agent-supervisor.sh with a recorder fake tmux (the
 * shape supervisor.qwen-endpoint-5977 uses) and asserts the launch line: the vendor's address and model, the key only
 * as a launch secret, no inherited ANTHROPIC_* value reaching the pane, a broken account stopping the launch, and a
 * Claude home untouched.
 *
 *   node --test supervisor.anthropiccompat-7206.test.js
 */
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { spawnSync } = require('node:child_process');

const SUP = nodePath.join(__dirname, 'bin', 'agent-supervisor.sh');
const TMUX_REAL = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } }) || null;
const compat = require('./engine/anthropiccompat');
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-sup-compat-7206-'));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const FAKE_TMUX = nodePath.join(SANDBOX, 'rec-tmux.sh');
fs.writeFileSync(FAKE_TMUX, [
  '#!/bin/bash',
  'case "$1" in',
  '  new-session)',
  '    before=""',
  '    for arg in "$@"; do',
  '      if [ "$before" = --pane-entry ]; then cp "$arg" "$REC.secrets"; break; fi',
  '      before="$arg"',
  '    done',
  '    printf "%s\\n" "$*" >> "$REC"; exit 0 ;;',
  '  has-session) exit 1 ;;',
  '  *) exit 0 ;;',
  'esac',
].join('\n') + '\n', { mode: 0o755 });

const KEY = 'sk-deepseek-secret-0123456789';
let n = 0;
function home(files, prefix) {
  const dir = nodePath.join(SANDBOX, `${prefix || '.kosmos-deepseek-h'}${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(nodePath.join(dir, name), body, { mode: 0o600 });
  return dir;
}
function run(configDir, model, extraEnv) {
  const rec = nodePath.join(SANDBOX, `rec-${++n}.txt`);
  const env = { PATH: process.env.PATH, HOME: SANDBOX, REC: rec, AGENT_WORKFORCE_HOME: SANDBOX, CLAUDE_CONFIG_DIR: configDir, ...(extraEnv || {}) };
  const r = spawnSync('/bin/bash', [SUP, `agent-d${n}`, SANDBOX, '/usr/bin/true', FAKE_TMUX, '', model || '', 'claude'],
    { env, encoding: 'utf8', timeout: 30000 });
  const argv = fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : '';
  const secrets = fs.existsSync(`${rec}.secrets`) ? fs.readFileSync(`${rec}.secrets`, 'utf8') : '';
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), argv, secrets };
}
const ACCT = { vendor: 'deepseek', model: 'deepseek-chat', key: KEY };

test('a DeepSeek home launches claude against DeepSeek, with its model in place of the agent\'s Claude model', () => {
  const r = run(home({ 'kosmos-endpoint.json': JSON.stringify(ACCT) }), 'claude-sonnet-5');
  assert.match(r.argv, /new-session/, r.out);
  assert.match(r.argv, /-e ANTHROPIC_BASE_URL=https:\/\/api\.deepseek\.com\/anthropic/);
  assert.match(r.argv, /-e ANTHROPIC_MODEL=deepseek-chat/);
  assert.match(r.argv, /--model deepseek-chat/);
  assert.equal(/claude-sonnet-5/.test(r.argv), false, 'the agent\'s Claude model is not sent to DeepSeek');
  assert.match(r.argv, /\/usr\/bin\/env( -u [A-Z_]+)+ \/usr\/bin\/true/, 'claude does not run behind the env -u prefix');
});

test('the key reaches the pane only as a launch secret, never in the argv or the supervisor output', () => {
  const r = run(home({ 'kosmos-endpoint.json': JSON.stringify(ACCT) }));
  assert.match(r.secrets, new RegExp('^ANTHROPIC_AUTH_TOKEN=' + KEY + '$', 'm'));
  assert.equal(r.argv.includes(KEY), false, 'the key is in the tmux argv');
  assert.equal(r.out.includes(KEY), false, 'the key is in the supervisor output');
});

/* What this can and cannot show: the fake tmux has no global environment, which is the real way an inherited value
   reaches a pane. So it pins the two mechanisms that defeat one there instead: every variable the account sets is a
   -e pair (a -e pair beats tmux's global value), and every other launch variable is removed with env -u. */
test('every launch variable is either a -e pair from the account or removed with env -u; a value in the supervisor\'s own env reaches nothing', () => {
  const r = run(home({ 'kosmos-endpoint.json': JSON.stringify(ACCT) }), '', {
    ANTHROPIC_BASE_URL: 'https://elsewhere.example', ANTHROPIC_API_KEY: 'sk-ant-inherited', ANTHROPIC_MODEL: 'claude-opus-5',
  });
  assert.match(r.argv, /new-session/, r.out);
  assert.equal(/elsewhere\.example|sk-ant-inherited|claude-opus-5/.test(r.argv + r.secrets), false, 'an inherited value reached the pane');
  const set = compat.launchEnv(home({ 'kosmos-endpoint.json': JSON.stringify(ACCT) })).env;
  for (const [k, val] of Object.entries(set)) {
    if (k === 'ANTHROPIC_AUTH_TOKEN') continue;   // the key: a launch secret, asserted above
    assert.ok(r.argv.includes(`-e ${k}=${val}`), `${k} is not set as a -e pair, so tmux's global value would win`);
  }
  for (const v of compat.LAUNCH_VARS.filter((x) => !(x in set))) assert.ok(r.argv.includes(`-u ${v}`), `${v} is not removed`);
});

test('an account that cannot be used stops the launch, saying why, and never starts claude against Anthropic', () => {
  for (const bad of [JSON.stringify({ ...ACCT, key: '' }), JSON.stringify({ ...ACCT, model: 'claude-sonnet-5' }), '{not json']) {
    const r = run(home({ 'kosmos-endpoint.json': bad }));
    assert.notEqual(r.code, 0);
    assert.equal(/new-session/.test(r.argv), false, 'something was launched: ' + r.argv);
    assert.match(r.out, /DeepSeek account cannot be used: .*the agent was not started/);
  }
  const missing = nodePath.join(SANDBOX, '.kosmos-deepseek-missing');
  fs.mkdirSync(missing, { recursive: true });
  const r = run(missing);
  assert.notEqual(r.code, 0);
  assert.equal(/new-session/.test(r.argv), false);
  assert.match(r.out, /it has no key set up; the agent was not started/);
});

test('review 2: when the key cannot be handed over privately, the launch is refused, never run without it', () => {
  const data = nodePath.join(SANDBOX, `data-blocked-${++n}`);
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(nodePath.join(data, 'launch-secrets'), 'a file where the secrets folder would go');
  const r = run(home({ 'kosmos-endpoint.json': JSON.stringify(ACCT) }), '', { AGENT_WORKFORCE_DATA: data });
  assert.notEqual(r.code, 0);
  assert.equal(/new-session/.test(r.argv), false, 'the agent was launched without its key: ' + r.argv);
  assert.match(r.out, /provider key could not be handed to the agent privately; the agent was not started/);
});

/* Review 4: the REAL leak path, end to end. A private tmux server (its own socket, killed after) carries stray values in
   its GLOBAL environment, the way a pane inherits them in life; the supervisor launches through it, and a stand-in
   "claude" writes out exactly the environment and arguments it was started with. */
test('real tmux: a value in tmux\'s global environment never reaches a DeepSeek pane; the vendor\'s settings and key do', { skip: !TMUX_REAL && 'no tmux on this computer' }, async () => {
  const sock = `kosmos-7206-${process.pid}-${++n}`;
  const wrap = nodePath.join(SANDBOX, `tmux-${sock}.sh`);
  fs.writeFileSync(wrap, `#!/bin/bash\nexec ${TMUX_REAL} -L ${sock} -f /dev/null "$@"\n`, { mode: 0o755 });
  const out = nodePath.join(SANDBOX, `seen-${sock}.txt`);
  const fake = nodePath.join(SANDBOX, `fake-claude-${sock}.sh`);
  fs.writeFileSync(fake, `#!/bin/bash\n{ printf 'ARGS %s\\n' "$*"; env; } > "${out}.part" && mv "${out}.part" "${out}"\nsleep 2\n`, { mode: 0o755 });
  const tm = (...a) => spawnSync(wrap, a, { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: SANDBOX } });   // no TMUX_TMPDIR: /tmp
  try {
    tm('new-session', '-d', '-s', 'keepalive', 'sleep 60');
    for (const [k, v] of [['ANTHROPIC_API_KEY', 'sk-ant-global-leak'], ['ANTHROPIC_BASE_URL', 'https://global.example'],
      ['ANTHROPIC_MODEL', 'claude-opus-5'], ['CLAUDE_CODE_USE_BEDROCK', '1'], ['ANTHROPIC_AUTH_TOKEN', 'tok-global-leak']]) {
      tm('set-environment', '-g', k, v);
    }
    const dir = home({ 'kosmos-endpoint.json': JSON.stringify(ACCT) });
    const env = { PATH: process.env.PATH, HOME: SANDBOX, AGENT_WORKFORCE_HOME: SANDBOX, CLAUDE_CONFIG_DIR: dir };
    const r = spawnSync('/bin/bash', [SUP, `agent-t${n}`, SANDBOX, fake, wrap, '', 'claude-sonnet-5', 'claude'], { env, encoding: 'utf8', timeout: 30000 });
    for (let i = 0; i < 100 && !fs.existsSync(out); i += 1) await new Promise((res) => setTimeout(res, 100));
    assert.ok(fs.existsSync(out), 'the pane never ran: ' + (r.stdout || '') + (r.stderr || ''));
    const seen = fs.readFileSync(out, 'utf8');
    const has = (k) => new RegExp('^' + k + '=', 'm').test(seen);
    const val = (k) => ((seen.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]);
    assert.equal(val('ANTHROPIC_BASE_URL'), 'https://api.deepseek.com/anthropic');
    assert.equal(val('ANTHROPIC_AUTH_TOKEN'), KEY, 'the account\'s key did not reach the pane (or the global one won)');
    assert.equal(val('ANTHROPIC_MODEL'), 'deepseek-chat');
    assert.equal(has('ANTHROPIC_API_KEY'), false, 'tmux\'s global ANTHROPIC_API_KEY reached the pane');
    assert.equal(has('CLAUDE_CODE_USE_BEDROCK'), false, 'tmux\'s global Bedrock switch reached the pane');
    assert.equal(/sk-ant-global-leak|global\.example|tok-global-leak|claude-opus-5|claude-sonnet-5/.test(seen), false, 'a global or Claude value reached the pane');
    assert.match(seen, /^ARGS .*--model deepseek-chat/m);
  } finally {
    tm('kill-server');
    // kill-server leaves its socket file; remove this test's own (its unique name), never anything else there.
    // tm() passes no TMUX_TMPDIR, so the server's socket is always under /tmp (review 5).
    try { fs.rmSync(nodePath.join('/tmp', `tmux-${process.getuid()}`, sock), { force: true }); } catch { /* best effort */ }
  }
});

test('CONTROL: a Claude home launches exactly as before: its own model, no vendor address, no env prefix', () => {
  const r = run(home({ '.claude.json': '{}' }, '.claude-h'), 'claude-sonnet-5');
  assert.match(r.argv, /new-session/, r.out);
  assert.match(r.argv, /--model claude-sonnet-5/);
  assert.equal(/ANTHROPIC_|\/usr\/bin\/env -u/.test(r.argv), false, 'a Claude home got vendor settings');
  assert.equal(/ANTHROPIC_/.test(r.secrets), false);
});

test('the supervisor\'s lists match the module: every vendor is recognised, every launch variable is set or removed', () => {
  const src = fs.readFileSync(SUP, 'utf8');
  const block = src.slice(src.indexOf('#7206: an account home named for a vendor'), src.indexOf('#2808 class-1 / #2129'));
  assert.ok(block.length > 200, 'the #7206 block moved; re-anchor this test');
  for (const id of Object.keys(compat.VENDORS)) {
    assert.ok(block.includes(`.kosmos-${id}-?*)`), `vendor ${id} has no case in the supervisor`);
  }
  // Every launch variable is either set by the account (a -e pair beats tmux's global value) or removed outright with
  // env -u: the removed ones are exactly the launch variables the account does not set.
  const set = Object.keys(compat.launchEnv(home({ 'kosmos-endpoint.json': JSON.stringify(ACCT) })).env);
  const unset = compat.LAUNCH_VARS.filter((v) => !set.includes(v));
  const declared = (block.match(/_cx_unset=\(([^)]*)\)/) || [])[1];
  assert.deepEqual(String(declared).trim().split(/\s+/).sort(), unset.slice().sort());
});

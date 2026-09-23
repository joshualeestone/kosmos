'use strict';
/**
 * #3296/#3391 accounts slice: bin/agent-supervisor.sh injects the PER-ACCOUNT key
 * into a gemini/grok pane. This EXECUTES the shipped script with a recorder fake tmux
 * (a `new-session` that writes its argv to a file; a `has-session` that returns
 * non-zero so both wait loops and the final supervise loop exit at once), and asserts
 * the pane env: GEMINI_API_KEY / XAI_API_KEY is passed from the account key file when
 * present, and is NOT injected (falls back to the machine-global door) when absent.
 *
 *   node --test supervisor.provider-key-inject-3296.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { spawnSync } = require('node:child_process');

const SUP = nodePath.join(__dirname, 'bin', 'agent-supervisor.sh');
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-sup-keyinject-3296-'));
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

// A recorder tmux: `new-session` appends its argv to $REC; `has-session` exits 1 (so
// the wait/supervise loops never spin); everything else is a quiet no-op success.
const FAKE_TMUX = nodePath.join(SANDBOX, 'rec-tmux.sh');
fs.writeFileSync(FAKE_TMUX, [
  '#!/bin/bash',
  'case "$1" in',
  '  new-session) printf "%s\\n" "$*" >> "$REC"; exit 0 ;;',
  '  has-session) exit 1 ;;',
  '  *) exit 0 ;;',
  'esac',
].join('\n') + '\n', { mode: 0o755 });

// Run the supervisor once for a runner with a given account home; return what tmux
// new-session was invoked with. CLAUDE(arg3) is /usr/bin/true -- the arm launches
// "$CLAUDE ..." through fake tmux, which records rather than runs it.
function runSupervisor({ runner, model, envHome, envVar }) {
  const rec = nodePath.join(SANDBOX, `rec-${runner}-${Math.random().toString(36).slice(2)}.txt`);
  const env = {
    PATH: process.env.PATH,
    HOME: SANDBOX,
    REC: rec,
    AGENT_WORKFORCE_HOME: SANDBOX,
  };
  if (envHome) env[envVar] = envHome;
  const r = spawnSync('/bin/bash', [
    SUP,
    `agent-${runner}`,        // session
    SANDBOX,                  // workdir
    '/usr/bin/true',          // runner bin ("$CLAUDE")
    FAKE_TMUX,                // tmux bin
    '',                       // log
    model,                    // model
    runner,                   // runner
  ], { env, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, rec: fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : '' };
}

test('gemini: a per-account key file is injected as GEMINI_API_KEY into the pane', () => {
  const home = nodePath.join(SANDBOX, '.gemini-acct');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(nodePath.join(home, '.kosmos-gemini-apikey'), 'AIza-account-secret-1234', { mode: 0o600 });
  const out = runSupervisor({ runner: 'gemini', model: 'gemini-2.5-flash', envHome: home, envVar: 'GEMINI_CLI_HOME' });
  assert.ok(out.rec.includes('new-session'), 'the gemini arm reached tmux new-session');
  assert.match(out.rec, /-e GEMINI_API_KEY=AIza-account-secret-1234/, 'the account key is injected as GEMINI_API_KEY');
});

test('gemini: NO key file -> no per-account GEMINI_API_KEY injection (falls back to the global door)', () => {
  const home = nodePath.join(SANDBOX, '.gemini-nokey');
  fs.mkdirSync(home, { recursive: true }); // account home exists, but no key file
  const out = runSupervisor({ runner: 'gemini', model: 'gemini-2.5-flash', envHome: home, envVar: 'GEMINI_CLI_HOME' });
  assert.ok(out.rec.includes('new-session'), 'the gemini arm still launched');
  assert.ok(!/-e GEMINI_API_KEY=/.test(out.rec), 'no per-account key injected when the file is absent');
});

test('grok: a per-account key file is injected as XAI_API_KEY into the pane', () => {
  const home = nodePath.join(SANDBOX, '.grok-acct');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(nodePath.join(home, '.kosmos-grok-apikey'), 'xai-account-secret-5678', { mode: 0o600 });
  const out = runSupervisor({ runner: 'grok', model: 'grok-4.6', envHome: home, envVar: 'GROK_HOME' });
  assert.ok(out.rec.includes('new-session'), 'the grok arm reached tmux new-session');
  assert.match(out.rec, /-e XAI_API_KEY=xai-account-secret-5678/, 'the account key is injected as XAI_API_KEY');
});

test('grok: NO key file -> no per-account XAI_API_KEY injection', () => {
  const home = nodePath.join(SANDBOX, '.grok-nokey');
  fs.mkdirSync(home, { recursive: true });
  const out = runSupervisor({ runner: 'grok', model: 'grok-4.6', envHome: home, envVar: 'GROK_HOME' });
  assert.ok(out.rec.includes('new-session'), 'the grok arm still launched');
  assert.ok(!/-e XAI_API_KEY=/.test(out.rec), 'no per-account key injected when the file is absent');
});

test('a default-account gemini agent (no GEMINI_CLI_HOME) injects no per-account key', () => {
  const out = runSupervisor({ runner: 'gemini', model: 'gemini-2.5-flash', envHome: null, envVar: 'GEMINI_CLI_HOME' });
  assert.ok(out.rec.includes('new-session'), 'the default gemini arm launched');
  assert.ok(!/-e GEMINI_API_KEY=/.test(out.rec), 'a default-account agent injects no per-account key (uses the global door)');
});

/* When BOTH the machine-global secrets/env door AND a per-account key file are present,
   the PER-ACCOUNT value must win in the pane. That is load-bearing for correctness (a
   per-account agent must never silently run on the machine-global key), and it rests on
   two facts: (1) the supervisor appends the per-account `-e` AFTER the door loop, and
   (2) tmux applies the LAST `-e` for a repeated var as the winner. This runs the SHIPPED
   script (via a symlink, so the exact bytes execute) from a temp tree whose
   `$(dirname $0)/../secrets/env` holds a global-door value, and asserts the LAST -e for
   the var is the per-account one. A future edit that moved the injection before the door
   would flip the last-writer and this test would go red. */
function runSupervisorWithDoor({ runner, model, doorVar, doorValue, keyBasename }) {
  const tree = fs.mkdtempSync(nodePath.join(os.tmpdir(), `aw-sup-door-${runner}-`));
  fs.mkdirSync(nodePath.join(tree, 'bin'), { recursive: true });
  fs.mkdirSync(nodePath.join(tree, 'secrets', 'env'), { recursive: true });
  const acct = nodePath.join(tree, 'acct');
  fs.mkdirSync(acct, { recursive: true });
  fs.symlinkSync(SUP, nodePath.join(tree, 'bin', 'agent-supervisor.sh'));
  fs.writeFileSync(nodePath.join(tree, 'secrets', 'env', doorVar), doorValue);        // the global door
  fs.writeFileSync(nodePath.join(acct, keyBasename), 'peraccountvalue', { mode: 0o600 }); // the per-account key
  const rec = nodePath.join(tree, 'rec.txt');
  const fake = nodePath.join(tree, 'rec-tmux.sh');
  fs.writeFileSync(fake, [
    '#!/bin/bash', 'case "$1" in',
    '  new-session) printf "%s\\n" "$*" >> "$REC"; exit 0 ;;',
    '  has-session) exit 1 ;;', '  *) exit 0 ;;', 'esac',
  ].join('\n') + '\n', { mode: 0o755 });
  const envVar = runner === 'gemini' ? 'GEMINI_CLI_HOME' : 'GROK_HOME';
  const env = { PATH: process.env.PATH, HOME: tree, REC: rec, AGENT_WORKFORCE_HOME: tree };
  env[envVar] = acct;
  spawnSync('/bin/bash', [nodePath.join(tree, 'bin', 'agent-supervisor.sh'), `agent-${runner}`, tree, '/usr/bin/true', fake, '', model, runner], { env, encoding: 'utf8', timeout: 20000 });
  const out = fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : '';
  fs.rmSync(tree, { recursive: true, force: true });
  return out;
}

test('gemini: with BOTH a global-door key and a per-account key, the PER-ACCOUNT value wins in the pane', () => {
  const rec = runSupervisorWithDoor({ runner: 'gemini', model: 'gemini-2.5-flash', doorVar: 'GEMINI_API_KEY', doorValue: 'globaldoorvalue', keyBasename: '.kosmos-gemini-apikey' });
  const all = [...rec.matchAll(/GEMINI_API_KEY=(\S+)/g)].map((m) => m[1]);
  assert.ok(all.includes('globaldoorvalue') && all.includes('peraccountvalue'), 'both the door value and the per-account value are passed');
  assert.equal(all[all.length - 1], 'peraccountvalue', 'the per-account key is the LAST -e, so tmux resolves it as the winner');
});

test('grok: with BOTH a global-door key and a per-account key, the PER-ACCOUNT value wins', () => {
  const rec = runSupervisorWithDoor({ runner: 'grok', model: 'grok-4.6', doorVar: 'XAI_API_KEY', doorValue: 'globaldoorvalue', keyBasename: '.kosmos-grok-apikey' });
  const all = [...rec.matchAll(/XAI_API_KEY=(\S+)/g)].map((m) => m[1]);
  assert.ok(all.includes('globaldoorvalue') && all.includes('peraccountvalue'), 'both values are passed');
  assert.equal(all[all.length - 1], 'peraccountvalue', 'the per-account key wins as the last -e');
});

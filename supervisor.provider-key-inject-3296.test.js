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
  // The key must NEVER be logged/echoed -- it reaches the pane only via the -e env (recorded
  // in `rec`), never the supervisor's own stdout/stderr (which launchd captures to the log).
  assert.ok(!out.stdout.includes('AIza-account-secret-1234') && !out.stderr.includes('AIza-account-secret-1234'), 'the key never appears in the supervisor stdout/stderr');
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
  assert.ok(!out.stdout.includes('xai-account-secret-5678') && !out.stderr.includes('xai-account-secret-5678'), 'the key never appears in the supervisor stdout/stderr');
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

/* The two "per-account wins" tests above run against a RECORDER fake tmux and rest on one
   property of REAL tmux: a repeated `-e VAR=` resolves to the LAST value. That property is
   what makes appending the per-account key after the global-door loop the winner, so verify
   it against the real tmux binary once -- the codebase's "measured, not assumed" practice for
   tmux-env claims (bin/agent-supervisor.sh cites "measured on 3.6a" for its own). Skips
   cleanly if no real tmux is installed (CI/no-tmux hosts), since the fake-tmux tests above
   already pin the ordering our code controls; this pins only tmux's own resolution. */
test('real tmux resolves a repeated -e to the LAST value (the precedence the per-account override rests on)', () => {
  const candidates = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'];
  let realTmux = candidates.find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  if (!realTmux) {
    try { realTmux = require('node:child_process').execSync('command -v tmux', { encoding: 'utf8' }).trim() || null; }
    catch { realTmux = null; }
  }
  if (!realTmux) { console.log('# no real tmux found -- skipping the real-tmux precedence check'); return; }
  const label = `aw-prec-${process.pid}-${Math.random().toString(36).slice(2)}`;
  const run = (args) => spawnSync(realTmux, ['-L', label, ...args], { encoding: 'utf8', timeout: 10000 });
  try {
    run(['new-session', '-d', '-s', 's', '-e', 'AWTESTVAR=firstvalue', '-e', 'AWTESTVAR=lastvalue', 'sleep 5']);
    const shown = (run(['show-environment', '-t', 's', 'AWTESTVAR']).stdout || '').trim();
    assert.equal(shown, 'AWTESTVAR=lastvalue', 'real tmux must resolve a repeated -e to the LAST value, or the per-account key override is unsound');
  } finally {
    run(['kill-server']);
  }
});

/* #3391 subscription half: a per-account Grok account signed in with a SUBSCRIPTION
   (auth.json, no key file) must reach grok with NO XAI_API_KEY at all, or grok runs on the
   key instead of the sign-in. An EMPTY value still counts as set to grok (measured), so the
   supervisor drops every door pair and runs grok through `env -u XAI_API_KEY`. */
function runGrokWithAccount({ door, keyFile, authJson, authRaw, keyIsDir, defaultHome, noEngine, withStderr, oldGrok }) {
  const tree = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-sup-grok-sub-'));
  fs.mkdirSync(nodePath.join(tree, 'bin'), { recursive: true });
  fs.mkdirSync(nodePath.join(tree, 'secrets', 'env'), { recursive: true });
  // defaultHome: no GROK_HOME, the account is <HOME>/.grok (the default account).
  const acct = defaultHome ? nodePath.join(tree, '.grok') : nodePath.join(tree, 'acct');
  fs.mkdirSync(acct, { recursive: true });
  fs.symlinkSync(SUP, nodePath.join(tree, 'bin', 'agent-supervisor.sh'));
  // The supervisor asks engine/grokaccounts.identityOf what kind of account this is, so the
  // tree carries the real engine (a symlink). The token mint that an engine also enables is
  // kept in the sandbox by AGENT_WORKFORCE_DATA below, never the real store.
  if (!noEngine) fs.symlinkSync(nodePath.join(__dirname, 'engine'), nodePath.join(tree, 'engine'));
  if (door) fs.writeFileSync(nodePath.join(tree, 'secrets', 'env', 'XAI_API_KEY'), door);
  if (keyFile !== undefined) fs.writeFileSync(nodePath.join(acct, '.kosmos-grok-apikey'), keyFile, { mode: 0o600 });
  if (authJson) fs.writeFileSync(nodePath.join(acct, 'auth.json'), JSON.stringify({ 'https://auth.x.ai::abc': { email: 'x@example.com', refresh_token: 'r' } }), { mode: 0o600 });
  if (authRaw !== undefined) fs.writeFileSync(nodePath.join(acct, 'auth.json'), authRaw, { mode: 0o600 });
  if (keyIsDir) fs.mkdirSync(nodePath.join(acct, '.kosmos-grok-apikey'));
  const rec = nodePath.join(tree, 'rec.txt');
  const fake = nodePath.join(tree, 'rec-tmux.sh');
  fs.writeFileSync(fake, [
    '#!/bin/bash', 'case "$1" in',
    '  new-session) printf "%s\\n" "$*" >> "$REC"; exit 0 ;;',
    '  has-session) exit 1 ;;', '  *) exit 0 ;;', 'esac',
  ].join('\n') + '\n', { mode: 0o755 });
  fs.mkdirSync(nodePath.join(tree, 'data'), { recursive: true });
  const env = { PATH: process.env.PATH, HOME: tree, REC: rec, AGENT_WORKFORCE_HOME: tree, AGENT_WORKFORCE_DATA: nodePath.join(tree, 'data') };
  if (!defaultHome) env.GROK_HOME = acct;
  /* A fake grok whose --help lists --leader-socket (grok 1.0.41, measured) or, for oldGrok, does not.
     tmux is fake, so this runner is only ever asked for --help; it is never launched. */
  const runner = nodePath.join(tree, 'fake-grok.sh');
  fs.writeFileSync(runner, '#!/bin/bash\n[ "$1" = --help ] && echo "' + (oldGrok ? '--model <M>' : '--leader-socket <PATH>') + '"\nexit 0\n', { mode: 0o755 });
  const r = spawnSync('/bin/bash', [nodePath.join(tree, 'bin', 'agent-supervisor.sh'), 'agent-grok', tree, runner, fake, '', 'grok-4.6', 'grok'], { env, encoding: 'utf8', timeout: 20000 });
  const out = fs.existsSync(rec) ? fs.readFileSync(rec, 'utf8') : '';
  fs.rmSync(tree, { recursive: true, force: true });
  return withStderr ? { rec: out, stderr: r.stderr || '' } : out;
}

test('grok SUBSCRIPTION account: the door XAI_API_KEY is dropped and grok runs under env -u XAI_API_KEY', () => {
  const rec = runGrokWithAccount({ door: 'globaldoorvalue', authJson: true });
  assert.ok(rec.includes('new-session'), 'the grok arm launched');
  assert.ok(!/XAI_API_KEY=/.test(rec), 'no XAI_API_KEY value of any kind reaches the pane');
  assert.match(rec, /GROK_CLAUDE_HOOKS_ENABLED=0 \/usr\/bin\/env -u XAI_API_KEY \S*fake-grok\.sh /, 'grok is launched through /usr/bin/env -u XAI_API_KEY');
  // The pair structure survived the filter: every -e is still followed by a NAME=value.
  const argv = rec.trim().split(/\s+/);
  argv.forEach((a, i) => { if (a === '-e') assert.match(argv[i + 1] || '', /^[A-Z_][A-Z0-9_]*=/, 'every -e still carries a NAME=value after the filter'); });
});

test('grok CONTROL: a key-file account with an auth.json too keeps its key and gets no env -u', () => {
  const rec = runGrokWithAccount({ door: 'globaldoorvalue', keyFile: 'peraccountvalue', authJson: true });
  const all = [...rec.matchAll(/XAI_API_KEY=(\S+)/g)].map((m) => m[1]);
  assert.equal(all[all.length - 1], 'peraccountvalue', 'the key file wins, as identityOf decides');
  assert.ok(!/env -u XAI_API_KEY/.test(rec), 'a key-file account is not stripped');
});

test('grok: an EMPTY key file with an auth.json is a subscription account (the same rule identityOf uses)', () => {
  const rec = runGrokWithAccount({ door: 'globaldoorvalue', keyFile: '', authJson: true });
  assert.ok(!/XAI_API_KEY=/.test(rec), 'an empty key file does not make it an api-key account');
  assert.match(rec, /env -u XAI_API_KEY/, 'it runs under env -u like any subscription account');
});

test('grok DEFAULT account (~/.grok) with a sign-in: the door key is dropped too, so it runs on the subscription the board lists', () => {
  const rec = runGrokWithAccount({ door: 'globaldoorvalue', authJson: true, defaultHome: true });
  assert.ok(rec.includes('new-session'), 'the default grok arm launched');
  assert.ok(!/XAI_API_KEY=/.test(rec), 'no XAI_API_KEY reaches a default agent whose ~/.grok holds a sign-in');
  assert.match(rec, /\/usr\/bin\/env -u XAI_API_KEY/);
});

test('grok DEFAULT CONTROL: a default ~/.grok with NO sign-in keeps the door key', () => {
  const rec = runGrokWithAccount({ door: 'globaldoorvalue', defaultHome: true });
  assert.match(rec, /-e XAI_API_KEY=globaldoorvalue/, 'the door key still reaches a default agent with no sign-in');
  assert.ok(!/env -u XAI_API_KEY/.test(rec));
});

/* The supervisor decides "subscription" by the SAME rules as grokaccounts.identityOf, or a
   dir the board does not list as a subscription would still lose its key (iteration-4 review). */
const kept = (rec) => /-e XAI_API_KEY=globaldoorvalue/.test(rec) && !/env -u XAI_API_KEY/.test(rec);
const stripped = (rec) => !/XAI_API_KEY=/.test(rec) && /env -u XAI_API_KEY/.test(rec);

test('grok: an auth.json that is not ONE auth.x.ai entry is not a subscription, so the door key stays', () => {
  assert.ok(kept(runGrokWithAccount({ door: 'globaldoorvalue', authRaw: '{}' })), 'an empty {} keeps the key');
  assert.ok(kept(runGrokWithAccount({ door: 'globaldoorvalue', authRaw: JSON.stringify({ 'https://auth.x.ai::a': {}, 'https://auth.x.ai::b': {} }) })), 'two entries keep the key');
  assert.ok(kept(runGrokWithAccount({ door: 'globaldoorvalue', authRaw: JSON.stringify({ 'https://other.example::a': {} }) })), 'another issuer keeps the key');
  assert.ok(kept(runGrokWithAccount({ door: 'globaldoorvalue', authRaw: '{"https://auth.x.ai::a":{"email":' })), 'ONE entry in a file that does not parse keeps the key (readAuth would not describe it)');
  // CONTROL: exactly one entry, a sign-in that is positively good (a refresh token), strips through the same fixture path.
  assert.ok(stripped(runGrokWithAccount({ door: 'globaldoorvalue', authRaw: JSON.stringify({ 'https://auth.x.ai::a': { email: 'e', refresh_token: 'r' } }) })));
});

test('grok: a WHITESPACE-only key file beside a sign-in is a subscription (identityOf trims it to empty)', () => {
  assert.ok(stripped(runGrokWithAccount({ door: 'globaldoorvalue', keyFile: '  \n', authJson: true })));
});

test('grok: an UNREADABLE key file beside a sign-in describes nothing, so nothing is stripped', () => {
  assert.ok(kept(runGrokWithAccount({ door: 'globaldoorvalue', keyIsDir: true, authJson: true })));
});

test('grok: a PER-ACCOUNT subscription agent gets its own short leader socket; a key account and the default do not', () => {
  const sub = runGrokWithAccount({ door: 'globaldoorvalue', authJson: true });
  const m = sub.match(/--leader-socket (\S+)/);
  assert.ok(m, 'a per-account subscription agent is launched with its own --leader-socket');
  assert.match(m[1], /\/\.grok\/leader-[0-9a-f]{12}\.sock$/, 'named leader-<hash>.sock so `grok leader list` finds it');
  /* The length the CODE controls is the fixed suffix after $HOME (30 bytes), whatever the
     account's name: $HOME is /Users/<name> on a real Mac, and a fixture's mkdtemp HOME is
     longer, so an absolute bound would measure the fixture, not the code. */
  assert.equal(Buffer.byteLength(m[1].slice(m[1].lastIndexOf('/.grok/'))), '/.grok/leader-'.length + 12 + '.sock'.length);
  const keyAcct = runGrokWithAccount({ door: 'globaldoorvalue', keyFile: 'peraccountvalue', authJson: true }).match(/--leader-socket (\S+)/);
  assert.ok(keyAcct, 'a per-account KEY agent is isolated too (the premise cuts both ways)');
  assert.notEqual(keyAcct[1], m[1], 'a different account in the same kind of slot gets a different leader');
  assert.ok(!/--leader-socket/.test(runGrokWithAccount({ door: 'globaldoorvalue', authJson: true, defaultHome: true })), 'CONTROL: the default account IS the default leader');
});

test('grok: with NO engine to ask, a sign-in keeps the door key AND says so (never a silent keep)', () => {
  const r = runGrokWithAccount({ door: 'globaldoorvalue', authJson: true, noEngine: true, withStderr: true });
  assert.ok(kept(r.rec), 'the key is kept (the visible failure)');
  assert.match(r.stderr, /auth\.json is there but this supervisor cannot reach the engine or node/, 'and the supervisor log says why');
  // CONTROL: with the engine, the same fixture strips and says nothing.
  const c = runGrokWithAccount({ door: 'globaldoorvalue', authJson: true, withStderr: true });
  assert.ok(stripped(c.rec));
  assert.doesNotMatch(c.stderr, /cannot reach the engine/);
});

test('grok DEFAULT agent: the dir the supervisor judged is exported as GROK_HOME, so grok reads that dir', () => {
  const rec = runGrokWithAccount({ door: 'globaldoorvalue', authJson: true, defaultHome: true });
  assert.match(rec, /-e GROK_HOME=\S+\/\.grok(\s|$)/, 'the default home is exported into the pane');
  const per = runGrokWithAccount({ door: 'globaldoorvalue', authJson: true });
  const homes = [...per.matchAll(/-e GROK_HOME=(\S+)/g)].map((x) => x[1]);
  assert.equal(homes.length, 1, 'CONTROL: a per-account agent carries exactly ONE GROK_HOME (its own, forwarded as before), not a second default one');
  assert.match(homes[0], /\/acct$/, 'and it is the account dir');
});

test('grok: the supervisor classifies by identityOf itself, so odd shapes agree with the board', () => {
  // The issuer string repeated INSIDE the entry is still ONE top-level entry: a subscription.
  assert.ok(stripped(runGrokWithAccount({ door: 'globaldoorvalue', authRaw: JSON.stringify({ 'https://auth.x.ai::a': { email: 'e', refresh_token: 'r', note: '"https://auth.x.ai::b' } }) })));
  // One top-level entry whose value is not an object is not an account (identityOf null): kept.
  assert.ok(kept(runGrokWithAccount({ door: 'globaldoorvalue', authRaw: JSON.stringify({ 'https://auth.x.ai::a': null }) })));
  assert.ok(kept(runGrokWithAccount({ door: 'globaldoorvalue', authRaw: JSON.stringify([{ 'https://auth.x.ai::a': {} }]) })), 'a top-level array is not an account');
});

test('grok: a PROVABLY LAPSED sign-in keeps the door key (a working agent is not restarted into a dead sign-in) and says so', () => {
  const r = runGrokWithAccount({ door: 'globaldoorvalue', authRaw: JSON.stringify({ 'https://auth.x.ai::a': { email: 'e', expires_at: '2000-01-01T00:00:00.000000Z' } }), withStderr: true });
  assert.ok(kept(r.rec), 'the key is kept for a lapsed sign-in');
  assert.match(r.stderr, /the sign-in in \S+ has expired, so this agent keeps any XAI_API_KEY/);
  // CONTROL: the same shape with a refresh token (renewable) strips as a subscription.
  assert.ok(stripped(runGrokWithAccount({ door: 'globaldoorvalue', authRaw: JSON.stringify({ 'https://auth.x.ai::a': { email: 'e', refresh_token: 'r', expires_at: '2000-01-01T00:00:00.000000Z' } }) })));
});

test('grok: an OLDER grok whose --help has no --leader-socket gets no leader flag (it would exit rc 2 and crash-loop)', () => {
  const rec = runGrokWithAccount({ door: 'globaldoorvalue', authJson: true, oldGrok: true });
  assert.ok(rec.includes('new-session'), 'it still launches');
  assert.ok(!/--leader-socket/.test(rec), 'the flag is not passed to a grok that does not know it');
  assert.ok(/--leader-socket/.test(runGrokWithAccount({ door: 'globaldoorvalue', authJson: true })), 'CONTROL: a grok that knows the flag gets it');
});

test('grok: a sign-in we cannot vouch for (UNKNOWN: no refresh token, no readable expiry) keeps the door key and says so', () => {
  const r = runGrokWithAccount({ door: 'globaldoorvalue', authRaw: JSON.stringify({ 'https://auth.x.ai::a': { email: 'e' } }), withStderr: true });
  assert.ok(kept(r.rec), 'the key is kept when the sign-in is not positively good');
  assert.match(r.stderr, /could not tell whether the sign-in in \S+ is still good, so this agent keeps any XAI_API_KEY/);
});

'use strict';

/*
 * #3675: browser-check fixture boards must not read the host Mac's real accounts.
 * The account modules look under AGENT_WORKFORCE_HOME || os.homedir(); a fixture
 * that sandboxed everything but HOME showed real Claude emails and the end of a real
 * OpenAI key in Settings (measured on Agent1s: 5 Claude accounts, 1 OpenAI).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DIR = path.join(__dirname, 'docs', 'browser-checks');
/* The env a child starts from: the developer's, minus anything that would decide the answer
   before the lib does (an exported Claude config, or an ambient home read before the seam). */
const AMBIENT = ['AGENT_WORKFORCE_HOME', 'AGENT_WORKFORCE_CLAUDE_CONFIG', 'CODEX_HOME', 'AGENT_WORKFORCE_CODEX_HOME',
  'GEMINI_CLI_HOME', 'GROK_HOME', 'CLAUDE_CONFIG_DIR'];
function cleanEnv(over) {
  const env = { ...process.env };
  for (const v of AMBIENT) delete env[v];
  return { ...env, ...over };
}
const LIB = path.join(DIR, 'lib-sandbox-home.js');

/* A check boots a board if it requires server.js or spawns it. */
function bootsBoard(src) {
  // With or without .js: thread-server.js loads the board as require('../../server').
  if (/require\((['"])\.\.\/\.\.\/server(\.js)?\1\)|require\(path\.join\([^)]*server/.test(src)) return true;
  return /server\.js['"`]/.test(src) && /\b(spawn|fork|execFile)\b/.test(src);
}

test('#3675: every browser check that boots or spawns the board requires lib-sandbox-home at top level, before the board', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && !f.startsWith('lib-'));
  const booting = files.filter((f) => bootsBoard(fs.readFileSync(path.join(DIR, f), 'utf8')));
  assert.ok(booting.length >= 50, `found ${booting.length} board-booting checks; the scan is not seeing them`);
  const missing = [];
  for (const f of booting) {
    const lines = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n');
    // Bare, or with an opt-in call chained on (render-talk-fill-2622 plants its account).
    const at = lines.findIndex((l) => /^require\('\.\/lib-sandbox-home\.js'\)[;.]/.test(l));
    const firstBoard = lines.findIndex((l) => /\.\.\/\.\.\/server|server\.js/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l));
    if (at === -1 || (firstBoard !== -1 && at > firstBoard)) missing.push(f);
  }
  assert.deepEqual(missing, [], 'these checks can read the host Mac\'s real accounts');
});

/* Run a fixture-shaped child with HOME pointed at a planted "real" home holding one
   Claude account, and report how many accounts the board would list. */
function listedAccounts({ withLib, home }) {
  const code = `
    const fs = require('fs'), os = require('os'), path = require('path');
    const mk = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
    const S = mk('aw-3675-');
    Object.assign(process.env, { AGENT_WORKFORCE_DATA: S, AGENT_WORKFORCE_WORKERS: mk('aw-3675w-'),
      AGENT_WORKFORCE_PROJECTS: mk('aw-3675p-'), AGENT_WORKFORCE_LAUNCH: mk('aw-3675l-'),
      AGENT_WORKFORCE_CONFIG_ROOT: mk('aw-3675c-') });
    // No AGENT_WORKFORCE_CLAUDE_CONFIG: 20 wired checks never set it, so the subscription
    // check must be sealed by the lib too.
    ${withLib ? `require(${JSON.stringify(LIB)});` : ''}
    const n = require(${JSON.stringify(path.join(__dirname, 'engine', 'accounts.js'))}).list().length;
    const sub = require(${JSON.stringify(path.join(__dirname, 'engine', 'subscription.js'))}).check().state;
    for (const d of [S, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS,
      process.env.AGENT_WORKFORCE_LAUNCH, process.env.AGENT_WORKFORCE_CONFIG_ROOT]) fs.rmSync(d, { recursive: true, force: true });
    process.stdout.write(JSON.stringify({ n, sub }));`;
  const r = spawnSync(process.execPath, ['-e', code], { env: cleanEnv({ HOME: home }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('#3675: a fixture requiring lib-sandbox-home lists none of the real home\'s accounts (control: without it, it does)', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-3675-realhome-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  fs.mkdirSync(path.join(home, '.claude-planted'));
  fs.writeFileSync(path.join(home, '.claude-planted', '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: 'planted-3675@example.com' } }));
  // The subscription check reads <home>/.claude.json for the default account.
  fs.writeFileSync(path.join(home, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: 'planted-3675@example.com', organizationType: 'claude_max' } }));
  const without = listedAccounts({ withLib: false, home });
  assert.ok(without.n >= 1, 'CONTROL: without the lib the planted account is listed (the leak)');
  assert.equal(without.sub, 'connected', 'CONTROL: and the planted subscription is read');
  const withLib = listedAccounts({ withLib: true, home });
  assert.equal(withLib.n, 0, 'with the lib the real home\'s accounts are never listed');
  assert.notEqual(withLib.sub, 'connected', 'and the real home\'s subscription is never read');
});

test('#3675: the lib keeps a caller\'s sandbox, replaces the real home, and removes only the folder it made', () => {
  const run = (envHome) => {
    const env = cleanEnv(envHome === undefined ? {} : { AGENT_WORKFORCE_HOME: envHome });
    const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(LIB)}); process.stdout.write(process.env.AGENT_WORKFORCE_HOME);`], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const made = run(undefined);
  const tmps = [os.tmpdir(), fs.realpathSync(os.tmpdir())];
  assert.ok(made !== '' && made !== os.homedir() && tmps.some((d) => made.startsWith(d)), `unset: a temp folder, got ${made}`);
  assert.equal(fs.existsSync(made), false, 'the folder it made is removed when the process exits');
  assert.notEqual(run(os.homedir()), os.homedir(), 'set to the real home: replaced');
  const mine = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-3675-mine-'));
  assert.equal(run(mine), mine, 'set to a sandbox: kept');
  assert.equal(fs.existsSync(mine), true, 'and never removed');
  fs.rmSync(mine, { recursive: true, force: true });
});

test('#3675: tools/browser-checks.sh exports a sandbox home for every board and check it runs', () => {
  const sh = fs.readFileSync(path.join(__dirname, 'tools', 'browser-checks.sh'), 'utf8');
  // The guarded block: unset or the real home becomes RUN_DIR/home (an inverted test would not match).
  const at = sh.search(/^if \[ -z "\$\{AGENT_WORKFORCE_HOME:-\}" \] \|\| \[ "\$\{AGENT_WORKFORCE_HOME%\/\}" = "\$\{HOME%\/\}" \]; then\n\s+export AGENT_WORKFORCE_HOME="\$RUN_DIR\/home"$/m);
  assert.ok(at > 0, 'the runner exports a sandbox home when none, or the real one, is set');
  const unset = sh.search(/^unset CODEX_HOME AGENT_WORKFORCE_CODEX_HOME GEMINI_CLI_HOME GROK_HOME CLAUDE_CONFIG_DIR$/m);
  assert.ok(unset > 0, 'and removes the ambient homes read before the seam');
  const firstBoard = sh.indexOf('node ./server.js');
  assert.ok(at < firstBoard && unset < firstBoard, 'both before it boots its first board');
});

test('#3675: plantSubscribedClaude gives the check its OWN home, never the shared one it was given', (t) => {
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-3675-shared-'));
  t.after(() => fs.rmSync(shared, { recursive: true, force: true }));
  const code = `const lib = require(${JSON.stringify(LIB)}); const own = lib.plantSubscribedClaude();
    const sub = require(${JSON.stringify(path.join(__dirname, 'engine', 'subscription.js'))});
    const acc = require(${JSON.stringify(path.join(__dirname, 'engine', 'accounts.js'))});
    process.stdout.write(JSON.stringify({ own, home: process.env.AGENT_WORKFORCE_HOME, machine: sub.checkMachine(acc.list()).state }));`;
  const r = spawnSync(process.execPath, ['-e', code], { env: cleanEnv({ AGENT_WORKFORCE_HOME: shared }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  assert.notEqual(got.home, shared, 'it moved to its own home');
  assert.equal(got.machine, 'connected', 'where the fixture subscription reads connected');
  assert.deepEqual(fs.readdirSync(shared), [], 'and wrote nothing into the shared one');
  assert.equal(fs.existsSync(got.own), false, 'its own home is removed on exit');
});

test('#3675: the lib removes the ambient homes read before the seam, and names no codex home', () => {
  const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(LIB)}); process.stdout.write(JSON.stringify(['CODEX_HOME','AGENT_WORKFORCE_CODEX_HOME','GEMINI_CLI_HOME','GROK_HOME','CLAUDE_CONFIG_DIR'].map((v) => process.env[v] === undefined)));`],
    { env: { ...process.env, CODEX_HOME: '/x', AGENT_WORKFORCE_CODEX_HOME: '/x', GEMINI_CLI_HOME: '/x', GROK_HOME: '/x', CLAUDE_CONFIG_DIR: '/x' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [true, true, true, true, true]);
});

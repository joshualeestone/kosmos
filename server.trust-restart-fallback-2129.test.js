/**
 * THE #2129 ONE-CLICK FALLBACK ROUTE, DRIVEN OVER HTTP.
 * POST /api/agent/:name/trust-and-restart.
 *
 * 🛑 WHY THIS FILE EXISTS. The keystone fix (#2382) auto-trusts a fresh agent's
 * folder by keying the write on the on-disk realpath the runner looks up. This
 * route is the insurance for the case that fix cannot reach -- a silent write
 * failure, or a runner that changes its trust format -- where the agent still
 * lands on the terminal trust menu a white-collar user cannot answer. So the
 * two properties worth pinning by CONTENT (a source regex sees neither) are:
 *   1. the trust key it writes is the NATIVE realpath -- the same call the
 *      runner uses -- so the escape and the create-time write can never
 *      disagree about spelling (the exact #2382 divergence); and
 *   2. the trust write is BEST-EFFORT and NON-GATING: a failed write still
 *      restarts, because the restart is the half that unbricks the agent. A
 *      route that withheld the restart on a trust-write refusal would leave the
 *      agent exactly as stuck as before while reporting a failure.
 *
 * 🛑 WHY ITS OWN FILE, NOT server.test.js: that suite states it NEVER sets
 * AGENT_WORKFORCE_HOME, and arms reason from it. A default-account trust write
 * resolves defaultAgentConfig() = AGENT_WORKFORCE_HOME/.claude.json (and the
 * codex home likewise), so an unsealed run would write the OPERATOR'S REAL
 * ~/.claude.json / ~/.codex. This file seals its own roots -- all of them,
 * both providers -- so the default-account arm (the fresh-user catastrophe
 * itself) can be exercised without touching a real config.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

/* Seal BEFORE requiring anything: the trust/create modules resolve their homes
   per call, but the rule is seal-first rather than depend on which is lazy. */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-trust-restart-2129-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'),
  nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
/* 🛑 EVERY ROOT THAT COULD FALL BACK TO A REAL CONFIG, both providers. A
   default-account claude trust write targets defaultAgentConfig(), a default
   codex one targets defaultAgentCodexHome(); each reads AGENT_WORKFORCE_HOME
   but ALSO an explicit override, and an ambient override on a developer's box
   would walk straight through the HOME seal into a real file. Delete them. */
delete process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
delete process.env.CLAUDE_CONFIG_DIR;
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const CODEX_BIN = nodePath.join(BIN, 'codex');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, CODEX_BIN, TMUX_BIN]) {
  fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}
process.env.AGENT_WORKFORCE_CLAUDE_BIN = CLAUDE_BIN;
process.env.AGENT_WORKFORCE_CODEX_BIN = CODEX_BIN;

/* The shared fake tmux + pane file, so an agent reads as RUNNING from the real
   producer (fleet), not a hand-typed pane line. The restart only runs on an
   agent it can confirm is ours and live. */
const FAKE_TMUX = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
const PANES = nodePath.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_TMUX_BIN = FAKE_TMUX;
process.env.AGENT_WORKFORCE_FAKE_PANES = PANES;

const fleet = require('./test-support/fleet');
const create = require('./engine/create');
const trust = require('./engine/trust');
const store = require('./engine/store');
const { KEY } = require('./engine/trust');

/* Make an agent Kosmos would recognise: a folder, a launch job for the given
   runner/account, a profile, and a running pane. Returns the worker folder,
   which is what the trust write is keyed on. */
function born(name, { runner = 'claude', configDir = null } = {}) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  const bin = runner === 'codex' ? CODEX_BIN : CLAUDE_BIN;
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, bin, TMUX_BIN, null, configDir, runner), 'utf8');
  store.writeProfile(name, { provider: runner === 'codex' ? 'openai' : 'anthropic' });
  /* Running, or restart answers on a refusal branch and the arm proves nothing. */
  fs.writeFileSync(PANES, fleet.line({ session: name + '-discord', title: 'working' }) + '\n');
  const job = create.readJob(name);
  assert.ok(job && job.runner === runner,
    'the seeded agent is not readable as a ' + runner + ' job, so every assertion below would be right for the wrong reason: ' + JSON.stringify(job));
  /* ⚠️ RECOMPUTED AFTER writeProfile RECORDS THE DIR. workerDir() returns the raw
     WORKERS/name path until a profile is on disk, then returns the RECORDED
     (realpath-resolved) dir. The route resolves the folder AFTER born has run,
     so it sees the recorded spelling -- return that, or an arm compares the
     trust key against a path the route never used. */
  return create.workerDir(name);
}

/* 🔑 THE SEAM THAT MAKES DRIVING THE RESTART SAFE, and it is not DRY_RUN.
   run() consults `runner` before DRY_RUN, so this intercepts launchctl and tmux
   while the trust write (which does not shell out) runs for real.
   ⚠️ has-session must answer GONE after the kill, or remove.restart -- which
   re-checks and refuses to claim a restart over a live window -- lands every
   call on its partial branch. This answers the way a real tmux does once the
   session is closed. */
const fakeRun = (_file, args) => (Array.isArray(args) && args[0] === 'has-session'
  ? { ok: false, code: 1 }
  : { ok: true, stdout: '' });
create.setRunner(fakeRun);
/* remove.js keeps its OWN runner: the restart lives there, so intercepting only
   create leaves the window-close shelling out for real. */
require('./engine/remove').setRunner(fakeRun);

const { start, server } = require('./server');
let base = '';

test.before(async () => {
  await start(0);
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => {
  try { server.close(); } catch { /* the port is going away anyway */ }
  create.setRunner(null);
  require('./engine/remove').setRunner(null);
});

async function trustAndRestart(name) {
  const res = await fetch(base + '/api/agent/' + encodeURIComponent(name) + '/trust-and-restart', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  return { status: res.status, body: await res.json() };
}

test('a Claude default-account agent: the trust key is the NATIVE realpath, and it restarts', async () => {
  const name = 'tr-claude-default';
  const folder = born(name);
  const r = await trustAndRestart(name);

  assert.equal(r.status, 200, 'the route did not answer 200: ' + JSON.stringify(r.body));
  assert.equal(r.body.trusted && r.body.trusted.wrote, true, 'the trust write was not reported done: ' + JSON.stringify(r.body.trusted));
  assert.equal(r.body.trusted.runner, 'claude', JSON.stringify(r.body.trusted));
  assert.equal(r.body.outcome, 'restarted', 'the agent was not restarted: ' + JSON.stringify(r.body));

  /* The default-account write lands in AGENT_WORKFORCE_HOME/.claude.json. */
  const cfgPath = nodePath.join(HOME, '.claude.json');
  assert.ok(fs.existsSync(cfgPath), 'the default-account config was not created (createIfAbsent should have made it)');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

  /* 🔑 THE KEYSTONE PROPERTY. The runner looks its cwd up by the OS realpath
     (process.cwd()/canonicalize), which fs.realpathSync.native returns. If the
     route keyed on the raw folder path (or plain fs.realpathSync, which does
     NOT case-fold on macOS) this key would be absent and the menu would fire.
     The route MUST have written under the native spelling. */
  const nativeKey = fs.realpathSync.native(folder);
  assert.ok(cfg.projects && cfg.projects[nativeKey],
    'no trust entry under the native realpath key -- the runner would not find it: keys=' + JSON.stringify(Object.keys(cfg.projects || {})) + ' wanted=' + nativeKey);
  assert.equal(cfg.projects[nativeKey][KEY], true,
    'the folder was not marked trusted under the native key: ' + JSON.stringify(cfg.projects[nativeKey]));
});

test('a codex agent: a trusted [projects."…"] block is written, and it restarts', async () => {
  const name = 'tr-codex-default';
  const folder = born(name, { runner: 'codex' });
  const r = await trustAndRestart(name);

  assert.equal(r.status, 200, 'the route did not answer 200: ' + JSON.stringify(r.body));
  assert.equal(r.body.trusted && r.body.trusted.wrote, true, JSON.stringify(r.body.trusted));
  assert.equal(r.body.trusted.runner, 'codex', JSON.stringify(r.body.trusted));
  assert.equal(r.body.outcome, 'restarted', JSON.stringify(r.body));

  const tomlPath = nodePath.join(HOME, '.codex', 'config.toml');
  assert.ok(fs.existsSync(tomlPath), 'the codex config.toml was not written');
  const toml = fs.readFileSync(tomlPath, 'utf8');
  /* codex looks the folder up under its own on-disk canonical spelling
     (std::fs::canonicalize), which fs.realpathSync.native mirrors. Assert the
     block trusts the folder AS THE RUNNER SEES IT -- idempotent, so it holds
     whichever spelling create.workerDir happened to return. `folder` is kept
     as the arm's control that the agent was actually seeded. */
  assert.ok(folder, 'the codex agent was not seeded');
  const codexKey = fs.realpathSync.native(create.workerDir(name));
  assert.ok(toml.includes(`[projects."${codexKey}"]`),
    'no trusted project block for the agent folder as the runner canonicalizes it (' + codexKey + '): ' + toml);
  assert.match(toml, /trust_level = "trusted"/, 'the block does not mark the folder trusted: ' + toml);
});

test('BEST-EFFORT / NON-GATING: a failed trust write still restarts the agent', async () => {
  /* Force a soft trust-write REFUSAL without touching any real file: a
     non-default claude account whose .claude.json is a SYMLINK. trustFolder
     refuses a symlinked config (it will not replace somebody's arrangement) and
     returns {ok:false, because:'…symlink…'} rather than throwing. The route
     must then STILL restart -- withholding it would leave the agent as stuck as
     before while reporting a failure, the exact defect this route removes. */
  const name = 'tr-claude-symlink';
  const acct = nodePath.join(SANDBOX, 'acct-symlink');
  fs.mkdirSync(acct, { recursive: true });
  fs.symlinkSync(nodePath.join(SANDBOX, 'elsewhere.json'), nodePath.join(acct, '.claude.json'));
  born(name, { configDir: acct });

  const r = await trustAndRestart(name);

  assert.equal(r.status, 200, 'a soft trust-write failure was allowed to gate the restart: ' + JSON.stringify(r.body));
  assert.equal(r.body.trusted && r.body.trusted.wrote, false,
    'control: the trust write should have SOFT-FAILED here, so this arm is not testing what it claims: ' + JSON.stringify(r.body.trusted));
  assert.match(String(r.body.trusted.because || ''), /symlink/,
    'the reason is not the symlink refusal, so the write may have failed for an unrelated reason: ' + JSON.stringify(r.body.trusted));
  assert.equal(r.body.outcome, 'restarted',
    'THE CONTRACT: the restart must run even when the trust write did not: ' + JSON.stringify(r.body));
});

test('an unknown agent: the route ANSWERS (no crash), skips the trust write, and surfaces the restart refusal', async () => {
  const r = await trustAndRestart('no-such-agent-here');
  /* No job -> nothing to key a trust write on -> skipped, not fatal. The
     restart gives its own friendly refusal, and the route carries both. */
  assert.equal(r.status, 400, 'a missing agent should be a friendly 400, not a 200 or a 500: ' + JSON.stringify(r.body));
  assert.equal(r.body.trusted && r.body.trusted.wrote, false, JSON.stringify(r.body.trusted));
  assert.equal(r.body.outcome, 'refused', JSON.stringify(r.body));
  assert.match(String(r.body.because || ''), /not started by Kosmos/,
    'the refusal does not explain why in the words the plain restart route uses: ' + JSON.stringify(r.body));
});

'use strict';

/**
 * #3296 / #3391: installJob (the backfill / adopt / repair / import path) now writes a
 * Gemini or Grok launch job on the MAC (launchd) path instead of refusing at the root,
 * so a gemini/grok agent whose plist went missing can be repaired/adopted/imported. The
 * runner is read from the agent's own profile (recordedRunner), so it is never silently
 * re-installed as a claude job -- the mis-launch the old root refusal guarded against.
 *
 * WIN32 still refuses: engine/win32launch.js has no gemini/grok substrate and it LAUNCHES
 * rather than just registering, so the refusal is preserved there (the Windows backfill is
 * carded). The Mac-success behavior itself is pinned in engine/create.test.js; this file
 * pins the win32 refusal and the caller (register.repair) wiring.
 *
 *   node --test engine/create.installjob-gemini-grok-3296.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'installjob-gx-3296-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'), nodePath.join(SANDBOX, 'launch')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
delete process.env.AGENT_WORKFORCE_GEMINI_HOME;
delete process.env.AGENT_WORKFORCE_GROK_HOME;

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const GEMINI_BIN = nodePath.join(BIN, 'gemini');
const GROK_BIN = nodePath.join(BIN, 'grok');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
const AGY_BIN = nodePath.join(BIN, 'agy'); // #3568: the override must keep the basename agy
for (const b of [CLAUDE_BIN, GEMINI_BIN, GROK_BIN, TMUX_BIN, AGY_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const BINS = { claudeBin: CLAUDE_BIN, tmuxBin: TMUX_BIN, geminiBin: GEMINI_BIN, grokBin: GROK_BIN };
/* register.repair does NOT forward bin paths to installJob (it passes only model/platform/
   runner), so installJob resolves them via runners.resolveBin, which honours these env
   overrides. Set them so the repair path finds the sandbox runners rather than a canonical
   path that does not exist here. Direct installJob calls below still pass BINS explicitly. */
process.env.AGENT_WORKFORCE_CLAUDE_BIN = CLAUDE_BIN;
process.env.AGENT_WORKFORCE_GEMINI_BIN = GEMINI_BIN;
process.env.AGENT_WORKFORCE_GROK_BIN = GROK_BIN;
process.env.AGENT_WORKFORCE_TMUX_BIN = TMUX_BIN;

const create = require('./create');
const store = require('./store');
const register = require('./register');

/* A stubbed launchctl so installJob's bootstrap does not shell out to the real one on
   the developer's Mac. `run` is consulted before launchctl, so the account/plist writes
   still execute for real. */
const okRun = () => ({ ok: true, stdout: '' });

/* Seed an agent that exists on disk (folder + profile provider) but has NO launch job --
   exactly the missing-job state backfill/repair exists for. No plist, so recordedRunner
   falls to profile.provider. */
function bornMissingJob(name, provider) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  store.writeProfile(name, { provider });
  const brief = create.briefFilename(create.providerRunner(provider));
  fs.writeFileSync(nodePath.join(create.workerDir(name), brief), '# brief\n', 'utf8');
  return name;
}

test.beforeEach(() => { create.setRunner(okRun); create.setDryRun(false); });
test.afterEach(() => { create.setDryRun(true); create.setRunner(null); });

test('#3296: installJob still REFUSES a gemini agent on win32 (no win32launch substrate), writing no job', () => {
  const name = bornMissingJob('ij-win-gemini', 'google');
  // Force jobPresence to report a registered-check of "no" on win32 so MY gemini/grok
  // guard is what fires, not the earlier "could not check" (unknown) guard.
  const win32job = require('./win32job');
  const realPresence = win32job.presence;
  win32job.presence = () => ({ known: true, registered: false });
  let r;
  try { r = create.installJob(name, { ...BINS, platform: 'win32' }); }
  finally { win32job.presence = realPresence; }
  assert.equal(r.ok, false, 'win32 must refuse a gemini backfill (no substrate)');
  assert.match(String(r.because), /Windows/, 'the win32 refusal must name Windows: ' + r.because);
  assert.match(String(r.because), /Gemini/, 'the win32 refusal must name the runner: ' + r.because);
});

test('#3391: installJob still REFUSES a grok agent on win32', () => {
  const name = bornMissingJob('ij-win-grok', 'xai');
  const win32job = require('./win32job');
  const realPresence = win32job.presence;
  win32job.presence = () => ({ known: true, registered: false });
  let r;
  try { r = create.installJob(name, { ...BINS, platform: 'win32' }); }
  finally { win32job.presence = realPresence; }
  assert.equal(r.ok, false, 'win32 must refuse a grok backfill');
  assert.match(String(r.because), /Windows/, r.because);
  assert.match(String(r.because), /Grok/, r.because);
});

/* #3568 round 10: a backfill tells the person it will run on their main Claude account only
   when it is a Claude agent. A Gemini agent with no account runs on its own default, not Claude's. */
test('#3568: a Gemini backfill does not say it will run on the main Claude account', () => {
  const name = bornMissingJob('ij-gem-acct', 'google');
  const r = create.installJob(name, { ...BINS, platform: process.platform });
  assert.equal(r.ok, true, String(r.because));
  assert.equal(r.guessed.account, null, 'a Gemini agent was told it runs on a Claude account');
});
test('#3296: installJob refuses a gemini backfill when the Gemini runner is not installed, naming it', () => {
  const name = bornMissingJob('ij-no-gemini-runner', 'google');
  const r = create.installJob(name, { ...BINS, geminiBin: nodePath.join(BIN, 'gemini-not-here') });
  assert.equal(r.ok, false, 'a missing Gemini runner must refuse');
  assert.match(String(r.because), /Gemini runner/, r.because);
  assert.equal(create.readJob(name), null, 'no job should have been written for the missing-runner refusal');
});

test('#3296: the never-overwrite guard still fires for a gemini agent that already has a job', () => {
  const name = bornMissingJob('ij-gemini-hasjob', 'google');
  // Give it a job first (a successful backfill), then a second install must refuse.
  const first = create.installJob(name, { ...BINS });
  assert.equal(first.ok, true, 'first backfill should succeed: ' + first.because);
  const second = create.installJob(name, { ...BINS });
  assert.equal(second.ok, false, 'a second install must not overwrite an existing job');
  assert.equal(second.already, true, 'the refusal must be the never-overwrite guard');
});

test('#3296/#3391: isNonClaudeRunner is the ONE recognized-runner-set predicate, total over the runner set', () => {
  // The set {codex, gemini, grok} shared by plistFor, installJob and worldstarts, so a
  // fifth runner reaches all three at once (Repo Convention #5). Pinned here.
  assert.equal(create.isNonClaudeRunner('codex'), true);
  assert.equal(create.isNonClaudeRunner('gemini'), true);
  assert.equal(create.isNonClaudeRunner('grok'), true);
  assert.equal(create.isNonClaudeRunner('claude'), false, 'claude is the default runner, not a non-claude one');
  assert.equal(create.isNonClaudeRunner('anthropic'), false, 'anthropic is a provider, not a runner');
  assert.equal(create.isNonClaudeRunner(undefined), false);
  assert.equal(create.isNonClaudeRunner(''), false);
});

test('#3296/#3391: register.repair backfills a google agent as GEMINI and an xai agent as GROK', () => {
  bornMissingJob('rep-gemini', 'google');
  bornMissingJob('rep-grok', 'xai');
  bornMissingJob('rep-claude', 'anthropic'); // control: a claude agent still repairs as claude
  const out = register.repair({ ...BINS, platform: process.platform });
  assert.equal(out.ok, true, 'repair failed: ' + out.because);
  // The repaired jobs name the RIGHT runner, read from each agent's profile.
  assert.equal(create.readJob('rep-gemini').runner, 'gemini', 'repair backfilled the google agent as the wrong runner');
  assert.equal(create.readJob('rep-grok').runner, 'grok', 'repair backfilled the xai agent as the wrong runner');
  assert.equal(create.readJob('rep-claude').runner, 'claude', 'control: the claude agent should repair as claude');
});

/* #3568: the Antigravity runner in the backfill/repair path, with its flag on (off is tested below). */
function withAgyOn(fn) {
  const was = process.env.AGENT_WORKFORCE_ANTIGRAVITY;
  process.env.AGENT_WORKFORCE_ANTIGRAVITY = '1';
  try { return fn(); } finally {
    if (was === undefined) delete process.env.AGENT_WORKFORCE_ANTIGRAVITY; else process.env.AGENT_WORKFORCE_ANTIGRAVITY = was;
  }
}
test('#3568: with the flag off, installJob refuses an Antigravity agent and writes no job', () => {
  const was = process.env.AGENT_WORKFORCE_ANTIGRAVITY;
  delete process.env.AGENT_WORKFORCE_ANTIGRAVITY;
  try {
    const name = bornMissingJob('ij-agy-off', 'antigravity');
    const r = create.installJob(name, { ...BINS, antigravityBin: AGY_BIN, platform: process.platform });
    assert.equal(r.ok, false, 'the flag is off, so nothing may start an Antigravity agent');
    assert.match(String(r.because), /switched off/);
    assert.equal(create.readJob(name), null, 'a refused backfill must write no job');
  } finally {
    if (was === undefined) delete process.env.AGENT_WORKFORCE_ANTIGRAVITY; else process.env.AGENT_WORKFORCE_ANTIGRAVITY = was;
  }
});
test('#3568: installJob refuses an Antigravity agent on win32 and refuses an account dir for one', () => withAgyOn(() => {
  const name = bornMissingJob('ij-agy', 'antigravity');
  const win32job = require('./win32job');
  const realPresence = win32job.presence;
  win32job.presence = () => ({ known: true, registered: false });
  let r;
  try { r = create.installJob(name, { ...BINS, antigravityBin: AGY_BIN, platform: 'win32' }); }
  finally { win32job.presence = realPresence; }
  assert.equal(r.ok, false);
  assert.match(String(r.because), /Windows/);
  assert.match(String(r.because), /Antigravity/);
  assert.doesNotMatch(String(r.because), /created fresh/, 'create refuses Antigravity on Windows too, so do not offer it');
  const acct = create.installJob(name, { ...BINS, antigravityBin: AGY_BIN, configDir: nodePath.join(SANDBOX, '.claude-other') });
  assert.equal(acct.ok, false, 'an account dir would be written into the agy job as CLAUDE_CONFIG_DIR');
  assert.match(String(acct.because), /Antigravity/);
  assert.equal(create.readJob(name), null, 'a refused backfill must write no job');
  // A backfill that goes through does not tell the person it will run on their Claude account.
  const ok = create.installJob(name, { ...BINS, antigravityBin: AGY_BIN, platform: process.platform });
  assert.equal(ok.ok, true, String(ok.because));
  assert.equal(ok.guessed.account, null, 'an Antigravity agent has no Claude account to guess');
}));
test('#3568: register.repair backfills an Antigravity agent on the antigravity runner, not as Claude', () => withAgyOn(() => {
  bornMissingJob('rep-agy', 'antigravity');
  const was = process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN;
  process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = AGY_BIN;
  try {
    const out = register.repair({ ...BINS, platform: process.platform });
    assert.equal(out.ok, true, 'repair failed: ' + out.because);
    assert.equal((create.readJob('rep-agy') || {}).runner, 'antigravity', 'repair reinstalled an Antigravity agent as another runner');
  } finally {
    if (was === undefined) delete process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN; else process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = was;
  }
}));

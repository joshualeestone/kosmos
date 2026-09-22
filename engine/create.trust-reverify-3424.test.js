'use strict';

/*
 * #3424 RE-VERIFY HARNESS for the #2129/#3383/#3406/#3417 trust fix.
 *
 * THE ACCEPTANCE BAR (Splinter + Josh, 2026-09-22). The fix is NOT "done" on one
 * hopeful clean create. It must pass:
 *   (1) SEVERAL fresh agents created back-to-back, each seeded with the trust +
 *       bypass + onboarding pre-accepts landed in the config location THAT agent
 *       READS - not the default ~/.claude.json, and never in a sibling agent's dir.
 *   (2) A reboot with agents auto-starting, still clean (the relaunch path
 *       re-seeds each agent in the same read-location).
 *
 * WHAT THIS FILE COVERS, AND THE ONE THING IT DOES NOT. This is the INTEGRATION
 * layer the existing tests leave open:
 *   - create.trust-configdir-1629.test.js is UNIT-level: it MOCKS trustFolder and
 *     asserts the ARGUMENTS (a configDir is passed, createIfAbsent is true). It
 *     never writes a real file or reads it back.
 *   - ensure-launch-trust.test.js writes real files but for ONE default-account agent.
 * Neither exercises the acceptance bar's two new dimensions: N agents back-to-back
 * with per-agent config-dir isolation (the "write file A, read file B" class -
 * Alexandra's #3417 diagnosis), and the relaunch/reboot re-seed. This file drives
 * the REAL seeding code (ensureLaunchTrust, which its own docblock says "mirrors
 * engine/create.js's exact create-time calls") and asserts on the REAL files.
 *
 * WHAT IT DELIBERATELY LEAVES TO A HUMAN STEP (named per the decide-and-document
 * ruling): the true reboot BEHAVIOURAL check - a real launchd auto-start bringing a
 * LIVE Claude Code up with no visible prompt - cannot run in CI (no reboot, no real
 * account, and observing "no prompt" would mean scraping a pane, the exact thing
 * Kosmos is moving away from). That check is the documented runbook at the bottom of
 * this file. What CI CAN prove, and what actually caught #2129, is that the seed
 * lands in the file the agent reads; the no-prompt behaviour follows from that by the
 * established mechanism (#3389 seed + #3406 HOME reinject). So this harness pins the
 * ROOT CAUSE (write-A-read-B) for N agents and both paths (create-mirror + relaunch),
 * and the behavioural end-to-end stays Josh's live test + the runbook.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandbox EVERY root trust.js can write to, BEFORE requiring it - the exact
// a-test-of-the-real-env-branch hazard (a broken fix here would otherwise write the
// operator's real ~/.claude.json). Three seams cover the default-account paths, and
// per-account writes go to the configDir we pass, which is inside the sandbox too.
const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'trust-reverify-3424-')));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'default-claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_SETTINGS = path.join(SANDBOX, 'default-settings.json');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
// A stray CLAUDE_CONFIG_DIR in the operator's env would make CONFIG(null) honour it
// (trust.js:106); the default-account path uses defaultAgentConfig() which prefers our
// seam, but delete it so nothing in this process can drift onto the engine's account.
delete process.env.CLAUDE_CONFIG_DIR;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { ensureLaunchTrust } = require('./ensure-launch-trust');
// Reuse trust.js's OWN key names + canonicaliser rather than re-deriving them here:
// a second derivation is the two-derivations-of-one-fact defect, and would silently
// pass while asserting the wrong key or the wrong on-disk case.
const { KEY, BYPASS_KEY, ONBOARDING_KEY, canonicalOnDisk } = require('./trust');

const DEFAULT_CONFIG = process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
const DEFAULT_SETTINGS = process.env.AGENT_WORKFORCE_CLAUDE_SETTINGS;

// The on-disk realpath key trust.js writes under projects{}, normalised to forward
// slashes exactly as trust.js does (a no-op on macOS, load-bearing on win32/#2281).
const trustKeyFor = (workdir) => canonicalOnDisk(workdir).split(path.sep).join('/');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const trustEntry = (configFile, workdir) => {
  if (!fs.existsSync(configFile)) return undefined;
  const data = readJson(configFile);
  return data.projects && data.projects[trustKeyFor(workdir)];
};
const isTrusted = (configFile, workdir) => {
  const e = trustEntry(configFile, workdir);
  return !!(e && e[KEY] === true);
};

// One fresh agent's on-disk identity: a launch CWD (the trust key) and its own
// per-account config dir (.claude-workK, what CLAUDE_CONFIG_DIR points at).
let seq = 0;
function freshAgent() {
  const k = ++seq;
  const workdir = path.join(SANDBOX, 'workers', `w${k}`);
  const configDir = path.join(SANDBOX, `.claude-work${k}`);
  fs.mkdirSync(workdir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  return { k, workdir, configDir, configFile: path.join(configDir, '.claude.json'), settingsFile: path.join(configDir, 'settings.json') };
}

// N is the "SEVERAL agents back-to-back" count from the acceptance bar. 5 is chosen as
// comfortably more than the 1-2 a create-then-restart smoke exercises - enough to surface an
// ordering / lost-update / cross-contamination bug that N=2 could mask - while staying fast.
// The assertions are per-agent, so the exact value is not load-bearing above ~3.
const N = 5;

test('#3424 bar (1): N per-account agents created back-to-back are EACH seeded in the dir they read, with no leak and no cross-contamination', () => {
  const agents = [];
  for (let i = 0; i < N; i++) {
    const a = freshAgent();
    // The real relaunch/create seeding path (mirrors create.js's create-time calls).
    ensureLaunchTrust(a.workdir, a.configDir);
    agents.push(a);
  }

  for (const a of agents) {
    // Trust landed in THIS agent's own config file (the read location), keyed on its workdir.
    assert.ok(isTrusted(a.configFile, a.workdir),
      `agent ${a.k}: folder-trust must be in its OWN ${a.configFile} for its own workdir`);
    // Bypass landed in THIS agent's own settings.json; onboarding is a TOP-LEVEL
    // key in THIS agent's own .claude.json (the same file as trust, a DIFFERENT file
    // than bypass - trust.js:128-150; writing it to settings.json is a silent no-op).
    assert.equal(readJson(a.settingsFile)[BYPASS_KEY], true,
      `agent ${a.k}: bypass pre-accept must be in its own settings.json`);
    assert.equal(readJson(a.configFile)[ONBOARDING_KEY], true,
      `agent ${a.k}: onboarding pre-accept must be top-level in its own .claude.json`);

    // NO LEAK to the default account: the write-A-read-B bug wrote a per-account
    // agent's trust into the default ~/.claude.json. Assert the default config carries
    // NONE of these agents' trust (it should not exist at all on the per-account path).
    assert.ok(!isTrusted(DEFAULT_CONFIG, a.workdir),
      `agent ${a.k}: its trust must NOT leak into the default account config (${DEFAULT_CONFIG})`);

    // NO CROSS-CONTAMINATION: agent a's trust key is absent from every OTHER agent's dir.
    for (const other of agents) {
      if (other.k === a.k) continue;
      assert.ok(!isTrusted(other.configFile, a.workdir),
        `agent ${a.k}'s trust must not appear in agent ${other.k}'s config`);
    }
  }
});

test('#3424 bar (2): a reboot proxy - re-running the relaunch seed for every agent is idempotent and still correctly located', () => {
  const agents = [];
  for (let i = 0; i < N; i++) {
    const a = freshAgent();
    ensureLaunchTrust(a.workdir, a.configDir);
    agents.push(a);
  }
  // Snapshot each agent's config+settings after the first (create) seed.
  const before = agents.map((a) => ({
    cfg: fs.readFileSync(a.configFile, 'utf8'),
    set: fs.readFileSync(a.settingsFile, 'utf8'),
  }));

  // The reboot: the supervisor re-runs ensure-launch-trust.js on every (re)launch.
  for (const a of agents) ensureLaunchTrust(a.workdir, a.configDir);

  agents.forEach((a, i) => {
    // Still true, still in the same per-account read location.
    assert.ok(isTrusted(a.configFile, a.workdir), `agent ${a.k}: trust still set after reboot re-seed`);
    assert.equal(readJson(a.settingsFile)[BYPASS_KEY], true, `agent ${a.k}: bypass still set after reboot re-seed`);
    assert.equal(readJson(a.configFile)[ONBOARDING_KEY], true, `agent ${a.k}: onboarding still set (top-level in .claude.json) after reboot re-seed`);
    // Idempotent at the FILE level: the re-seed leaves each file byte-identical. This asserts
    // the OUTCOME we depend on (a relaunch cannot corrupt, churn, or reshuffle a seeded file),
    // not the internal no-write - an identical rewrite would also pass, and that is fine, byte
    // stability is the guarantee. (trust.js does short-circuit on already:true, but this test
    // pins the observable, not the implementation detail.)
    assert.equal(fs.readFileSync(a.configFile, 'utf8'), before[i].cfg, `agent ${a.k}: config byte-identical after the idempotent re-seed`);
    assert.equal(fs.readFileSync(a.settingsFile, 'utf8'), before[i].set, `agent ${a.k}: settings byte-identical after the idempotent re-seed`);
    // Still no leak to default after the reboot.
    assert.ok(!isTrusted(DEFAULT_CONFIG, a.workdir), `agent ${a.k}: still no leak to the default config after reboot`);
  });
});

test('#3424 default-account path: a no-CLAUDE_CONFIG_DIR agent is seeded in the DEFAULT file it reads (the #2129/#3406 read location), not a per-account dir', () => {
  const workdir = path.join(SANDBOX, 'workers', 'default-acct');
  fs.mkdirSync(workdir, { recursive: true });
  // Empty configDir = the default account. trust.js routes this to defaultAgentConfig()
  // / defaultAgentSettings() (our sandbox seams), which stand in for ~/.claude.json and
  // ~/.claude/settings.json - the files a default-account agent reads once #3406 reinjects HOME.
  ensureLaunchTrust(workdir, '');

  assert.ok(isTrusted(DEFAULT_CONFIG, workdir),
    'default-account agent: trust must land in the default config (the ~/.claude.json equivalent it reads)');
  assert.equal(readJson(DEFAULT_SETTINGS)[BYPASS_KEY], true,
    'default-account agent: bypass in the default settings.json');
  assert.equal(readJson(DEFAULT_CONFIG)[ONBOARDING_KEY], true,
    'default-account agent: onboarding top-level in the default .claude.json (the ~/.claude.json equivalent)');
});

test('#3424 bar (1), default-account variant: SEVERAL default-account agents seeded back-to-back all survive in the ONE shared config, no dropped entry', () => {
  // Multiple default-account agents (no CLAUDE_CONFIG_DIR) all write the SAME ~/.claude.json /
  // ~/.claude/settings.json. Unlike the per-account case there is no isolation to check - they
  // SHARE the file - so the failure mode is a DROPPED ENTRY: a later agent's read-modify-write
  // clobbers an earlier agent's trust instead of merging it (trustFolderInner does
  // data.projects[key] = Object.assign(...); a merge/replace bug there drops the others).
  // SCOPE: this is SEQUENTIAL back-to-back, matching the acceptance bar - NOT concurrent. It
  // exercises the read-modify-MERGE correctness, NOT the #3088 file lock, which serialises
  // genuinely simultaneous writers and cannot be reproduced by single-threaded synchronous
  // calls (that would need real concurrency - separate processes or overlapping async writes).
  // Assert the shared default config ends up carrying EVERY agent's trust entry, not just the last.
  const workdirs = [];
  for (let i = 0; i < N; i++) {
    const wd = path.join(SANDBOX, 'workers', `default-b2b-${i}`);
    fs.mkdirSync(wd, { recursive: true });
    ensureLaunchTrust(wd, ''); // default account: shares DEFAULT_CONFIG / DEFAULT_SETTINGS
    workdirs.push(wd);
  }
  for (const wd of workdirs) {
    assert.ok(isTrusted(DEFAULT_CONFIG, wd),
      `default-account back-to-back: ${wd}'s trust must survive in the shared default config (a lost update would have dropped it)`);
  }
  // The shared settings keys survive N sequential writers too.
  assert.equal(readJson(DEFAULT_SETTINGS)[BYPASS_KEY], true, 'shared default settings.json still carries bypass after N default agents');
  assert.equal(readJson(DEFAULT_CONFIG)[ONBOARDING_KEY], true, 'shared default .claude.json still carries onboarding after N default agents');
});

test('#3424 #2129 used-machine regression: a default-account agent IGNORES a poisoned CLAUDE_CONFIG_DIR (the used-env split that actually broke)', () => {
  // The #2129 bug was NOT file-absent-vs-present - a fresh Mac Mini worked. It was
  // clean-env-vs-used-env: on a USED machine the Kosmos board inherits a stray
  // CLAUDE_CONFIG_DIR, and CONFIG(null) HONOURS it (trust.js:108), so a default-account trust
  // landed in the ENGINE's config while the agent read ~/.claude.json - trust written, prompt
  // still fires. The fix routes default-account writes through defaultAgentConfig() /
  // defaultAgentSettings(), which IGNORE CLAUDE_CONFIG_DIR. To exercise that ignore we must
  // drop the AGENT_WORKFORCE_CLAUDE_CONFIG/SETTINGS overrides (so defaultAgent* falls to
  // AGENT_WORKFORCE_HOME, still fully sandboxed) and set a poison CLAUDE_CONFIG_DIR: a
  // regression to CONFIG(null) would then follow the poison, which this asserts against.
  const savedConfig = process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;
  const savedSettings = process.env.AGENT_WORKFORCE_CLAUDE_SETTINGS;
  const poison = path.join(SANDBOX, 'POISON-config-dir');
  const workdir = path.join(SANDBOX, 'workers', 'used-machine');
  fs.mkdirSync(poison, { recursive: true });
  fs.mkdirSync(workdir, { recursive: true });
  try {
    delete process.env.AGENT_WORKFORCE_CLAUDE_CONFIG;   // defaultAgentConfig -> AGENT_WORKFORCE_HOME/.claude.json
    delete process.env.AGENT_WORKFORCE_CLAUDE_SETTINGS; // defaultAgentSettings -> AGENT_WORKFORCE_HOME/.claude/settings.json
    process.env.CLAUDE_CONFIG_DIR = poison;             // the stray inherited var a used machine carries
    ensureLaunchTrust(workdir, '');                     // default account (empty configDir)

    const homeConfig = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude.json');
    const poisonConfig = path.join(poison, '.claude.json');
    assert.ok(isTrusted(homeConfig, workdir),
      'default-account trust must land in the HOME .claude.json (defaultAgentConfig ignores CLAUDE_CONFIG_DIR)');
    assert.equal(fs.existsSync(poisonConfig), false,
      'default-account trust must NOT follow the poisoned CLAUDE_CONFIG_DIR - a write there is the exact #2129 write-A-read-B bug');
  } finally {
    delete process.env.CLAUDE_CONFIG_DIR;
    if (savedConfig !== undefined) process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = savedConfig;
    if (savedSettings !== undefined) process.env.AGENT_WORKFORCE_CLAUDE_SETTINGS = savedSettings;
  }
});

test('#3424 CONTROL: an un-seeded agent reads as NOT trusted - proving the assertions above are non-vacuous (they would fire the #2129 wedge)', () => {
  const a = freshAgent();
  // Deliberately do NOT call ensureLaunchTrust. This runs last, so DEFAULT_CONFIG is populated
  // by the default-account tests above - which means isTrusted() actually FIRES here against a
  // real, non-empty config and must return false, rather than short-circuiting on a missing
  // file. That is the non-vacuity proof: the reader can return true, and for this workdir it does not.
  assert.equal(isTrusted(DEFAULT_CONFIG, a.workdir), false,
    'an un-seeded workdir must read NOT trusted in the populated default config - else every positive assertion above is vacuous');
  // And nothing wrote its per-account config file at all.
  assert.equal(fs.existsSync(a.configFile), false,
    'the un-seeded agent has no per-account .claude.json (the seed is the only writer)');
});

/*
 * ── REBOOT BEHAVIOURAL CHECK (manual runbook - CI cannot reboot) ──────────────
 * The automated tests above prove the SEED lands in the read-location for N agents
 * on both the create-mirror and relaunch paths. The one thing they cannot do is
 * observe a LIVE Claude Code coming up with no prompt after a real reboot. Run this
 * once when the #3417 fix merges, on a used machine (the env that broke #2129):
 *
 *   1. Create >=3 fresh agents back-to-back in the running app.
 *   2. Confirm each comes online (board state leaves "starting"), no trust/bypass/
 *      onboarding prompt in its pane.
 *   3. Reboot the Mac. Let launchd auto-start the fleet.
 *   4. Confirm every agent comes back online with no prompt, no manual Trust & Restart.
 *   5. For any agent that DOES prompt, capture: its CLAUDE_CONFIG_DIR, whether the
 *      trust key is in that dir's .claude.json vs ~/.claude.json (the write-A-read-B
 *      tell), and the pane's HOME (the #3406 tell). That triage maps directly onto
 *      the two candidate causes: the seed (mine, #3389) or the HOME reinject (#3406).
 */

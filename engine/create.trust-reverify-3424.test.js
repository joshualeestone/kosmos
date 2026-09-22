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
    // Idempotent: the re-seed rewrote nothing (a second write would churn the file / risk drift).
    assert.equal(fs.readFileSync(a.configFile, 'utf8'), before[i].cfg, `agent ${a.k}: config unchanged by the idempotent re-seed`);
    assert.equal(fs.readFileSync(a.settingsFile, 'utf8'), before[i].set, `agent ${a.k}: settings unchanged by the idempotent re-seed`);
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

test('#3424 CONTROL: an un-seeded agent has NO trust key anywhere - proving the assertions above are non-vacuous (they would fire the #2129 wedge)', () => {
  const a = freshAgent();
  // Deliberately do NOT call ensureLaunchTrust.
  assert.ok(!fs.existsSync(a.configFile) || !isTrusted(a.configFile, a.workdir),
    'an agent that never ran the seed must NOT read as trusted - else every assertion above passes vacuously');
  assert.ok(!isTrusted(DEFAULT_CONFIG, a.workdir),
    'and its (absent) trust must not appear in the default config either');
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

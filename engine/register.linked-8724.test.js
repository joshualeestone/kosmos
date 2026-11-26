'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#8724: register.repair({ only, linked: true }), the job half of "Set up and restart" for a window the person
 * linked to Kosmos by hand. The sandbox roots are engine/register.test.js's (its notes say why each is there); here
 * `create` runs for real against them, with its launchctl runner stubbed.
 *
 *   node --test engine/register.linked-8724.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { skipOnWin32 } = require('../test-support/skip-on-win32');   // kosmos#8378: the macOS-only arms
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-register-8724-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'launch');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(SB, 'bin', 'claude');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(SB, 'bin', 'tmux');
/* #1794: the codex runner too. The #1337/#1400 repair arms write a Codex agent's
   trust config, and repair only does so when a codex binary is present -- true on
   a dev machine (real codex), ABSENT on a clean CI runner, so the write never
   happens and "the trust write did not land in the sandbox". Seam it to a stub. */
process.env.AGENT_WORKFORCE_CODEX_BIN = path.join(SB, 'bin', 'codex');
/* 🛑 AND THE CODEX HOME, WHICH THIS FILE DID NOT SANDBOX AND WHICH IT CAN REACH.
   It calls `create.installJob` twice, and `installJob` runs `trustCodexFolder`
   and `dismissCodexUpdateNotice` against `codexHomeDir()` - which resolves to
   `AGENT_WORKFORCE_CODEX_HOME || AGENT_WORKFORCE_HOME/.codex || ~/.codex`.
   With none of the three set, that is the OPERATOR'S REAL `~/.codex`.

   ⚠️ MEASURED, NOT HYPOTHETICAL (#1359): a single-line change to `installJob`
   made those calls unconditional, and this file appended SEVEN
   `trust_level = "trusted"` entries to the live config while reporting 19/19
   PASS. The entries named this file's own temp sandbox, which no longer exists.
   They were removed by hand; a test should not need that.

   📌 It is safe TODAY only because `installJob` happens to gate that work on
   `runner === 'codex'` and nothing here passes one. That is a property of the
   code under test, not a guard on the test - exactly the wrong way round. */
process.env.AGENT_WORKFORCE_HOME = path.join(SB, 'home');
process.env.AGENT_WORKFORCE_CODEX_HOME = path.join(SB, 'home', '.codex');

const create = require('./create');
const store = require('./store');
const register = require('./register');

let CALLS = [];
create.setRunner((file, args) => { CALLS.push([file, ...args].join(' ')); return { ok: true, stdout: '' }; });
create.setDryRun(false);

/* 🛑 THE PLATFORM IS STATED, NOT INHERITED (#570) -- the same fix step 9 made to
   remove.test.js, for the same reason. Every fixture below IS a Mac: it writes a
   `.plist` and asserts about `launchctl` argv. `survey`/`repair` now ask the JOB
   rather than a file, and on Windows the job is a Scheduled Task -- so a suite
   that states nothing drives the win32 arm through Mac fixtures and goes red for
   reasons that have nothing to do with the code under test. The win32 arm is
   pinned from EITHER platform in jobexists.win32-570.test.js. */
const mac = {
  survey: () => register.survey({ platform: 'darwin' }),
  repair: (o) => register.repair({ platform: 'darwin', ...(o || {}) }),
};

/* #6714: `ran` (default true) records that the agent has reported in, as every real agent has: the survey counts
   only agents that have run here. */
function agent(name, { folder = true, job = false, profile = true, ran = true } = {}) {
  if (profile) store.writeProfile(name, { role: 'helper' });
  if (ran) require('./liveness').seen(name);
  if (folder) fs.mkdirSync(create.workerDir(name), { recursive: true });
  if (job) {
    fs.mkdirSync(path.dirname(create.plistPath(name)), { recursive: true });
    fs.writeFileSync(create.plistPath(name), '<plist/>', 'utf8');
  }
}
function reset() {
  CALLS = [];
  fs.rmSync(store.PROFILES, { recursive: true, force: true });
  fs.rmSync(path.join(SB, 'launch'), { recursive: true, force: true });
  fs.rmSync(path.join(SB, 'workers'), { recursive: true, force: true });
  fs.rmSync(path.join(store.ROOT, 'removed.json'), { force: true });
  // #6714: whether each agent ran, and which notices were hidden, are per test too.
  for (const d of ['liveness', 'selfreports']) fs.rmSync(path.join(store.ROOT, d), { recursive: true, force: true });
  fs.rmSync(path.join(store.ROOT, 'restart-notices-hidden.json'), { force: true });
  fs.mkdirSync(path.join(SB, 'bin'), { recursive: true });
  // kosmos#8378: stubs this platform counts as runnable (on Windows a .cmd beside each; test-support/runnerstub.js).
  for (const b of ['claude', 'tmux', 'codex']) require('../test-support/runnerstub').writeRunnerStub(path.join(SB, 'bin'), b);   // codex: #1794
}

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

test('#8724 linked: an agent that never ran and has no job gets its job; CONTROL: the plain one-agent repair refuses it', () => {
  reset();
  agent('zara', { ran: false });   // a hand-started window: no run record of Kosmos's own
  const plain = mac.repair({ only: 'zara' });
  assert.equal(plain.ok, false, 'the notice path offered an agent that never ran: ' + JSON.stringify(plain));
  assert.ok(!fs.existsSync(create.plistPath('zara')));
  const r = mac.repair({ only: 'zara', linked: true });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.results.map((x) => [x.name, x.ok]), [['zara', true]]);
  assert.ok(fs.existsSync(create.plistPath('zara')), 'no launch job was written');
});

test('#8724 linked: a hidden notice does not stop it', () => {
  reset();
  agent('zara');
  assert.deepEqual(register.hide('zara', { platform: 'darwin' }), { ok: true });
  assert.equal(mac.repair({ only: 'zara' }).ok, false, 'CONTROL: the notice path skips a hidden one');
  assert.equal(mac.repair({ only: 'zara', linked: true }).ok, true);
});

test('#8724 linked: still refused without a profile, without a folder, when removed, or when it has a job', () => {
  for (const [label, setup] of [
    ['no profile', () => agent('zara', { profile: false })],
    ['no folder', () => agent('zara', { folder: false })],
    ['has a job', () => agent('zara', { job: true })],
    ['removed', () => {
      agent('zara');
      fs.mkdirSync(store.ROOT, { recursive: true });
      fs.writeFileSync(path.join(store.ROOT, 'removed.json'), JSON.stringify([{ name: 'zara' }]), 'utf8');
    }],
  ]) {
    reset();
    setup();
    const before = label === 'has a job' ? fs.readFileSync(create.plistPath('zara'), 'utf8') : null;
    const r = mac.repair({ only: 'zara', linked: true });
    assert.equal(r.ok, false, label + ': ' + JSON.stringify(r));
    assert.equal(r.refused, true, label);
    if (before !== null) assert.equal(fs.readFileSync(create.plistPath('zara'), 'utf8'), before, 'an existing job was rewritten');
    else assert.ok(!fs.existsSync(create.plistPath('zara')), label + ': a job was written');
  }
});

test('#8724 linked: it acts on the one agent named, never on all of them', () => {
  reset();
  agent('zara', { ran: false });
  agent('brigitte');   // on the notice: a plain repair of all would take it
  const none = mac.repair({ linked: true });
  assert.equal(none.ok, false, 'linked with no name repaired: ' + JSON.stringify(none));
  assert.ok(!fs.existsSync(create.plistPath('brigitte')));
  mac.repair({ only: 'zara', linked: true });
  assert.ok(!fs.existsSync(create.plistPath('brigitte')), 'a linked repair of zara wrote brigitte a job too');
});

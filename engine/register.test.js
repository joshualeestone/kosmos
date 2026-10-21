'use strict';

/**
 * Which agents survive a restart, and giving the missing ones their job.
 *
 * 🛑 ON JOSH'S MACHINE THIS WAS ONE OUT OF SIXTEEN, and nothing anywhere said
 * so: an agent with a login job and one without are identical on the board and
 * identical in every API. The difference showed up once, at the next login.
 *
 * ⚠️ EVERY TEST HERE RUNS AGAINST A SANDBOXED HOME. `create` is put in dry-run
 * with an injected runner, so no `launchctl` call can reach the real machine —
 * and the plist directory, the worker directory and the data root are all
 * pointed into a temp folder. The one root that has no override is launchd
 * itself, which is why the runner is the belt to those braces.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-register-'));
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
  fs.writeFileSync(path.join(SB, 'bin', 'claude'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(SB, 'bin', 'tmux'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(SB, 'bin', 'codex'), '#!/bin/sh\n', { mode: 0o755 }); // #1794
}

test('an agent with a folder and no job is the thing being looked for', () => {
  reset();
  agent('anna', { job: true });
  agent('brigitte');
  agent('marilyn');
  const s = mac.survey();
  assert.equal(s.ok, true);
  assert.deepEqual(s.missing, ['brigitte', 'marilyn']);
  /* ⚠️ THE ROW CARRIES BOTH NAMES. Act on `name`, speak `shownAs`: the panel
     printed the machine name and Josh read `ava, bob, brigitte` beside cards
     saying Ava, Brigitte and Scarlett. With no display name recorded, the two
     are the same string, which is the ordinary case and not a fallback. */
  assert.deepEqual(s.agents.find((x) => x.name === 'anna'),
    { name: 'anna', shownAs: 'anna', removed: false, folder: true, job: true, profile: true, ran: true });
});

test('the roster comes from what Kosmos wrote, never from what is in the folder', () => {
  /* 🛑 `~/work/workers` IS A PLAIN DIRECTORY. On this fleet's own Mac it holds
     worker checkouts that are not Kosmos agents at all, and writing launchd
     jobs for whatever is sitting there would start strangers' processes at
     every login. The failure direction is to do nothing. */
  reset();
  fs.mkdirSync(path.join(SB, 'workers', 'somebody-elses-thing'), { recursive: true });
  assert.deepEqual(mac.survey().missing, []);
});

test('a removed agent is not resurrected', () => {
  reset();
  agent('rick');
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(path.join(store.ROOT, 'removed.json'), JSON.stringify([{ name: 'rick' }]), 'utf8');
  const s = mac.survey();
  assert.deepEqual(s.missing, [], 'an agent somebody removed on purpose was queued to be started again');
  assert.equal(s.agents.find((a) => a.name === 'rick').removed, true);
});

test('an unreadable removed list stops everything, rather than guessing', () => {
  /* ⚠️ FAIL CLOSED, and this is the one place in the module where that is the
     right direction: without the list we cannot tell a forgotten agent from one
     somebody deliberately took off the board, and the wrong guess starts a
     process they stopped on purpose. */
  reset();
  agent('rick');
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(path.join(store.ROOT, 'removed.json'), '{not json', 'utf8');
  const s = mac.survey();
  assert.equal(s.ok, false);
  assert.match(s.because, /removed/);
  assert.deepEqual(mac.repair().results, [], 'a repair ran against a list we could not read');
});

test('a profile with no folder is reported and never acted on', () => {
  /* An agent whose folder is gone would get a job that fails every thirty
     seconds forever. It stays on the survey so it can be SEEN. */
  reset();
  agent('tom', { folder: false });
  const s = mac.survey();
  assert.equal(s.agents.find((a) => a.name === 'tom').folder, false);
  assert.deepEqual(s.missing, []);
});

test('a name that is not a name is not turned into a path', () => {
  reset();
  fs.mkdirSync(store.PROFILES, { recursive: true });
  fs.writeFileSync(path.join(store.PROFILES, '...json'), '{}', 'utf8');
  assert.deepEqual(mac.survey().agents.map((a) => a.name), []);
});

test('the repair writes the job, enables the label, and bootstraps it', () => {
  reset();
  agent('brigitte');
  const out = mac.repair();
  assert.equal(out.ok, true);
  assert.equal(out.installed, 1);
  assert.equal(fs.existsSync(create.plistPath('brigitte')), true, 'no job was written');
  /* ⚠️ enable BEFORE bootstrap. `remove` sticks by writing a per-user disable
     override keyed on the LABEL, and it outlives the plist, so bootstrapping
     into a standing disable is refused (measured on macOS 26.7, #4254) and the
     repaired agent never comes up. */
  const enable = CALLS.findIndex((c) => c.includes('enable'));
  const boot = CALLS.findIndex((c) => c.includes('bootstrap'));
  assert.ok(enable !== -1 && boot !== -1, 'launchctl was not asked at all');
  assert.ok(enable < boot, 'bootstrap ran before enable, so a disabled label is refused');
});

test('the model it last ran as goes into the job, and an unknown one is left out', () => {
  reset();
  agent('christina');
  agent('heather');
  mac.repair({ modelFor: (n) => (n === 'christina' ? 'claude-opus-5' : null) });
  assert.match(fs.readFileSync(create.plistPath('christina'), 'utf8'), /claude-opus-5/);
  /* ⚠️ AND NOT GUESSED. A plist naming the wrong model is a silent downgrade
     that outlives everybody's memory of the day it was written; the
     five-argument job every pre-model agent already runs is correct. */
  const args = fs.readFileSync(create.plistPath('heather'), 'utf8')
    .match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/)[1]
    .match(/<string>/g).length;
  assert.equal(args, 7, 'a model was invented for an agent that had no record of one');
});

test('what we had to assume travels back, so the screen can say it', () => {
  reset();
  agent('marilyn');
  const r = mac.repair().results[0];
  assert.match(r.guessed.model, /default/);
  assert.match(r.guessed.account, /main Claude account/);
  const kept = mac.repair({ modelFor: () => 'claude-opus-5' });
  assert.deepEqual(kept.results, [], 'it repaired the same agent twice');
});

test('an existing job is never overwritten', () => {
  /* Somebody edited theirs by hand, or `remove` merely disabled it: removal
     deletes nothing. Rewriting from defaults we had to guess at would be the
     silent downgrade this module refuses everywhere else. */
  reset();
  agent('anna', { job: true });
  // The fixture is a plist, so it is the darwin arm this pins; #570's win32
  // half of the same guard is in jobexists.win32-570.test.js.
  const r = create.installJob('anna', { platform: 'darwin' });
  assert.equal(r.ok, false);
  assert.equal(r.already, true);
  assert.equal(fs.readFileSync(create.plistPath('anna'), 'utf8'), '<plist/>');
});

test('the job stays on disk when it could not be started', () => {
  /* ⚠️ THE ONE PLACE THIS DIFFERS FROM CREATION'S ROLLBACK. A failed bootstrap
     during creation leaves nothing a person owns. Here the agent already
     exists, and the file is what brings it back at the NEXT login even if it
     could not be started now. Removing it would throw away the fix to keep the
     report tidy. */
  reset();
  agent('spensor');
  create.setRunner((file, args) => {
    if (args[0] === 'bootstrap') return { ok: false };
    return { ok: true, stdout: '' };
  });
  const r = mac.repair().results[0];
  create.setRunner((file, args) => { CALLS.push([file, ...args].join(' ')); return { ok: true, stdout: '' }; });
  assert.equal(r.ok, true);
  assert.equal(r.started, false);
  assert.match(r.because, /next login/);
  assert.equal(fs.existsSync(create.plistPath('spensor')), true, 'the fix was thrown away to keep the report tidy');
});

test('no job is written when Claude is not on this computer', () => {
  /* The same refusal creation makes, for the same reason: a job pointing at a
     binary that is not there fails every thirty seconds forever. */
  reset();
  agent('dan');
  fs.rmSync(path.join(SB, 'bin', 'claude'));
  const r = create.installJob('dan', { platform: 'darwin' });
  assert.equal(r.ok, false);
  assert.match(r.because, /could not find Claude/);
  assert.equal(fs.existsSync(create.plistPath('dan')), false);
});

test.after(() => { fs.rmSync(SB, { recursive: true, force: true }); });

test('a machine that has never had an agent is not an unreadable one', () => {
  /* 🛑 THIS SHIPPED WRONG FOR TEN MINUTES AND WAS FOUND BY RUNNING IT. The
     profiles directory does not exist until the first profile is written, so
     every fresh machine answered "we could not read what Kosmos knows about
     your agents" — the could-not-look versus is-not-there inversion this whole
     product is written against, on a board with nothing on it to be alarmed
     about. */
  reset();
  fs.rmSync(store.PROFILES, { recursive: true, force: true });
  const s = mac.survey();
  assert.equal(s.ok, true);
  assert.deepEqual(s.agents, []);
  assert.deepEqual(s.missing, []);
});

test('the survey speaks the name the person typed', () => {
  /* 🛑 THE PANEL PRINTED THE SLUG. Josh, 2026-08-22, reading his own repair
     list: `ava, bob, brigitte` while his board showed Ava, Brigitte and
     Scarlett. He reasonably took Scarlett to be missing from a list she was
     in, because her machine name is one of the lowercase ones. */
  reset();
  agent('scarlett');
  store.writeProfile('scarlett', { displayName: 'Scarlett' });
  const row = mac.survey().agents.find((x) => x.name === 'scarlett');
  assert.equal(row.shownAs, 'Scarlett');
  /* ⚠️ And the acting key is untouched: everything downstream of this builds a
     path, a launchd label and a tmux target out of it. */
  assert.equal(row.name, 'scarlett');
  assert.deepEqual(mac.survey().missing, ['scarlett'], 'the list a repair acts on stopped being machine names');
  assert.equal(mac.repair().results[0].shownAs, 'Scarlett', 'the report speaks the machine name');
});

test('#500: a folder or job with no profile is surveyed as a stray, and repair never touches it', () => {
  reset();
  /* The positive control FIRST: the profile-backed folder-only shape must
     still enumerate and still repair, or this test proves absence with a
     survey that finds nothing at all. */
  agent('with-profile');
  agent('stray-folder', { profile: false });
  agent('stray-job', { profile: false, folder: false, job: true });
  /* The birth record is what ties a folder to Kosmos: `stray-folder` was
     created once (the receipt survives its deleted profile), while the
     stranger's checkout below has no line and must stay invisible. */
  fs.rmSync(create.createdLogFile(), { force: true });
  fs.mkdirSync(path.dirname(create.createdLogFile()), { recursive: true });
  fs.appendFileSync(create.createdLogFile(),
    JSON.stringify({ at: new Date().toISOString(), name: 'stray-folder', outcome: 'created' }) + '\n', 'utf8');
  /* The birth line records the spelling the person TYPED; the folder is
     made under the slug. The tie must match "Casey" to casey or every
     capitalized creation's remains stay invisible. */
  agent('casey', { profile: false });
  fs.appendFileSync(create.createdLogFile(),
    JSON.stringify({ at: new Date().toISOString(), name: 'Casey', outcome: 'partial' }) + '\n', 'utf8');
  fs.mkdirSync(path.join(SB, 'workers', 'somebody-elses-checkout'), { recursive: true });
  /* A directory whose name fails NAME_RE cannot collide with any creatable
     name; it holds nothing hostage and is not ours to show. */
  fs.mkdirSync(path.join(SB, 'workers', 'Bad Name'), { recursive: true });

  const s = mac.survey();
  assert.equal(s.ok, true);
  const byName = new Map(s.agents.map((a) => [a.name, a]));
  assert.equal(byName.get('with-profile').profile, true);
  assert.deepEqual(s.missing, ['with-profile'],
    'the profile-backed control fell out of missing, or a stray got in');

  const sf = byName.get('stray-folder');
  assert.ok(sf, 'the profile-less folder is absent: the survey still enumerates from profiles only');
  assert.deepEqual({ folder: sf.folder, job: sf.job, profile: sf.profile },
    { folder: true, job: false, profile: false });
  const sj = byName.get('stray-job');
  assert.ok(sj, 'the profile-less job is absent: the survey still enumerates from profiles only');
  assert.deepEqual({ folder: sj.folder, job: sj.job, profile: sj.profile },
    { folder: false, job: true, profile: false });
  assert.equal(byName.has('Bad Name'), false, 'a NAME_RE-failing directory is not a name');
  assert.equal(byName.has('somebody-elses-checkout'), false,
    'a directory with no birth record was shown: the roster-from-records ruling is broken');
  assert.ok(byName.get('casey'), 'a capitalized birth line failed to tie its lowercased folder');
  assert.equal(byName.get('casey').profile, false);

  /* repair() acts on missing. After it runs, the stray folder must hold no
     launchd job: minting one would resurrect an agent nobody registered. */
  const r = mac.repair();
  assert.equal(r.ok, true);
  assert.equal(fs.existsSync(create.plistPath('stray-folder')), false,
    'repair wrote a job for a profile-less stray');
  assert.equal(fs.existsSync(create.plistPath('with-profile')), true,
    'the control was not repaired, so the guard proves nothing');
});

test('#500: a removed name with stray remains is carried as removed and never queued for repair', () => {
  reset();
  fs.rmSync(create.createdLogFile(), { force: true });
  agent('ghost', { profile: false });
  fs.mkdirSync(path.dirname(create.createdLogFile()), { recursive: true });
  fs.appendFileSync(create.createdLogFile(),
    JSON.stringify({ at: new Date().toISOString(), name: 'ghost', outcome: 'created' }) + '\n', 'utf8');
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(path.join(store.ROOT, 'removed.json'), JSON.stringify([{ name: 'ghost' }]), 'utf8');
  const s = mac.survey();
  assert.equal(s.ok, true);
  const ghost = s.agents.find((a) => a.name === 'ghost');
  assert.ok(ghost, 'the removed stray fell out of the survey entirely');
  assert.equal(ghost.removed, true, 'somebody\'s removal decision was dropped');
  assert.deepEqual(s.missing, [], 'a removed stray was queued to be repaired');
});

test('#500: a directory born long after every line for its name is a later tenant, not a stray', () => {
  reset();
  fs.rmSync(create.createdLogFile(), { force: true });
  /* The line predates the directory by years: whatever this folder is,
     it is not what that creation made. It stays invisible, and the
     control right beside it (a line YOUNGER than its folder) shows. */
  agent('old-name', { profile: false });
  agent('young-name', { profile: false });
  fs.mkdirSync(path.dirname(create.createdLogFile()), { recursive: true });
  fs.appendFileSync(create.createdLogFile(),
    JSON.stringify({ at: '2001-01-01T00:00:00Z', name: 'old-name', outcome: 'created' }) + '\n'
    + JSON.stringify({ at: '2099-01-01T00:00:00Z', name: 'young-name', outcome: 'created' }) + '\n', 'utf8');
  const s = mac.survey();
  const names = s.agents.map((a) => a.name);
  assert.ok(names.includes('young-name'), 'the control stray is absent, so the later-tenant assert proves nothing');
  assert.ok(!names.includes('old-name'), 'a directory born after its only line was shown as that line\'s remains');
});

test('#500: an unreadable root reports the sweep failed rather than a confident absence', () => {
  reset();
  agent('solo');
  fs.chmodSync(path.join(SB, 'workers'), 0o000);
  try {
    const s = mac.survey();
    assert.equal(s.ok, true, 'an unreadable stray root took the whole survey down');
    assert.equal(s.straySweepFailed, true, 'could-not-look was reported as found-nothing');
  } finally {
    fs.chmodSync(path.join(SB, 'workers'), 0o755);
  }
  const healthy = mac.survey();
  assert.equal(healthy.straySweepFailed, false, 'the flag stuck after the root came back');
});

test('#500: both walks fail soft on a machine with neither root', () => {
  reset();
  /* An ABSENT root contributes nothing rather than failing the survey:
     the profile-backed roster must survive a fresh machine with neither
     directory. (The unreadable arm is driven by its own test above,
     through the straySweepFailed flag.) */
  fs.rmSync(create.createdLogFile(), { force: true });
  fs.rmSync(path.join(SB, 'workers'), { recursive: true, force: true });
  fs.rmSync(path.join(SB, 'launch'), { recursive: true, force: true });
  store.writeProfile('solo', { role: 'helper' });
  const s = mac.survey();
  assert.equal(s.ok, true);
  assert.deepEqual(s.agents.map((a) => a.name), ['solo']);
});

/**
 * #1400: repair rebuilt a Codex agent's job as a Claude job.
 *
 * 🛑 `installJob` reads an absent runner as claude, and `register.js` contained
 * zero references to `provider`. So an agent whose job went missing came back
 * pointing at the claude binary with the `codex` argument gone - **and repair
 * reported success.** It runs Claude in a folder set up for Codex.
 *
 * ⭐ AND THE TEST THAT LOOKED LIKE COVERAGE WAS COVERAGE FOR A DIFFERENT KEY. The
 * model assertion above tests the NEIGHBOURING field of this exact call. The
 * runner neither travelled nor was asserted, one key over, in the same argument
 * list. That is why nothing went red.
 */
/**
 * #1337: the codex writes must land INSIDE the sandbox, and this asserts it
 * rather than trusting it.
 *
 * 🛑 WHY THIS EXISTS, AND IT IS TODAY'S INCIDENT. This file previously
 * SANDBOXED the codex home and ASSERTED NOTHING ABOUT IT. That is a guard with
 * no alarm: when the seam was absent, `installJob` wrote a real
 * `trust_level = "trusted"` entry into the OPERATOR'S `~/.codex/config.toml`
 * on every full-suite run, and this file reported **21 pass, 0 fail**. Four
 * runs went by. Nothing in a green signalled it.
 *
 * ⭐ MEASURED (#1337): perturbing the one home derivation turned
 * `create.test.js`, `openaiaccounts.test.js` and `codexsession.test.js` RED and
 * made `discover.adopt.test.js` REFUSE TO RUN - while THIS file stayed GREEN.
 * A file that cannot notice where its own writes land is the one file that
 * could pollute again.
 *
 * 📌 And this is assertable rather than circular (Mona Lisa's distinction): it
 * is a fact about a FILE ON DISK, not a property of the code under test. You
 * cannot assert "nobody will ever pass a codex runner"; you CAN assert "the
 * entry is under my sandbox and not under the real home".
 */
test('#1337: a Codex repair writes its trust entry inside the sandbox, not the real home', () => {
  reset();
  agent('codexhome');
  store.writeProfile('codexhome', { role: 'helper', provider: 'openai' });
  fs.rmSync(create.plistPath('codexhome'), { force: true });
  mac.repair();

  const sandboxed = path.join(SB, 'home', '.codex', 'config.toml');
  assert.ok(fs.existsSync(sandboxed),
    'the codex trust write did not land in the sandbox at all: either it went somewhere else, or the repair stopped doing it and this guard is now blind');
  assert.match(fs.readFileSync(sandboxed, 'utf8'), /codexhome/,
    'the sandboxed config exists but does not name this agent, so the write under test is not the one being asserted');

  /* THE ARM THAT MATTERS: the operator's real home must be untouched. Resolved
     the same way the product resolves it, so this cannot drift from the code. */
  const real = path.join(os.homedir(), '.codex', 'config.toml');
  if (fs.existsSync(real)) {
    assert.doesNotMatch(fs.readFileSync(real, 'utf8'), /codexhome/,
      'THE TEST WROTE INTO THE OPERATOR\'S REAL ~/.codex - the sandbox seam is not holding');
  }
});

test('#1400: a Codex agent repairs to a CODEX job, and a Claude agent still repairs to a Claude one', () => {
  reset();
  /* Both arms in one test on purpose: a fix that always passes `runner: codex`
     satisfies the first assertion and breaks every Claude agent on the machine.
     The pair is the guard; either alone is not. */
  agent('codexrepair');
  store.writeProfile('codexrepair', { role: 'helper', provider: 'openai' });
  agent('clauderepair');

  mac.repair({ modelFor: () => null });

  const codexPlist = fs.readFileSync(create.plistPath('codexrepair'), 'utf8');
  const claudePlist = fs.readFileSync(create.plistPath('clauderepair'), 'utf8');

  assert.match(codexPlist, /<string>codex<\/string>/,
    'a Codex agent was repaired into a Claude job: it will run the wrong program in its own folder');
  assert.doesNotMatch(claudePlist, /<string>codex<\/string>/,
    'a Claude agent was repaired into a Codex job: the fix is "always codex"');
});

test('#1400 CONTROL: a CORRUPT profile still repairs, on the default runner', () => {
  /* Same posture the model above keeps: a repair onto the default runner is
     recoverable in one click; no repair at all is not.

     🛑 A CORRUPT PROFILE, NOT AN ABSENT ONE. My first version of this control
     omitted the profile entirely and failed - because `survey()` finds agents
     BY their profile, so an agent without one is never seen and repair has
     nothing to skip. The control was aimed at a state that cannot occur, which
     is not a weaker test, it is a test of nothing. The reachable case is a
     profile that EXISTS and cannot be parsed, which is exactly what the
     try/catch around `readProfile` is for. */
  reset();
  agent('corruptrepair');
  fs.writeFileSync(path.join(store.PROFILES, 'corruptrepair.json'), '{ not json', 'utf8');
  const out = mac.repair({ modelFor: () => null });
  const row = out.results.find((r) => r.name === 'corruptrepair');
  assert.ok(row, 'an agent with a corrupt profile was skipped rather than repaired');
  assert.ok(fs.existsSync(create.plistPath('corruptrepair')),
    'an unparseable profile left somebody\'s agent without a job');
  assert.doesNotMatch(fs.readFileSync(create.plistPath('corruptrepair'), 'utf8'),
    /<string>codex<\/string>/, 'a runner was invented from a profile that could not be read');
});

test('#5534: Repair does not start an import the company policy held, but restores an agent that ran before', () => {
  reset();
  const orgpolicy = require('./orgpolicy');
  agent('heldcodex');
  agent('rancodex');
  store.writeProfile('heldcodex', { provider: 'openai', policyHeld: true });
  store.writeProfile('rancodex', { provider: 'openai' });
  fs.mkdirSync(path.dirname(orgpolicy.APPLIED()), { recursive: true });
  fs.writeFileSync(orgpolicy.APPLIED(), JSON.stringify({ org: 'org-1', version: 1, applied_at: 1,
    policy: { providers_allowed: ['anthropic'], models_allowed: null } }));
  try {
    const out = mac.repair();
    const held = out.results.find((r) => r.name === 'heldcodex');
    assert.ok(held, 'the held agent was not in the repair list at all');
    assert.equal(held.ok, false, 'Repair started an agent the policy held');
    assert.match(String(held.because), /policy does not allow OpenAI for new agents/);
    assert.equal(fs.existsSync(create.plistPath('heldcodex')), false, 'a job was written for the held agent');
    assert.equal(fs.existsSync(create.plistPath('rancodex')), true, 'CONTROL: an agent that ran before is restored (nothing is bricked)');
    // Review 3: once the policy allows it and Repair has started it, it is an agent that ran: the mark clears.
    fs.writeFileSync(orgpolicy.APPLIED(), JSON.stringify({ org: 'org-1', version: 2, applied_at: 1,
      policy: { providers_allowed: null, models_allowed: null } }));
    const again = mac.repair().results.find((r) => r.name === 'heldcodex');
    assert.equal(again && again.ok, true, 'the held agent was not restored once allowed: ' + (again && again.because));
    assert.equal(store.readProfile('heldcodex').policyHeld, false, 'the mark stayed after Repair started the agent');
  } finally {
    fs.rmSync(orgpolicy.APPLIED(), { force: true });
  }
});

/* #6310: the fleet Mac's agents each start at login from their OWN LaunchAgent (com.<name>.discord, KeepAlive,
   WorkingDirectory = the worker folder). The survey looked only for our plist, so all 18 read as "will not come back",
   and Repair would have installed and started a second copy of each. */
function foreignJob(file, { dir, keepAlive = true, runAtLoad = false, disabled = false, raw = null } = {}) {
  fs.mkdirSync(path.join(SB, 'launch'), { recursive: true });
  const body = raw !== null ? raw : '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n'
    + '\t<key>Label</key>\n\t<string>' + file.replace(/\.plist$/, '') + '</string>\n'
    + (keepAlive ? '\t<key>KeepAlive</key>\n\t<true/>\n' : '')
    + (runAtLoad ? '\t<key>RunAtLoad</key>\n\t<true/>\n' : '')
    + (disabled ? '\t<key>Disabled</key>\n\t<true/>\n' : '')
    + '\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>/bin/bash</string>\n\t</array>\n'
    + (dir ? '\t<key>WorkingDirectory</key>\n\t<string>' + dir.replace(/&/g, '&amp;') + '</string>\n' : '')
    + '</dict>\n</plist>\n';
  fs.writeFileSync(path.join(SB, 'launch', file), body, 'utf8');
}

test('#6310: an agent started at login by a job that is not ours is not missing, and Repair writes nothing for it', () => {
  reset();
  agent('angelx');
  agent('leox');
  agent('plainx');   // CONTROL: no job anywhere, still counted and still repaired
  foreignJob('com.angelx.discord.plist', { dir: create.workerDir('angelx') });
  foreignJob('com.leox.discord.plist', { dir: create.workerDir('leox'), keepAlive: false, runAtLoad: true });
  const s = mac.survey();
  assert.equal(s.ok, true);
  assert.deepEqual(s.missing, ['plainx']);
  assert.equal(s.agents.find((x) => x.name === 'angelx').job, true);
  const r = mac.repair();
  assert.deepEqual(r.results.map((x) => x.name), ['plainx']);
  assert.equal(fs.existsSync(create.plistPath('angelx')), false, 'Repair wrote a second login job for an agent that had one');
  assert.equal(fs.existsSync(create.plistPath('plainx')), true, 'the control was not repaired, so this test could not see a repair');
});

test('#6310: a disabled job, a job that never starts, or one in another folder does not cover the agent', () => {
  reset();
  agent('offx');
  agent('idlex');
  agent('elsex');
  foreignJob('com.offx.discord.plist', { dir: create.workerDir('offx'), disabled: true });
  foreignJob('com.idlex.discord.plist', { dir: create.workerDir('idlex'), keepAlive: false });
  fs.mkdirSync(path.join(SB, 'workers', 'not-elsex'), { recursive: true });
  foreignJob('com.elsex.discord.plist', { dir: path.join(SB, 'workers', 'not-elsex') });
  assert.deepEqual(mac.survey().missing, ['elsex', 'idlex', 'offx']);
});

test('#6310: a login job we cannot read makes unknown only the agent it names; the rest are still counted', () => {
  reset();
  agent('ownx', { job: true });
  agent('unkx');
  agent('plainy');   // CONTROL: not named by the unreadable file, so its missing job is still reported
  foreignJob('com.broken.thing.plist', { raw: 'not a property list, but it runs ' + create.workerDir('unkx') + ' at login' });
  const s = mac.survey();
  assert.deepEqual(s.missing, ['plainy']);
  assert.equal(s.agents.find((x) => x.name === 'unkx').job, null);
  assert.deepEqual(s.unknown, ['unkx'], '#6320: the unknown agent is listed for the banner, and only it');
  assert.equal(s.agents.find((x) => x.name === 'ownx').job, true, 'our own plist still answers on its own');
  const r = mac.repair();
  assert.deepEqual(r.results.map((x) => x.name), ['plainy']);
  assert.equal(fs.existsSync(create.plistPath('unkx')), false, 'Repair wrote a job for an agent whose login job is unknown');
});

test('#6310: a scheduled job that starts at login in the folder covers it, as do a run-once launcher, a Program key and a $HOME spelling', () => {
  reset();
  for (const n of ['tickx', 'oncex', 'progx', 'homex']) agent(n);
  const bin = path.join(SB, 'scripts');
  fs.mkdirSync(bin, { recursive: true });
  const script = (n, body) => { const f = path.join(bin, n); fs.writeFileSync(f, body, 'utf8'); return f; };
  const job = (file, extra) => foreignJob(file, { keepAlive: false, raw: '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n' + extra + '</dict>\n</plist>\n' });
  const args = (a) => '\t<key>ProgramArguments</key>\n\t<array>\n' + a.map((x) => '\t\t<string>' + x + '</string>\n').join('') + '\t</array>\n';
  job('com.tickx.tick.plist', '\t<key>RunAtLoad</key>\n\t<true/>\n\t<key>StartInterval</key>\n\t<integer>120</integer>\n\t<key>WorkingDirectory</key>\n\t<string>' + create.workerDir('tickx') + '</string>\n' + args(['/bin/true']));
  job('com.oncex.discord.plist', '\t<key>RunAtLoad</key>\n\t<true/>\n' + args(['/bin/bash', script('launch-oncex.sh', 'tmux new-session -d -c "' + create.workerDir('oncex') + '"\n')]));
  job('com.progx.discord.plist', '\t<key>KeepAlive</key>\n\t<true/>\n\t<key>Program</key>\n\t<string>' + script('launch-progx.sh', 'cd ' + create.workerDir('progx') + '\n') + '</string>\n');
  const oldHome = process.env.HOME;
  process.env.HOME = SB;
  try {
    job('com.homex.discord.plist', '\t<key>KeepAlive</key>\n\t<true/>\n' + args(['/bin/bash', script('launch-homex.sh', 'WORK_DIR="$HOME/workers/homex"\n')]));
    assert.deepEqual(mac.survey().missing, []);
  } finally {
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  }
});

test('#6310: a kept-alive job whose start script names the folder covers the agent; a periodic one and a longer name do not', () => {
  reset();
  agent('scriptx');
  agent('periodx');
  agent('leo');
  const bin = path.join(SB, 'scripts');
  fs.mkdirSync(bin, { recursive: true });
  const script = (n, body) => { const f = path.join(bin, n); fs.writeFileSync(f, body, 'utf8'); return f; };
  const job = (file, args, extra) => foreignJob(file, { keepAlive: false, raw: '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n'
    + extra + '\t<key>ProgramArguments</key>\n\t<array>\n' + args.map((a) => '\t\t<string>' + a + '</string>\n').join('') + '\t</array>\n</dict>\n</plist>\n' });
  job('com.scriptx.discord.plist', ['/bin/bash', script('launch-scriptx.sh', 'WORK_DIR="' + create.workerDir('scriptx') + '"\ntmux new-session -d -c "$WORK_DIR"\n')],
    '\t<key>KeepAlive</key>\n\t<true/>\n\t<key>RunAtLoad</key>\n\t<true/>\n');
  job('com.periodx.digest.plist', ['/bin/bash', script('digest.sh', 'cd ' + create.workerDir('periodx') + '\n')],
    '\t<key>RunAtLoad</key>\n\t<true/>\n\t<key>StartInterval</key>\n\t<integer>120</integer>\n');
  job('com.leonardo.discord.plist', ['/bin/bash', script('launch-leonardo.sh', 'WORK_DIR="' + create.workerDir('leo') + 'nardo"\n')],
    '\t<key>KeepAlive</key>\n\t<true/>\n');
  assert.deepEqual(mac.survey().missing, ['leo', 'periodx']);
});

test('#6310: a login job that cannot be read at all makes every agent without its own plist unknown, and none is repaired', (t) => {
  if (process.getuid && process.getuid() === 0) return t.skip('root reads a mode-000 file');
  reset();
  agent('ownz', { job: true });
  agent('anyz');
  foreignJob('com.locked.thing.plist', {});
  const locked = path.join(SB, 'launch', 'com.locked.thing.plist');
  fs.chmodSync(locked, 0o000);
  try {
    const s = mac.survey();
    assert.deepEqual(s.missing, []);
    assert.equal(s.agents.find((x) => x.name === 'anyz').job, null);
    assert.equal(s.agents.find((x) => x.name === 'ownz').job, true);
    mac.repair();
    assert.equal(fs.existsSync(create.plistPath('anyz')), false, 'Repair acted on an unknown agent');
    // CONTROL: once it can be read again (it names nobody), the agent is counted again, a minute later: a failed
    // read is retried, not cached for good.
    fs.chmodSync(locked, 0o644);
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    try {
      assert.deepEqual(mac.survey().missing, [], 'retried before its minute');
      t.mock.timers.tick(61000);
      assert.deepEqual(mac.survey().missing, ['anyz']);
    } finally { t.mock.timers.reset(); }
  } finally {
    try { fs.chmodSync(locked, 0o644); } catch { /* reset removes it */ }
  }
});

test('#6310: KeepAlive written as a dict counts; a folder preceded by other name characters does not', () => {
  reset();
  agent('dictx');
  agent('edgex');
  const raw = (extra) => '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n' + extra + '</dict>\n</plist>\n';
  foreignJob('com.dictx.discord.plist', { raw: raw('\t<key>KeepAlive</key>\n\t<dict>\n\t\t<key>SuccessfulExit</key>\n\t\t<false/>\n\t</dict>\n\t<key>WorkingDirectory</key>\n\t<string>' + create.workerDir('dictx') + '</string>\n') });
  foreignJob('com.edgex.discord.plist', { raw: raw('\t<key>KeepAlive</key>\n\t<true/>\n\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>/bin/echo</string>\n\t\t<string>old' + create.workerDir('edgex') + '</string>\n\t</array>\n') });
  assert.deepEqual(mac.survey().missing, ['edgex']);
});

test('#6310: a binary plist is read through plutil', (t) => {
  if (!fs.existsSync('/usr/bin/plutil')) return t.skip('no plutil off a Mac');
  reset();
  agent('binx');
  foreignJob('com.binx.discord.plist', { dir: create.workerDir('binx') });
  const file = path.join(SB, 'launch', 'com.binx.discord.plist');
  require('node:child_process').execFileSync('/usr/bin/plutil', ['-convert', 'binary1', file]);
  assert.equal(fs.readFileSync(file).slice(0, 8).toString('latin1'), 'bplist00', 'the fixture is not binary');
  assert.deepEqual(mac.survey().missing, []);
});

test('#6310: a start script that cannot be read leaves "no job" unproven; a nested Disabled and a closing full stop do not mislead', (t) => {
  if (process.getuid && process.getuid() === 0) return t.skip('root reads a mode-000 file');
  reset();
  agent('nestx');
  agent('dotx');
  const bin = path.join(SB, 'scripts');
  fs.mkdirSync(bin, { recursive: true });
  const raw = (extra) => '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n' + extra + '</dict>\n</plist>\n';
  // A Disabled key inside EnvironmentVariables is not the job's own.
  foreignJob('com.nestx.discord.plist', { raw: raw('\t<key>EnvironmentVariables</key>\n\t<dict>\n\t\t<key>Disabled</key>\n\t\t<true/>\n\t</dict>\n\t<key>KeepAlive</key>\n\t<true/>\n\t<key>WorkingDirectory</key>\n\t<string>' + create.workerDir('nestx') + '</string>\n') });
  const dotScript = path.join(bin, 'launch-dotx.sh'); fs.writeFileSync(dotScript, '# starts the agent in ' + create.workerDir('dotx') + '.\n', 'utf8');
  foreignJob('com.dotx.discord.plist', { raw: raw('\t<key>KeepAlive</key>\n\t<true/>\n\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>/bin/bash</string>\n\t\t<string>' + dotScript + '</string>\n\t</array>\n') });
  assert.deepEqual(mac.survey().missing, [], 'a nested Disabled or a closing full stop misread a covered agent');
  // Now an unreadable launcher script: every agent without its own plist is unknown, and nothing is repaired.
  agent('lostx');
  const locked = path.join(bin, 'launch-locked.sh'); fs.writeFileSync(locked, 'echo\n', 'utf8'); fs.chmodSync(locked, 0o000);
  try {
    foreignJob('com.locked.discord.plist', { raw: raw('\t<key>KeepAlive</key>\n\t<true/>\n\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>/bin/bash</string>\n\t\t<string>' + locked + '</string>\n\t</array>\n') });
    const s = mac.survey();
    assert.deepEqual(s.missing, []);
    assert.equal(s.agents.find((x) => x.name === 'lostx').job, null);
  } finally { fs.chmodSync(locked, 0o644); }
});

test('#6310: what counts as a launcher: an unreadable script after Program counts; a huge bundle and an unreadable log do not doubt everyone', (t) => {
  if (process.getuid && process.getuid() === 0) return t.skip('root reads a mode-000 file');
  reset();
  agent('plainq');   // CONTROL: no job anywhere; stays counted unless something genuinely leaves it unproven
  const bin = path.join(SB, 'scripts');
  fs.mkdirSync(bin, { recursive: true });
  const raw = (extra) => '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n' + extra + '</dict>\n</plist>\n';
  const args = (a) => '\t<key>ProgramArguments</key>\n\t<array>\n' + a.map((x) => '\t\t<string>' + x + '</string>\n').join('') + '\t</array>\n';
  // A bundled CLI of 3 MB of text: not searched, and not a reason to doubt everyone.
  const bundle = path.join(bin, 'cli.js'); fs.writeFileSync(bundle, '// bundle\n' + 'x'.repeat(3 * 1024 * 1024), 'utf8');
  foreignJob('com.bundle.app.plist', { raw: raw('\t<key>KeepAlive</key>\n\t<true/>\n' + args(['/usr/bin/env', 'node', bundle])) });
  // An unreadable log being followed: data, not a launcher.
  const log = path.join(bin, 'app.log'); fs.writeFileSync(log, 'line\n', 'utf8'); fs.chmodSync(log, 0o000);
  try {
    foreignJob('com.tail.app.plist', { raw: raw('\t<key>KeepAlive</key>\n\t<true/>\n' + args(['/usr/bin/tail', '-F', log])) });
    assert.deepEqual(mac.survey().missing, ['plainq'], 'a bundle or an unreadable log made the control unknown');
    // An unreadable SCRIPT in the third slot of a Program-style job: may be any agent's launcher.
    const script = path.join(bin, 'launch-q.sh'); fs.writeFileSync(script, 'echo\n', 'utf8'); fs.chmodSync(script, 0o000);
    try {
      foreignJob('com.progq.discord.plist', { raw: raw('\t<key>KeepAlive</key>\n\t<true/>\n\t<key>Program</key>\n\t<string>/bin/bash</string>\n' + args(['bash', '-l', script])) });
      const s = mac.survey();
      assert.deepEqual(s.missing, []);
      assert.equal(s.agents.find((x) => x.name === 'plainq').job, null);
    } finally { fs.chmodSync(script, 0o644); }
  } finally { fs.chmodSync(log, 0o644); }
});

test('#6310: a folder written in another case still matches, and a remembered answer follows a changed script', () => {
  reset();
  agent('casex');
  const bin = path.join(SB, 'scripts');
  fs.mkdirSync(bin, { recursive: true });
  const script = path.join(bin, 'launch-casex.sh');
  fs.writeFileSync(script, 'echo nothing yet\n', 'utf8');
  foreignJob('com.casex.discord.plist', { raw: '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n\t<key>KeepAlive</key>\n\t<true/>\n\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>/bin/bash</string>\n\t\t<string>' + script + '</string>\n\t</array>\n</dict>\n</plist>\n' });
  assert.deepEqual(mac.survey().missing, ['casex'], 'the script names no folder yet');
  fs.writeFileSync(script, 'WORK_DIR="' + create.workerDir('casex').toUpperCase() + '"\n', 'utf8');
  const st = fs.statSync(script); fs.utimesSync(script, st.atime, new Date(st.mtimeMs + 5000));
  assert.deepEqual(mac.survey().missing, [], 'the remembered answer did not follow the changed script, or case was not ignored');
});

test('#6310: a file that becomes a launcher is seen at once; an impossible character reference does not doubt everyone', () => {
  reset();
  agent('modex');
  agent('plainr');   // CONTROL for the second half
  const bin = path.join(SB, 'scripts');
  fs.mkdirSync(bin, { recursive: true });
  const runner = path.join(bin, 'runner');   // no extension: a launcher only once it is executable
  fs.writeFileSync(runner, 'cd ' + create.workerDir('modex') + '\n', { mode: 0o644 });
  const raw = (extra) => '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n' + extra + '</dict>\n</plist>\n';
  foreignJob('com.modex.discord.plist', { raw: raw('\t<key>KeepAlive</key>\n\t<true/>\n\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>' + runner + '</string>\n\t</array>\n') });
  assert.ok(mac.survey().missing.includes('modex'), 'a non-executable data file was searched');
  fs.chmodSync(runner, 0o755);
  assert.ok(!mac.survey().missing.includes('modex'), 'a remembered answer missed the file becoming executable');
  foreignJob('com.weird.thing.plist', { raw: raw('\t<key>KeepAlive</key>\n\t<true/>\n\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>/bin/echo</string>\n\t\t<string>bad &#x110000; ref</string>\n\t</array>\n') });
  assert.ok(mac.survey().missing.includes('plainr'), 'an impossible character reference made every agent unknown');
});

test('#6310: a data file in a folder the survey cannot open does not doubt everyone; a script name there does', (t) => {
  if (process.getuid && process.getuid() === 0) return t.skip('root opens a mode-000 folder');
  reset();
  agent('plains');   // CONTROL
  const closed = path.join(SB, 'closed');
  fs.mkdirSync(closed, { recursive: true });
  const raw = (extra) => '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n' + extra + '</dict>\n</plist>\n';
  const args = (a) => '\t<key>ProgramArguments</key>\n\t<array>\n' + a.map((x) => '\t\t<string>' + x + '</string>\n').join('') + '\t</array>\n';
  fs.chmodSync(closed, 0o000);
  try {
    foreignJob('com.tail.closed.plist', { raw: raw('\t<key>KeepAlive</key>\n\t<true/>\n' + args(['/usr/bin/tail', '-F', path.join(closed, 'app.log')])) });
    assert.deepEqual(mac.survey().missing, ['plains'], 'a log in a closed folder made the control unknown');
    foreignJob('com.run.closed.plist', { raw: raw('\t<key>KeepAlive</key>\n\t<true/>\n' + args(['/bin/bash', path.join(closed, 'launch.sh')])) });
    const s = mac.survey();
    assert.equal(s.agents.find((x) => x.name === 'plains').job, null, 'a launcher in a closed folder was read as proof of no job');
  } finally { fs.chmodSync(closed, 0o755); }
});

test('#6310: a WorkingDirectory inside the agent folder covers it; a sibling folder does not', () => {
  reset();
  agent('subx');
  agent('sibx');
  fs.mkdirSync(path.join(create.workerDir('subx'), 'run'), { recursive: true });
  fs.mkdirSync(create.workerDir('sibx') + '-old', { recursive: true });
  foreignJob('com.subx.discord.plist', { dir: path.join(create.workerDir('subx'), 'run') });
  foreignJob('com.sibx.discord.plist', { dir: create.workerDir('sibx') + '-old' });
  assert.deepEqual(mac.survey().missing, ['sibx']);
});

test('#6310: a quoted "$HOME" spelling matches; a launcher in a privacy-guarded folder is never read and leaves agents unknown', () => {
  reset();
  agent('quotx');
  agent('plaint');   // CONTROL
  const bin = path.join(SB, 'scripts');
  fs.mkdirSync(bin, { recursive: true });
  const raw = (extra) => '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n' + extra + '</dict>\n</plist>\n';
  const args = (a) => '\t<key>ProgramArguments</key>\n\t<array>\n' + a.map((x) => '\t\t<string>' + x + '</string>\n').join('') + '\t</array>\n';
  const oldHome = process.env.HOME;
  process.env.HOME = SB;
  try {
    const q = path.join(bin, 'launch-quotx.sh');
    fs.writeFileSync(q, 'cd "$HOME"/workers/quotx\n', 'utf8');
    foreignJob('com.quotx.discord.plist', { raw: raw('\t<key>KeepAlive</key>\n\t<true/>\n' + args(['/bin/bash', q])) });
    assert.deepEqual(mac.survey().missing, ['plaint'], 'the quoted $HOME spelling was not matched');
  } finally { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome; }
  // A launcher under the Kosmos home's Documents: not touched (it does not even exist here), and it doubts everyone.
  const guarded = path.join(create.homeDir(), 'Documents', 'launch.sh');
  foreignJob('com.docs.app.plist', { raw: raw('\t<key>KeepAlive</key>\n\t<true/>\n' + args(['/bin/bash', guarded])) });
  const s = mac.survey();
  assert.equal(fs.existsSync(guarded), false, 'the fixture was meant to prove the path is judged without being read');
  assert.equal(s.agents.find((x) => x.name === 'plaint').job, null);
});

test('#6310: an oversized plist doubts only an agent it names', () => {
  reset();
  agent('bigx');
  agent('plainu');   // CONTROL
  fs.mkdirSync(path.join(SB, 'launch'), { recursive: true });
  fs.writeFileSync(path.join(SB, 'launch', 'com.big.thing.plist'), 'runs ' + create.workerDir('bigx') + '\n' + 'x'.repeat(300 * 1024), 'utf8');
  const s = mac.survey();
  assert.deepEqual(s.missing, ['plainu']);
  assert.equal(s.agents.find((x) => x.name === 'bigx').job, null);
});

test('#6310: an unreadable launcher is tried again a minute later', (t) => {
  if (process.getuid && process.getuid() === 0) return t.skip('root reads a mode-000 file');
  reset();
  agent('plainu');
  const bin = path.join(SB, 'scripts');
  fs.mkdirSync(bin, { recursive: true });
  const script = path.join(bin, 'launch-u.sh'); fs.writeFileSync(script, 'echo\n', 'utf8'); fs.chmodSync(script, 0o000);
  foreignJob('com.u.discord.plist', { raw: '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n\t<key>KeepAlive</key>\n\t<true/>\n\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>/bin/bash</string>\n\t\t<string>' + script + '</string>\n\t</array>\n</dict>\n</plist>\n' });
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    assert.equal(mac.survey().agents.find((x) => x.name === 'plainu').job, null);
    fs.chmodSync(script, 0o644);
    assert.equal(mac.survey().agents.find((x) => x.name === 'plainu').job, null, 'retried before its minute');
    t.mock.timers.tick(61000);
    assert.deepEqual(mac.survey().missing, ['plainu']);
  } finally { t.mock.timers.reset(); fs.chmodSync(script, 0o644); }
});

test('#6310: one survey converts at most four binary plists; the fifth is read on a later survey', (t) => {
  if (!fs.existsSync('/usr/bin/plutil')) return t.skip('no plutil off a Mac');
  reset();
  const names = ['bin1', 'bin2', 'bin3', 'bin4', 'bin5'];
  for (const n of names) {
    agent(n);
    foreignJob('com.' + n + '.discord.plist', { dir: create.workerDir(n) });
    require('node:child_process').execFileSync('/usr/bin/plutil', ['-convert', 'binary1', path.join(SB, 'launch', 'com.' + n + '.discord.plist')]);
  }
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  try {
    const first = mac.survey();
    assert.equal(first.agents.filter((x) => x.job === true).length, 4, 'more or fewer than four were converted in one survey');
    assert.equal(first.agents.filter((x) => x.job === null).length, 1);
    assert.deepEqual(first.unknown, [], '#6320: a plist only waiting its turn was told to the person as unreadable');
    const next = mac.survey();   // #6320: no minute wait: the next survey reads the one left over
    assert.deepEqual(next.missing, []);
    assert.equal(next.agents.filter((x) => x.job === true).length, 5, 'the waiting plist was not read on the next survey');
  } finally { t.mock.timers.reset(); }
});

test('#6310: a WorkingDirectory created after the first survey covers the agent at once', () => {
  reset();
  agent('latex');
  const run = path.join(create.workerDir('latex'), 'run');
  foreignJob('com.latex.discord.plist', { dir: run });
  assert.deepEqual(mac.survey().missing, ['latex'], 'the folder does not exist yet, so nothing starts in it');
  fs.mkdirSync(run, { recursive: true });
  assert.deepEqual(mac.survey().missing, [], 'a remembered answer missed the folder appearing');
});

test('#6310: a launcher or WorkingDirectory in a privacy-guarded folder is never looked at, not even with stat', () => {
  reset();
  agent('plainv');
  const docs = path.join(create.homeDir(), 'Documents');
  fs.mkdirSync(docs, { recursive: true });
  const guarded = path.join(docs, 'launch.sh');
  fs.writeFileSync(guarded, 'echo\n', 'utf8');
  const raw = '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n\t<key>KeepAlive</key>\n\t<true/>\n\t<key>WorkingDirectory</key>\n\t<string>' + docs + '</string>\n\t<key>ProgramArguments</key>\n\t<array>\n\t\t<string>/bin/bash</string>\n\t\t<string>' + guarded + '</string>\n\t</array>\n</dict>\n</plist>\n';
  foreignJob('com.docs.app.plist', { raw });
  const touched = [];
  const wrap = (obj, key) => { const orig = obj[key]; obj[key] = function (p, ...rest) { if (typeof p === 'string' && p.startsWith(docs)) touched.push(key + ' ' + p); return orig.call(this, p, ...rest); }; return () => { obj[key] = orig; }; };
  const undo = [wrap(fs, 'statSync'), wrap(fs, 'readFileSync'), wrap(fs, 'openSync'), wrap(fs.realpathSync, 'native'), wrap(fs, 'existsSync')];   // the code resolves with .native
  try {
    const s = mac.survey();
    assert.equal(s.agents.find((x) => x.name === 'plainv').job, null, 'a guarded launcher should leave others unknown');
  } finally { undo.reverse().forEach((u) => u()); }
  assert.deepEqual(touched, [], 'the survey touched a guarded path: ' + touched.join(', '));
});

test('#6310: a launcher that is a link into a guarded folder is not read; nor is a guarded folder in another case', () => {
  const raw = (args) => '<?xml version="1.0"?>\n<plist version="1.0">\n<dict>\n\t<key>KeepAlive</key>\n\t<true/>\n\t<key>ProgramArguments</key>\n\t<array>\n' + args.map((a) => '\t\t<string>' + a + '</string>\n').join('') + '\t</array>\n</dict>\n</plist>\n';
  // 1. A link into Documents whose target is a perfectly readable script: guarded, so not read, so others are unknown.
  //    Without the guard the target would be read, found harmless, and the control would read as missing.
  reset();
  agent('plainw');
  const docs = path.join(create.homeDir(), 'Documents');
  fs.mkdirSync(docs, { recursive: true });
  const real = path.join(docs, 'real-launch.sh');
  fs.writeFileSync(real, 'echo\n', 'utf8');
  const bin = path.join(SB, 'scripts');
  fs.mkdirSync(bin, { recursive: true });
  const link = path.join(bin, 'launch-w.sh');
  try { fs.unlinkSync(link); } catch { /* fresh */ }
  fs.symlinkSync(real, link);
  foreignJob('com.linkw.app.plist', { raw: raw(['/bin/bash', link]) });
  assert.equal(mac.survey().agents.find((x) => x.name === 'plainw').job, null, 'a link into Documents was followed and read');
  // 2. The guarded folder written in lower case (the same folder on the Mac's disks): not touched either.
  reset();
  agent('plainw');
  const lower = path.join(create.homeDir(), 'documents', 'other.sh');
  foreignJob('com.lower.app.plist', { raw: raw(['/bin/bash', lower]) });
  const touched = [];
  const orig = fs.statSync;
  fs.statSync = function (p, ...rest) { if (typeof p === 'string' && p === lower) touched.push(p); return orig.call(this, p, ...rest); };
  let s;
  try { s = mac.survey(); } finally { fs.statSync = orig; }
  assert.deepEqual(touched, [], 'the lower-case guarded path was stat-ed');
  assert.equal(s.agents.find((x) => x.name === 'plainw').job, null);
});

test('#6320: a real unreadable plist still lists the unknown while another only waits its turn', (t) => {
  if (!fs.existsSync('/usr/bin/plutil')) return t.skip('no plutil off a Mac');
  if (process.getuid && process.getuid() === 0) return t.skip('root reads a mode-000 file');
  reset();
  for (const n of ['wa1', 'wa2', 'wa3', 'wa4', 'wa5']) {
    agent(n);
    foreignJob('com.' + n + '.discord.plist', { dir: create.workerDir(n) });
    require('node:child_process').execFileSync('/usr/bin/plutil', ['-convert', 'binary1', path.join(SB, 'launch', 'com.' + n + '.discord.plist')]);
  }
  agent('lostz');
  foreignJob('com.zz.locked.plist', {});
  const locked = path.join(SB, 'launch', 'com.zz.locked.plist');
  fs.chmodSync(locked, 0o000);
  try {
    const s = mac.survey();
    assert.ok(s.unknown.includes('lostz'), 'a real failure was hidden because another plist was only waiting: ' + JSON.stringify(s.unknown));
  } finally { fs.chmodSync(locked, 0o644); }
});

test('#6320: on Windows a failed task lookup makes every agent unknown but lists none (Mac-only)', () => {
  reset();
  agent('winx');
  const w = require('./win32job');
  const orig = w.list;
  w.list = () => ({ known: false });
  try {
    const s = register.survey({ platform: 'win32' });
    assert.equal(s.agents.find((x) => x.name === 'winx').job, null, 'the fixture did not make the agent unknown');
    assert.deepEqual(s.unknown, []);
  } finally { w.list = orig; }
});

test('#6320: an agent a broken plist names is listed even while other plists wait their turn', (t) => {
  if (!fs.existsSync('/usr/bin/plutil')) return t.skip('no plutil off a Mac');
  reset();
  for (const n of ['wb1', 'wb2', 'wb3', 'wb4', 'wb5']) {
    agent(n);
    foreignJob('com.' + n + '.discord.plist', { dir: create.workerDir(n) });
    require('node:child_process').execFileSync('/usr/bin/plutil', ['-convert', 'binary1', path.join(SB, 'launch', 'com.' + n + '.discord.plist')]);
  }
  agent('suspx');
  foreignJob('com.broken.suspx.plist', { raw: 'not a plist, but it runs ' + create.workerDir('suspx') });
  const s = mac.survey();
  assert.ok(s.unknown.includes('suspx'), 'a real could-not-read was hidden while others waited: ' + JSON.stringify(s.unknown));
});

/* #6714 (Josh, 2026-10-20 08:35): "this is not a real agent but my only option is to set it to start at login". A test
   that stopped half way left a profile and a folder holding only a CLAUDE.md; it had never run. */
test('#6714: a profile and a folder that never ran are not on the restart notice, and Repair never starts them', () => {
  reset();
  agent('leftover-unrelated', { ran: false });
  agent('brigitte');   // CONTROL: the same shape, but it has run
  const s = mac.survey();
  assert.deepEqual(s.missing, ['brigitte']);
  assert.equal(s.agents.find((x) => x.name === 'leftover-unrelated').ran, false);
  const r = mac.repair();
  assert.deepEqual(r.results.map((x) => x.name), ['brigitte'], 'repair acted on an agent that never ran');
  assert.ok(!fs.existsSync(create.plistPath('leftover-unrelated')), 'a login job was written for something that never ran');
});

test('#6714: a self-report from before liveness records existed counts as having run', () => {
  reset();
  agent('old', { ran: false });
  const sr = require('./selfreport');
  fs.mkdirSync(path.dirname(sr.fileFor('old')), { recursive: true });
  fs.writeFileSync(sr.fileFor('old'), '{}\n');
  assert.deepEqual(mac.survey().missing, ['old']);
});

test('#6714: a hidden notice leaves missing, is listed as hidden, and Repair of all skips it; Show brings it back', () => {
  reset();
  agent('brigitte');
  agent('marilyn');
  assert.deepEqual(register.hide('brigitte', { platform: 'darwin' }), { ok: true });
  let s = mac.survey();
  assert.deepEqual(s.missing, ['marilyn']);
  assert.deepEqual(s.hidden, ['brigitte']);
  assert.deepEqual(mac.repair().results.map((x) => x.name), ['marilyn'], 'Start them all at login started a hidden one');
  assert.deepEqual(register.show('brigitte'), { ok: true });
  s = mac.survey();
  assert.deepEqual(s.missing, ['brigitte']);
  assert.deepEqual(s.hidden, []);
});

test('#6714: only a name the notice shows can be hidden', () => {
  reset();
  agent('anna', { job: true });   // has a job: no notice
  agent('never', { ran: false }); // never ran: no notice
  for (const n of ['anna', 'never', 'nobody', '../etc']) {
    assert.equal(register.hide(n, { platform: 'darwin' }).ok, false, n + ' was hidden');
  }
  assert.ok(!fs.existsSync(path.join(store.ROOT, 'restart-notices-hidden.json')), 'a refused hide wrote the file');
});

test('#6714: an unreadable hidden list hides nothing', () => {
  reset();
  agent('brigitte');
  fs.writeFileSync(path.join(store.ROOT, 'restart-notices-hidden.json'), '{not json');
  assert.deepEqual(mac.survey().missing, ['brigitte']);
});

test('#6714: Start at login for one agent starts only that one, and refuses a name the notice does not offer', () => {
  reset();
  agent('brigitte');
  agent('marilyn');
  agent('anna', { job: true });
  const one = mac.repair({ only: 'marilyn' });
  assert.equal(one.ok, true);
  assert.deepEqual(one.results.map((x) => x.name), ['marilyn']);
  assert.ok(!fs.existsSync(create.plistPath('brigitte')), 'starting one started another');
  for (const n of ['anna', 'nobody']) assert.equal(mac.repair({ only: n }).ok, false, n + ' was repaired');
});

test('#6714 review 2: a hidden name whose agent now starts at login is forgotten, so a later loss shows the notice', () => {
  reset();
  agent('brigitte');
  assert.equal(register.hide('brigitte', { platform: 'darwin' }).ok, true);
  assert.deepEqual(mac.survey().hidden, ['brigitte']);
  // It gets its job: the next look forgets the hide.
  fs.mkdirSync(path.dirname(create.plistPath('brigitte')), { recursive: true });
  fs.writeFileSync(create.plistPath('brigitte'), '<plist/>', 'utf8');
  mac.survey();
  // It loses the job again: the notice is back, not silently closed.
  fs.rmSync(create.plistPath('brigitte'));
  const s = mac.survey();
  assert.deepEqual(s.missing, ['brigitte']);
  assert.deepEqual(s.hidden, []);
});

/* What this can show: forgetting reads the file afresh and drops only the stale name. The race itself (a hide landing
   between the survey's read and its write) cannot be staged in one synchronous call; forgetHidden's re-read is the fix. */
test('#6714 review 4: the survey forgets a name whose agent now starts at login and keeps the others', () => {
  reset();
  agent('anna', { job: true });
  agent('brigitte');
  fs.writeFileSync(path.join(store.ROOT, 'restart-notices-hidden.json'), JSON.stringify({ entries: [{ name: 'anna', group: 'missing' }] }));
  assert.equal(register.hide('brigitte', { platform: 'darwin' }).ok, true);
  const s = mac.survey();
  assert.deepEqual(s.hidden, ['brigitte']);
  const onDisk = JSON.parse(fs.readFileSync(path.join(store.ROOT, 'restart-notices-hidden.json'), 'utf8')).entries.map((e) => e.name);
  assert.deepEqual(onDisk, ['brigitte'], 'anna (now starting at login) should be forgotten and brigitte kept');
});

test('#6714 review 5: a hidden name no longer on the board at all is forgotten', () => {
  reset();
  agent('brigitte');
  fs.writeFileSync(path.join(store.ROOT, 'restart-notices-hidden.json'), JSON.stringify({ entries: [{ name: 'brigitte', group: 'missing' }, { name: 'gone', group: 'missing' }] }));
  mac.survey();
  const onDisk = JSON.parse(fs.readFileSync(path.join(store.ROOT, 'restart-notices-hidden.json'), 'utf8')).entries.map((e) => e.name);
  assert.deepEqual(onDisk, ['brigitte'], 'a name with no agent stayed hidden where Settings never shows it');
});

test('#6714 review 17: a closed "could not check" notice does not hide the "will not come back" one that follows', () => {
  reset();
  agent('brigitte');
  // Closed while it was the uncertain notice.
  fs.writeFileSync(path.join(store.ROOT, 'restart-notices-hidden.json'), JSON.stringify({ entries: [{ name: 'brigitte', group: 'unknown' }] }));
  const s = mac.survey();   // the survey now proves it has no job
  assert.deepEqual(s.missing, ['brigitte'], 'the certain warning was silenced by closing the uncertain one');
  assert.deepEqual(s.hidden, []);
  // CONTROL: closing the certain one does hide it.
  assert.equal(register.hide('brigitte', { platform: 'darwin' }).ok, true);
  assert.deepEqual(mac.survey().missing, []);
});

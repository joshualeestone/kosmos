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

function agent(name, { folder = true, job = false, profile = true } = {}) {
  if (profile) store.writeProfile(name, { role: 'helper' });
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
  fs.mkdirSync(path.join(SB, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(SB, 'bin', 'claude'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(SB, 'bin', 'tmux'), '#!/bin/sh\n', { mode: 0o755 });
}

test('an agent with a folder and no job is the thing being looked for', () => {
  reset();
  agent('anna', { job: true });
  agent('brigitte');
  agent('marilyn');
  const s = register.survey();
  assert.equal(s.ok, true);
  assert.deepEqual(s.missing, ['brigitte', 'marilyn']);
  /* ⚠️ THE ROW CARRIES BOTH NAMES. Act on `name`, speak `shownAs`: the panel
     printed the machine name and Josh read `ava, bob, brigitte` beside cards
     saying Ava, Brigitte and Scarlett. With no display name recorded, the two
     are the same string, which is the ordinary case and not a fallback. */
  assert.deepEqual(s.agents.find((x) => x.name === 'anna'),
    { name: 'anna', shownAs: 'anna', removed: false, folder: true, job: true, profile: true });
});

test('the roster comes from what Kosmos wrote, never from what is in the folder', () => {
  /* 🛑 `~/work/workers` IS A PLAIN DIRECTORY. On this fleet's own Mac it holds
     worker checkouts that are not Kosmos agents at all, and writing launchd
     jobs for whatever is sitting there would start strangers' processes at
     every login. The failure direction is to do nothing. */
  reset();
  fs.mkdirSync(path.join(SB, 'workers', 'somebody-elses-thing'), { recursive: true });
  assert.deepEqual(register.survey().missing, []);
});

test('a removed agent is not resurrected', () => {
  reset();
  agent('rick');
  fs.mkdirSync(store.ROOT, { recursive: true });
  fs.writeFileSync(path.join(store.ROOT, 'removed.json'), JSON.stringify([{ name: 'rick' }]), 'utf8');
  const s = register.survey();
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
  const s = register.survey();
  assert.equal(s.ok, false);
  assert.match(s.because, /removed/);
  assert.deepEqual(register.repair().results, [], 'a repair ran against a list we could not read');
});

test('a profile with no folder is reported and never acted on', () => {
  /* An agent whose folder is gone would get a job that fails every thirty
     seconds forever. It stays on the survey so it can be SEEN. */
  reset();
  agent('tom', { folder: false });
  const s = register.survey();
  assert.equal(s.agents.find((a) => a.name === 'tom').folder, false);
  assert.deepEqual(s.missing, []);
});

test('a name that is not a name is not turned into a path', () => {
  reset();
  fs.mkdirSync(store.PROFILES, { recursive: true });
  fs.writeFileSync(path.join(store.PROFILES, '...json'), '{}', 'utf8');
  assert.deepEqual(register.survey().agents.map((a) => a.name), []);
});

test('the repair writes the job, enables the label, and bootstraps it', () => {
  reset();
  agent('brigitte');
  const out = register.repair();
  assert.equal(out.ok, true);
  assert.equal(out.installed, 1);
  assert.equal(fs.existsSync(create.plistPath('brigitte')), true, 'no job was written');
  /* ⚠️ enable BEFORE bootstrap. `remove` sticks by writing a per-user disable
     override keyed on the LABEL, and it outlives the plist — so bootstrapping
     into a standing disable succeeds and starts nothing, which would report a
     repaired agent that never comes up. */
  const enable = CALLS.findIndex((c) => c.includes('enable'));
  const boot = CALLS.findIndex((c) => c.includes('bootstrap'));
  assert.ok(enable !== -1 && boot !== -1, 'launchctl was not asked at all');
  assert.ok(enable < boot, 'bootstrap ran before enable, so a disabled label starts nothing');
});

test('the model it last ran as goes into the job, and an unknown one is left out', () => {
  reset();
  agent('christina');
  agent('heather');
  register.repair({ modelFor: (n) => (n === 'christina' ? 'claude-opus-5' : null) });
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
  const r = register.repair().results[0];
  assert.match(r.guessed.model, /default/);
  assert.match(r.guessed.account, /main Claude account/);
  const kept = register.repair({ modelFor: () => 'claude-opus-5' });
  assert.deepEqual(kept.results, [], 'it repaired the same agent twice');
});

test('an existing job is never overwritten', () => {
  /* Somebody edited theirs by hand, or `remove` merely disabled it: removal
     deletes nothing. Rewriting from defaults we had to guess at would be the
     silent downgrade this module refuses everywhere else. */
  reset();
  agent('anna', { job: true });
  const r = create.installJob('anna');
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
  const r = register.repair().results[0];
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
  const r = create.installJob('dan');
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
  const s = register.survey();
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
  const row = register.survey().agents.find((x) => x.name === 'scarlett');
  assert.equal(row.shownAs, 'Scarlett');
  /* ⚠️ And the acting key is untouched: everything downstream of this builds a
     path, a launchd label and a tmux target out of it. */
  assert.equal(row.name, 'scarlett');
  assert.deepEqual(register.survey().missing, ['scarlett'], 'the list a repair acts on stopped being machine names');
  assert.equal(register.repair().results[0].shownAs, 'Scarlett', 'the report speaks the machine name');
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

  const s = register.survey();
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
  const r = register.repair();
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
  const s = register.survey();
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
  const s = register.survey();
  const names = s.agents.map((a) => a.name);
  assert.ok(names.includes('young-name'), 'the control stray is absent, so the later-tenant assert proves nothing');
  assert.ok(!names.includes('old-name'), 'a directory born after its only line was shown as that line\'s remains');
});

test('#500: an unreadable root reports the sweep failed rather than a confident absence', () => {
  reset();
  agent('solo');
  fs.chmodSync(path.join(SB, 'workers'), 0o000);
  try {
    const s = register.survey();
    assert.equal(s.ok, true, 'an unreadable stray root took the whole survey down');
    assert.equal(s.straySweepFailed, true, 'could-not-look was reported as found-nothing');
  } finally {
    fs.chmodSync(path.join(SB, 'workers'), 0o755);
  }
  const healthy = register.survey();
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
  const s = register.survey();
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
  register.repair();

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

  register.repair({ modelFor: () => null });

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
  const out = register.repair({ modelFor: () => null });
  const row = out.results.find((r) => r.name === 'corruptrepair');
  assert.ok(row, 'an agent with a corrupt profile was skipped rather than repaired');
  assert.ok(fs.existsSync(create.plistPath('corruptrepair')),
    'an unparseable profile left somebody\'s agent without a job');
  assert.doesNotMatch(fs.readFileSync(create.plistPath('corruptrepair'), 'utf8'),
    /<string>codex<\/string>/, 'a runner was invented from a profile that could not be read');
});

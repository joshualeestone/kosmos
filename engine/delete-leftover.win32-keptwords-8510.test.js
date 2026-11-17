'use strict';
/**
 * kosmos#8510: the clause that ends the task-only delete's sentences and Restore's (delete-leftover.startsAgainWords)
 * says what Start at login (register.repair) brings back. The account and the model are decided separately by the
 * repair: the model it was set to when that model is still offered, else the model it last ran; and the account by
 * the record's outcome, keeping the folder (out of reach, or its account could not be read or confirmed) or not. The
 * out-of-reach words once ran only when the model was still offered, so a kept folder out of reach whose model was
 * retired got "it starts on your main account", false once the folder comes back holding the same account.
 *
 * Here every outcome, with the model offered and retired, at unreadable counts 0, 1 and 2, has its words checked for
 * the facts they must state, and then (Windows only) the real repair is run on the same record and what it wrote is
 * checked against those same facts, so the sentence and the repair cannot disagree. The end-to-end case drives the
 * card's own path through the real task-only delete. Nothing here touches a real Scheduled Task: the repair writes to
 * jobfixture's stand-in Task Scheduler (win32job's runner seam, a task file per task in the sandbox).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'keptwords-8510-')));
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'agent workers 8510');   // spaces: every sentence is capped with them
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(SANDBOX, 'LaunchAgents', 'systemd', 'user');
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_TRASH = nodePath.join(SANDBOX, 'Trash');
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_CLAUDE_BIN = process.execPath;   // a runnable file: the repair checks the runner exists
fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_CONFIG, JSON.stringify({ projects: {} }));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const WORKERS = process.env.AGENT_WORKFORCE_WORKERS;
fs.mkdirSync(nodePath.join(WORKERS, 'neighbour8510'), { recursive: true });   // a computer with agents

const create = require('./create');
const remove = require('./remove');
const status = require('./status');
const store = require('./store');
const accounts = require('./accounts');
const win32job = require('./win32job');
const win32create = require('./win32create');
const register = require('./register');
const liveness = require('./liveness');
const leftover = require('./delete-leftover');
const jobfix = require('../test-support/jobfixture');

const WINDOWS_ONLY = { skip: process.platform !== 'win32' ? 'the stand-in Task Scheduler (jobfixture) is installed only on a Windows host' : false };

remove.setRunner(() => ({ ok: true, stdout: '' }));
leftover.setRunner((file, args) => {
  const script = args[args.length - 1];
  if (script === leftover.DRIVE_SCRIPT) {
    return { ok: true, stdout: JSON.stringify({ type: 'Fixed', total: 500 * 1024 ** 3, policy: false, nuke: 0, maxMB: 20000 }) + '\r\n' };
  }
  return { ok: true, stdout: '' };
});

const ACCOUNT = nodePath.join(SANDBOX, '.claude-second8510');
const OWNER = { emailAddress: 'owner@example.test', organizationUuid: 'org-8510' };
const OWNER_IDENTITY = { kind: 'signin', email: 'owner@example.test', keyTail: null, org: 'org-8510' };
const SET_MODEL = 'claude-opus-5-5';
const RETIRED_MODEL = 'claude-2.1';   // a Claude model no longer on the list (checked below), so not put back
const LAST_RAN = 'claude-haiku-4-5-20251001';
const modelFor = () => LAST_RAN;

const signIn = (dir, oauthAccount) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(accounts.configFile(dir), JSON.stringify(oauthAccount ? { oauthAccount } : { theme: 'dark' }));
  fs.mkdirSync(nodePath.join(SANDBOX, '.claude', 'projects'), { recursive: true });
  if (oauthAccount) accounts.share(dir);
};

const made = [];
const extraDirs = [];
/* An agent that has run here, with its folder in the workers folder and no startup task (the task-only delete removed
   it), so the survey offers Start at login; its profile records `win32Task`. */
function recordedAgent(name, win32Task) {
  made.push(name);
  store.writeProfile(name, { displayName: name, provider: 'anthropic', win32Task });
  fs.mkdirSync(nodePath.dirname(liveness.fileFor(name)), { recursive: true });
  fs.writeFileSync(liveness.fileFor(name), JSON.stringify({ at: new Date().toISOString(), state: 'idle' }));
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), 'work\n');
  return name;
}
function folder(tag, contents) {
  const dir = nodePath.join(SANDBOX, `.claude-${tag}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  extraDirs.push(dir);
  if (contents === 'torn') fs.writeFileSync(accounts.configFile(dir), '{"oauthAccount": {"emailAd');   // mid-write
  if (contents === 'other') fs.writeFileSync(accounts.configFile(dir), JSON.stringify({ oauthAccount: { emailAddress: 'someone-else@example.test' } }));
  // 'empty': no config and no key, so nothing shows whose account it is (could not confirm)
  return dir;
}
function writtenTask(name) {
  jobfix.jobPath(name);   // forgets what win32job remembered of the task
  const read = win32job.taskSpec(name);
  assert.equal(read.known && read.registered, true, 'no task was registered: ' + JSON.stringify(read));
  return { configDir: read.spec.configDir || null, model: read.spec.model || null };
}
function startAtLogin(name) {
  const s = register.survey({ platform: 'win32' });
  assert.ok(s.missing.includes(name), 'fixture: Start at login is not offered: ' + JSON.stringify(s));
  const out = register.repair({ platform: 'win32', only: name, modelFor });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.results[0].ok, true, JSON.stringify(out.results[0]));
}

/* Each outcome: the record that gives it, and what the repair does with the account. `account` is 'folder' (the task
   is written on the recorded folder), 'main' (the main account, nothing kept), 'kept' (the main account now, the
   folder kept in the record to try again) or 'drop' (the main account; this start is the last that keeps it). */
const OUTCOMES = {
  same: { why: null, account: 'folder', rec: () => ({ configDir: ACCOUNT, account: OWNER_IDENTITY }) },
  sameMain: { why: null, account: 'mainAsBefore', rec: () => ({ configDir: null, account: null }) },
  changed: { why: 'changed', account: 'main', rec: () => ({ configDir: folder('changed', 'other'), account: OWNER_IDENTITY }) },
  unusable: { why: 'unusable', account: 'main', rec: () => ({ configDir: 42, account: OWNER_IDENTITY }) },
  unverifiable: { why: 'unverifiable', account: 'main', rec: () => ({ configDir: ACCOUNT, account: null }) },
  removed: { why: 'removed', account: 'main', rec: () => ({ configDir: null, account: null, accountRemoved: true }) },
  missing: { why: 'missing', account: 'main', rec: () => ({ configDir: null, account: null, accountRemoved: true, why: 'missing' }) },
  couldNotRead: { why: 'unreadable', reason: 'read', account: 'kept', rec: () => ({ configDir: folder('torn', 'torn'), account: OWNER_IDENTITY }) },
  couldNotConfirm: { why: 'unreadable', reason: 'confirm', account: 'kept', rec: () => ({ configDir: folder('empty', 'empty'), account: OWNER_IDENTITY }) },
  outOfReach: { why: 'unreachable', account: 'kept', rec: () => ({ configDir: nodePath.join(SANDBOX, 'not-connected-8510', '.claude-away'), account: OWNER_IDENTITY }) },
};
const COUNTS = [0, 1, 2];
const MODELS = { offered: SET_MODEL, retired: RETIRED_MODEL };

/* The record for one combination. A count is carried only by a folder repair kept before (`kept`), as the engine
   writes it; at count 2 a folder that still cannot be read or confirmed is the last start before the drop. */
function recordFor(outcome, count, model) {
  const base = OUTCOMES[outcome].rec();
  return { runner: 'claude', model, ...base, ...(count > 0 ? { kept: true, unreadable: count } : base.configDir ? { kept: true } : {}) };
}
function expectedAccount(outcome, count) {
  const o = OUTCOMES[outcome];
  if (o.why === 'unreadable' && count >= 2) return 'drop';
  return o.account;
}
const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;
/* Every sentence a person reads here, the caller's included (a path counts as its words, spaces and all). */
const SENTENCE_MAX_WORDS = 30;
/* The whole clause after "offers it": the longest (out of reach, model retired) is 110 words, so this leaves
   room for one short sentence and stops it growing back toward the 169 it once was. */
const CLAUSE_MAX_WORDS = 120;
const sentencesOf = (text) => text.replace(/^\. /, '').split(/(?<=\.)\s+(?=[A-Z])/).filter(Boolean);
function assertShortSentences(text, label) {
  for (const sentence of sentencesOf(text)) {
    assert.ok(wordCount(sentence) <= SENTENCE_MAX_WORDS, `${label}\na sentence of ${wordCount(sentence)} words: ${sentence}`);
  }
}

/* The facts the words must state for one combination, asserted piece by piece so the wording can still be polished.
   They describe THIS Start at login only: after it the agent has a startup job, Start at login is not offered again,
   and nothing moves it to another account on its own, so no later Start at login may be promised. */
function assertWords(words, { outcome, count, modelKey }) {
  const label = `${outcome} / model ${modelKey} / count ${count}: ${words}`;
  const account = expectedAccount(outcome, count);
  const kept = account === 'kept' || account === 'drop';
  assert.ok(words.startsWith('. It starts on '), label);   // its own sentences, after the caller's
  assert.ok(words.endsWith('.'), label);
  assertShortSentences(words, label);
  assert.ok(wordCount(words.slice(2)) <= CLAUSE_MAX_WORDS, `${label}\n${wordCount(words.slice(2))} words`);
  assert.doesNotMatch(words, /written again|\(|until|tries (it|that folder) again|later Start at login|for good|keeps that folder|forget/, `${label}\npromises a later Start at login`);
  // The model, decided on its own by the repair.
  if (modelKey === 'offered') {
    assert.match(words, /model it was set to/, label);
    assert.doesNotMatch(words, /model it last ran|choose (it|its model) again/, label);
  } else {
    assert.match(words, /the model it last ran, as the model it was set to is not offered now/, label);
    if (kept) {
      // Round 4: no order is asked (model then account ends in the same task), and nothing is waited for.
      assert.match(words, / Choose its model again if it used another\.$/, label);
      assert.doesNotMatch(words, /right account|account first|once it is/, label);
    } else {
      assert.match(words, /Choose its (account and )?model again/, label);
    }
  }
  if (account === 'folder') {
    // kosmos#8584: a folder is read again at Start at login, so "if", with the main account as the other way.
    assert.match(words, modelKey === 'offered'
      ? /It starts on the model it was set to\. It starts on the account it was set to only if Kosmos finds that same account in its account folder at Start at login\. Otherwise it starts on your main account; choose its account again if it should use another\./
      : /It starts on the model it last ran, as the model it was set to is not offered now\. It starts on the account it was set to only if Kosmos finds that same account in its account folder at Start at login\. Otherwise it starts on your main account; choose its account again if it should use another\. Choose its model again if it used another\./, label);
    assert.doesNotMatch(words, /because /, label);
  } else if (account === 'mainAsBefore') {
    assert.match(words, modelKey === 'offered' ? /account and model it was set to before/ : /starts on your main account, as before/, label);
  } else if (account === 'main') {
    if (outcome === 'changed') {
      /* Round 6/7: read again, live, at Start at login, so the main account is never said flatly ("only if"). */
      assert.match(words, /The account in the folder it used has signed out or changed\. It starts on that folder's account only if that same account is signed in there again before you use Start at login\. Otherwise it starts on your main account/, label);
      assert.doesNotMatch(words, /because /, label);
      // kosmos#8584: with a retired model the advice is its own last sentence, true whichever account it lands on.
      if (modelKey !== 'offered') assert.match(words, /if it should use another\. Choose its model again if it used another\.$/, label);
    } else {
      // Fixed in the record (unusable included: win32AccountThere's refusals do not change), so said flatly.
      assert.match(words, /on your main account, because /, label);
      assert.doesNotMatch(words, /only if|unless/, label);
    }
    assert.match(words, /[Cc]hoose its account( and model)? again/, label);
  } else {
    // This Start at login: that folder only if it can be used then, else the main account, and what to do about it.
    assert.match(words, /It starts on that folder's account only if Kosmos can (reach the folder then and it holds the same account|confirm that at Start at login|read that account at Start at login and it is the same one)\./, label);
    assert.match(words, /Otherwise it starts on your main account; choose its account again/, label);
    if (outcome === 'outOfReach') {
      assert.match(words, /Kosmos cannot reach the account folder it last used right now\. If that folder is on a disk or shared folder that is not connected, connect it before you use Start at login\./, label);
      assert.match(words, /choose its account again once that folder is back, or another account if it is gone\./, label);
    } else {
      assert.match(words, OUTCOMES[outcome].reason === 'confirm' ? /could not confirm that the account folder it last used still holds the same account/ : /could not read which account is in the account folder it last used/, label);
    }
    if (account === 'drop') assert.match(words, /two earlier Start at logins/, label);
    else assert.doesNotMatch(words, /earlier Start at logins/, label);
  }
}


test.before(() => {
  win32create.setPark(() => {});
  create.setRunner(() => ({ ok: true }));
  create.setDryRun(false);
});
test.after(() => {
  create.setRunner(null);
  win32create.setPark(null);
  win32job.setRunner(null);
  win32job.setAnchorer(null);
});
test.beforeEach(() => {
  status.setPaneSource(() => '');
  signIn(ACCOUNT, OWNER);
});
test.afterEach(() => {
  status.setPaneSource(null);
  for (const n of made.splice(0)) {
    try { fs.rmSync(jobfix.jobPath(n), { force: true }); } catch { /* none */ }
    fs.rmSync(store.profilePath(n), { force: true });
    fs.rmSync(liveness.fileFor(n), { force: true });
    fs.rmSync(nodePath.join(WORKERS, n), { recursive: true, force: true });
  }
  for (const d of extraDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  fs.rmSync(ACCOUNT, { recursive: true, force: true });
  fs.rmSync(ACCOUNT + '-unplugged', { recursive: true, force: true });
});

test('kosmos#8510: fixture: each record gives the outcome it is named for, and the retired model is not offered', () => {
  for (const [outcome, o] of Object.entries(OUTCOMES)) {
    for (const count of COUNTS) {
      for (const [modelKey, model] of Object.entries(MODELS)) {
        const name = recordedAgent(`fx-${outcome}-${count}-${modelKey}`.toLowerCase(), recordFor(outcome, count, model));
        const rec = create.win32RecordedTask(name);
        const wantWhy = o.why === 'unreadable' && count >= 2 ? 'unreadableGaveUp' : o.why;
        assert.equal(rec.accountGone || rec.accountWhy, wantWhy, `${name}: ${JSON.stringify(rec)}`);
        if (o.reason) assert.equal(rec.unreadableReason, o.reason, name);
        assert.equal(rec.modelOk, modelKey === 'offered', `${name}: modelOk`);
      }
    }
  }
});

test('kosmos#8510: the words for every outcome, model offered or retired, at counts 0, 1 and 2 state the facts the repair acts on', () => {
  for (const outcome of Object.keys(OUTCOMES)) {
    for (const count of COUNTS) {
      for (const [modelKey, model] of Object.entries(MODELS)) {
        const name = recordedAgent(`w-${outcome}-${count}-${modelKey}`.toLowerCase(), recordFor(outcome, count, model));
        assertWords(leftover.startsAgainWords(name), { outcome, count, modelKey });
      }
    }
  }
});

test('kosmos#8510: for every outcome, model and count, what Start at login writes is what the words said, and Start at login is not offered again', WINDOWS_ONLY, () => {
  for (const outcome of Object.keys(OUTCOMES)) {
    for (const count of COUNTS) {
      for (const [modelKey, model] of Object.entries(MODELS)) {
        const name = recordedAgent(`r-${outcome}-${count}-${modelKey}`.toLowerCase(), recordFor(outcome, count, model));
        const words = leftover.startsAgainWords(name);
        assertWords(words, { outcome, count, modelKey });
        startAtLogin(name);
        const label = `${name}: ${words}`;
        const task = writtenTask(name);
        assert.equal(task.model, modelKey === 'offered' ? SET_MODEL : LAST_RAN, `${label}\nthe model the repair wrote`);
        if (expectedAccount(outcome, count) === 'folder') assert.equal(task.configDir, ACCOUNT, label);
        else assert.equal(task.configDir, null, `${label}\nthe repair wrote a folder the words said it would not`);
        // The words promise nothing after this Start at login, because nothing comes: it is not offered again.
        assert.equal(register.survey({ platform: 'win32' }).missing.includes(name), false, `${label}\nStart at login is still offered`);
      }
    }
  }
});

/* An agent set up the way a person does it: its task on ACCOUNT running `model`, then ACCOUNT chosen for it (so the
   record holds whose account that is). */
function agentOnAccount(name, model) {
  made.push(name);
  store.writeProfile(name, { displayName: name, provider: 'anthropic' });
  fs.mkdirSync(nodePath.dirname(liveness.fileFor(name)), { recursive: true });
  fs.writeFileSync(liveness.fileFor(name), JSON.stringify({ at: new Date().toISOString(), state: 'idle' }));
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(nodePath.join(create.workerDir(name), 'CLAUDE.md'), 'work\n');
  fs.writeFileSync(jobfix.jobPath(name), jobfix.jobFor(name, process.execPath, null, model, ACCOUNT, 'claude'));
  const moved = create.setAccount(name, ACCOUNT, { platform: 'win32' });
  assert.equal(moved.outcome, create.OUTCOME.CREATED, 'fixture: ' + JSON.stringify(moved));
  assert.deepEqual(store.readProfile(name).win32Task, { runner: 'claude', configDir: ACCOUNT, model, account: OWNER_IDENTITY }, 'fixture: the record');
  return name;
}
/* The real task-only delete (its folder away, so the name is a task-only leftover). Every sentence of the plan's words
   and the outcome's is checked against the cap, the caller's own included, with a workers folder whose path has
   spaces in it. */
function taskOnlyDelete(name) {
  const away = nodePath.join(SANDBOX, name + '-away');
  fs.renameSync(create.workerDir(name), away);
  let plan; let done;
  try {
    plan = leftover.plan(name, { platform: 'win32' });
    assert.equal(plan.ok && plan.taskOnly, true, 'fixture: not the task-only delete: ' + JSON.stringify(plan));
    done = leftover.del(name, { platform: 'win32' });
    assert.equal(done.outcome, leftover.OUTCOME.DELETED, JSON.stringify(done));
  } finally { fs.renameSync(away, create.workerDir(name)); }
  for (const words of [plan.reassurance, done.said]) {
    assert.ok(words.includes(WORKERS + nodePath.sep + name), 'fixture: the path with spaces is not in the words: ' + words);
    assert.match(words, /Then use Start at login when Kosmos offers it\. It starts on /, 'the words did not start a sentence of their own');
    assertShortSentences(words, words);
  }
  return [plan.reassurance, done.said];
}
const unplugged = ACCOUNT + '-unplugged';
const offered = (name) => register.survey({ platform: 'win32' }).missing.includes(name);

test('kosmos#8510: out of reach with a retired model, connected before Start at login: on that folder, as the words said', WINDOWS_ONLY, () => {
  const name = agentOnAccount('reach8510', RETIRED_MODEL);
  fs.renameSync(ACCOUNT, unplugged);   // the disk with ACCOUNT is not connected
  for (const words of taskOnlyDelete(name)) {
    assert.match(words, /Kosmos cannot reach the account folder it last used right now\. If that folder is on a disk or shared folder that is not connected, connect it before you use Start at login\./);
    assert.doesNotMatch(words, /it starts on your main account and the model it last ran/i, 'the words promised the main account outright');
  }
  fs.renameSync(unplugged, ACCOUNT);   // connected, still signed in to the same account, before Start at login
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: LAST_RAN }, 'Start at login did not do what the words said');
});

test('kosmos#8510: out of reach with a retired model, still not connected at Start at login: the main account, not offered again, nothing moves it back when the folder returns; choosing its account and then its model does what the words said', WINDOWS_ONLY, () => {
  const name = agentOnAccount('stillaway8510', RETIRED_MODEL);
  fs.renameSync(ACCOUNT, unplugged);
  const [words] = taskOnlyDelete(name);
  assert.match(words, /Otherwise it starts on your main account; choose its account again once that folder is back, or another account if it is gone\./);
  assert.match(words, /Choose its model again if it used another\./);
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: null, model: LAST_RAN });
  assert.equal(offered(name), false, 'Start at login is offered again, so the words could have promised it');
  // The folder comes back: nothing moves the agent on its own, and Start at login is still not offered.
  fs.renameSync(unplugged, ACCOUNT);
  assert.equal(offered(name), false);
  assert.deepEqual(writtenTask(name), { configDir: null, model: LAST_RAN }, 'the agent moved on its own');
  // What the words say to do: its account again, then its model.
  assert.equal(create.setAccount(name, ACCOUNT, { platform: 'win32' }).outcome, create.OUTCOME.CREATED);
  assert.equal(create.setModel(name, 'opus55', { platform: 'win32' }).outcome, create.OUTCOME.CREATED);
  assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: SET_MODEL }, 'the account then the model did not leave it on both');
});

test('kosmos#8510: a folder whose config could not be read, readable again by Start at login: on that folder, as the words said', WINDOWS_ONLY, () => {
  const name = agentOnAccount('readable8510', RETIRED_MODEL);
  const config = accounts.configFile(ACCOUNT);
  const whole = fs.readFileSync(config, 'utf8');
  fs.writeFileSync(config, whole.slice(0, 10));   // Claude Code writing it at that moment
  for (const words of taskOnlyDelete(name)) {
    assert.match(words, /It starts on that folder's account only if Kosmos can read that account at Start at login and it is the same one\./);
  }
  fs.writeFileSync(config, whole);
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: LAST_RAN });
});

test('kosmos#8510: a folder out of reach that comes back holding another account: the main account, as the words said', WINDOWS_ONLY, () => {
  const name = agentOnAccount('another8510', SET_MODEL);
  fs.renameSync(ACCOUNT, unplugged);
  for (const words of taskOnlyDelete(name)) {
    assert.match(words, /only if Kosmos can reach the folder then and it holds the same account\. Otherwise it starts on your main account/);
  }
  fs.renameSync(unplugged, ACCOUNT);
  signIn(ACCOUNT, { emailAddress: 'someone-else@example.test', organizationUuid: 'org-other' });
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL });
  assert.equal(offered(name), false);
});

test('kosmos#8510: a folder that could not be read and then goes away before Start at login: the main account, as the words said', WINDOWS_ONLY, () => {
  const name = agentOnAccount('goesaway8510', SET_MODEL);
  fs.writeFileSync(accounts.configFile(ACCOUNT), '{"oauthAccount": {"emailAd');
  for (const words of taskOnlyDelete(name)) {
    assert.match(words, /only if Kosmos can read that account at Start at login and it is the same one\. Otherwise it starts on your main account/);
  }
  fs.renameSync(ACCOUNT, unplugged);   // the disk is unplugged before the person uses Start at login
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL });
  assert.equal(offered(name), false);
});

test('kosmos#8510 round 5: an outcome the words do not know gets the neutral sentence, never the kept-folder words', () => {
  const create = require('./create');
  const real = create.win32RecordedTask;
  try {
    for (const modelOk of [true, false]) {
      create.win32RecordedTask = () => ({ accountOk: false, accountRemoved: false, accountWhy: 'notYetKnown8510', modelOk });
      const words = leftover.startsAgainWords('unknown-why-8510');
      assert.match(words, /^\. It starts on your main account and /, words);
      assert.doesNotMatch(words, /only if|cannot reach|could not (read|confirm)|that folder/, words);
      assert.match(words, modelOk ? /the model it was set to\. Choose its account again if it should use another\.$/
        : /the model it last ran, as the model it was set to is not offered now\. Choose its account and model again if it used others\.$/, words);
    }
    // CONTROL: the same stub with a kept outcome does give the kept-folder words, so the check above can fail.
    create.win32RecordedTask = () => ({ accountOk: false, accountRemoved: false, accountWhy: 'unreachable', modelOk: true });
    assert.match(leftover.startsAgainWords('unknown-why-8510'), /cannot reach the account folder it last used/);
  } finally {
    create.win32RecordedTask = real;
  }
});

test('kosmos#8510 round 6: a folder holding another account, the same account signed in again before Start at login: on that folder, as the words allowed', WINDOWS_ONLY, () => {
  const name = agentOnAccount('signback8510', SET_MODEL);
  try {
    signIn(ACCOUNT, { emailAddress: 'someone-else@example.test', organizationUuid: 'org-other' });
    for (const words of taskOnlyDelete(name)) {
      assert.match(words, /The account in the folder it used has signed out or changed\. It starts on that folder's account only if that same account is signed in there again before you use Start at login\. Otherwise it starts on your main account/);
      assert.doesNotMatch(words, /but on your main account, because /, 'the main account was said as a flat fact');
    }
    signIn(ACCOUNT, OWNER);   // the person signs the same account back in
    startAtLogin(name);
    // The reason for "unless": the repair reads the account again and writes the task on that folder.
    assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: SET_MODEL });
  } finally {
    signIn(ACCOUNT, OWNER);
  }
});

/* kosmos#8584 review 1: the reverse of the test above. The words for a folder that is fine at the delete say "only if
   Kosmos finds that same account in its account folder at Start at login. Otherwise it starts on your main account".
   Signed out in between, Start at login writes
   the main account (and the model it was set to), as the words said, and is not offered again. */
test('kosmos#8584: a folder fine at the delete, signed out before Start at login: the main account, as the words said', WINDOWS_ONLY, () => {
  const name = agentOnAccount('signout8584', SET_MODEL);
  try {
    for (const words of taskOnlyDelete(name)) {
      assert.match(words, /It starts on the model it was set to\. It starts on the account it was set to only if Kosmos finds that same account in its account folder at Start at login\. Otherwise it starts on your main account; choose its account again if it should use another\./);
    }
    signIn(ACCOUNT, { emailAddress: 'someone-else@example.test', organizationUuid: 'org-other' });   // signed out, another in
    startAtLogin(name);
    assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL });
    assert.equal(offered(name), false, 'Start at login is offered again, so the advice to choose its account would be wrong');
  } finally {
    signIn(ACCOUNT, OWNER);
  }
});

/* kosmos#8584 review 2: the SAME account still signed in, yet Start at login writes the main account: the folder is out
   of reach (a disk not connected), or its config cannot be read at that moment (being written). This is why the words
   say "only if Kosmos finds that same account in its account folder", never a plain "if it is still signed in". */
test('kosmos#8584 review 2: a folder fine at the delete, out of reach at Start at login: the main account, as the words said', WINDOWS_ONLY, () => {
  const name = agentOnAccount('away8584', SET_MODEL);
  let moved = false;
  try {
    for (const words of taskOnlyDelete(name)) assert.match(words, /only if Kosmos finds that same account in its account folder at Start at login\./);
    fs.renameSync(ACCOUNT, unplugged);   // the account is still signed in there, but the disk is not connected
    moved = true;
    startAtLogin(name);
    assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL });
  } finally {
    if (moved) fs.renameSync(unplugged, ACCOUNT);
  }
});

test('kosmos#8584 review 2: a folder fine at the delete, its config mid-write at Start at login: the main account, as the words said', WINDOWS_ONLY, () => {
  const name = agentOnAccount('midwrite8584', SET_MODEL);
  const config = accounts.configFile(ACCOUNT);
  const whole = fs.readFileSync(config, 'utf8');
  try {
    for (const words of taskOnlyDelete(name)) assert.match(words, /only if Kosmos finds that same account in its account folder at Start at login\./);
    fs.writeFileSync(config, whole.slice(0, 10));   // the same account, its config being written at that moment
    startAtLogin(name);
    assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL });
  } finally {
    fs.writeFileSync(config, whole);
  }
});

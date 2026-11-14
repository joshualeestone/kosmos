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
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
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
const NUMBER = { 3: 'three', 2: 'two' };
/* The whole kept-folder clause, longest case (out of reach, model retired) about 136 words: a cap so it cannot grow
   back toward the 169 it once was, with room for one more short sentence. */
const KEPT_CLAUSE_MAX_WORDS = 145;
const SENTENCE_MAX_WORDS = 30;
const sentencesOf = (text) => text.replace(/^[.;] /, '').split(/(?<=\.)\s+/).filter(Boolean);

/* The facts a sentence must state for one combination, asserted piece by piece so the wording can still be polished. */
function assertWords(words, { outcome, count, modelKey }) {
  const label = `${outcome} / model ${modelKey} / count ${count}: ${words}`;
  const account = expectedAccount(outcome, count);
  const kept = account === 'kept' || account === 'drop';
  // A kept folder's words start a sentence of their own, so the caller's sentence is not stretched past the cap.
  assert.ok(words.startsWith(kept ? '. It starts on ' : '; it starts on '), label);
  assert.ok(words.endsWith('.'), label);
  // The model, decided on its own by the repair.
  if (modelKey === 'offered') {
    assert.match(words, /model it was set to/, label);
    assert.doesNotMatch(words, /model it last ran|choose it again/, label);
  } else {
    assert.match(words, /model it last ran/, label);
    assert.doesNotMatch(words, /model it was set to(?! is no longer offered)/, label);
    if (kept) {
      /* A model change forgets a kept folder, so the words say to choose the model again only once that no longer
         matters (never merely "on another account", which it already is while the folder is kept), and say it last. */
      assert.match(words, / If it used another model, choose it again only once it is back on that folder, is on your main account for good, or has its account chosen again\.$/, label);
      assert.doesNotMatch(words, /choose its model again|moved to another account/, label);
    } else {
      assert.match(words, /[Cc]hoose its (account and )?model again/, label);
    }
  }
  if (account === 'folder') {
    assert.match(words, modelKey === 'offered' ? /account and model it was set to before/ : /account it was set to/, label);
    assert.doesNotMatch(words, /main account/, label);
  } else if (account === 'mainAsBefore') {
    assert.match(words, modelKey === 'offered' ? /account and model it was set to before/ : /main account, as before/, label);
  } else if (account === 'main') {
    assert.match(words, /main account/, label);
    assert.match(words, /[Cc]hoose its account( and model)? again/, label);
    assert.doesNotMatch(words, /keeps that folder|forget that folder|until a Start at login/, label);
  }
  if (kept) {
    assert.match(words, OUTCOMES[outcome].reason === 'confirm' ? /could not confirm/ : outcome === 'outOfReach' ? /Kosmos cannot reach the account folder it used right now\./ : /could not read which account/, label);
    // Every rewrite forgets the folder (said once, with the setters named).
    assert.match(words, /Changing this agent's account or model, or anything else that sets up its startup job again, makes Kosmos forget that folder\./, label);
    assert.doesNotMatch(words, /forgets it\b|main account and the model it last ran/, label);
  }
  if (account === 'kept') {
    // Main account now, the folder again at a later Start at login holding the same account, and how the keeping ends.
    assert.match(words, /It runs on your main account until a Start at login (finds that folder again, holding the same account|reads the same account there|confirms that)\./, label);
    const left = 3 - count;
    assert.match(words, new RegExp(`Another account in that folder moves it to your main account for good, as ${left === 1 ? 'does the next Start at login that reaches that folder'
      : `do ${NUMBER[left]} ${count > 0 ? 'more ' : ''}Start at logins that reach that folder`} without confirming the account in it\\.`), label);
    if (outcome === 'outOfReach') {
      assert.match(words, /If that folder is on a disk or shared folder that is not connected, connect it, or else choose its account again\./, label);
    }
  } else if (account === 'drop') {
    assert.match(words, /two earlier Start at logins/, label);
    assert.match(words, /Unless the next Start at login that reaches that folder (reads|confirms) the same account there, it stays on your main account for good\./, label);
    // A start that cannot reach the folder keeps it, so the drop is not "the next Start at login" whatever happens.
    assert.match(words, /Kosmos keeps that folder until then\./, label);
    assert.match(words, /Choose its account again if it should use another\./, label);
  }
  if (kept) {
    // Plain: short sentences, a capped whole, and no engine wording.
    for (const sentence of sentencesOf(words)) {
      assert.ok(wordCount(sentence) <= SENTENCE_MAX_WORDS, `${label}\na sentence of ${wordCount(sentence)} words: ${sentence}`);
    }
    assert.ok(wordCount(words.slice(2)) <= KEPT_CLAUSE_MAX_WORDS, `${label}\n${wordCount(words.slice(2))} words`);
    assert.doesNotMatch(words, /written again|\(/, label);
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
        const wantWhy = o.why === 'unreadable' && count >= 2 ? 'unreadableGaveUp' : o.why === 'missing' || o.why === 'removed' ? o.why : o.why;
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

test('kosmos#8510: for every outcome, model and count, what Start at login writes is what the words said', WINDOWS_ONLY, () => {
  for (const outcome of Object.keys(OUTCOMES)) {
    for (const count of COUNTS) {
      for (const [modelKey, model] of Object.entries(MODELS)) {
        const name = recordedAgent(`r-${outcome}-${count}-${modelKey}`.toLowerCase(), recordFor(outcome, count, model));
        const words = leftover.startsAgainWords(name);
        assertWords(words, { outcome, count, modelKey });
        const before = store.readProfile(name).win32Task;
        startAtLogin(name);
        const label = `${name}: ${words}`;
        const task = writtenTask(name);
        const after = store.readProfile(name).win32Task;
        assert.equal(task.model, modelKey === 'offered' ? SET_MODEL : LAST_RAN, `${label}\nthe model the repair wrote`);
        const account = expectedAccount(outcome, count);
        if (account === 'folder') assert.equal(task.configDir, ACCOUNT, label);
        else assert.equal(task.configDir, null, `${label}\nthe repair wrote a folder the words said it would not`);
        if (account === 'kept') {
          assert.equal(after.configDir, before.configDir, `${label}\nthe words said the folder is kept, the repair dropped it`);
          assert.equal(after.kept, true, label);
          const counted = outcome === 'outOfReach' ? count : count + 1;   // a start out of reach neither adds nor clears
          assert.equal(after.unreadable || 0, counted, `${label}\nthe count the next words read`);
        } else {
          assert.notEqual(after.kept, true, `${label}\nthe repair kept a folder the words did not mention`);
        }
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
/* The real task-only delete (its folder away, so the name is a task-only leftover): the plan's words and the outcome's,
   each checked sentence by sentence against the cap, the caller's own sentence included. */
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
    assert.match(words, /Start at login when Kosmos offers it\. It starts on the model /, 'the kept words did not start a sentence of their own');
    for (const sentence of sentencesOf(words)) {
      assert.ok(wordCount(sentence) <= SENTENCE_MAX_WORDS, `a sentence the person sees has ${wordCount(sentence)} words: ${sentence}`);
    }
  }
  return [plan.reassurance, done.said];
}
const unplugged = ACCOUNT + '-unplugged';

test('kosmos#8510: a kept folder out of reach with a retired model: the words say the model it last ran and the kept folder, and when the folder is back with the same account Start at login writes the task on it', WINDOWS_ONLY, () => {
  const name = agentOnAccount('reach8510', RETIRED_MODEL);
  fs.renameSync(ACCOUNT, unplugged);   // the disk with ACCOUNT is not connected
  for (const words of taskOnlyDelete(name)) {
    assert.match(words, /It starts on the model it last ran\. Kosmos cannot reach the account folder it used right now\./);
    assert.match(words, /It runs on your main account until a Start at login finds that folder again, holding the same account\./);
    assert.match(words, /as do three Start at logins that reach that folder without confirming the account in it\./);
    assert.match(words, /If it used another model, choose it again only once it is back on that folder/);
    assert.doesNotMatch(words, /it starts on your main account and the model it last ran/i, 'the words promised the main account outright');
  }
  // The disk is connected again, still signed in to the same account, before the person uses Start at login.
  fs.renameSync(unplugged, ACCOUNT);
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: LAST_RAN }, 'Start at login did not do what the words said');
});

test('kosmos#8510: a folder whose config could not be read, readable again by Start at login: back on that folder, as the words said', WINDOWS_ONLY, () => {
  const name = agentOnAccount('readable8510', RETIRED_MODEL);
  const config = accounts.configFile(ACCOUNT);
  const whole = fs.readFileSync(config, 'utf8');
  fs.writeFileSync(config, whole.slice(0, 10));   // Claude Code writing it at that moment
  for (const words of taskOnlyDelete(name)) {
    assert.match(words, /It runs on your main account until a Start at login reads the same account there\./);
  }
  fs.writeFileSync(config, whole);
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: ACCOUNT, model: LAST_RAN });
});

test('kosmos#8510: a folder out of reach that comes back holding another account: your main account for good, as the words said', WINDOWS_ONLY, () => {
  const name = agentOnAccount('another8510', SET_MODEL);
  fs.renameSync(ACCOUNT, unplugged);
  for (const words of taskOnlyDelete(name)) {
    assert.match(words, /Another account in that folder moves it to your main account for good/);
  }
  fs.renameSync(unplugged, ACCOUNT);
  signIn(ACCOUNT, { emailAddress: 'someone-else@example.test', organizationUuid: 'org-other' });
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL });
  const rec = store.readProfile(name).win32Task;
  assert.equal(rec.configDir, null, 'the folder holding another account was kept: ' + JSON.stringify(rec));
  assert.notEqual(rec.kept, true);
});

test('kosmos#8510: a folder that could not be read and then goes away before Start at login: kept, the count unchanged, and the next words are the out-of-reach ones', WINDOWS_ONLY, () => {
  const name = agentOnAccount('goesaway8510', SET_MODEL);
  const config = accounts.configFile(ACCOUNT);
  fs.writeFileSync(config, '{"oauthAccount": {"emailAd');
  taskOnlyDelete(name);
  fs.renameSync(ACCOUNT, unplugged);   // the disk is unplugged before the person uses Start at login
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: null, model: SET_MODEL });
  const rec = store.readProfile(name).win32Task;
  assert.equal(rec.configDir, ACCOUNT, 'a folder out of reach was not kept');
  assert.equal(rec.kept, true);
  assert.equal(rec.unreadable, undefined, 'a start that could not reach the folder changed the count');
  fs.rmSync(jobfix.jobPath(name), { force: true });   // its startup job removed again
  assertWords(leftover.startsAgainWords(name), { outcome: 'outOfReach', count: 0, modelKey: 'offered' });
});

test('kosmos#8510: the same, with the folder still out of reach at Start at login: the main account now, the folder kept, and the words that follow are the same kept-folder words', WINDOWS_ONLY, () => {
  const name = recordedAgent('stillaway8510', recordFor('outOfReach', 0, RETIRED_MODEL));
  startAtLogin(name);
  assert.deepEqual(writtenTask(name), { configDir: null, model: LAST_RAN });
  const rec = store.readProfile(name).win32Task;
  assert.equal(rec.kept, true);
  assert.ok(rec.configDir && rec.configDir.endsWith('.claude-away'), JSON.stringify(rec));
  // The task now runs the model it last ran, which is offered, so the next words say the model it was set to.
  fs.rmSync(jobfix.jobPath(name), { force: true });
  assertWords(leftover.startsAgainWords(name), { outcome: 'outOfReach', count: 0, modelKey: 'offered' });
});

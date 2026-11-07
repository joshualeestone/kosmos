'use strict';
/**
 * kosmos#8177: on Windows, Remove must not take a case variant of an agent's name as that agent.
 *
 * Task Scheduler ignores letter case, so `schtasks /Query /TN Kosmos\agent-Cai` answers with `cai`'s task. `jobFor`
 * counted that as a job for `Cai`, so `plan('Cai')` answered ok under a name with no task of its own, and a removal
 * recorded `Cai` as removed while `cai` kept running (the false success #8112 fixes on the Mac, here for every agent).
 *
 * The fake schtasks below answers the way Task Scheduler is REASONED to (not yet measured on a Windows box): a query in
 * any letter case finds the one task, and the answer names it in the task's own stored spelling. If a real Windows
 * echoed the query's spelling instead, the fix would not apply (and nothing would break); #8177 stays open until that is
 * measured. Run from a Mac, like remove.win32-job-570.test.js, through the win32 arm.
 *
 *   node --test engine/remove.win32-case-8177.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Sandbox every root before requiring: this module stops agents.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-case-8177-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const remove = require('./remove');
const job = require('./win32job');
const status = require('./status');

const WIN = 'win32';

/* A Task Scheduler holding one task, `real`'s, found by a query in any letter case. `shape` is the line the answer
   names it on (English, German, or none at all). */
function taskSchedulerWith(real, shape, folder) {
  const asked = [];
  const tn = job.taskName(real);
  const shown = folder ? folder + tn.slice(tn.indexOf('\\')) : tn;   // the folder as Task Scheduler stores it
  job.setRunner((args) => {
    asked.push(args.join(' '));
    if (args[0] !== '/Query') return { ok: true, out: '' };
    const at = args.indexOf('/TN');
    if (at < 0 || String(args[at + 1]).toLowerCase() !== tn.toLowerCase()) {
      return { ok: false, out: 'ERROR: The system cannot find the file specified.' };
    }
    if (shape === 'none') return { ok: true, out: 'Status: Ready\n' };
    const label = shape === 'de' ? 'Aufgabenname:' : 'TaskName:';
    return { ok: true, out: `\r\nFolder: \\Kosmos\r\nHostName:      BOX\r\n${label}      \\${shown}\r\nStatus:        Ready\r\n` };
  });
  return asked;
}

/* The real agent `cai8177` is a folder here, as on a Windows box: that folder is what says the task is cai8177's. */
const create = require('./create');
fs.mkdirSync(create.workerDir('cai8177'), { recursive: true });

test.beforeEach(() => {
  remove.setRunner(() => ({ ok: true, stdout: '' }));
  status.setPaneSource(() => '');   // an empty board: no session answers for either spelling
});
test.after(() => { job.setRunner(null); remove.setRunner(null); status.setPaneSource(null); });

test('#8177 a case variant of a Windows agent\'s name finds no job, so Remove does not plan it', () => {
  const asked = taskSchedulerWith('cai8177');
  // CONTROL: the fake answers the variant's query with the real task, as Task Scheduler does, so the bug is reachable.
  assert.equal(job.status('Cai8177').registered, true, 'CONTROL: the fake did not find cai8177\'s task for Cai8177');
  assert.ok(asked.some((a) => a.includes('agent-Cai8177')), 'CONTROL: the variant was never asked for by its own spelling');

  assert.equal(remove.jobFor('Cai8177', WIN), null, 'cai8177\'s task was counted as a job for Cai8177');
  const p = remove.plan('Cai8177', WIN);
  assert.equal(p.ok, false, 'Remove planned Cai8177, which has no task of its own');
  assert.match(p.because, /cannot find an agent called Cai8177/, 'refused for another reason: ' + p.because);
});

test('#8177 the agent\'s own spelling still finds its job and plans (CONTROL)', () => {
  taskSchedulerWith('cai8177');
  const found = remove.jobFor('cai8177', WIN);
  assert.ok(found, 'the real agent lost its own job');
  assert.equal(found.label, job.taskName('cai8177'));
  const p = remove.plan('cai8177', WIN);
  assert.equal(p.ok, true, 'Remove refused the real agent: ' + p.because);
});

test('#8177 the task\'s name is read from the value, so a German Windows refuses the variant too', () => {
  taskSchedulerWith('cai8177', 'de');
  assert.equal(remove.jobFor('Cai8177', WIN), null, 'the variant counted on a German Windows');
  assert.ok(remove.jobFor('cai8177', WIN), 'the real agent lost its job on a German Windows');
});

test('#8177 an answer that names no task keeps the job: no positive evidence of another spelling', () => {
  /* The weak side, by design: output this cannot read (a shape not seen) falls back to "registered", as before,
     rather than making every agent's job vanish. */
  taskSchedulerWith('cai8177', 'none');
  assert.ok(remove.jobFor('cai8177', WIN), 'an unreadable answer made the real agent\'s job vanish');
});

test('#8177 spelledOtherwise reads the task path, bounded, in any letter case', () => {
  const tn = job.taskName('cai8177');
  const variant = job.taskName('Cai8177');
  assert.equal(job.spelledOtherwise(variant, `TaskName: \\${tn}\nStatus: Ready`), tn);
  assert.equal(job.spelledOtherwise(tn, `TaskName: \\${tn}\nStatus: Ready`), null, 'its own spelling is not another one');
  assert.equal(job.spelledOtherwise(variant, `TaskName: ${tn}o\nStatus: Ready`), null, 'a longer task name is not this one');
  assert.equal(job.spelledOtherwise(variant, 'Status: Ready'), null, 'no task path is no evidence');
  assert.equal(job.spelledOtherwise(job.taskName('a.b'), `TaskName: \\${job.taskName('aXb')}`), null, 'a dot in the name is literal');
});

test('#8177 a folder stored in other letter case does not hide the real agent\'s own job (review 1)', () => {
  taskSchedulerWith('cai8177', 'en', 'kosmos');
  assert.ok(remove.jobFor('cai8177', WIN), 'the real agent lost its job because the folder is spelled kosmos');
  assert.equal(remove.jobFor('Cai8177', WIN), null, 'the variant counted when the folder is spelled kosmos');
});

test('#8177 a variant still reads as having a job for create and import: registered stays true (review 1)', () => {
  /* create.jobPresence is what refuses making `Cai` over `cai`'s task (and worldimport refuses on it); `/Create /F`
     would otherwise overwrite cai's task. Only remove.jobFor treats the variant as "no job of its own". */
  taskSchedulerWith('cai8177');
  assert.equal(create.jobPresence('Cai8177', WIN), 'yes', 'a variant read as free to create over cai8177\'s task');
  assert.equal(job.presence('Cai8177').spelledOtherwise, job.taskName('cai8177'));
  assert.equal(job.presence('cai8177').spelledOtherwise, undefined, 'the real spelling was marked as another');
});

test('#8177 an agent whose task is stored in other letter case keeps its own job (review 3)', () => {
  /* The folder is `cai8177r` and the task was stored as `Cai8177r`. That task is this agent's (Windows cannot hold a
     `Cai8177r` folder beside it), and the task commands ignore case, so main restarts and removes it. Refusing it
     would strand the agent: restart, pause and Remove would all say Kosmos did not start it. */
  taskSchedulerWith('Cai8177r');
  fs.mkdirSync(create.workerDir('cai8177r'), { recursive: true });
  assert.equal(job.status('cai8177r').spelledOtherwise, job.taskName('Cai8177r'), 'CONTROL: the stored case was not read as another spelling');
  assert.ok(remove.jobFor('cai8177r', WIN), 'the agent lost its own job because the task is stored in other case');
  const p = remove.plan('cai8177r', WIN);
  assert.equal(p.ok, true, 'Remove refused the agent over its own task: ' + p.because);
  assert.equal(remove.taskIsAnotherSpellings('cai8177r', job.status('cai8177r')), false);
});

test('#8177 an agent whose folder is gone keeps a task stored in other letter case (review 5)', () => {
  /* No folder for either spelling: the task is nobody else's, it is the agent's own (or its leftover), and main
     restarts and removes it. Refusing would leave a task nothing in Kosmos can clear. */
  taskSchedulerWith('Cai8177n');
  assert.equal(job.status('cai8177n').spelledOtherwise, job.taskName('Cai8177n'), 'CONTROL: the stored case was not read as another spelling');
  assert.ok(remove.jobFor('cai8177n', WIN), 'a folderless agent lost its own task');
  assert.equal(remove.plan('cai8177n', WIN).ok, true, 'Remove refused a folderless agent over its own task');
});

test('#8177 a named Kosmos\'s task (agent+world) is read the same way (review 2)', () => {
  const tn = job.taskName('cai8177', 'qa');
  assert.ok(tn.includes('+qa'), 'CONTROL: the world id is not in the task name: ' + tn);
  assert.equal(job.spelledOtherwise(job.taskName('Cai8177', 'qa'), `TaskName: \\${tn}\nStatus: Ready`), tn);
  assert.equal(job.spelledOtherwise(tn, `TaskName: \\${tn}\nStatus: Ready`), null);
  assert.equal(job.spelledOtherwise(job.taskName('cai8177', 'qb'), `TaskName: \\${tn}\nStatus: Ready`), null, 'another world\'s task is not this one');
});

test('#8177 another Kosmos\'s job is not judged by this Kosmos\'s folders (review 4)', () => {
  /* jobFor(name, platform, worldId) for a world this board does not serve: that agent's folder is not in this world's
     workers dir, so the exact-folder test would read its own task (stored as Cai8177w) as another spelling's. */
  const asked = [];
  const tn = job.taskName('Cai8177w', 'otherw');
  job.setRunner((args) => {
    asked.push(args.join(' '));
    const at = args.indexOf('/TN');
    if (args[0] === '/Query' && at >= 0 && String(args[at + 1]).toLowerCase() === tn.toLowerCase()) return { ok: true, out: `TaskName: \\${tn}\r\nStatus: Ready\r\n` };
    return { ok: false, out: 'ERROR: The system cannot find the file specified.' };
  });
  assert.equal(job.status('cai8177w', 'otherw').spelledOtherwise, tn, 'CONTROL: the stored case was not read as another spelling');
  assert.ok(remove.jobFor('cai8177w', WIN, 'otherw'), 'another world\'s agent lost its own task');
});

test('#8177 KNOWN GAP, pinned so it is not forgotten: a profile-recorded agent\'s variant still finds its task', () => {
  /* A folder recorded in the profile does not carry the spelling, and the profile is read without case, so this
     branch keeps main's answer for a recorded agent: jobFor('Cai8177p') counts cai8177p's task. #8112's folderIsExactly
     is the test to use here once it lands; when it does, this assertion flips (null), and that is the fix. */
  const store = require('./store');
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'recorded-'));
  store.writeProfile('cai8177p', { dir });
  assert.ok(create.usableRecordedDir(store.readProfile('Cai8177p').dir), 'CONTROL: the profile is not read for the variant');
  taskSchedulerWith('cai8177p');
  assert.ok(remove.jobFor('Cai8177p', WIN), 'the known gap changed: update this test and the card');
});

'use strict';
/**
 * kosmos#8177: on Windows, Remove must not take a case variant of an agent's name as that agent.
 *
 * Task Scheduler ignores letter case, so `schtasks /Query /TN Kosmos\agent-Cai` answers with `cai`'s task. `jobFor`
 * counted that as a job for `Cai`, so `plan('Cai')` answered ok under a name with no task of its own, and a removal
 * recorded `Cai` as removed while `cai` kept running (the false success #8112 fixes on the Mac, here for every agent).
 *
 * The fix judges by the folders (remove.folderIsAnotherSpellings), never by how schtasks spells the task it prints, so
 * the fake below answers a query in any letter case and ECHOES the spelling it was asked for: the fix must hold even
 * then. Run from a Mac, like remove.win32-job-570.test.js, through the win32 arm.
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
const create = require('./create');

const WIN = 'win32';

/* A Task Scheduler holding one task, stored as `stored` (in `worldId`), found by a query in any letter case. The
   answer echoes the spelling asked for, the reading that gives the fix nothing to go on. */
function taskSchedulerWith(stored, worldId) {
  const tn = job.taskName(stored, worldId);
  job.setRunner((args) => {
    if (args[0] !== '/Query') return { ok: true, out: '' };
    const at = args.indexOf('/TN');
    const asked = at >= 0 ? String(args[at + 1]) : '';
    if (asked.toLowerCase() !== tn.toLowerCase()) return { ok: false, out: 'ERROR: The system cannot find the file specified.' };
    return { ok: true, out: `\r\nFolder: \\Kosmos\r\nTaskName:      \\${asked}\r\nStatus:        Ready\r\n` };
  });
}
function folder(name) { fs.mkdirSync(create.workerDir(name), { recursive: true }); }

test.beforeEach(() => {
  remove.setRunner(() => ({ ok: true, stdout: '' }));
  status.setPaneSource(() => '');   // an empty board: no session answers for any spelling
});
test.after(() => { job.setRunner(null); remove.setRunner(null); status.setPaneSource(null); });

test('#8177 a case variant of a Windows agent\'s name finds no job, so Remove does not plan it', () => {
  folder('cai8177');
  taskSchedulerWith('cai8177');
  // CONTROL: the fake finds cai8177's task for the variant, as Task Scheduler does, so the bug is reachable.
  assert.equal(job.status('Cai8177').registered, true, 'CONTROL: the fake did not find cai8177\'s task for Cai8177');

  assert.equal(remove.jobFor('Cai8177', WIN), null, 'cai8177\'s task was counted as a job for Cai8177');
  const p = remove.plan('Cai8177', WIN);
  assert.equal(p.ok, false, 'Remove planned Cai8177, which has no task of its own');
  assert.match(p.because, /cannot find an agent called Cai8177/, 'refused for another reason: ' + p.because);
});

test('#8177 the agent\'s own spelling still finds its job and plans (CONTROL)', () => {
  folder('cai8177');
  taskSchedulerWith('cai8177');
  const found = remove.jobFor('cai8177', WIN);
  assert.ok(found, 'the real agent lost its own job');
  assert.equal(found.label, job.taskName('cai8177'));
  assert.equal(remove.plan('cai8177', WIN).ok, true, 'Remove refused the real agent');
});

test('#8177 a third spelling is refused too, whatever case the task was stored in (review 7)', () => {
  folder('cai8177t');
  taskSchedulerWith('Cai8177t');   // the task stored in a case that matches neither the folder nor the name asked
  assert.equal(remove.jobFor('CAI8177T', WIN), null, 'a third spelling counted the agent\'s task');
  assert.equal(remove.plan('CAI8177T', WIN).ok, false, 'Remove planned a third spelling');
  assert.ok(remove.jobFor('cai8177t', WIN), 'the agent lost its own task stored as Cai8177t');
});

test('#8177 an agent asked by its folder\'s own name keeps a task stored in other letter case (review 3)', () => {
  /* The folder is `cai8177r` and the task was stored as `Cai8177r`: the task commands ignore case, so main restarts and
     removes it, and refusing would strand the agent. */
  folder('cai8177r');
  taskSchedulerWith('Cai8177r');
  assert.ok(remove.jobFor('cai8177r', WIN), 'the agent lost its own job because the task is stored in other case');
  assert.equal(remove.plan('cai8177r', WIN).ok, true, 'Remove refused the agent over its own task');
});

test('#8177 an agent whose folder is gone keeps its task (review 5)', () => {
  /* No folder for any spelling: the task is nobody else's, and main restarts and removes it. Refusing would leave a task
     nothing in Kosmos can clear. */
  taskSchedulerWith('Cai8177n');
  assert.ok(remove.jobFor('cai8177n', WIN), 'a folderless agent lost its own task');
  assert.ok(remove.jobFor('Cai8177n', WIN), 'a folderless agent lost its own task asked by its stored spelling');
  assert.equal(remove.plan('cai8177n', WIN).ok, true, 'Remove refused a folderless agent over its own task');
});

test('#8177 a variant still reads as having a job for create: registered stays true', () => {
  /* create.jobPresence is what refuses making `Cai` over `cai`'s task (and worldimport refuses on it); `/Create /F`
     would otherwise overwrite cai's task. Only remove.jobFor treats the variant as "no job of its own". */
  folder('cai8177');
  taskSchedulerWith('cai8177');
  assert.equal(create.jobPresence('Cai8177', WIN), 'yes', 'a variant read as free to create over cai8177\'s task');
});

test('#8177 another Kosmos\'s job is not judged by this Kosmos\'s folders (review 4)', () => {
  /* A folder `cai8177w` here, but the job asked about is the agent `Cai8177w` of another Kosmos, whose folder is not in
     this workers dir: it keeps its own task. */
  folder('cai8177w');
  taskSchedulerWith('Cai8177w', 'otherw');
  assert.ok(remove.jobFor('Cai8177w', WIN, 'otherw'), 'another world\'s agent lost its own task');
  assert.equal(remove.folderIsAnotherSpellings('Cai8177w'), true, 'CONTROL: this world\'s folders do read it as a variant');
});

test('#8177 KNOWN GAP, pinned so it is not forgotten: a profile-recorded agent\'s variant still finds its task', () => {
  /* A folder recorded in the profile does not carry the spelling, and the profile is read without case, so this branch
     keeps main's answer for a recorded agent: jobFor('Cai8177p') counts cai8177p's task. #8112's folderIsExactly is the
     test to use here once it lands; when it does, this assertion flips (null), and that is the fix. */
  const store = require('./store');
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'recorded-'));
  store.writeProfile('cai8177p', { dir });
  folder('cai8177p');
  assert.ok(create.usableRecordedDir(store.readProfile('Cai8177p').dir), 'CONTROL: the profile is not read for the variant');
  taskSchedulerWith('cai8177p');
  assert.ok(remove.jobFor('Cai8177p', WIN), 'the known gap changed: update this test and the card');
});

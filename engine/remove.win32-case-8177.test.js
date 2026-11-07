'use strict';
/**
 * kosmos#8177: on Windows, Remove must not take a case variant of an agent's name as that agent.
 *
 * Task Scheduler ignores letter case, so `schtasks /Query /TN Kosmos\agent-Cai` answers with `cai`'s task. `jobFor`
 * counted that as a job for `Cai`, so `plan('Cai')` answered ok under a name with no task of its own, and a removal
 * recorded `Cai` as removed while `cai` kept running (the false success #8112 fixes on the Mac, here for every agent).
 *
 * Every task Kosmos registers is named from a lowercase machine name (create.NAME_RE, enforced by installJob), so the
 * fix decides by the name: one with a capital letter has no task of its own. The fake below answers a query in any
 * letter case and ECHOES the spelling it was asked for, so nothing rests on how schtasks prints the task. Run from a
 * Mac, like remove.win32-job-570.test.js, through the win32 arm.
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

/* A Task Scheduler holding one task, `stored`'s (in `worldId`), found by a query in any letter case. The answer echoes
   the spelling asked for. `stored` is always lowercase: installJob builds no other. */
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
  assert.equal(remove.jobFor('CAI8177', WIN), null, 'another spelling counted cai8177\'s task');
});

test('#8177 the agent\'s own name still finds its job and plans (CONTROL)', () => {
  folder('cai8177');
  taskSchedulerWith('cai8177');
  const found = remove.jobFor('cai8177', WIN);
  assert.ok(found, 'the real agent lost its own job');
  assert.equal(found.label, job.taskName('cai8177'));
  assert.equal(remove.plan('cai8177', WIN).ok, true, 'Remove refused the real agent');
});

test('#8177 an agent whose folder was renamed by case in Explorer keeps its task (review 9)', () => {
  /* Folder `Cai8177e`, task and machine name `cai8177e`: NTFS still resolves workers/cai8177e, and main restarts,
     pauses and removes it. A rule judged by the folders refused it. */
  folder('Cai8177e');
  taskSchedulerWith('cai8177e');
  assert.ok(remove.jobFor('cai8177e', WIN), 'the agent lost its own task because its folder is spelled Cai8177e');
  assert.equal(remove.plan('cai8177e', WIN).ok, true, 'Remove refused the agent over its own task');
});

test('#8177 an agent whose folder is gone keeps its task', () => {
  taskSchedulerWith('cai8177n');
  assert.ok(remove.jobFor('cai8177n', WIN), 'a folderless agent lost its own task');
  assert.equal(remove.plan('cai8177n', WIN).ok, true, 'Remove refused a folderless agent over its own task');
});

test('#8177 a profile-recorded agent\'s variant finds no job either', () => {
  /* A recorded folder does not carry the spelling and the profile is read without case, so a folder test could not
     tell `Cai8177p` from `cai8177p`. The name test does not need to. */
  const store = require('./store');
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'recorded-'));
  store.writeProfile('cai8177p', { dir });
  assert.ok(create.usableRecordedDir(store.readProfile('Cai8177p').dir), 'CONTROL: the profile is not read for the variant');
  taskSchedulerWith('cai8177p');
  assert.equal(remove.jobFor('Cai8177p', WIN), null, 'a recorded agent\'s variant counted its task');
  assert.ok(remove.jobFor('cai8177p', WIN), 'the recorded agent lost its own task');
});

test('#8177 in another Kosmos too: the variant has no job, the agent keeps its own', () => {
  taskSchedulerWith('cai8177w', 'otherw');
  assert.equal(job.status('Cai8177w', 'otherw').registered, true, 'CONTROL: the fake did not find the task for the variant');
  assert.equal(remove.jobFor('Cai8177w', WIN, 'otherw'), null, 'another world\'s variant counted the task');
  assert.ok(remove.jobFor('cai8177w', WIN, 'otherw'), 'another world\'s agent lost its own task');
});

test('#8177 a variant still reads as having a job for create: registered stays true', () => {
  /* create.jobPresence is what refuses making `Cai` over `cai`'s task (and worldimport refuses on it); `/Create /F`
     would otherwise overwrite cai's task. Only remove.jobFor treats the variant as "no job of its own". */
  folder('cai8177');
  taskSchedulerWith('cai8177');
  assert.equal(create.jobPresence('Cai8177', WIN), 'yes', 'a variant read as free to create over cai8177\'s task');
});

test('#8177 the premise: Kosmos builds a job only for a lowercase name (CONTROL)', () => {
  /* The fix rests on this. If installJob ever accepts a capital letter, a task could carry one and this rule would hide
     it from its own agent; this test fails first. */
  assert.match(create.installJob('Cai8177x', { platform: WIN }).because || '', /not a name this product can build a job from/);
});

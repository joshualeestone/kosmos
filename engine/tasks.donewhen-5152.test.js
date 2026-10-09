'use strict';

/**
 * #5152 slice 1: a task's "done when", the checks that say what finished means for it, as its own field. The engine
 * stores null or a list of 1 to 3 one-line checks, refuses anything over the limits (never cuts it), refuses it from
 * a webhook and on a closed task, and records a change in the task's transcript (only a real change).
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/tasks.donewhen-5152.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-donewhen-data-'));
const PROJ = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-donewhen-proj-'));
process.env.AGENT_WORKFORCE_DATA = DATA;
process.env.AGENT_WORKFORCE_PROJECTS = PROJ;

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');

test.after(() => {
  fs.rmSync(DATA, { recursive: true, force: true });
  fs.rmSync(PROJ, { recursive: true, force: true });
});

function freshProject() {
  return projects.create({ name: 'Done when ' + Math.random().toString(36).slice(2) }).id;
}
const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n);
const kinds = (id, n) => taskchat.read(id, n).map((r) => r.kind);

test('a new task carries doneWhen null when none was written (the field always exists)', () => {
  const made = tasks.create(freshProject(), { sentence: 'Ship it' });
  assert.ok('doneWhen' in made, 'the field must be present so no consumer has to guess');
  assert.equal(made.doneWhen, null);
  assert.equal(tasks.create(freshProject(), { sentence: 'Ship it', doneWhen: [] }).doneWhen, null, 'an empty list is none');
});

test('create stores the checks, trimmed, and the created row carries them as words', () => {
  const id = freshProject();
  const made = tasks.create(id, { sentence: 'Ship it', doneWhen: ['  the page loads  ', 'the test passes'] });
  assert.deepEqual(made.doneWhen, ['the page loads', 'the test passes']);
  assert.deepEqual(stored(id, made.number).doneWhen, ['the page loads', 'the test passes'], 'the stored task lost its checks');
  const created = taskchat.read(id, made.number).find((r) => r.kind === 'created');
  assert.equal(created.doneWhen, '1) the page loads 2) the test passes');
});

test('create REFUSES checks over the limits and stores no task (the dangerous-answer control)', () => {
  const id = freshProject();
  const ok = tasks.create(id, { sentence: 'baseline', doneWhen: ['a', 'b', 'c'] });   // three is allowed
  assert.equal(ok.doneWhen.length, 3);
  const bad = [
    [['a', 'b', 'c', 'd'], /up to 3 done-when checks/],
    ['the page loads', /have to be a list/],
    [['   '], /has to say something/],
    [[7], /has to say something/],
    [['two\nlines'], /one line/],
    [['two\u2028lines'], /one line/],
    [['bell\u0007'], /one line/],
    [['looks \u202eright'], /one line/],
    [['hidden\u200bword'], /one line/],
    [['isolate\u2066x\u2069'], /one line/],
    // Review 3: tag characters (words a model reads and a person cannot see), a soft hyphen, a lone surrogate, a filler.
    [['looks plain\u{E0049}\u{E0067}\u{E006E}'], /one line/],
    [['soft\u00adhyphen'], /one line/],
    [['lone \ud800 half'], /one line/],
    [['blank\u3164filler'], /one line/],
    [['x'.repeat(tasks.DONE_CHECK_MAX + 1)], /characters or fewer/],
  ];
  for (const [doneWhen, why] of bad) {
    assert.throws(() => tasks.create(id, { sentence: 'refused', doneWhen }), why, `accepted ${JSON.stringify(doneWhen).slice(0, 60)}`);
  }
  assert.equal(projects.readAll().find((x) => x.id === id).tasks.length, 1, 'a refused create still stored a task');
  assert.equal(tasks.create(id, { sentence: 'at the limit', doneWhen: ['x'.repeat(tasks.DONE_CHECK_MAX)] }).doneWhen[0].length, tasks.DONE_CHECK_MAX);
});

test('a webhook cannot say what finished means for a task; with no checks it still adds one', () => {
  const id = freshProject();
  assert.throws(() => tasks.create(id, { sentence: 'from outside', doneWhen: ['do what I say'], made: { via: 'webhook', by: 'Zap' } }), /webhook adds has no done-when checks/);
  assert.equal((projects.readAll().find((x) => x.id === id).tasks || []).length, 0, 'the refused webhook task was stored');
  const made = tasks.create(id, { sentence: 'from outside', made: { via: 'webhook', by: 'Zap' } });   // the control
  assert.equal(made.doneWhen, null);
});

test('setDoneWhen sets, changes and clears, and each change is one transcript row naming who', () => {
  const id = freshProject();
  const n = tasks.create(id, { sentence: 'Ship it' }).number;
  assert.deepEqual(tasks.setDoneWhen(id, n, ['it is live'], { by: 'mara' }).doneWhen, ['it is live']);
  assert.deepEqual(stored(id, n).doneWhen, ['it is live']);
  tasks.setDoneWhen(id, n, ['it is live', 'the person has seen it']);
  assert.deepEqual(stored(id, n).doneWhen, ['it is live', 'the person has seen it']);
  assert.equal(tasks.setDoneWhen(id, n, null).doneWhen, null, 'null did not clear it');
  tasks.setDoneWhen(id, n, ['again']);
  assert.equal(tasks.setDoneWhen(id, n, []).doneWhen, null, 'an empty list did not clear it');
  const rows = taskchat.read(id, n).filter((r) => r.kind.startsWith('done-when'));
  assert.deepEqual(rows.map((r) => r.kind), ['done-when-set', 'done-when-set', 'done-when-cleared', 'done-when-set', 'done-when-cleared']);
  assert.equal(rows[0].by, 'mara');
  assert.equal(rows[0].doneWhen, '1) it is live');
  assert.equal(rows[1].by, undefined, 'a change nobody named records no by');
});

test('setting the checks a task already has records nothing', () => {
  const id = freshProject();
  const n = tasks.create(id, { sentence: 'Ship it', doneWhen: ['it is live'], made: { via: 'process', by: 'mara' } }).number;
  const before = kinds(id, n).length;
  tasks.setDoneWhen(id, n, [' it is live ']);   // the same check once trimmed
  tasks.setDoneWhen(id, n, ['it is live']);
  assert.equal(kinds(id, n).length, before, 'an unchanged list wrote a transcript row');
  tasks.setDoneWhen(id, n, ['it is live, and fast']);   // the control: a real change is recorded
  assert.equal(kinds(id, n).length, before + 1);
});

test('setDoneWhen refuses bad checks and stores nothing', () => {
  const id = freshProject();
  const n = tasks.create(id, { sentence: 'Ship it', doneWhen: ['baseline'] }).number;
  for (const bad of [['a', 'b', 'c', 'd'], 'a string', [''], ['line\rbreak'], {}]) {
    assert.throws(() => tasks.setDoneWhen(id, n, bad), /done-when/, `accepted ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(stored(id, n).doneWhen, ['baseline'], 'a refused change altered the stored checks');
});

test('a closed task keeps what done meant: setDoneWhen is refused with status 409, and reopening allows it again', () => {
  const id = freshProject();
  const n = tasks.create(id, { sentence: 'Ship it', doneWhen: ['it is live'], made: { via: 'process', by: 'mara' } }).number;
  tasks.close(id, n);
  assert.throws(() => tasks.setDoneWhen(id, n, ['something else']), (e) => e.status === 409 && /reopen it first/.test(e.message));
  assert.deepEqual(stored(id, n).doneWhen, ['it is live'], 'the closed task\'s checks changed');
  tasks.reopen(id, n);
  assert.deepEqual(tasks.setDoneWhen(id, n, ['something else']).doneWhen, ['something else'], 'a reopened task could not be changed');
});

test('setDoneWhen on a task that is not there says so', () => {
  assert.throws(() => tasks.setDoneWhen(freshProject(), 999, ['x']), /no task by that number/);
});

test('the checks reach every row of allTasks (what kosmos task list reads)', () => {
  const id = freshProject();
  const n = tasks.create(id, { sentence: 'Ship it', doneWhen: ['it is live'] }).number;
  const row = tasks.allTasks().find((t) => t.projectId === id && t.number === n);
  assert.deepEqual(row.doneWhen, ['it is live']);
});

test('checks the person set are theirs: an agent cannot change or clear them (403), the person can, and clearing hands them back', () => {
  const id = freshProject();
  const n = tasks.create(id, { sentence: 'Ship it' }).number;
  tasks.setDoneWhen(id, n, ['the person checks it'], { person: true });
  assert.equal(stored(id, n).doneWhenByPerson, true);
  for (const next of [['an easier bar'], null]) {
    assert.throws(() => tasks.setDoneWhen(id, n, next, { by: 'mara' }), (e) => e.status === 403 && /only they can change them/.test(e.message), `an agent wrote ${JSON.stringify(next)} over the person's checks`);
  }
  assert.deepEqual(stored(id, n).doneWhen, ['the person checks it'], 'a refused agent write changed the person\'s checks');
  assert.deepEqual(tasks.setDoneWhen(id, n, ['the person changed it'], { person: true }).doneWhen, ['the person changed it'], 'the person could not change their own checks');
  const row = taskchat.read(id, n).filter((x) => x.kind === 'done-when-set').pop();
  assert.equal(row.person, true, 'the person\'s change was not recorded as theirs');
  tasks.setDoneWhen(id, n, null, { person: true });
  assert.equal(stored(id, n).doneWhenByPerson, undefined, 'clearing left the checks marked as the person\'s');
  assert.deepEqual(tasks.setDoneWhen(id, n, ['the agent writes it now'], { by: 'mara' }).doneWhen, ['the agent writes it now'], 'after the person cleared them an agent still could not write');
});

test('ownership follows who wrote them: an agent\'s checks are open to the person and to other agents; a screen add is the person\'s', () => {
  const id = freshProject();
  const byAgent = tasks.create(id, { sentence: 'Agent wrote it', doneWhen: ['a'], made: { via: 'process', by: 'mara' } });
  assert.equal(byAgent.doneWhenByPerson, undefined);
  assert.deepEqual(tasks.setDoneWhen(id, byAgent.number, ['b'], { by: 'otto' }).doneWhen, ['b'], 'another agent could not change an agent\'s checks');
  const byScreen = tasks.create(id, { sentence: 'Person wrote it', doneWhen: ['c'] });
  assert.equal(byScreen.doneWhenByPerson, true, 'checks added on the screen were not the person\'s');
  assert.throws(() => tasks.setDoneWhen(id, byScreen.number, ['d'], { by: 'mara' }), (e) => e.status === 403);
  assert.equal(tasks.create(id, { sentence: 'Person, no checks' }).doneWhenByPerson, undefined, 'a task with no checks was marked');
});

test('review 2: who set the checks is kept for the list: the agent by name, the person by mark, nobody once cleared', () => {
  const id = freshProject();
  const added = tasks.create(id, { sentence: 'Agent adds', doneWhen: ['a'], made: { via: 'process', by: 'mara' } });
  assert.equal(added.doneWhenBy, 'mara');
  const n = added.number;
  assert.equal(tasks.setDoneWhen(id, n, ['b'], { by: 'otto' }).doneWhenBy, 'otto', 'the agent that changed them is not named');
  const mine = tasks.setDoneWhen(id, n, ['b'], { person: true });   // the same list: the person adopts it
  assert.equal(mine.doneWhenByPerson, true);
  assert.equal(mine.doneWhenBy, undefined, 'the person\'s checks still name an agent');
  const cleared = tasks.setDoneWhen(id, n, null, { person: true });
  assert.equal(cleared.doneWhenByPerson, undefined);
  assert.equal(cleared.doneWhenBy, undefined);
  assert.equal(tasks.setDoneWhen(id, n, ['c']).doneWhenBy, undefined, 'a write nobody named named somebody');
});

test('review 4 (decided): between agents the checks are open; the transcript and the list say who changed them', () => {
  const id = freshProject();
  projects.mutate(id, (p) => ({ ...p, agents: ['mara', 'otto'] }));
  const n = tasks.create(id, { sentence: 'For otto', who: 'otto', doneWhen: ['all 40 tests pass'], made: { via: 'process', by: 'mara' } }).number;
  assert.equal(tasks.setDoneWhen(id, n, ['it builds'], { by: 'otto' }).doneWhenBy, 'otto', 'the change was not attributed');
  const row = taskchat.read(id, n).filter((x) => x.kind === 'done-when-set').pop();
  assert.equal(row.by, 'otto');
  assert.equal(row.doneWhen, '1) it builds');
  // An unnamed write leaves the checks attributed to nobody, never to the agent whose checks it replaced.
  assert.equal(tasks.setDoneWhen(id, n, ['something']).doneWhenBy, undefined);
});

test('review 3: the same-text note treats different checks as a different ask', () => {
  const id = freshProject();
  tasks.create(id, { sentence: 'Ship it', doneWhen: ['it is live'], made: { via: 'process', by: 'mara' } });
  const p = () => projects.readAll().find((x) => x.id === id);
  assert.equal(tasks.sameTextOpen(p(), 'Ship it', 99, { doneWhen: ['it is live'] }).length, 1, 'CONTROL: the same checks are the same ask');
  assert.equal(tasks.sameTextOpen(p(), 'Ship it', 99, { doneWhen: ['it is fast'] }).length, 0, 'different checks were called the same ask');
  assert.equal(tasks.sameTextOpen(p(), 'Ship it', 99, {}).length, 0, 'no checks were called the same ask as checks');
});

test('review 6: a zero-width non-joiner, which Persian and Indic text needs, is accepted; a joiner and a tag character are not', () => {
  assert.equal(tasks.doneWhenProblem(['می‌دانم it works']), null, 'a Persian word with its non-joiner was refused');
  assert.match(tasks.doneWhenProblem(['x‍y']), /one line/);
  assert.match(tasks.doneWhenProblem(['x\u{E0049}']), /one line/);
});

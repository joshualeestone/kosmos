'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273: CI fails a run that leaves them)

/**
 * kosmos#4787: a repeating task (tasks.setRepeat) and its runs (tasks.recordRun). The rule is checked whole and stored
 * normalised; a run is kept as lastRunAt / lastRunBy / lastRunNote and recorded in the task's conversation; a one-off or
 * closed task refuses a run; closing ends the rule; the person's rule is theirs; a repeating task is never built.
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/tasks.repeat-4787.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rep-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rep-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');

function freshTask() {
  const p = projects.create({ name: 'Rep ' + Math.random().toString(36).slice(2) });
  const made = tasks.create(p.id, { sentence: 'Check the listings' });
  return { id: p.id, n: made.number };
}
const stored = (id, n) => tasks.byNumber(projects.readAll().find((x) => x.id === id), n);

test('#4787: setRepeat stores the rule normalised, records it once, and clears it', () => {
  const { id, n } = freshTask();
  tasks.setRepeat(id, n, { every: 'day', at: '09:00', junk: 1 });
  assert.deepEqual(stored(id, n).repeat, { every: 'day', at: '09:00' }, 'only the rule\'s own fields are stored');
  tasks.setRepeat(id, n, { every: 'day', at: '09:00' });   // the same rule again: no second event
  assert.equal(taskchat.read(id, n).filter((e) => e.kind === 'repeat-set').length, 1);
  assert.equal(taskchat.read(id, n).find((e) => e.kind === 'repeat-set').words, 'every day at 9am');
  tasks.setRepeat(id, n, null);
  assert.equal('repeat' in stored(id, n), false, 'cleared: the field goes');
  assert.ok(taskchat.read(id, n).some((e) => e.kind === 'repeat-cleared'));
});

test('#4787: setRepeat refuses a bad rule whole, and a closed task', () => {
  const { id, n } = freshTask();
  assert.throws(() => tasks.setRepeat(id, n, { every: 'day', at: '9am' }), /HH:MM/);
  assert.equal('repeat' in stored(id, n), false, 'nothing stored on a refusal');
  tasks.close(id, n);
  assert.throws(() => tasks.setRepeat(id, n, { every: 'hour' }), /closed/);
  tasks.setRepeat(id, n, null);   // CONTROL: clearing a closed task's (absent) rule is allowed, nothing to refuse
});

test('#4787: recordRun keeps the latest run and records each one; a one-off or closed task refuses a run', () => {
  const { id, n } = freshTask();
  assert.throws(() => tasks.recordRun(id, n, 'ada', 'x'), /does not repeat/, 'a one-off task is closed, not run');
  tasks.setRepeat(id, n, { every: 'hour', minute: 15 });
  const at = Date.parse('2026-10-06T09:16:00Z');
  tasks.recordRun(id, n, 'ada', '  found 3   new listings ', at);
  let t = stored(id, n);
  assert.equal(t.lastRunAt, '2026-10-06T09:16:00.000Z');
  assert.equal(t.lastRunBy, 'ada');
  assert.equal(t.lastRunNote, 'found 3 new listings', 'one line, trimmed');
  tasks.recordRun(id, n, 'ada', '', at + 3600000);
  t = stored(id, n);
  assert.equal('lastRunNote' in t, false, 'a run with no note does not keep the previous run\'s note');
  const runs = taskchat.read(id, n).filter((e) => e.kind === 'run');
  assert.equal(runs.length, 2, 'every run is in the conversation');
  assert.equal(runs[0].note, 'found 3 new listings');
  assert.throws(() => tasks.recordRun(id, n, 'ada', 'x'.repeat(501)), /at most/);
  tasks.close(id, n);
  assert.throws(() => tasks.recordRun(id, n, 'ada', ''), /does not repeat/, 'closing ended the repetition (review 1), so a run is refused');
});

test('#4787 review 1: between runs a repeating task holds no work for the Prompter or the Assigner; once due it does (the two agree)', () => {
  const nudge = require('./agentnudge');
  const assigner = require('./assigner');
  const p = projects.create({ name: 'Own ' + Math.random().toString(36).slice(2), agents: ['ada'] });
  const made = tasks.create(p.id, { sentence: 'Hourly monitor', who: 'ada' });
  tasks.setRepeat(p.id, made.number, { every: 'hour' });
  tasks.recordRun(p.id, made.number, 'ada', '');   // just ran: waiting for the next hour
  const all = () => projects.readAll();
  assert.equal(nudge.openParts('ada', all()).length, 0, 'ran just now: not idle-with-open-work');
  assert.equal(assigner.hasOpenWork('ada', all()), false, 'and the Assigner agrees');
  // CONTROL: the same task, its rule set three hours ago and its last run two hours ago, is due again: open work for both.
  projects.mutate(p.id, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === made.number ? { ...t, lastRunAt: new Date(Date.now() - 2 * 3600000).toISOString(), repeatSetAt: new Date(Date.now() - 3 * 3600000).toISOString() } : t)) }));
  assert.equal(nudge.openParts('ada', all()).length, 1, 'overdue: the owner holds open work again');
  assert.equal(assigner.hasOpenWork('ada', all()), true);
});

test('#4787 review 1: closing a repeating task ends the repetition, and a reopen does not bring it back', () => {
  const { id, n } = freshTask();
  tasks.setRepeat(id, n, { every: 'day', at: '09:00' });
  tasks.close(id, n);
  assert.equal('repeat' in stored(id, n), false);
  assert.ok(taskchat.read(id, n).some((e) => e.kind === 'repeat-cleared' && e.via === 'close'));
  tasks.reopen(id, n);
  assert.equal('repeat' in stored(id, n), false, 'reopened as a one-off');
});

test('#4787 review 1: the person\'s rule is theirs: an agent cannot change or clear it; the person can (control)', () => {
  const { id, n } = freshTask();
  tasks.setRepeat(id, n, { every: 'day', at: '09:00' }, { person: true });
  assert.throws(() => tasks.setRepeat(id, n, { every: 'hour' }), /only they can change it/);
  assert.throws(() => tasks.setRepeat(id, n, null), /only they can change it/);
  tasks.setRepeat(id, n, { every: 'day', at: '09:00' });   // the same rule from an agent is no change: allowed
  assert.deepEqual(stored(id, n).repeat, { every: 'day', at: '09:00' });
  tasks.setRepeat(id, n, { every: 'hour' }, { person: true });
  assert.deepEqual(stored(id, n).repeat, { every: 'hour', minute: 0 });
  const ev = taskchat.read(id, n).filter((e) => e.kind === 'repeat-set').pop();
  assert.equal(ev.words, 'every hour');
  assert.equal(ev.via, 'screen');
  assert.equal(typeof ev.every, 'string', 'flat fields, not an object stored as text');
});

test('#4787 review 1: the same run reported twice within a minute counts once', () => {
  const { id, n } = freshTask();
  tasks.setRepeat(id, n, { every: 'hour' });
  const at = Date.parse('2026-10-06T09:00:00Z');
  tasks.recordRun(id, n, 'ada', 'first', at);
  const again = tasks.recordRun(id, n, 'ada', 'retry', at + 30000);
  assert.equal(again.duplicate, true);
  assert.equal(stored(id, n).lastRunNote, 'first', 'the first stays');
  assert.equal(taskchat.read(id, n).filter((e) => e.kind === 'run').length, 1);
  tasks.recordRun(id, n, 'ada', 'next hour', at + 3600000);
  assert.equal(taskchat.read(id, n).filter((e) => e.kind === 'run').length, 2, 'CONTROL: an hour later is a new run');
});

test('#4787 review 2: an agent re-sending the person\'s own rule leaves it theirs; a later agent change is still refused', () => {
  const { id, n } = freshTask();
  tasks.setRepeat(id, n, { every: 'hour' });                    // agent's rule
  tasks.setRepeat(id, n, { every: 'day', at: '09:00' }, { person: true });
  tasks.setRepeat(id, n, { every: 'day', at: '09:00' });        // agent re-sends the person's rule: no change
  assert.equal(stored(id, n).repeatByPerson, true);
  assert.throws(() => tasks.setRepeat(id, n, { every: 'hour' }), /only they can change it/);
});

test('#4787 review 2: a repeating task that closes because its last part closes ends the repetition too', () => {
  const p = projects.create({ name: 'Part ' + Math.random().toString(36).slice(2), agents: ['ada'] });
  const made = tasks.create(p.id, { sentence: 'Daily digest', who: 'ada' });
  tasks.setRepeat(p.id, made.number, { every: 'day', at: '08:00' });
  const parts = tasks.partsOf(stored(p.id, made.number));
  tasks.setPartClosed(p.id, made.number, parts[0].id, true);
  assert.equal('repeat' in stored(p.id, made.number), false);
  assert.ok(taskchat.read(p.id, made.number).some((e) => e.kind === 'repeat-cleared' && e.via === 'close'));
});

test('#4787 review 2: the duplicate guard is per runner: another agent\'s run inside the minute is recorded', () => {
  const { id, n } = freshTask();
  tasks.setRepeat(id, n, { every: 'hour' });
  const at = Date.parse('2026-10-06T09:00:00Z');
  tasks.recordRun(id, n, 'ada', 'a', at);
  const other = tasks.recordRun(id, n, 'bo', 'b', at + 20000);
  assert.notEqual(other.duplicate, true);
  assert.equal(taskchat.read(id, n).filter((e) => e.kind === 'run').length, 2);
});

test('#4787 review 3: a repeating task is never built: the mark is refused, and setting a rule takes an existing mark off', () => {
  const { id, n } = freshTask();
  tasks.setRepeat(id, n, { every: 'hour' });
  const out = tasks.setBuilt(id, n, { by: 'ada', note: 'done' });
  assert.equal(out.ok, false);
  assert.match(out.because, /repeats/);
  const two = freshTask();
  assert.equal(tasks.setBuilt(two.id, two.n, { by: 'ada' }).ok, true, 'CONTROL: a one-off can be marked built');
  tasks.setRepeat(two.id, two.n, { every: 'day', at: '08:00' });
  assert.equal('builtAt' in stored(two.id, two.n), false, 'the rule took the mark off');
  assert.ok(taskchat.read(two.id, two.n).some((e) => e.kind === 'unbuilt' && e.reason === 'it repeats'));
});

test('#4787 review 3: clearing a rule clears its runs, so a rule set again later has no stale last run', () => {
  const { id, n } = freshTask();
  tasks.setRepeat(id, n, { every: 'hour' });
  tasks.recordRun(id, n, 'ada', 'x');
  tasks.setRepeat(id, n, null);
  const t = stored(id, n);
  assert.equal('lastRunAt' in t || 'lastRunBy' in t || 'lastRunNote' in t, false);
});

test('#4787 review 4: an agent cannot make a task repeat over the person\'s built mark; the person can (control)', () => {
  const { id, n } = freshTask();
  assert.equal(tasks.setBuilt(id, n, { person: true }).ok, true);
  assert.throws(() => tasks.setRepeat(id, n, { every: 'hour' }), /only they can make it repeat/);
  assert.ok(stored(id, n).builtAt, 'the person\'s mark stays');
  tasks.setRepeat(id, n, { every: 'hour' }, { person: true });
  assert.equal('builtAt' in stored(id, n), false);
});

test('#4787 review 4: a rule put on an old task is measured from when the rule was set, not when the task was made', () => {
  const { id, n } = freshTask();
  projects.mutate(id, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === n ? { ...t, createdAt: '2026-01-01T00:00:00.000Z' } : t)) }));
  tasks.setRepeat(id, n, { every: 'day', at: new Date(Date.now() + 2 * 3600000).toTimeString().slice(0, 5) });   // two hours from now
  assert.equal(require('./taskrepeat').waitingForNextRun(stored(id, n)), true, 'the first run is two hours away, not months overdue');
});

test('#4787 review 5: the person\'s run is a flag; an agent named operator is an agent, and the two are different runners', () => {
  const { id, n } = freshTask();
  tasks.setRepeat(id, n, { every: 'hour' });
  const at = Date.parse('2026-10-06T09:00:00Z');
  tasks.recordRun(id, n, null, '', at, { person: true });
  assert.equal(stored(id, n).lastRunByPerson, true);
  const other = tasks.recordRun(id, n, 'operator', '', at + 10000);
  assert.notEqual(other.duplicate, true, 'an agent called operator is not the person, so not a duplicate of the person\'s run');
  assert.equal(stored(id, n).lastRunBy, 'operator');
  assert.equal('lastRunByPerson' in stored(id, n), false);
  const runs = taskchat.read(id, n).filter((e) => e.kind === 'run');
  assert.equal(runs[0].person, true);
  assert.equal(runs[1].by, 'operator');
});

test('#4787 slice 2: a run reported past its slot\'s miss grace is marked late, in the task and its history; an on-time run clears it', () => {
  const taskrepeat = require('../engine/taskrepeat');
  const { id, n } = freshTask();
  tasks.setRepeat(id, n, { every: 'day', at: '09:00' });
  const slot1 = taskrepeat.nextAfter({ every: 'day', at: '09:00' }, Date.parse(stored(id, n).repeatSetAt));
  tasks.recordRun(id, n, 'ada', 'on time', slot1 + 5 * 60000);
  assert.equal(stored(id, n).lastRunLate, undefined, 'five minutes after its slot is on time');
  const slot2 = taskrepeat.nextAfter({ every: 'day', at: '09:00' }, slot1 + 5 * 60000 + 10 * 60000);
  tasks.recordRun(id, n, 'ada', 'slow', slot2 + 20 * 60000);
  assert.equal(stored(id, n).lastRunLate, true, 'twenty minutes after its slot is late');
  const runs = taskchat.read(id, n).filter((e) => e.kind === 'run');
  assert.deepEqual(runs.map((e) => e.late === true), [false, true], 'the history says which run was late');
  const slot3 = taskrepeat.nextAfter({ every: 'day', at: '09:00' }, slot2 + 20 * 60000 + 10 * 60000);
  tasks.recordRun(id, n, 'ada', 'back on time', slot3 + 60000);
  assert.equal(stored(id, n).lastRunLate, undefined, 'the next on-time run clears the mark');
  /* review 1: a missed day, then the next day's run on time: on time (measured against the latest slot, not the oldest). */
  tasks.recordRun(id, n, 'bob', 'next day, on time', slot3 + 2 * 86400000 + 5 * 60000);
  assert.equal(stored(id, n).lastRunLate, undefined, 'after a missed day, the next day\'s 09:05 run is on time');
  tasks.recordRun(id, n, 'bob', 'very late', slot3 + 3 * 86400000 + 4 * 3600000);
  assert.equal(stored(id, n).lastRunLate, true, 'CONTROL: four hours after its slot is late');
  tasks.setRepeat(id, n, { every: 'day', at: '10:00' });
  assert.equal(stored(id, n).lastRunLate, undefined, 'review 1: a changed rule drops the mark, measured against the old rule');
  const slot10 = taskrepeat.nextAfter({ every: 'day', at: '10:00' }, Math.max(Date.parse(stored(id, n).repeatSetAt), Date.parse(stored(id, n).lastRunAt)) + 15 * 60000);   // the slots above run ahead of now
  tasks.recordRun(id, n, 'bob', 'late again', slot10 + 2 * 3600000);
  assert.equal(stored(id, n).lastRunLate, true, 'precondition for the clear below: a late mark is there');
  tasks.setRepeat(id, n, null);
  assert.equal(stored(id, n).lastRunLate, undefined, 'stopping the repeat clears it with the other run fields');
});

test('#4787 slice 2 review 2: a second runner reporting the same late run in the same minute is late too', () => {
  const taskrepeat = require('../engine/taskrepeat');
  const { id, n } = freshTask();
  tasks.setRepeat(id, n, { every: 'day', at: '09:00' });
  const slot = taskrepeat.nextAfter({ every: 'day', at: '09:00' }, Date.parse(stored(id, n).repeatSetAt));
  tasks.recordRun(id, n, 'ada', 'late', slot + 3600000);
  assert.equal(stored(id, n).lastRunLate, true);
  tasks.recordRun(id, n, 'bob', 'also late', slot + 3600000 + 20000);
  assert.equal(stored(id, n).lastRunBy, 'bob', 'precondition: the second runner\'s run was recorded');
  assert.equal(stored(id, n).lastRunLate, true, 'the same moment off the schedule is late for both');
});

test('#4787 slice 3: setReviewer names the person, an agent on the project, or nobody; the history records each change', () => {
  const p = projects.create({ name: 'Rev ' + Math.random().toString(36).slice(2) });
  projects.mutate(p.id, (x) => ({ ...x, agents: ['ada', 'bob'] }));
  const n = tasks.create(p.id, { sentence: 'Morning report' }).number;
  assert.throws(() => tasks.setReviewer(p.id, n, 'ada'), /does not repeat/, 'a one-off task has no runs to review');
  tasks.setRepeat(p.id, n, { every: 'day', at: '09:00' });
  tasks.setReviewer(p.id, n, 'ada');
  assert.equal(stored(p.id, n).repeatReviewer, 'ada');
  assert.ok(stored(p.id, n).repeatReviewerSetAt, 'when it was named, so earlier misses are not told');
  assert.throws(() => tasks.setReviewer(p.id, n, 'zed'), /not on this project/);
  assert.throws(() => tasks.setReviewer(p.id, n, 'me'), /only the person/, 'an agent cannot name the person');
  tasks.setReviewer(p.id, n, 'me', { person: true });
  assert.equal(stored(p.id, n).repeatReviewerPerson, true);
  assert.equal(stored(p.id, n).repeatReviewer, undefined);
  assert.throws(() => tasks.setReviewer(p.id, n, 'bob'), /person chose/, 'the person\'s choice is theirs');
  tasks.setReviewer(p.id, n, 'bob', { person: true });
  assert.equal(stored(p.id, n).repeatReviewer, 'bob');
  tasks.setReviewer(p.id, n, 'none', { person: true });
  assert.equal(stored(p.id, n).repeatReviewer, undefined);
  assert.equal(stored(p.id, n).repeatReviewerPerson, undefined);
  const kinds = taskchat.read(p.id, n).filter((e) => /^reviewer-/.test(e.kind)).map((e) => e.kind + ':' + (e.who || (e.person ? 'person' : '')));
  assert.deepEqual(kinds, ['reviewer-set:ada', 'reviewer-set:person', 'reviewer-set:bob', 'reviewer-cleared:person']);
  // Setting what it already is records nothing.
  tasks.setReviewer(p.id, n, 'none', { person: true });
  assert.equal(taskchat.read(p.id, n).filter((e) => /^reviewer-/.test(e.kind)).length, 4);
});

test('#4787 slice 3: stopping the repeat takes the reviewer and the told mark with it', () => {
  const p = projects.create({ name: 'Rev2 ' + Math.random().toString(36).slice(2) });
  projects.mutate(p.id, (x) => ({ ...x, agents: ['ada'] }));
  const n = tasks.create(p.id, { sentence: 'Hourly check' }).number;
  tasks.setRepeat(p.id, n, { every: 'hour' });
  tasks.setReviewer(p.id, n, 'ada');
  projects.mutate(p.id, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === n ? { ...t, missToldAt: new Date().toISOString() } : t)) }));
  tasks.setRepeat(p.id, n, null);
  const t = stored(p.id, n);
  for (const f of ['repeatReviewer', 'repeatReviewerPerson', 'repeatReviewerByPerson', 'repeatReviewerSetAt', 'missToldAt']) assert.equal(t[f], undefined, f);
});

test('#4787 slice 3 review 1: the person\'s Nobody is theirs too, and choosing what an agent named makes it theirs', () => {
  const p = projects.create({ name: 'Rev3 ' + Math.random().toString(36).slice(2) });
  projects.mutate(p.id, (x) => ({ ...x, agents: ['ada', 'bob'] }));
  const n = tasks.create(p.id, { sentence: 'Report' }).number;
  tasks.setRepeat(p.id, n, { every: 'day', at: '09:00' });
  tasks.setReviewer(p.id, n, 'none', { person: true });
  assert.throws(() => tasks.setReviewer(p.id, n, 'ada'), /person chose/, 'an agent cannot undo the person\'s Nobody');
  tasks.setReviewer(p.id, n, 'ada', { person: true });
  tasks.setReviewer(p.id, n, 'bob', { person: true });
  // An agent names itself; the person then picks that same agent: it is now theirs.
  const q = tasks.create(p.id, { sentence: 'Other' }).number;
  tasks.setRepeat(p.id, q, { every: 'day', at: '09:00' });
  tasks.setReviewer(p.id, q, 'ada');
  tasks.setReviewer(p.id, q, 'ada', { person: true });
  assert.equal(stored(p.id, q).repeatReviewerByPerson, true);
  assert.throws(() => tasks.setReviewer(p.id, q, 'bob'), /person chose/);
  assert.equal(taskchat.read(p.id, q).filter((e) => e.kind === 'reviewer-set').length, 1, 'the lock alone records nothing');
});

test('#4787 slice 3 review 2: an agent cannot get round the person\'s reviewer by stopping and restarting the repeat', () => {
  const p = projects.create({ name: 'Rev4 ' + Math.random().toString(36).slice(2) });
  projects.mutate(p.id, (x) => ({ ...x, agents: ['ada', 'bob'] }));
  const n = tasks.create(p.id, { sentence: 'Report' }).number;
  tasks.setRepeat(p.id, n, { every: 'day', at: '09:00' });   // an agent's rule
  tasks.setReviewer(p.id, n, 'ada', { person: true });
  assert.throws(() => tasks.setRepeat(p.id, n, null), /only they can stop it repeating/);
  assert.equal(stored(p.id, n).repeatReviewer, 'ada', 'the person\'s choice stands');
  tasks.setRepeat(p.id, n, { every: 'day', at: '10:00' });
  assert.equal(stored(p.id, n).repeatReviewer, 'ada', 'CONTROL: the agent may still change its own rule; the reviewer stays');
  tasks.setRepeat(p.id, n, null, { person: true });
  assert.equal(stored(p.id, n).repeat, undefined, 'the person can stop it');
});

test('#4787 slice 3 review 3: closing a repeating task drops its reviewer with its rule, so a reopened one starts clean', () => {
  const p = projects.create({ name: 'Rev5 ' + Math.random().toString(36).slice(2) });
  projects.mutate(p.id, (x) => ({ ...x, agents: ['ada', 'bob'] }));
  const n = tasks.create(p.id, { sentence: 'Report' }).number;
  tasks.setRepeat(p.id, n, { every: 'day', at: '09:00' });
  tasks.setReviewer(p.id, n, 'ada', { person: true });
  tasks.close(p.id, n);
  const t = stored(p.id, n);
  for (const f of ['repeat', 'repeatReviewer', 'repeatReviewerByPerson', 'repeatReviewerSetAt', 'missToldAt']) assert.equal(t[f], undefined, f);
  tasks.reopen(p.id, n);
  tasks.setRepeat(p.id, n, { every: 'day', at: '10:00' });
  tasks.setReviewer(p.id, n, 'bob');
  assert.equal(stored(p.id, n).repeatReviewer, 'bob', 'no old lock came back');
});

test('#4787 slice 3 review 4: "nobody" means no reviewer, as task assign reads it', () => {
  const p = projects.create({ name: 'Rev6 ' + Math.random().toString(36).slice(2) });
  projects.mutate(p.id, (x) => ({ ...x, agents: ['ada'] }));
  const n = tasks.create(p.id, { sentence: 'Report' }).number;
  tasks.setRepeat(p.id, n, { every: 'day', at: '09:00' });
  tasks.setReviewer(p.id, n, 'ada');
  tasks.setReviewer(p.id, n, 'Nobody');
  assert.equal(stored(p.id, n).repeatReviewer, undefined);
});

test('#4787 slice 3 review 5: Kosmos\'s own "missed" note is not activity (a dead job does not sort as fresh)', () => {
  const p = projects.create({ name: 'Rev7 ' + Math.random().toString(36).slice(2) });
  const n = tasks.create(p.id, { sentence: 'Report' }).number;
  const tick = () => { const s = Date.now(); while (Date.now() - s < 5) { /* let the clock move, so a newer event is newer */ } };
  const before = tasks.lastActivityOf(p.id, stored(p.id, n));
  tick();
  taskchat.record(p.id, n, { kind: 'missed', slot: new Date().toISOString(), count: 1, person: true });
  assert.equal(tasks.lastActivityOf(p.id, stored(p.id, n)), before);
  tick();
  taskchat.record(p.id, n, { kind: 'message', text: 'hi' });
  assert.notEqual(tasks.lastActivityOf(p.id, stored(p.id, n)), before, 'CONTROL: a real event a moment later is activity');
});

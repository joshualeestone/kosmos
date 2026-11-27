'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#8996: `kosmos project show` says when the project last had activity, and when quiet has gone on long enough to
   tell the person (14 days). Activity is the newest of a room post, a task's last activity and the making; a project whose
   quiet is expected (paused, archived, test, starter, parked) says why and is never called quiet; an unreadable room log
   is "cannot say", never "quiet". */
// The printed date is this computer's local day; pinned so the test reads one way. Not restored: run-tests.sh runs each
// test file in its own process, so it cannot reach another file.
process.env.TZ = 'America/Chicago';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'projectview-8996-'));
process.env.AGENT_WORKFORCE_DATA = path.join(DIR, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(DIR, 'workers');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(DIR, 'projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('./projectview');
const projects = require('./projects');

test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

const NOW = Date.parse('2026-11-24T17:00:00Z');
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const made = iso(NOW - 60 * DAY);
// `room`: the room's last post in ms, null for none, or undefined (passed explicitly) for a log that cannot be read.
const act = (p, o = {}) => v.activityOf(p, {
  now: NOW, lastPostAt: () => ('room' in o ? o.room : null),
  lastActivityOf: (id, t) => (o.tasks && t.number in o.tasks ? o.tasks[t.number] : null),
});

test('the newest of a room post, a task and the making wins, with what it was', () => {
  // #9186: staffed, as overviewOf passes it (members as projects.describe makes them), so unstaffed 0
  const members = projects.describe({ id: 'p', name: 'p', folder: DIR, agents: ['ada'], tasks: [] }, []).agents;
  const p = { id: 'p', createdAt: made, agents: members, tasks: [{ number: 1 }, { number: 2 }] };
  assert.deepEqual(act(p, { room: NOW - 3 * DAY, tasks: { 1: iso(NOW - 9 * DAY), 2: iso(NOW - 5 * DAY) } }),
    { at: iso(NOW - 3 * DAY), kind: 'post', ageDays: 3, quietDays: 14, quiet: false, unknown: false, expected: null, unstaffed: 0 });
  assert.equal(act(p, { room: NOW - 9 * DAY, tasks: { 2: iso(NOW - 2 * DAY) } }).kind, 'task');
  assert.equal(act(p, { room: null }).kind, 'made');
});

test('quiet from 14 days, not before (the line between is the threshold)', () => {
  const p = { id: 'p', createdAt: made, tasks: [] };
  assert.equal(act(p, { room: NOW - 13 * DAY - 1000 }).quiet, false);
  assert.equal(act(p, { room: NOW - 14 * DAY }).quiet, true);
});

test('a paused or archived project is never called quiet', () => {
  assert.equal(act({ id: 'p', createdAt: made, paused: true }, { room: NOW - 40 * DAY }).quiet, false);
  assert.equal(act({ id: 'p', createdAt: made, archived: true }, { room: NOW - 40 * DAY }).quiet, false);
  // CONTROL: the same project, not paused, is.
  assert.equal(act({ id: 'p', createdAt: made }, { room: NOW - 40 * DAY }).quiet, true);
});

test('a room log that cannot be read is "cannot say", never quiet', () => {
  const a = act({ id: 'p', createdAt: made, tasks: [] }, { room: undefined });
  assert.equal(a.unknown, true);
  assert.equal(a.quiet, false);
});

test('a post time in the future reads as now: never a false quiet, whatever older activity it hides', () => {
  const a = act({ id: 'p', createdAt: made, tasks: [{ number: 1 }] }, { room: NOW + 5 * DAY, tasks: { 1: iso(NOW - 20 * DAY) } });
  assert.equal(a.kind, 'post');
  assert.equal(a.ageDays, 0);
  assert.equal(a.quiet, false);
  // A making in the future proves nothing, and never outranks a real post a minute ago.
  const b = act({ id: 'p', createdAt: iso(NOW + 60000), tasks: [] }, { room: NOW - 60000 });
  assert.equal(b.kind, 'post');
});

test('the line says what it was, when, and when quiet stops being normal', () => {
  const base = { at: '2026-11-21T10:00:00.000Z', kind: 'post', ageDays: 3, quietDays: 14, quiet: false, unknown: false, expected: null };
  assert.equal(v.activityLine(base), 'Last activity: a post in its room, 3 days ago (2026-11-21). Quiet is normal until 14 days.');
  assert.equal(v.activityLine({ ...base, kind: 'task', ageDays: 20, quiet: true }),
    'Last activity: work on a task, 20 days ago (2026-11-21). That is past the 14 days Kosmos counts as normal quiet. If you are on the project, read its room: if nobody has told your person there in the last 14 days that it is quiet, post that there once.');
  assert.match(v.activityLine({ ...base, quiet: true, ageDays: 20 }, 'lease'), /read kosmos room lease: if nobody has told your person there in the last 14 days that it is quiet, post that there once\./);
  assert.equal(v.activityLine({ ...base, ageDays: 30, expected: 'paused' }),
    'Last activity: a post in its room, 30 days ago (2026-11-21). The project is paused, so quiet is expected.');
  assert.match(v.activityLine({ ...base, expected: 'archived' }), / The project is archived, so quiet is expected\.$/);
  assert.match(v.activityLine({ ...base, expected: 'test' }), / It is a test project, so quiet is expected\.$/);
  assert.match(v.activityLine({ ...base, expected: 'starter' }), / It is the starter project Kosmos made, so quiet is expected\.$/);
  assert.match(v.activityLine({ unknown: true, expected: 'paused' }), /could not read the project's room just now\. The project is paused/);
  assert.match(v.activityLine({ unknown: true, expected: 'parked' }), /could not read the project's room just now\. Every unfinished task/);
  assert.match(v.activityLine({ ...base, expected: 'nonsense' }), / Kosmos expects this project to be quiet\.$/, 'an unknown reason is said plainly, not invented');
  assert.equal(v.activityLine({ ...base, ageDays: 30, expected: 'parked' }),
    'Last activity: a post in its room, 30 days ago (2026-11-21). Every unfinished task is on hold or built and waiting, so quiet is expected.');
  assert.equal(v.activityLine({ ...base, kind: 'made', ageDays: 0 }),
    'Last activity: the project was made, within the last day (2026-11-21). Nothing has been posted or moved since it was made; quiet is normal until 14 days.');
  // The local day: 01:00 UTC on the 22nd is the evening of the 21st in Central time.
  assert.match(v.activityLine({ ...base, at: '2026-11-22T01:00:00.000Z' }), /\(2026-11-21\)/);
  assert.match(v.activityLine({ unknown: true }), /could not read the project's room/);
  assert.equal(v.activityLine(undefined), null, 'an older board sends no activity, and the CLI says nothing');
});

test('project show prints the line after the tasks', () => {
  const lines = v.renderShow({ project: { id: 'p', name: 'Lease', folder: '/tmp/x', briefFound: false, tasks: { total: 0 }, members: [],
    activity: { at: '2026-11-01T00:00:00.000Z', kind: 'task', ageDays: 23, quietDays: 14, quiet: true, unknown: false, expected: null } } });
  const at = lines.findIndex((l) => l.startsWith('Tasks: '));
  assert.ok(at >= 0);
  assert.match(lines[at + 1], /^Last activity: work on a task, 23 days ago .* If you are on the project, read kosmos room p: if nobody has told your person there in the last 14 days that it is quiet, post that there once\.$/);
});

test('overviewOf carries the activity for the CLI', () => {
  const o = v.overviewOf({ id: 'p', name: 'Lease', folder: DIR, createdAt: made, agents: [], tasks: [] }, [],
    { now: NOW, lastPostAt: () => NOW - 2 * DAY, lastActivityOf: () => null, readBrief: () => ({ goal: null, done: null, found: false }),
      readReport: () => null, folderOf: () => null, allProjects: [] });
  assert.equal(o.activity.kind, 'post');
  assert.equal(o.activity.ageDays, 2);
});

test('a project whose every unfinished task is held or built is parked, and not called quiet', () => {
  const held = { number: 1, sentence: 'a', onHold: true };
  const built = { number: 2, sentence: 'b', builtAt: iso(NOW - 30 * DAY) };
  const open = { number: 3, sentence: 'c' };
  const old = { room: NOW - 30 * DAY };
  const parked = act({ id: 'p', createdAt: made, tasks: [held, built] }, old);
  assert.equal(parked.expected, 'parked');
  assert.equal(parked.quiet, false);
  // CONTROL: one task still open to work on, and the same quiet is past normal.
  const live = act({ id: 'p', createdAt: made, tasks: [held, open] }, old);
  assert.equal(live.expected, null);
  assert.equal(live.quiet, true);
  // No unfinished task at all is not "parked": a finished project's long quiet is worth saying.
  assert.equal(act({ id: 'p', createdAt: made, tasks: [] }, old).expected, null);
});

test('against the real store, nothing stubbed: a project made, then given a task, is dated by both', () => {
  const projects = require('./projects');
  const tasks = require('./tasks');
  const folder = path.join(DIR, 'real');
  fs.mkdirSync(folder, { recursive: true });
  const p = projects.create({ name: 'Real', folder, agents: [] });
  const show = () => v.overviewOf(projects.list([]).find((x) => x.id === p.id), [], { readReport: () => null, folderOf: () => null }).activity;
  const first = show();
  assert.equal(first.unknown, false, 'the real room reader could not be reached');
  assert.equal(first.kind, 'made');
  tasks.create(p.id, { sentence: 'file the lease', made: { via: 'screen', by: null } });
  const second = show();
  assert.equal(second.kind, 'task', 'the real task reader did not date the new task');
  assert.equal(second.ageDays, 0);
});

test('a hold whose own condition is met (its date passed) is not parked', () => {
  const expired = { number: 1, sentence: 'a', onHold: true, onHoldUntil: { at: iso(NOW - 20 * DAY) } };
  const waiting = { number: 1, sentence: 'a', onHold: true, onHoldUntil: { at: iso(NOW + 20 * DAY) } };
  const old = { room: NOW - 30 * DAY };
  assert.equal(act({ id: 'p', createdAt: made, tasks: [expired] }, old).expected, null);
  assert.equal(act({ id: 'p', createdAt: made, tasks: [expired] }, old).quiet, true);
  // CONTROL: the same hold, still waiting for its date, is parked.
  assert.equal(act({ id: 'p', createdAt: made, tasks: [waiting] }, old).expected, 'parked');
});

test('a task reader that throws does not break project show', () => {
  const a = v.activityOf({ id: 'p', createdAt: made, tasks: [{ number: 1 }] },
    { now: NOW, lastPostAt: () => NOW - DAY, lastActivityOf: () => { throw new Error('boom'); } });
  assert.equal(a.kind, 'post');
});

test('a test project and the starter project are quiet by design, not called quiet', () => {
  const old = { room: NOW - 40 * DAY };
  assert.equal(act({ id: 'p', createdAt: made, testOnly: true }, old).quiet, false);
  const projects = require('./projects');
  const starter = { id: 'p', createdAt: made, name: projects.WELCOME_NAME, made: { via: 'kosmos' } };
  assert.equal(projects.isStarter(starter), true, 'fixture: the starter project as the store marks it');
  assert.equal(act(starter, old).quiet, false);
  // CONTROL: a project of the same name the person made is not the starter, and its quiet is past normal.
  assert.equal(act({ ...starter, made: { via: 'screen' } }, old).quiet, true);
});

test('the reason named is the project\'s own: archived over paused, test, starter, then parked', () => {
  const old = { room: NOW - 40 * DAY };
  assert.equal(act({ id: 'p', createdAt: made, paused: true }, old).expected, 'paused');
  assert.equal(act({ id: 'p', createdAt: made, archived: true, paused: true }, old).expected, 'archived');
  assert.equal(act({ id: 'p', createdAt: made, testOnly: true }, old).expected, 'test');
  const projects = require('./projects');
  assert.equal(act({ id: 'p', createdAt: made, name: projects.WELCOME_NAME, made: { via: 'kosmos' } }, old).expected, 'starter');
  assert.equal(act({ id: 'p', createdAt: made, name: projects.WELCOME_NAME, made: { via: 'kosmos' }, paused: true }, old).expected, 'paused');
  assert.equal(act({ id: 'p', createdAt: made, tasks: [{ number: 1, sentence: 'a', onHold: true }] }, old).expected, 'parked');
  // CONTROL: none of them, and the same quiet is past normal.
  const plain = act({ id: 'p', createdAt: made }, old);
  assert.equal(plain.expected, null);
  assert.equal(plain.quiet, true);
});

test('a post just ahead of now (clock skew) counts as now, so a busy project is never called quiet', () => {
  const a = act({ id: 'p', createdAt: made, tasks: [] }, { room: NOW + 500 });
  assert.equal(a.kind, 'post');
  assert.equal(a.ageDays, 0);
  assert.equal(a.quiet, false);
});

test('the starter project with a task in it is watched like any project', () => {
  const projects = require('./projects');
  const starter = { id: 'p', createdAt: made, name: projects.WELCOME_NAME, made: { via: 'kosmos' } };
  const old = { room: NOW - 40 * DAY };
  assert.equal(act({ ...starter, tasks: [] }, old).expected, 'starter');
  const worked = act({ ...starter, tasks: [{ number: 1, sentence: 'real work' }] }, old);
  assert.equal(worked.expected, null);
  assert.equal(worked.quiet, true);
});

test('an older CLI facing a newer board says nothing false', () => {
  const base = { at: '2026-11-21T10:00:00.000Z', kind: 'post', ageDays: 30, quietDays: 14, quiet: false, unknown: false };
  assert.equal(v.activityLine({ ...base, expected: 'dormant' }),
    'Last activity: a post in its room, 30 days ago (2026-11-21). Kosmos expects this project to be quiet.');
  assert.equal(v.activityLine({ ...base, kind: 'file', expected: null }),
    'Last activity: something on the project, 30 days ago (2026-11-21). Quiet is normal until 14 days.');
});

test('a malformed payload never prints "0 days" or reads as fresh', () => {
  const base = { at: '2026-11-21T10:00:00.000Z', kind: 'post', unknown: false, expected: null };
  assert.equal(v.activityLine({ ...base, ageDays: 20, quiet: true, quietDays: 0 }),
    'Last activity: a post in its room, 20 days ago (2026-11-21). That is past the 14 days Kosmos counts as normal quiet. If you are on the project, read its room: if nobody has told your person there in the last 14 days that it is quiet, post that there once.');
  assert.equal(v.activityLine({ ...base, ageDays: 'x', quiet: false }), 'Last activity: a post in its room (2026-11-21). Quiet is normal until 14 days.');
});

test('every other sentence, word for word', () => {
  assert.equal(v.activityLine({ unknown: false, at: null }), 'Last activity: none Kosmos can date.');
  assert.equal(v.activityLine({ unknown: true }),
    'Last activity: Kosmos could not read the project\'s room just now, so it cannot say how long the project has been quiet.');
  assert.equal(v.activityLine({ at: '2026-11-23T10:00:00.000Z', kind: 'task', ageDays: 1, quietDays: 14, quiet: false, unknown: false, expected: null }),
    'Last activity: work on a task, 1 day ago (2026-11-23). Quiet is normal until 14 days.');
});

test('a starter project holding only finished tasks is watched too (work was put there)', () => {
  const projects = require('./projects');
  const starter = { id: 'p', createdAt: made, name: projects.WELCOME_NAME, made: { via: 'kosmos' },
    tasks: [{ number: 1, sentence: 'done', closedAt: iso(NOW - 30 * DAY) }] };
  assert.equal(act(starter, { room: NOW - 40 * DAY }).expected, null);
});

test('the last branches, pinned: no readable date, a future task time, a made project gone quiet, the tie-break', () => {
  assert.equal(v.activityLine({ at: 'not a date', kind: 'post', ageDays: 3, quietDays: 14, quiet: false, unknown: false, expected: null }),
    'Last activity: a post in its room, 3 days ago. Quiet is normal until 14 days.');
  const future = act({ id: 'p', createdAt: made, tasks: [{ number: 1 }] }, { room: NOW - 20 * DAY, tasks: { 1: iso(NOW + 3 * DAY) } });
  assert.equal(future.kind, 'task');
  assert.equal(future.quiet, false);
  assert.equal(v.activityLine({ at: '2026-09-25T10:00:00.000Z', kind: 'made', ageDays: 60, quietDays: 14, quiet: true, unknown: false, expected: null }, 'lease'),
    'Last activity: the project was made, 60 days ago (2026-09-25). That is past the 14 days Kosmos counts as normal quiet. If you are on the project, read kosmos room lease: if nobody has told your person there in the last 14 days that it is quiet, post that there once.');
  // A post at the very moment the project was made says more than the making.
  assert.equal(act({ id: 'p', createdAt: iso(NOW - DAY), tasks: [] }, { room: NOW - DAY }).kind, 'post');
});

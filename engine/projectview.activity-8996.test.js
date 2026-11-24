'use strict';
/* kosmos#8996: `kosmos project show` says when the project last had activity, and when quiet has gone on long enough to
   tell the person (14 days). Activity is the newest of a room post, a task's last activity and the making; a paused or
   archived project is never called quiet; an unreadable room log is "cannot say", never "quiet". */
process.env.TZ = 'America/Chicago';   // the printed date is this computer's local day; pinned so the test reads one way
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
  const p = { id: 'p', createdAt: made, tasks: [{ number: 1 }, { number: 2 }] };
  assert.deepEqual(act(p, { room: NOW - 3 * DAY, tasks: { 1: iso(NOW - 9 * DAY), 2: iso(NOW - 5 * DAY) } }),
    { at: iso(NOW - 3 * DAY), kind: 'post', ageDays: 3, quietDays: 14, quiet: false, unknown: false, paused: false, parked: false });
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

test('a time after now proves nothing and is not the last activity', () => {
  const a = act({ id: 'p', createdAt: made, tasks: [{ number: 1 }] }, { room: NOW + 5 * DAY, tasks: { 1: iso(NOW - 20 * DAY) } });
  assert.equal(a.kind, 'task');
  assert.equal(a.quiet, true);
});

test('the line says what it was, when, and when quiet stops being normal', () => {
  const base = { at: '2026-11-21T10:00:00.000Z', kind: 'post', ageDays: 3, quietDays: 14, quiet: false, unknown: false, paused: false, parked: false };
  assert.equal(v.activityLine(base), 'Last activity: a post in its room, 3 days ago (2026-11-21). Quiet is normal until 14 days.');
  assert.equal(v.activityLine({ ...base, kind: 'task', ageDays: 20, quiet: true }),
    'Last activity: a task was added or moved, 20 days ago (2026-11-21). That is past the 14 days Kosmos counts as normal quiet. If nobody has said so in its room, tell your person there.');
  assert.equal(v.activityLine({ ...base, ageDays: 30, paused: true }),
    'Last activity: a post in its room, 30 days ago (2026-11-21). The project is paused or archived, so quiet is expected.');
  assert.equal(v.activityLine({ ...base, ageDays: 30, parked: true }),
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
    activity: { at: '2026-11-01T00:00:00.000Z', kind: 'task', ageDays: 23, quietDays: 14, quiet: true, unknown: false, paused: false } } });
  const at = lines.findIndex((l) => l.startsWith('Tasks: '));
  assert.ok(at >= 0);
  assert.match(lines[at + 1], /^Last activity: a task was added or moved, 23 days ago .* tell your person there\.$/);
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
  assert.equal(parked.parked, true);
  assert.equal(parked.quiet, false);
  // CONTROL: one task still open to work on, and the same quiet is past normal.
  const live = act({ id: 'p', createdAt: made, tasks: [held, open] }, old);
  assert.equal(live.parked, false);
  assert.equal(live.quiet, true);
  // No unfinished task at all is not "parked": a finished project's long quiet is worth saying.
  assert.equal(act({ id: 'p', createdAt: made, tasks: [] }, old).parked, false);
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

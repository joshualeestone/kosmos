'use strict';
/*
 * #992: task conversations are recorded. Covers the engine/taskchat.js store
 * (per-task append-only transcript under app data, retention-safe) and its
 * wiring into engine/tasks.js's lifecycle (created / part-added / assigned /
 * part-closed / part-reopened / closed / reopened).
 *
 *   node --test taskchat.992.test.js
 *
 * Store isolation: AGENT_WORKFORCE_DATA is pointed at a fresh temp dir BEFORE
 * requiring the engine, so store.ROOT (a lazy getter) resolves there and nothing
 * touches the real Application Support tree.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-taskchat-992-'));
process.env.AGENT_WORKFORCE_DATA = DATA;

const taskchat = require('./engine/taskchat');
const tasks = require('./engine/tasks');
const projects = require('./engine/projects');

function freshProject(agents) {
  const name = 'P' + Math.random().toString(36).slice(2, 8);
  const folder = path.join(DATA, 'proj-' + name);
  fs.mkdirSync(folder, { recursive: true }); // projects.create requires the folder to exist
  return projects.create({ name, folder, agents: agents || [] });
}

// --- the store module, in isolation ---------------------------------------

test('#992 record + read round-trips, stamps `at`, keeps append order', () => {
  const p = 'proj-A', n = 7;
  assert.equal(taskchat.record(p, n, { kind: 'created', sentence: 'do the thing' }), true);
  assert.equal(taskchat.record(p, n, { kind: 'closed' }), true);
  const rows = taskchat.read(p, n);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, 'created');
  assert.equal(rows[0].sentence, 'do the thing');
  assert.equal(rows[1].kind, 'closed');
  assert.match(rows[0].at, /^\d{4}-\d\d-\d\dT/); // ISO stamp added by record()
});

test('#992 each task gets its OWN file; reading one never returns another\'s', () => {
  taskchat.record('proj-B', 1, { kind: 'created', sentence: 'one' });
  taskchat.record('proj-B', 2, { kind: 'created', sentence: 'two' });
  assert.equal(taskchat.read('proj-B', 1).length, 1);
  assert.equal(taskchat.read('proj-B', 1)[0].sentence, 'one');
  assert.equal(taskchat.read('proj-B', 2)[0].sentence, 'two');
  // and the same task number under a DIFFERENT project is a different file
  taskchat.record('proj-C', 1, { kind: 'created', sentence: 'other project' });
  assert.equal(taskchat.read('proj-C', 1)[0].sentence, 'other project');
  assert.equal(taskchat.read('proj-B', 1)[0].sentence, 'one');
});

test('#992 no transcript and unreadable both read as [], never an error', () => {
  assert.deepEqual(taskchat.read('proj-never', 99), []);
  assert.deepEqual(taskchat.read(null, 1), []);
  assert.deepEqual(taskchat.read('proj-A', 0), []); // invalid number
});

test('#992 record is fail-soft: a bad key/number/event returns false, never throws', () => {
  assert.equal(taskchat.record(null, 1, { kind: 'x' }), false);
  assert.equal(taskchat.record('p', 0, { kind: 'x' }), false);
  assert.equal(taskchat.record('p', 1.5, { kind: 'x' }), false);
  assert.equal(taskchat.record('p', 1, null), false);
  assert.equal(taskchat.record('p', 1, { kind: '' }), false);
  assert.equal(taskchat.record('p', 1, {}), false);
});

test('#992 a malformed or partial line is skipped on read, not fatal', () => {
  const p = 'proj-D', n = 3;
  taskchat.record(p, n, { kind: 'created' });
  // simulate a torn write / a foreign appender
  fs.appendFileSync(taskchat.taskChatFile(p, n), '{ this is not json\n');
  taskchat.record(p, n, { kind: 'closed' });
  const rows = taskchat.read(p, n);
  assert.equal(rows.length, 2); // the two real events; the junk line dropped
  assert.deepEqual(rows.map((r) => r.kind), ['created', 'closed']);
});

test('#992 control characters are flattened so one event stays one line', () => {
  const p = 'proj-E', n = 4;
  taskchat.record(p, n, { kind: 'created', sentence: 'line one\nline two\ttab' });
  const raw = fs.readFileSync(taskchat.taskChatFile(p, n), 'utf8');
  assert.equal(raw.trimEnd().split('\n').length, 1, 'the record is exactly one physical line');
  assert.equal(taskchat.read(p, n)[0].sentence, 'line one line two tab');
});

test('#992 retention-safe: recording APPENDS, it does not rewrite the file', () => {
  const p = 'proj-F', n = 5;
  for (let i = 0; i < 5; i++) taskchat.record(p, n, { kind: 'note', i: String(i) });
  const raw = fs.readFileSync(taskchat.taskChatFile(p, n), 'utf8');
  assert.equal(raw.trimEnd().split('\n').length, 5, 'five appends -> five lines, nothing rewritten');
  assert.equal(taskchat.read(p, n).length, 5);
});

test('#992 the transcript lives under app data, never the project folder', () => {
  const file = taskchat.taskChatFile('proj-G', 2);
  assert.ok(file.startsWith(path.join(DATA, 'AgentWorkforce', 'task-chats')),
    'task transcript must live under store.ROOT/task-chats, not the user project folder');
});

// --- wired into tasks.js lifecycle ----------------------------------------

test('#992 tasks.create records a `created` event on the task transcript', () => {
  const p = freshProject();
  const made = tasks.create(p.id, { sentence: 'ship it', detail: 'the details', made: { via: 'screen' } });
  const rows = taskchat.read(p.id, made.number);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'created');
  assert.equal(rows[0].sentence, 'ship it');
  assert.equal(rows[0].detail, 'the details');
  assert.equal(rows[0].addedBy, 'operator');
});

test('#992 close and reopen each record their own event', () => {
  const p = freshProject();
  const made = tasks.create(p.id, { sentence: 'a task', made: { via: 'screen' } });
  tasks.close(p.id, made.number);
  tasks.reopen(p.id, made.number);
  const kinds = taskchat.read(p.id, made.number).map((r) => r.kind);
  assert.deepEqual(kinds, ['created', 'closed', 'reopened']);
});

test('#992 an assignment records `assigned`, a resubmit of the same agent records nothing', () => {
  const p = freshProject(['ada']);
  const made = tasks.create(p.id, { sentence: 'work', made: { via: 'screen' } });
  // the created task has one derived part; find its id
  const proj = projects.readAll().find((x) => x.id === p.id);
  const partId = tasks.partsOf(tasks.byNumber(proj, made.number))[0].id;
  const r1 = tasks.assignPart(p.id, made.number, partId, 'ada', { via: 'screen' });
  assert.equal(r1.ok, true);
  assert.equal(r1.changed, true);
  const r2 = tasks.assignPart(p.id, made.number, partId, 'ada', { via: 'screen' }); // resubmit, no move
  assert.equal(r2.changed, false);
  const rows = taskchat.read(p.id, made.number);
  const assigns = rows.filter((r) => r.kind === 'assigned');
  assert.equal(assigns.length, 1, 'exactly one assigned event -- the resubmit recorded nothing');
  assert.equal(assigns[0].who, 'ada');
});

test('#992 a refused task write records nothing (agent not on the project)', () => {
  const p = freshProject([]); // no agents
  assert.throws(() => tasks.create(p.id, { sentence: 'x', who: 'ghost', made: { via: 'screen' } }));
  // the counter did advance inside mutate before the throw? No -- mutate is
  // atomic and threw, so no task and no transcript. The next real create is #1.
  const made = tasks.create(p.id, { sentence: 'real', made: { via: 'screen' } });
  const rows = taskchat.read(p.id, made.number);
  assert.deepEqual(rows.map((r) => r.kind), ['created']);
});

test.after(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

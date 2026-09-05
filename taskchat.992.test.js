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

test('#992 a projectId that sanitises to nothing reads/keys as absent, never throws', () => {
  // store.safeKey THROWS on an all-disallowed-char id ('...', '!!!'); keyOf must
  // catch that so read()/taskChatFile() honour the fail-soft contract.
  assert.doesNotThrow(() => taskchat.read('...', 1));
  assert.deepEqual(taskchat.read('...', 1), []);
  assert.equal(taskchat.taskChatFile('!!!', 1), null);
  assert.equal(taskchat.record('...', 1, { kind: 'x' }), false);
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

test('#992 a refused assignPart records nothing (agent not on the project)', () => {
  const p = freshProject(['ada']); // bo is NOT a member
  const made = tasks.create(p.id, { sentence: 'x', made: { via: 'screen' } });
  const proj = projects.readAll().find((x) => x.id === p.id);
  const partId = tasks.partsOf(tasks.byNumber(proj, made.number))[0].id;
  assert.throws(() => tasks.assignPart(p.id, made.number, partId, 'bo', { via: 'screen' }));
  // the throw happens inside writeParts before any record; only 'created' stands
  assert.deepEqual(taskchat.read(p.id, made.number).map((r) => r.kind), ['created']);
});

test('#992 the rest of the lifecycle records too: part-added, part-closed/reopened, unassign', () => {
  const p = freshProject(['ada', 'bo']);
  const made = tasks.create(p.id, { sentence: 'work', who: 'ada', made: { via: 'screen' } });
  // add a second part (assigned to bo)
  const add = tasks.addPart(p.id, made.number, { sentence: 'the other half', who: 'bo', made: { via: 'screen' } });
  assert.equal(add.ok, true);
  // close then reopen that part
  const proj = projects.readAll().find((x) => x.id === p.id);
  const parts = tasks.partsOf(tasks.byNumber(proj, made.number));
  const partId = parts[parts.length - 1].id; // the just-added part
  assert.equal(tasks.setPartClosed(p.id, made.number, partId, new Date().toISOString()).ok, true);
  assert.equal(tasks.setPartClosed(p.id, made.number, partId, null).ok, true);
  // take somebody off a part (unassign to null is a real event)
  const firstPart = parts[0].id;
  const un = tasks.assignPart(p.id, made.number, firstPart, null, { via: 'screen' });
  assert.equal(un.ok, true);
  assert.equal(un.changed, true);

  const kinds = taskchat.read(p.id, made.number).map((r) => r.kind);
  assert.deepEqual(kinds, ['created', 'part-added', 'part-closed', 'part-reopened', 'assigned']);
  const unassign = taskchat.read(p.id, made.number).find((r) => r.kind === 'assigned');
  assert.equal(unassign.who, null, 'an unassign records who: null');
  // #992 (iter-6 nit): part-added carries its new part's id, exactly as the
  // sibling part events do, so a reader can correlate a part-added with the
  // part-closed / part-reopened / assigned events on that same part.
  const partAdded = taskchat.read(p.id, made.number).find((r) => r.kind === 'part-added');
  assert.equal(typeof partAdded.partId, 'number', 'part-added stores partId as a number');
  assert.equal(partAdded.partId, partId, 'part-added carries the id of the part it added');
});

test('#992 a task created pre-assigned records its birth assignee on `created`', () => {
  const p = freshProject(['ada']);
  const made = tasks.create(p.id, { sentence: 'work', who: 'ada', made: { via: 'screen' } });
  const created = taskchat.read(p.id, made.number)[0];
  assert.equal(created.kind, 'created');
  assert.equal(created.who, 'ada', 'the original assignee is captured, not just later removals');
  // and an unassigned create records who: null (not missing)
  const p2 = freshProject();
  const m2 = tasks.create(p2.id, { sentence: 'solo', made: { via: 'screen' } });
  assert.equal(taskchat.read(p2.id, m2.number)[0].who, null);
});

test('#992 re-closing / re-reopening records no duplicate: only a real transition is logged', () => {
  const p = freshProject();
  const made = tasks.create(p.id, { sentence: 'x', made: { via: 'screen' } });
  tasks.close(p.id, made.number);
  tasks.close(p.id, made.number); // already closed -> no new event
  tasks.reopen(p.id, made.number);
  tasks.reopen(p.id, made.number); // already open -> no new event
  const kinds = taskchat.read(p.id, made.number).map((r) => r.kind);
  assert.deepEqual(kinds, ['created', 'closed', 'reopened'], 'a re-close/re-open logs nothing');
});

test('#992 re-closing a PART records no duplicate either (same transition gate)', () => {
  const p = freshProject(['ada']);
  const made = tasks.create(p.id, { sentence: 'x', who: 'ada', made: { via: 'screen' } });
  const proj = projects.readAll().find((x) => x.id === p.id);
  const partId = tasks.partsOf(tasks.byNumber(proj, made.number))[0].id;
  tasks.setPartClosed(p.id, made.number, partId, new Date().toISOString());
  tasks.setPartClosed(p.id, made.number, partId, new Date().toISOString()); // already closed -> nothing
  tasks.setPartClosed(p.id, made.number, partId, null);
  tasks.setPartClosed(p.id, made.number, partId, null); // already open -> nothing
  const partEvents = taskchat.read(p.id, made.number).filter((r) => r.kind.startsWith('part-'));
  assert.deepEqual(partEvents.map((r) => r.kind), ['part-closed', 'part-reopened']);
});

test('#992 numeric fields keep their type: partId is a number, not a string', () => {
  const p = freshProject(['ada']);
  const made = tasks.create(p.id, { sentence: 'x', who: 'ada', made: { via: 'screen' } });
  const proj = projects.readAll().find((x) => x.id === p.id);
  const partId = tasks.partsOf(tasks.byNumber(proj, made.number))[0].id;
  tasks.assignPart(p.id, made.number, partId, null, { via: 'screen' }); // a move -> records assigned{partId}
  const assigned = taskchat.read(p.id, made.number).find((r) => r.kind === 'assigned');
  assert.equal(typeof assigned.partId, 'number', 'partId is stored as a number');
  assert.equal(assigned.partId, partId);
});

test('#992 completing a multi-part task by closing its last part records a task-level `closed`; reopening a part records `reopened`', () => {
  // The gap this closes: a multi-part task completes via the DERIVED
  // progressOf().closed state (all parts closed) with no task.closedAt write, so
  // before this its completion showed only as part-closed lines and never a
  // task-level `closed`. See tasks.js setPartClosed.
  const p = freshProject(['ada', 'bo']);
  const made = tasks.create(p.id, { sentence: 'two-parter', who: 'ada', made: { via: 'screen' } });
  tasks.addPart(p.id, made.number, { sentence: 'second half', who: 'bo', made: { via: 'screen' } });
  const proj = projects.readAll().find((x) => x.id === p.id);
  const [p1, p2] = tasks.partsOf(tasks.byNumber(proj, made.number)).map((x) => x.id);
  // close part 1 -> task NOT complete (part 2 still open) -> no task-level closed
  tasks.setPartClosed(p.id, made.number, p1, new Date().toISOString());
  assert.equal(taskchat.read(p.id, made.number).filter((r) => r.kind === 'closed').length, 0,
    'no task-level closed while another part is still open');
  // close part 2 (the last open one) -> task derived-complete -> records closed
  tasks.setPartClosed(p.id, made.number, p2, new Date().toISOString());
  const afterLast = taskchat.read(p.id, made.number);
  assert.equal(afterLast.filter((r) => r.kind === 'closed').length, 1,
    'closing the last open part completes the task and records a task-level closed');
  assert.deepEqual(afterLast.map((r) => r.kind).slice(-2), ['part-closed', 'closed'],
    'the derived task closed follows the part-closed that caused it');
  // reopen a part on the completed task -> no longer complete -> records reopened
  tasks.setPartClosed(p.id, made.number, p2, null);
  assert.deepEqual(taskchat.read(p.id, made.number).map((r) => r.kind).slice(-2),
    ['part-reopened', 'reopened'], 'reopening a part on a completed task records the task reopened');
});

test('#992 an explicit close of an already-complete (all-parts-closed) task records no duplicate `closed`', () => {
  // Consistency guard for the derived-transition model: setPartClosed already
  // recorded the completion, so an explicit close() on top of it is not a new
  // completion and must add nothing (setClosed compares the derived state).
  const p = freshProject(['ada']);
  const made = tasks.create(p.id, { sentence: 'x', who: 'ada', made: { via: 'screen' } });
  const proj = projects.readAll().find((x) => x.id === p.id);
  const partId = tasks.partsOf(tasks.byNumber(proj, made.number))[0].id;
  tasks.setPartClosed(p.id, made.number, partId, new Date().toISOString());
  assert.equal(taskchat.read(p.id, made.number).filter((r) => r.kind === 'closed').length, 1,
    'closing the only part already recorded the completion');
  tasks.close(p.id, made.number); // explicit close of an already-complete task
  assert.equal(taskchat.read(p.id, made.number).filter((r) => r.kind === 'closed').length, 1,
    'the explicit close adds no duplicate closed');
});

test('#992 a refused addPart records nothing (agent not on the project)', () => {
  const p = freshProject(['ada']); // bo is NOT a member
  const made = tasks.create(p.id, { sentence: 'x', made: { via: 'screen' } });
  // the membership throw sits inside writeParts before newPartId/record, so the
  // part-added line is never written -- only the create stands.
  assert.throws(() => tasks.addPart(p.id, made.number, { sentence: 'nope', who: 'bo', made: { via: 'screen' } }));
  assert.deepEqual(taskchat.read(p.id, made.number).map((r) => r.kind), ['created']);
});

test('#992 a failed transcript append never breaks the task: tasks.create still returns the task', () => {
  // #992 (iter-6 nit): the caller-side half of the best-effort promise. record()
  // swallows its own failure and returns false; this proves the task write that
  // triggered it still stands and the task is returned. Force the append to fail
  // by making the task-chats directory non-writable (a new file cannot be created
  // in a 0o555 dir). Assumes a non-root runner (this fleet runs as a normal user);
  // as root the write would not be blocked and the empty-transcript check would
  // fail loudly rather than false-pass -- which is the correct signal.
  const p = freshProject();
  const dir = taskchat.taskChatsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(dir, 0o555);
  try {
    const made = tasks.create(p.id, { sentence: 'survives a dead transcript', made: { via: 'screen' } });
    assert.ok(made && Number.isInteger(made.number), 'the task is still created and returned');
    assert.equal(made.sentence, 'survives a dead transcript');
    // the append failed and was swallowed, so nothing was recorded -- proving the
    // failure was real and yet did not propagate into the task write.
    assert.deepEqual(taskchat.read(p.id, made.number), [], 'record() failed silently; the task write stood anyway');
  } finally {
    fs.chmodSync(dir, 0o755); // restore so the round-robin after-hook can remove the tree
  }
});

test.after(() => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch { /* best effort */ } });

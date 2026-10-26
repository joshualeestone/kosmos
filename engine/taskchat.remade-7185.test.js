'use strict';
require('../test-support/tmpscope');   // kosmos#4273: every temp folder this file makes is removed when it exits

/**
 * #7185: a project's id comes from its name, and a task's conversation is stored by (project id, task number). A
 * project deleted and made again under the same name has the same id, so its new task 1 read the old task 1's
 * conversation, a person's words included. read() now keeps only rows stamped at or after the project's createdAt;
 * the old rows stay on disk.
 *
 * ⚠️ SANDBOX BOTH ROOTS BEFORE REQUIRING anything that reads them.
 *
 *   node --test engine/taskchat.remade-7185.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-remade-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-remade-proj-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const projects = require('../engine/projects');
const tasks = require('../engine/tasks');
const taskchat = require('../engine/taskchat');

const said = (id, n) => taskchat.read(id, n).filter((r) => r.kind === 'said').map((r) => r.text);

/* A project made, given task 1 with a message on it, then removed. Returns its id. The wait makes the next project's
   createdAt strictly later than every row written here, as it is on a real computer. */
async function madeAndRemoved(name, words) {
  const id = projects.create({ name }).id;
  const n = tasks.create(id, { sentence: 'First task' }).number;
  assert.ok(taskchat.record(id, n, { kind: 'said', text: words }), 'CONTROL: the message was recorded');
  assert.deepEqual(said(id, n), [words], 'CONTROL: the first project reads its own message');
  projects.remove(id);
  await new Promise((r) => setTimeout(r, 5));
  return id;
}

test('a project made again under a deleted one\'s name does not show the deleted one\'s task conversation', async () => {
  const first = await madeAndRemoved('Same name', 'from the first project');
  const second = projects.create({ name: 'Same name' }).id;
  assert.equal(second, first, 'CONTROL: the name gives the same id, which is how the old rows were reached');
  const n = tasks.create(second, { sentence: 'New first task' }).number;
  assert.equal(n, 1, 'CONTROL: the new task is task 1 again');
  const kinds = taskchat.read(second, n).map((r) => r.kind);
  assert.deepEqual(said(second, n), [], 'no message from the deleted project');
  assert.deepEqual(kinds, ['created'], 'only the new task\'s own history');
  assert.ok(taskchat.record(second, n, { kind: 'said', text: 'from the second project' }));
  assert.deepEqual(said(second, n), ['from the second project'], 'the new project still reads what it writes');
});

test('the deleted project\'s rows stay on disk (nothing deletes a person\'s words)', async () => {
  const id = await madeAndRemoved('Kept words', 'kept on disk');
  projects.create({ name: 'Kept words' });
  const file = taskchat.taskChatFile(id, 1);
  assert.match(fs.readFileSync(file, 'utf8'), /kept on disk/, 'the old row is still in the file');
});

test('the room\'s progress count does not count the deleted project\'s steps', async () => {
  const id = await madeAndRemoved('Progress name', 'old');
  assert.equal(taskchat.progressTimes(id).length, 1, 'CONTROL: with no project record there is no floor, and the old task\'s creation counts');
  projects.create({ name: 'Progress name' });
  assert.deepEqual(taskchat.progressTimes(id), [], 'the re-made project has made no progress yet');
  tasks.create(id, { sentence: 'Now' });
  assert.equal(taskchat.progressTimes(id).length, 1, 'its own new task counts once');
});

test('an id with no project record keeps every row (the old behaviour, so nothing that reads without a project breaks)', () => {
  assert.ok(taskchat.record('no-such-project-7185', 2, { kind: 'said', text: 'kept' }));
  assert.deepEqual(said('no-such-project-7185', 2), ['kept']);
});

/* The project room is the same class one store over: its rows (posts, notes, refusals) are tagged with the project
   id in one shared log (engine/messages.js), and messages.record() is what every room reader starts from. */
const messages = require('../engine/messages');
const roomTexts = (id) => messages.record().rows.filter((r) => r && r.project === id).map((r) => r.text);

test('a re-made project\'s room does not show the deleted project\'s room rows', async () => {
  const id = projects.create({ name: 'Room name' }).id;
  assert.ok(messages.roomNote(id, 'room line from the first project'), 'CONTROL: the room line was written');
  assert.deepEqual(roomTexts(id).filter((t) => /first project/.test(t)), ['room line from the first project'], 'CONTROL: the first project reads it');
  projects.remove(id);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(projects.create({ name: 'Room name' }).id, id, 'CONTROL: the same id again');
  assert.deepEqual(roomTexts(id).filter((t) => /first project/.test(t)), [], 'not shown in the new room');
  assert.ok(messages.roomNote(id, 'room line from the second project'));
  assert.deepEqual(roomTexts(id).filter((t) => /project$/.test(t)), ['room line from the second project'], 'the new room reads its own line');
  assert.match(fs.readFileSync(messages.LOG, 'utf8'), /room line from the first project/, 'the old line is still in the log');
});

test('when the projects file cannot be read, a project\'s rows are left out rather than shown', () => {
  const id = projects.create({ name: 'Unreadable ' + Math.random().toString(36).slice(2) }).id;
  const n = tasks.create(id, { sentence: 'Task' }).number;
  assert.ok(taskchat.record(id, n, { kind: 'said', text: 'private words' }));
  assert.deepEqual(said(id, n), ['private words'], 'CONTROL: readable, the row is shown');
  assert.ok(messages.roomNote(id, 'private room line'));
  assert.deepEqual(roomTexts(id), ['private room line'], 'CONTROL: readable, the room line is shown');
  const f = projects.file();
  const good = fs.readFileSync(f);
  fs.writeFileSync(f, good.toString('utf8') + ' not json');   // damaged: readAll throws, so the stamps cannot be known
  try {
    assert.throws(() => projects.readAll(), /cannot make sense/, 'CONTROL: the projects file really is unreadable now');
    assert.deepEqual(taskchat.read(id, n), [], 'unreadable: nothing is shown, so no other project\'s words can be');
    assert.deepEqual(roomTexts(id), [], 'and nothing from the room');
  } finally {
    fs.writeFileSync(f, good);
  }
  assert.deepEqual(said(id, n), ['private words'], 'readable again: shown again');
});

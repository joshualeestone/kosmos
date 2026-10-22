'use strict';
// kosmos#6894: a recurring task's run that CHANGED something is said in the project room, through the real ran route
// (setup as server.task-repeat-4787.test.js). Unchanged runs and duplicates say nothing there.
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-roomrun-srv-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, _resetRoomRunSaidForTest, _ageRoomRunSaidForTest } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const messages = require('./engine/messages');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const win32job = require('./engine/win32job');

let base;
let projectId;
test.before(async () => {
  win32job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.', code: 1 }));
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install([fleet.agent('mona', { state: 'idle' }), fleet.agent('zed', { state: 'idle' }), fleet.agent('fixture', { state: 'idle' })]).agents;
  const p = projects.create({ name: 'Room runs' });
  projects.addAgent(p.id, 'mona', roster);
  projects.addAgent(p.id, 'zed', roster);
  projectId = p.id;
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const post = async (p, body, headers = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
/* The room's notes in Kosmos's own voice, as the room reads them. */
const roomNotes = () => messages.record().rows.filter((m) => m && m.kind === 'note' && String(m.project) === String(projectId)).map((m) => m.text);

test('#6894: a changed run is said in the room once; an unchanged or duplicate run is not', async () => {
  const n = tasks.create(projectId, { sentence: 'Check the order queue', who: 'mona' }).number;
  const mona = { 'x-kosmos-agent-token': sendertoken.mint('mona').token };
  const zed = { 'x-kosmos-agent-token': sendertoken.mint('zed').token };
  let r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly' }, mona);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const start0 = roomNotes().length;
  const ran = async (body, who) => {
    _resetRoomRunSaidForTest();   // this test is about WHICH runs are said; the hourly hold has its own test below
    const res = await post(`/api/project/${projectId}/task/${n}/ran`, body, who);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    return roomNotes().slice(start0);
  };
  // Two runners take turns, so the board's one-minute duplicate rule (same runner) does not absorb a run.
  let notes = await ran({ note: 'found 3 new orders' }, mona);
  assert.deepEqual(notes, ['Task #' + n + ', "Check the order queue" (every hour): found 3 new orders'], 'a run with a new note is said');
  notes = await ran({ note: 'all clear' }, zed);
  assert.equal(notes.length, 2, 'another new note is said too');
  notes = await ran({ note: 'all clear' }, mona);
  assert.equal(notes.length, 2, 'the same note again (inferred unchanged) says nothing');
  notes = await ran({ note: 'checked', unchanged: true }, zed);
  assert.equal(notes.length, 2, 'a run marked unchanged says nothing');
  notes = await ran({ value: '2 errors' }, mona);
  assert.equal(notes.length, 3);
  assert.match(notes[2], /reading 2 errors$/, 'a first reading has nothing to compare with');
  notes = await ran({ value: '5 errors' }, zed);
  assert.equal(notes.length, 4);
  assert.match(notes[3], /reading 5 errors \(was 2 errors\)$/, 'a changed reading says what it was');
  notes = await ran({ value: '5 errors' }, mona);
  assert.equal(notes.length, 4, 'the same reading again says nothing');
  // The same runner twice within the minute is one run: the second is absorbed and says nothing.
  notes = await ran({ note: 'found 9 new orders' }, zed);
  assert.equal(notes.length, 5);
  notes = await ran({ note: 'found 10 new orders' }, zed);
  assert.equal(notes.length, 5, 'a duplicate inside the minute is not relayed');
  // Review 1: a note with a count in it is never "unchanged" to the board, but word for word the last change says nothing.
  notes = await ran({ note: 'checked 14 pages, all fine' }, mona);
  assert.equal(notes.length, 6);
  notes = await ran({ note: 'checked 14 pages, all fine' }, zed);
  assert.equal(notes.length, 6, 'the same counted note again says nothing');
  // Review 1: a reading corrected inside the minute (a duplicate) is said, and the next "was" follows it.
  notes = await ran({ value: '7 errors' }, mona);
  assert.match(notes[6], /reading 7 errors \(was 5 errors\)$/);
  notes = await ran({ value: '8 errors' }, mona);
  assert.equal(notes.length, 8, 'the same runner inside the minute, with a new reading: said');
  assert.match(notes[7], /reading 8 errors \(was 7 errors\)$/);
  // A note and a reading changed together are one line.
  notes = await ran({ note: 'found 2 new orders', value: '1 error' }, zed);
  assert.match(notes[8], /: found 2 new orders; reading 1 error \(was 8 errors\)$/);
  // The person recording a run from the screen is said the same way.
  notes = await ran({ note: 'restarted it by hand' }, { 'sec-fetch-site': 'same-origin' });
  assert.match(notes[9], /: restarted it by hand$/);
});

test('#6894: review 1: a task is said in the room at most once an hour, however often it changes', async () => {
  _resetRoomRunSaidForTest();
  const n = tasks.create(projectId, { sentence: 'Fast changer', who: 'mona' }).number;
  const mona = { 'x-kosmos-agent-token': sendertoken.mint('mona').token };
  const zed = { 'x-kosmos-agent-token': sendertoken.mint('zed').token };
  assert.equal((await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly' }, mona)).status, 200);
  const before = roomNotes().length;
  assert.equal((await post(`/api/project/${projectId}/task/${n}/ran`, { note: 'saw 1 thing' }, mona)).status, 200);
  assert.equal((await post(`/api/project/${projectId}/task/${n}/ran`, { note: 'saw 2 things' }, zed)).status, 200);
  assert.equal(roomNotes().length - before, 1, 'the second change inside the hour is not said');
  // Review 2: once the hour has passed, the next run says what the room has not heard, even a run that changed nothing.
  _ageRoomRunSaidForTest(61 * 60 * 1000);
  assert.equal((await post(`/api/project/${projectId}/task/${n}/ran`, {}, mona)).status, 200);
  const flushed = roomNotes().slice(before);
  assert.equal(flushed.length, 2, 'the held change is said on the first run after the hour');
  assert.match(flushed[1], /: saw 2 things$/);
  // And a reading held back is said against the last reading the ROOM saw, never one it did not.
  _resetRoomRunSaidForTest();
  const r = tasks.create(projectId, { sentence: 'Error count', who: 'mona' }).number;
  assert.equal((await post(`/api/project/${projectId}/task/${r}/repeat`, { every: 'hourly' }, mona)).status, 200);
  const at0 = roomNotes().length;
  assert.equal((await post(`/api/project/${projectId}/task/${r}/ran`, { value: '5 errors' }, mona)).status, 200);
  assert.equal((await post(`/api/project/${projectId}/task/${r}/ran`, { value: '9 errors' }, zed)).status, 200);   // held
  _ageRoomRunSaidForTest(61 * 60 * 1000);
  assert.equal((await post(`/api/project/${projectId}/task/${r}/ran`, { value: '12 errors' }, mona)).status, 200);
  const errs = roomNotes().slice(at0);
  assert.equal(errs.length, 2);
  assert.match(errs[1], /reading 12 errors \(was 5 errors\)$/, 'was names 5, which the room saw, not the held 9');
  // CONTROL: another task is not held by this one's hour (r was said moments ago).
  const c0 = roomNotes().length;
  const other = tasks.create(projectId, { sentence: 'Other task', who: 'mona' }).number;
  assert.equal((await post(`/api/project/${projectId}/task/${other}/repeat`, { every: 'hourly' }, mona)).status, 200);
  assert.equal((await post(`/api/project/${projectId}/task/${other}/ran`, { note: 'first look' }, mona)).status, 200);
  assert.equal(roomNotes().length - c0, 1);
});

test('#6894: CONTROL: setting the rule or a one-off task says nothing in the room', async () => {
  const before = roomNotes().length;
  const n = tasks.create(projectId, { sentence: 'Daily summary', who: 'mona' }).number;
  const mona = { 'x-kosmos-agent-token': sendertoken.mint('mona').token };
  const r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'daily', at: '09:00' }, mona);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const one = tasks.create(projectId, { sentence: 'One-off', who: 'mona' }).number;
  const refused = await post(`/api/project/${projectId}/task/${one}/ran`, { note: 'did it' }, mona);
  assert.equal(refused.status, 400, 'a one-off task has no runs');
  assert.equal(roomNotes().length, before);
});

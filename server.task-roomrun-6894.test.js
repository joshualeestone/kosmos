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
  // Review 5: one that found nothing new (a run with no note clears the task's change note, so it would say nothing).
  _ageRoomRunSaidForTest(61 * 60 * 1000);
  assert.equal((await post(`/api/project/${projectId}/task/${n}/ran`, { unchanged: true }, mona)).status, 200);
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
  // Review 2: a clock stepped back (the last line looks to be in the future) never mutes a task.
  _ageRoomRunSaidForTest(-2 * 60 * 60 * 1000);
  const c1 = roomNotes().length;
  assert.equal((await post(`/api/project/${projectId}/task/${other}/ran`, { note: 'second look' }, zed)).status, 200);
  assert.equal(roomNotes().length - c1, 1, 'a line stamped in the future does not hold the next one');
});

test('#6894: review 3: a held problem that cleared is not said later; a new rule starts fresh; a flushed note is not said twice', async () => {
  _resetRoomRunSaidForTest();
  const mona = { 'x-kosmos-agent-token': sendertoken.mint('mona').token };
  const zed = { 'x-kosmos-agent-token': sendertoken.mint('zed').token };
  const n = tasks.create(projectId, { sentence: 'Disk watch', who: 'mona' }).number;
  assert.equal((await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly' }, mona)).status, 200);
  const ran = async (body, who) => assert.equal((await post(`/api/project/${projectId}/task/${n}/ran`, body, who)).status, 200);
  const c0 = roomNotes().length;
  await ran({ note: 'all clear' }, mona);                 // said
  await ran({ note: 'disk at 91 percent' }, zed);         // held
  await ran({ note: 'all clear' }, mona);                 // held: back to what the room heard
  await ran({}, zed);                                     // a run with no note clears the task's change note
  _ageRoomRunSaidForTest(61 * 60 * 1000);
  await ran({}, mona);
  assert.deepEqual(roomNotes().slice(c0).length, 1, 'the cleared problem is never said as news');
  // Review 4: a held note that a bare run then replaced is dropped, not said after the hour (the bare run does not say
  // the problem is still there). CONTROL: a held note that nothing replaced IS said after the hour.
  await ran({ note: 'disk at 80 percent' }, zed);         // said (the hour has passed): opens a new hour
  await ran({ note: 'disk at 95 percent' }, mona);        // held
  await ran({}, zed);                                     // clears the task's note, and the held one
  _ageRoomRunSaidForTest(61 * 60 * 1000);
  await ran({}, mona);
  let notes = roomNotes().slice(c0);
  assert.equal(notes.length, 2, 'a held note a bare run replaced is never said as news');
  assert.match(notes[1], /: disk at 80 percent$/);
  await ran({ note: 'disk at 97 percent' }, zed);         // said: the hour has passed
  await ran({ note: 'disk at 99 percent' }, mona);        // held
  _ageRoomRunSaidForTest(61 * 60 * 1000);
  await ran({ unchanged: true }, zed);                    // flush: nothing replaced it, so the held note is said
  notes = roomNotes().slice(c0);
  assert.equal(notes.length, 4, 'CONTROL: a held note nothing replaced is said after the hour');
  assert.match(notes[3], /: disk at 99 percent$/);
  _ageRoomRunSaidForTest(61 * 60 * 1000);
  await ran({ note: 'disk at 99 percent' }, mona);
  assert.equal(roomNotes().slice(c0).length, 4, 'the note the room just heard is not said again');
  await ran({}, zed);                                     // clears the task's note, as before a new rule
  // A new rule starts fresh: the old rule's note does not silence the same words under it.
  assert.equal((await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'daily', at: '09:00' }, mona)).status, 200);
  await ran({ note: 'disk at 99 percent' }, mona);
  notes = roomNotes().slice(c0);
  assert.equal(notes.length, 5, 'under the new rule the note is news again');
  assert.match(notes[4], /\(every day at 9am\): disk at 99 percent$/);
});

test('#6894: review 4: a change note older than the room\'s first line is never said later as news', async () => {
  _resetRoomRunSaidForTest();
  const mona = { 'x-kosmos-agent-token': sendertoken.mint('mona').token };
  const zed = { 'x-kosmos-agent-token': sendertoken.mint('zed').token };
  const n = tasks.create(projectId, { sentence: 'Price watch', who: 'mona' }).number;
  assert.equal((await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly' }, mona)).status, 200);
  // Runners alternate: the same runner twice within a minute is one run (a duplicate).
  let turn = 0;
  const ran = async (body) => assert.equal((await post(`/api/project/${projectId}/task/${n}/ran`, body, (turn++ % 2) ? zed : mona)).status, 200);
  // Yesterday's change note, recorded before the room has heard anything of this task (as after a board restart).
  await ran({ note: 'price dropped to 40' });
  _resetRoomRunSaidForTest();
  const c0 = roomNotes().length;
  await ran({ unchanged: true, value: '41' });            // a reading-only run: said, naming the reading alone
  let notes = roomNotes().slice(c0);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /reading 41/);
  assert.doesNotMatch(notes[0], /price dropped/);
  _ageRoomRunSaidForTest(61 * 60 * 1000);
  await ran({ unchanged: true });                         // nothing new: the old note is not news
  assert.equal(roomNotes().slice(c0).length, 1, 'the standing note from before the first line is not said as news');
  // CONTROL: a new note after that IS said.
  await ran({ note: 'price rose to 45' });
  notes = roomNotes().slice(c0);
  assert.equal(notes.length, 2, 'CONTROL: a new note is said');
  assert.match(notes[1], /price rose to 45/);
});

test('#6894: review 4: a line the room did not get does not mute the task', async () => {
  _resetRoomRunSaidForTest();
  const mona = { 'x-kosmos-agent-token': sendertoken.mint('mona').token };
  const zed = { 'x-kosmos-agent-token': sendertoken.mint('zed').token };
  const n = tasks.create(projectId, { sentence: 'Queue watch', who: 'mona' }).number;
  assert.equal((await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly' }, mona)).status, 200);
  let turn = 0;   // the same runner twice within a minute is one run (a duplicate), so runners alternate
  const ran = async (body) => assert.equal((await post(`/api/project/${projectId}/task/${n}/ran`, body, (turn++ % 2) ? zed : mona)).status, 200);
  const real = messages.roomNote;
  let failed = 0;
  messages.roomNote = () => { failed++; return false; };
  try { await ran({ note: 'queue at 12' }); } finally { messages.roomNote = real; }
  assert.equal(failed, 1, 'the line was tried');
  const c0 = roomNotes().length;
  await ran({ note: 'queue at 14' });                     // within the hour: said, since the room never got the first
  const notes = roomNotes().slice(c0);
  assert.equal(notes.length, 1, 'a failed line does not hold the next one back for the hour');
  assert.match(notes[0], /queue at 14/);
});

test('#6894: review 5: a change the room never heard is not said once later runs replaced or cleared it', async () => {
  _resetRoomRunSaidForTest();
  const mona = { 'x-kosmos-agent-token': sendertoken.mint('mona').token };
  const zed = { 'x-kosmos-agent-token': sendertoken.mint('zed').token };
  const n = tasks.create(projectId, { sentence: 'Disk level', who: 'mona' }).number;
  assert.equal((await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly' }, mona)).status, 200);
  let turn = 0;   // the same runner twice within a minute is one run (a duplicate), so runners alternate
  const ran = async (body) => assert.equal((await post(`/api/project/${projectId}/task/${n}/ran`, body, (turn++ % 2) ? zed : mona)).status, 200);
  const c0 = roomNotes().length;
  await ran({ note: 'disk at 50 percent' });              // said
  await ran({ note: 'disk at 95 percent' });              // held
  _ageRoomRunSaidForTest(61 * 60 * 1000);
  await ran({ note: 'disk at 50 percent' });              // back to what the room heard: nothing to say
  await ran({});                                          // a bare run: says nothing of 95
  assert.equal(roomNotes().slice(c0).length, 1, 'the replaced 95 percent is never said as news');
  // A bare run as the FIRST run after the hour says nothing either (it cleared the note it would have said).
  await ran({ note: 'disk at 60 percent' });              // said: the hour had passed
  await ran({ note: 'disk at 97 percent' });              // held
  _ageRoomRunSaidForTest(61 * 60 * 1000);
  await ran({});
  let notes = roomNotes().slice(c0);
  assert.equal(notes.length, 2, 'a bare run never says the note it cleared');
  assert.match(notes[1], /: disk at 60 percent$/);
  // CONTROL: the same held change, with nothing replacing it, IS said after the hour.
  await ran({ note: 'disk at 70 percent' });              // said: the hour had passed
  await ran({ note: 'disk at 98 percent' });              // held
  _ageRoomRunSaidForTest(61 * 60 * 1000);
  await ran({ unchanged: true });
  notes = roomNotes().slice(c0);
  assert.equal(notes.length, 4, 'CONTROL: a held change nothing replaced is said');
  assert.match(notes[3], /: disk at 98 percent$/);
});

test('#6894: review 5: a problem that returns after a clear is news, even if the room was taken to know its words', async () => {
  _resetRoomRunSaidForTest();
  const mona = { 'x-kosmos-agent-token': sendertoken.mint('mona').token };
  const zed = { 'x-kosmos-agent-token': sendertoken.mint('zed').token };
  const n = tasks.create(projectId, { sentence: 'Space check', who: 'mona' }).number;
  assert.equal((await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly' }, mona)).status, 200);
  let turn = 0;
  const ran = async (body) => assert.equal((await post(`/api/project/${projectId}/task/${n}/ran`, body, (turn++ % 2) ? zed : mona)).status, 200);
  await ran({ note: 'disk full' });                       // recorded before the room heard anything of this task
  _resetRoomRunSaidForTest();
  const c0 = roomNotes().length;
  await ran({ unchanged: true, value: '41' });            // the first line: the reading; "disk full" taken as known
  await ran({});                                          // the problem clears
  _ageRoomRunSaidForTest(61 * 60 * 1000);
  await ran({ note: 'disk full' });                       // it comes back
  const notes = roomNotes().slice(c0);
  assert.equal(notes.length, 2, 'a problem that came back after a clear is said');
  assert.match(notes[1], /: disk full$/);
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

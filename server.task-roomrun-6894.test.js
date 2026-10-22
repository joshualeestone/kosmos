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
const { start, server } = require('./server');
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

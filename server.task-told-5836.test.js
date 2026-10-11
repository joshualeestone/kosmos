'use strict';
// kosmos#5836: last verified (a run's --value) and last communicated (kosmos task told), and the check between them,
// through the real server (setup as server.task-repeat-4787.test.js).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-told-srv-'));
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
const taskchat = require('./engine/taskchat');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const win32job = require('./engine/win32job');
const cli = require('./tools/windows/kosmos-cli');

let base;
let projectId;
test.before(async () => {
  win32job.setRunner(() => ({ ok: false, out: 'ERROR: The system cannot find the file specified.', code: 1 }));
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  /* `fixture`: the test fake-tmux answers every pane's session_name as fixture-discord, which ties to it. */
  const roster = fleet.install([fleet.agent('mona', { state: 'idle' }), fleet.agent('zed', { state: 'idle' }), fleet.agent('fixture', { state: 'idle' })]).agents;
  const p = projects.create({ name: 'Alpha' });
  projects.addAgent(p.id, 'mona', roster);
  projects.addAgent(p.id, 'fixture', roster);
  projectId = p.id;
});
test.after(() => {
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const newTask = (sentence) => tasks.create(projectId, { sentence, who: 'mona' }).number;
const stored = (n) => tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n);
/* A process post (no sec-fetch-site, no allowed Origin) is an agent's CLI; a screen post carries sec-fetch-site. */
const post = async (p, body, headers = {}) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const screen = { 'sec-fetch-site': 'same-origin' };


/* A run that sends a reading hears how it compares with what the PERSON was last told: never told, the same, or changed.
   Runs from one agent within a minute count once (RUN_DEDUP_MS), so the runs here alternate runners. */
test('#5836: the reading of a run is checked against what the person was last told, not against the last run', async () => {
  const n = newTask('Daily price check');
  const mona = sendertoken.mint('mona').token;
  const fixture = sendertoken.mint('fixture').token;
  let r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'daily', at: '09:00' }, { 'x-kosmos-agent-token': mona });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  // 1. First reading: the person has never been told anything, so it is news.
  r = await post(`/api/project/${projectId}/task/${n}/ran`, { note: 'checked the price', value: 'price  is $40' }, { 'x-kosmos-agent-token': mona });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.vs_told, { state: 'never' });
  assert.equal(stored(n).verified.value, 'price is $40', 'whitespace runs are folded');
  assert.equal(stored(n).verified.by, 'mona');
  // 2. The agent tells the person, then records it: told defaults to the last verified reading.
  r = await post(`/api/project/${projectId}/task/${n}/told`, {}, { 'x-kosmos-agent-token': mona });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(stored(n).told.value, 'price is $40');
  assert.equal(stored(n).told.by, 'mona');
  // 3. The same reading again (another runner): the same as what the person knows.
  r = await post(`/api/project/${projectId}/task/${n}/ran`, { value: 'price is $40' }, { 'x-kosmos-agent-token': fixture });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.vs_told.state, 'same');
  assert.equal(r.json.vs_told.told.value, 'price is $40');
  // 4. A new reading is compared with what the person was TOLD, and a run never moves what they were told.
  r = await post(`/api/project/${projectId}/task/${n}/ran`, { value: 'price is $45' }, screen);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.vs_told.state, 'changed');
  assert.equal(r.json.vs_told.told.value, 'price is $40', 'compared with what the person was told');
  assert.equal(stored(n).verified.person, true);
  assert.equal(stored(n).told.value, 'price is $40', 'a run never moves what the person was told');
  // 5. told with explicit words.
  r = await post(`/api/project/${projectId}/task/${n}/told`, { value: 'price went up to $45' }, screen);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(stored(n).told.value, 'price went up to $45');
  assert.equal(stored(n).told.person, true);
  // The page's tasks view carries both values (tskToldSentence reads them there).
  const list = await (await fetch(base + '/api/tasks?view=tasks&project=' + encodeURIComponent(projectId), { headers: screen })).json();
  const row = list.tasks.find((t) => t.number === n);
  assert.equal(row.verified && row.verified.value, 'price is $45', 'the tasks view does not carry the last verified reading');
  assert.equal(row.told && row.told.value, 'price went up to $45', 'the tasks view does not carry what the person was told');
  // CONTROL: a run with NO reading reports no comparison and leaves last verified as it was.
  await new Promise((res) => setTimeout(res, 5));
  r = await post(`/api/project/${projectId}/task/${n}/ran`, { note: 'checked again' }, { 'x-kosmos-agent-token': mona });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal('vs_told' in r.json, false);
});

/* The last run is NOT the baseline: a reading equal to the last run but different from what the person was told is
   still a change. This is the report's mistake, pinned. */
test('#5836: a reading that matches the last run but not what the person was told reads as changed', async () => {
  const n = newTask('Hourly status check');
  const mona = sendertoken.mint('mona').token;
  const fixture = sendertoken.mint('fixture').token;
  await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly' }, { 'x-kosmos-agent-token': mona });
  await post(`/api/project/${projectId}/task/${n}/ran`, { value: 'status ok' }, { 'x-kosmos-agent-token': mona });
  await post(`/api/project/${projectId}/task/${n}/told`, {}, { 'x-kosmos-agent-token': mona });
  // A run the agent saw but did not report.
  let r = await post(`/api/project/${projectId}/task/${n}/ran`, { value: 'status degraded' }, { 'x-kosmos-agent-token': fixture });
  assert.equal(r.json.vs_told.state, 'changed');
  // The next run sees the same thing as the last run: against its own memory it would be "no change". Against the person: changed.
  r = await post(`/api/project/${projectId}/task/${n}/ran`, { value: 'status degraded' }, screen);
  assert.equal(r.json.vs_told.state, 'changed', 'compared with the last run instead of with what the person was told');
  assert.equal(r.json.vs_told.told.value, 'status ok');
});

test('#5836: told is refused with a sentence: nothing verified yet, a one-off task, a bad reading, an agent off the project', async () => {
  const n = newTask('Weekly report');
  const mona = sendertoken.mint('mona').token;
  await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'weekly', on: 'mon', at: '09:00' }, { 'x-kosmos-agent-token': mona });
  let r = await post(`/api/project/${projectId}/task/${n}/told`, {}, { 'x-kosmos-agent-token': mona });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.match(r.json.error, /no reading is recorded/);
  const oneOff = newTask('A one-off');
  r = await post(`/api/project/${projectId}/task/${oneOff}/told`, { value: 'x' }, { 'x-kosmos-agent-token': mona });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.match(r.json.error, /does not repeat/);
  r = await post(`/api/project/${projectId}/task/${n}/ran`, { value: 'x'.repeat(501) }, { 'x-kosmos-agent-token': mona });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.match(r.json.error, /at most 500/);
  r = await post(`/api/project/${projectId}/task/${n}/ran`, { value: 7 }, { 'x-kosmos-agent-token': mona });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  const zed = sendertoken.mint('zed').token;
  r = await post(`/api/project/${projectId}/task/${n}/told`, { value: 'x' }, { 'x-kosmos-agent-token': zed });
  assert.equal(r.status, 403, JSON.stringify(r.json));
  assert.equal(stored(n).told, undefined, 'a refused told recorded something');
});

/* Review 1: a second report inside the minute from the same agent counts once (RUN_DEDUP_MS), but its reading is what the
   agent now sees: the check answers for the reading SENT, and keeps it as last verified. Was: a false "same". */
test('#5836: a run absorbed as a duplicate still answers for the reading it sent, and keeps it', async () => {
  const n = newTask('Error count check');
  const mona = sendertoken.mint('mona').token;
  await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly' }, { 'x-kosmos-agent-token': mona });
  await post(`/api/project/${projectId}/task/${n}/ran`, { value: '2 errors' }, { 'x-kosmos-agent-token': mona });
  await post(`/api/project/${projectId}/task/${n}/told`, {}, { 'x-kosmos-agent-token': mona });
  const r = await post(`/api/project/${projectId}/task/${n}/ran`, { value: '3 errors' }, { 'x-kosmos-agent-token': mona });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.duplicate, true, 'fixture: the second run inside the minute is absorbed as a duplicate');
  assert.equal(r.json.vs_told.state, 'changed', 'a duplicate answered for the thrown-away reading');
  assert.equal(stored(n).verified.value, '3 errors', 'the new reading was not kept');
});

/* Review 1: a bare told records the latest reading only when it is the caller's own: two agents on one task. */
test('#5836: a bare told after ANOTHER agent recorded the latest reading is refused; with --value it is taken', async () => {
  const n = newTask('Shared check');
  const mona = sendertoken.mint('mona').token;
  const fixture = sendertoken.mint('fixture').token;
  await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly' }, { 'x-kosmos-agent-token': mona });
  await post(`/api/project/${projectId}/task/${n}/ran`, { value: '4' }, { 'x-kosmos-agent-token': fixture });
  let r = await post(`/api/project/${projectId}/task/${n}/told`, {}, { 'x-kosmos-agent-token': mona });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.match(r.json.error, /recorded by fixture, not by you: say what you told the person with --value/);
  assert.equal(stored(n).told, undefined);
  r = await post(`/api/project/${projectId}/task/${n}/told`, { value: '3' }, { 'x-kosmos-agent-token': mona });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(stored(n).told.value, '3');
  // CONTROL: the agent that recorded it can take the default.
  r = await post(`/api/project/${projectId}/task/${n}/told`, {}, { 'x-kosmos-agent-token': fixture });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(stored(n).told.value, '4');
});

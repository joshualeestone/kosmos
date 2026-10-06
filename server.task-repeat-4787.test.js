'use strict';
// kosmos#4787: the repeat and ran routes through the real server (setup as server.task-built-3951.test.js).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-repeat-srv-'));
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

/* kosmos#4787: the repeat and ran routes. An agent on the project sets a rule and records runs by its token; the page
   reads the rule's words and next run off GET /api/tasks; a non-member, an unidentified process, a bad rule and a run on
   a one-off task are each refused with a sentence. */
test('#4787: an agent on the project makes its task repeat, records runs, and the tasks list says the rule and the next run', async () => {
  const n = newTask('Hourly listings check');
  const minted = sendertoken.mint('mona');
  let r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly', at: ':15' }, { 'x-kosmos-agent-token': minted.token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(stored(n).repeat, { every: 'hour', minute: 15 });
  assert.equal(r.json.words, 'every hour at :15');
  r = await post(`/api/project/${projectId}/task/${n}/ran`, { note: 'found 3 new listings' }, { 'x-kosmos-agent-token': minted.token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(stored(n).lastRunBy, 'mona');
  assert.equal(stored(n).lastRunNote, 'found 3 new listings');
  // The agents' plain list carries the words and the next run too (kosmos task list reads it).
  const plain = await (await fetch(base + '/api/tasks?project=' + encodeURIComponent(projectId), { headers: screen })).json();
  assert.equal(plain.tasks.find((t) => t.number === n).repeatWords, 'every hour at :15');
  const list = await (await fetch(base + '/api/tasks?view=tasks&project=' + encodeURIComponent(projectId), { headers: screen })).json();
  const row = list.tasks.find((t) => t.number === n);
  assert.equal(row.repeatWords, 'every hour at :15');
  assert.ok(Number.isFinite(row.repeatNextAt) && row.repeatNextAt > Date.now(), 'the next run is in the future');
  assert.equal(new Date(row.repeatNextAt).getMinutes(), 15, 'at :15 local');
  assert.match(row.repeatNextWords, /^(today|tomorrow) at \d{1,2}:15(am|pm)$/, 'the board says the next run in its own time');
});

test('#4787: the person can set a weekly rule and record a run from the screen; clearing stops it', async () => {
  const n = newTask('Weekly report');
  let r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'weekly', on: 'mon', at: '09:30' }, screen);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.words, 'every Monday at 9:30am');
  r = await post(`/api/project/${projectId}/task/${n}/ran`, {}, screen);
  assert.equal(r.status, 200);
  assert.equal(stored(n).lastRunByPerson, true, 'the person is a flag (review 5)');
  assert.equal('lastRunBy' in stored(n), false);
  const mona = sendertoken.mint('mona');
  r = await post(`/api/project/${projectId}/task/${n}/repeat`, { clear: true }, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 403, 'an agent cannot clear the person\'s rule');
  assert.match(r.json.error, /only they can change it/);
  r = await post(`/api/project/${projectId}/task/${n}/repeat`, { clear: true }, screen);
  assert.equal(r.status, 200);
  assert.equal('repeat' in stored(n), false);
});

test('#4787: refusals: a bad rule (400), a run on a one-off task (400), a non-member agent (403), an unidentified process (403)', async () => {
  const n = newTask('One-off');
  let r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'daily', at: '9am' }, screen);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /HH:MM/);
  r = await post(`/api/project/${projectId}/task/${n}/ran`, {}, screen);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /does not repeat/);
  const zed = sendertoken.mint('zed');
  r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly' }, { 'x-kosmos-agent-token': zed.token });
  assert.equal(r.status, 403, 'zed is not on the project');
  r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly' });   // a process with no token and no pane
  assert.equal(r.status, 403);
  assert.match(r.json.error, /could not tell which agent/);
  assert.equal('repeat' in stored(n), false, 'no refusal stored anything');
  r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly' }, screen);
  assert.equal(r.status, 200, 'CONTROL: the same rule from the screen is accepted');
});

test('#4787 review 3: an agent cannot close a task the person set to repeat; the person can (control)', async () => {
  const n = newTask('Morning digest');
  let r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'daily', at: '07:00' }, screen);
  assert.equal(r.status, 200);
  const mona = sendertoken.mint('mona');
  r = await post(`/api/project/${projectId}/task/${n}/close`, {}, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /only they can close it/);
  assert.ok(stored(n).repeat, 'still repeating');
  r = await post(`/api/project/${projectId}/task/${n}/close`, {}, screen);
  assert.equal(r.status, 200, 'CONTROL: the person closes it');
  assert.equal('repeat' in stored(n), false);
});

test('#4787 review 4: an agent may close a non-last part of the person\'s repeating task, but not the last one', async () => {
  const n = newTask('Weekly sweep');
  let r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'weekly', on: 'fri', at: '16:00' }, screen);
  assert.equal(r.status, 200);
  tasks.addPart(projectId, n, { sentence: 'second half', who: 'mona' });
  const parts = tasks.partsOf(stored(n));
  assert.equal(parts.length, 2, 'precondition: two parts');
  const mona = sendertoken.mint('mona');
  r = await post(`/api/project/${projectId}/task/${n}/part/${parts[0].id}/close`, {}, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 200, 'a part that leaves another open is just work: allowed ' + JSON.stringify(r.json));
  r = await post(`/api/project/${projectId}/task/${n}/part/${parts[1].id}/close`, {}, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 409, 'closing the last part would end the person\'s rule');
  assert.ok(stored(n).repeat);
});

test('#4787 review 5: a process closing part "01" is the same part 1: the last-part refusal still holds', async () => {
  const n = newTask('Daily backup check');
  let r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'daily', at: '06:00' }, screen);
  assert.equal(r.status, 200);
  const parts = tasks.partsOf(stored(n));
  const mona = sendertoken.mint('mona');
  r = await post(`/api/project/${projectId}/task/${n}/part/0${parts[0].id}/close`, {}, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 409);
  assert.ok(stored(n).repeat);
});

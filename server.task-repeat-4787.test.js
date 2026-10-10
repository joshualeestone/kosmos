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
  /* kosmos#5752 slice 2: the refusal names its fix, for a rule and for a run (a scheduled run by a non-member). */
  const fix = "that agent is not on this project, so it cannot change its tasks; ask the person to add this agent with the + beside Members on the project's page, then run the same command again";
  assert.equal(r.json.error, fix);
  r = await post(`/api/project/${projectId}/task/${n}/ran`, { note: 'a scheduled run' }, { 'x-kosmos-agent-token': zed.token });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, fix);
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

test('#4787 slice 1b: the projects list (what the task page reads) carries the board\'s repeat words; a one-off task carries none (control)', async () => {
  const n = newTask('Morning numbers');
  const plain = newTask('One-off');
  const r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'day', at: '08:15' }, screen);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const res = await fetch(base + '/api/projects', { headers: screen });
  assert.equal(res.status, 200);
  const all = await res.json();
  const list = Array.isArray(all) ? all : all.projects;
  const p = list.find((x) => x.id === projectId);
  const t = p.tasks.find((x) => Number(x.number) === Number(n));
  assert.equal(t.repeatWords, 'every day at 8:15am');
  assert.match(t.repeatNextWords, /8:15am/);
  assert.ok(Number.isFinite(t.repeatNextAt));
  const o = p.tasks.find((x) => Number(x.number) === Number(plain));
  assert.equal('repeatWords' in o, false, 'CONTROL: a task with no rule gets no repeat words');
});

test('#4787 slice 3: the reviewer rides the repeat route: an agent names an agent, only the screen names the person, and a person-reviewed miss is in Needs Your Decision', async () => {
  const n = newTask('Daily digest');
  const mona = sendertoken.mint('mona');
  let r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'daily', at: '09:00', reviewer: 'fixture' }, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(stored(n).repeatReviewer, 'fixture');
  r = await post(`/api/project/${projectId}/task/${n}/repeat`, { reviewer: 'me' }, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 403, 'an agent cannot name the person');
  assert.match(r.json.error, /only the person/);
  r = await post(`/api/project/${projectId}/task/${n}/repeat`, { reviewer: 'zed' }, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 400, 'zed is not on the project');
  r = await post(`/api/project/${projectId}/task/${n}/repeat`, { reviewer: 'me' }, screen);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(stored(n).repeatReviewerPerson, true);
  assert.deepEqual(stored(n).repeat, { every: 'day', at: '09:00' }, 'the reviewer alone leaves the rule as it is');
  r = await post(`/api/project/${projectId}/task/${n}/repeat`, {}, screen);
  assert.equal(r.status, 400, 'neither a rule nor a reviewer: refused, nothing changed');
  // A miss: rule and reviewer two days back, no run since. The Tasks route puts it in Needs Your Decision.
  const ago = new Date(Date.now() - 2 * 86400000).toISOString();
  projects.mutate(projectId, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === n ? { ...t, repeatSetAt: ago, repeatReviewerSetAt: ago } : t)) }));
  const list = await (await fetch(base + '/api/tasks?view=tasks&project=' + encodeURIComponent(projectId), { headers: screen })).json();
  const row = list.tasks.find((t) => t.number === n);
  assert.ok(row.repeatMissed >= 1, 'precondition: a run is missed');
  assert.equal(row.waitingOnPerson, true);
  assert.equal(row.state, 'decision');
  // CONTROL: the same miss with an agent reviewer is not on the person.
  r = await post(`/api/project/${projectId}/task/${n}/repeat`, { reviewer: 'fixture' }, screen);
  projects.mutate(projectId, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === n ? { ...t, repeatSetAt: ago, repeatReviewerSetAt: ago } : t)) }));
  const list2 = await (await fetch(base + '/api/tasks?view=tasks&project=' + encodeURIComponent(projectId), { headers: screen })).json();
  assert.notEqual(list2.tasks.find((t) => t.number === n).state, 'decision');
});

test('#4787 slice 3 review 1: a rule sent with a refused reviewer leaves the rule as it was; a held person-reviewed miss stays On hold', async () => {
  const n = newTask('Weekly sweep');
  const mona = sendertoken.mint('mona');
  let r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'daily', at: '08:00' }, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 200);
  r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'weekly', on: 'mon', at: '09:00', reviewer: 'bobb' }, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 400);
  assert.deepEqual(stored(n).repeat, { every: 'day', at: '08:00' }, 'nothing half-applied');
  r = await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'weekly', on: 'mon', at: '09:00', reviewer: 'fixture' }, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 200, 'CONTROL: a good reviewer with the rule takes both');
  assert.equal(stored(n).repeat.every, 'week');
  // Held: the person reviews it and a run is missed, but parking it means not now.
  await post(`/api/project/${projectId}/task/${n}/repeat`, { reviewer: 'me' }, screen);
  const ago = new Date(Date.now() - 15 * 86400000).toISOString();
  projects.mutate(projectId, (x) => ({ ...x, tasks: x.tasks.map((t) => (t.number === n ? { ...t, repeatSetAt: ago, repeatReviewerSetAt: ago } : t)) }));
  const before = (await (await fetch(base + '/api/tasks?view=tasks&project=' + encodeURIComponent(projectId), { headers: screen })).json()).tasks.find((t) => t.number === n);
  assert.equal(before.state, 'decision', 'precondition');
  tasks.setOnHold(projectId, n, true, { viaScreen: true });
  const after = (await (await fetch(base + '/api/tasks?view=tasks&project=' + encodeURIComponent(projectId), { headers: screen })).json()).tasks.find((t) => t.number === n);
  assert.equal(after.state, 'held');
});

test('#4787 slice 3 review 2: a rule and reviewer for a task that does not exist answers 404, as the rule alone does', async () => {
  const r = await post(`/api/project/${projectId}/task/99999/repeat`, { every: 'daily', at: '09:00', reviewer: 'fixture' }, screen);
  assert.equal(r.status, 404, JSON.stringify(r.json));
});

test('#4787 slice 3 review 3: a time or day sent without a frequency is refused, not dropped', async () => {
  const n = newTask('Time without frequency');
  await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'daily', at: '08:00' }, screen);
  const r = await post(`/api/project/${projectId}/task/${n}/repeat`, { reviewer: 'fixture', at: '10:00' }, screen);
  assert.equal(r.status, 400);
  assert.match(r.json.error, /goes with how often/);
  assert.equal(stored(n).repeatReviewer, undefined, 'nothing applied');
});

test('#4787 slice 3 review 4: a process stopping a task whose reviewer the person chose is refused with 403', async () => {
  const n = newTask('Person-reviewed');
  const mona = sendertoken.mint('mona');
  await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'daily', at: '09:00' }, { 'x-kosmos-agent-token': mona.token });
  await post(`/api/project/${projectId}/task/${n}/repeat`, { reviewer: 'me' }, screen);
  const r = await post(`/api/project/${projectId}/task/${n}/repeat`, { clear: true }, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 403);
  assert.match(r.json.error, /only they can stop it repeating/);
});

test('#4787 slice 3 review 6: a process cannot close a task whose reviewer the person chose (it would drop the choice)', async () => {
  const n = newTask('Close guard');
  const mona = sendertoken.mint('mona');
  await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'daily', at: '09:00' }, { 'x-kosmos-agent-token': mona.token });
  let r = await post(`/api/project/${projectId}/task/${n}/close`, {}, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 200, 'CONTROL: an agent may close a task whose rule it set and whose reviewer nobody chose: ' + JSON.stringify(r.json));
  const m = newTask('Close guard 2');
  await post(`/api/project/${projectId}/task/${m}/repeat`, { every: 'daily', at: '09:00' }, { 'x-kosmos-agent-token': mona.token });
  await post(`/api/project/${projectId}/task/${m}/repeat`, { reviewer: 'fixture' }, screen);
  r = await post(`/api/project/${projectId}/task/${m}/close`, {}, { 'x-kosmos-agent-token': mona.token });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(stored(m).repeatReviewer, 'fixture');
});

/* kosmos#5752 slice 2: every refusal for an agent acting on a project it is not on names the fix, one arm per site. */
test('#5752 slice 2: a non-member agent is told how to be added, on each of its own task writes (the reads: server.agent-reads-4491.test.js)', async () => {
  const n = newTask('A scheduled check');
  const zed = { 'x-kosmos-agent-token': sendertoken.mint('zed').token };
  const fix = "; ask the person to add this agent with the + beside Members on the project's page, then run the same command again";
  const arms = [
    ['add a task (the shared helper)', () => post(`/api/project/${projectId}/tasks`, { sentence: 'not mine' }, zed), 'add tasks to it'],
    ['the built mark', () => post(`/api/project/${projectId}/task/${n}/built`, { note: '1 met.' }, zed), 'mark its tasks'],
    ['a task message', () => post(`/api/project/${projectId}/task/${n}/message`, { text: 'hello' }, zed), 'write in its tasks'],
    ['record a run', () => post(`/api/project/${projectId}/task/${n}/ran`, {}, zed), 'change its tasks'],
  ];
  for (const [what, call, verb] of arms) {
    const r = await call();
    assert.equal(r.status, 403, what + ': ' + JSON.stringify(r.json));
    assert.equal(r.json && r.json.error, 'that agent is not on this project, so it cannot ' + verb + fix, what);
  }
  // Round 1: its own role on the project, and its post into the project's room (the `kosmos post` path).
  let r = await post(`/api/project/${projectId}/role`, { role: 'checker' }, zed);
  assert.equal(r.status, 403, 'role: ' + JSON.stringify(r.json));
  assert.equal(r.json.error, 'that agent is not on this project' + fix, 'role');
  r = await post('/api/project/' + projectId + '/role', { role: 'checker', name: 'zed' }, screen);
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'that agent is not on this project', 'CONTROL: the person setting a role is not told to add anyone');
  // CONTROL: a member's own run is not refused, so the arms above are about membership, not the request.
  const mona = { 'x-kosmos-agent-token': sendertoken.mint('mona').token };
  await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly' }, mona);
  assert.equal((await post(`/api/project/${projectId}/task/${n}/ran`, {}, mona)).status, 200);
});

/* kosmos#5752 slice 3: a refused task write is also a row in the project's room, so the person sees it and can add the
   agent from there. */
test('#5752 slice 3: a non-member\'s refused task writes are room rows saying what it tried, offering the add, once each', async () => {
  const n = newTask('A scheduled check, slice 3');
  const zed = { 'x-kosmos-agent-token': sendertoken.mint('zed').token };
  await post(`/api/project/${projectId}/task/${n}/ran`, {}, zed);
  await post(`/api/project/${projectId}/task/${n}/ran`, {}, zed);   // the same refusal again: still one row
  await post(`/api/project/${projectId}/task/${n}/built`, { note: '1 met.' }, zed);
  await post(`/api/project/${projectId}/task/${n}/message`, { text: 'hello' }, zed);
  await post(`/api/project/${projectId}/tasks`, { sentence: 'not mine' }, zed);
  await post(`/api/project/${projectId}/role`, { role: 'checker' }, zed);
  const res = await fetch(base + `/api/project/${encodeURIComponent(projectId)}/room`, { headers: screen });
  const room = await res.json();
  const rows = (room.rows || room.messages || room).filter((m) => m && m.kind === 'refused' && m.from === 'zed');
  assert.deepEqual(rows.map((m) => [m.doing, m.addable, m.because]), [
    ['record a run of a task', true, 'that agent is not on this project, so it cannot change its tasks'],
    ['mark a task built', true, 'that agent is not on this project, so it cannot mark its tasks'],
    ['write in a task', true, 'that agent is not on this project, so it cannot write in its tasks'],
    ['add a task', true, 'that agent is not on this project, so it cannot add tasks to it'],
    ['set its role here', true, 'that agent is not on this project'],
  ], 'one row per refusal, the bare sentence (never the agent-directed fix): ' + JSON.stringify(room).slice(0, 300));
  // The agents' own view of the room says what was tried too.
  const text = await (await fetch(base + `/api/project/${encodeURIComponent(projectId)}/room?as=text`, { headers: screen })).text();
  assert.match(text, /zed tried to record a run of a task here and Kosmos stopped it: that agent is not on this project/);
  // CONTROL: a member's own run leaves no refused row.
  const mona = { 'x-kosmos-agent-token': sendertoken.mint('mona').token };
  await post(`/api/project/${projectId}/task/${n}/repeat`, { every: 'hourly' }, mona);
  await post(`/api/project/${projectId}/task/${n}/ran`, {}, mona);
  const again = await (await fetch(base + `/api/project/${encodeURIComponent(projectId)}/room`, { headers: screen })).json();
  assert.equal((again.rows || again.messages || again).filter((m) => m && m.kind === 'refused' && m.from === 'mona').length, 0);
});

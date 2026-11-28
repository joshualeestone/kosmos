'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9217 slice 1: `kosmos heavy start/end` (POST /api/heavy) and the board's status (heavyJobs). Over HTTP on a
 * sandboxed board: an agent records and ends only its own heavy job, a page request is refused, a bad label is refused
 * in the engine's words, and /api/status and GET /api/heavy list what is running.
 *
 *   node --test server.heavy-9217.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-heavy-9217-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, boardAuthState, _heavyJobsNowForTest: heavyJobsNow, _heavyMissingSinceForTest: heavyMissingSince } = require('./server');
const store = require('./engine/store');
const sendertoken = require('./engine/sendertoken');
const fleet = require('./test-support/fleet');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
});
test.after(() => { try { fleet.restore(); } catch { /* best effort */ } try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const post = (body, headers) => fetch(`${base}/api/heavy`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const asAgent = (token, body) => post(body, { 'x-kosmos-agent-token': token });
const asScreen = (body) => post(body, { 'sec-fetch-site': 'same-origin' });
const jobsInStatus = async () => (await (await fetch(`${base}/api/status`)).json()).heavyJobs;

function twoAgents() {
  const board = fleet.install([fleet.agent('hv-ada', { state: 'idle', displayName: 'Ada Heavy' }), fleet.agent('hv-bo', { state: 'idle', displayName: 'Bo Heavy' })]);
  const card = (p) => board.agents.find((c) => (c.sessionName || '').startsWith(p)) || {};
  // The real rows, from the fixture's producer, for the heavyJobsNow arms (fixture-discipline: no hand-built rows).
  return { board, ada: card('hv-ada').sessionName, bo: card('hv-bo').sessionName, adaCard: card('hv-ada'), boCard: card('hv-bo') };
}

test('kosmos#9217: an agent records its heavy job, the status lists it with its name, and end clears it', async () => {
  const { ada } = twoAgents();
  assert.ok(ada, 'the fleet gave no cards');
  const tok = sendertoken.mint(ada).token;
  assert.deepEqual(await jobsInStatus(), [], 'control: nothing is listed before the call');
  let r = await asAgent(tok, { action: 'start', label: '  full   test run ' });
  assert.equal(r.status, 200, await r.clone().text());
  const started = await r.json();
  assert.equal(started.ok, true);
  assert.equal(started.job.label, 'full test run');
  const status = await (await fetch(`${base}/api/status`)).json();
  const listed = status.heavyJobs;
  assert.deepEqual(listed.map((j) => [j.agent, j.label, j.pid]), [[ada, 'full test run', null]]);
  const row = (status.agents || []).find((a) => a.sessionName === ada);
  assert.ok(row && row.name && row.name !== ada, 'control: the agent has a name other than its session name');
  assert.equal(listed[0].name, row.name, 'the job carries the name the board shows for that agent');
  const got = await (await fetch(`${base}/api/heavy`, { headers: { 'x-kosmos-agent-token': tok } })).json();
  assert.deepEqual(got.jobs.map((j) => j.label), ['full test run'], 'GET /api/heavy lists the same');
  r = await asAgent(tok, { action: 'end' });
  assert.deepEqual(await r.json(), { ok: true, ended: 1, others: 0 });
  assert.deepEqual(await jobsInStatus(), []);
});

test('kosmos#9217: one agent cannot end another agent\'s job', async () => {
  const { ada, bo } = twoAgents();
  const ta = sendertoken.mint(ada).token, tb = sendertoken.mint(bo).token;
  assert.equal((await asAgent(ta, { action: 'start', label: 'ada job' })).status, 200);
  assert.deepEqual(await (await asAgent(tb, { action: 'end' })).json(), { ok: true, ended: 0, others: 0 });
  assert.deepEqual((await jobsInStatus()).map((j) => j.agent), [ada]);
  await asAgent(ta, { action: 'end' });
});

test('kosmos#9217: a process that does not exist is refused at start', async () => {
  const { ada } = twoAgents();
  const tok = sendertoken.mint(ada).token;
  const r = await asAgent(tok, { action: 'start', label: 'tied', pid: process.pid });
  assert.equal(r.status, 200, await r.clone().text());
  assert.equal((await jobsInStatus()).length, 1, 'control: this live process keeps it');
  const child = require('node:child_process').spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  const dead = Number(child.stdout);
  let reused = false;
  try { process.kill(dead, 0); reused = true; } catch { /* gone, as expected */ }
  if (reused) { await asAgent(tok, { action: 'end', pid: process.pid }); return; }   // its number already went to another process
  const refused = await asAgent(tok, { action: 'start', label: 'gone', pid: dead });
  assert.equal(refused.status, 400, 'a process that does not exist is refused at start');
  assert.match((await refused.json()).error, /there is no process/);
  await asAgent(tok, { action: 'end', pid: process.pid });
});

test('kosmos#9217: a page request, a bad action and a bad label are refused, and nothing is recorded', async () => {
  const { ada } = twoAgents();
  const tok = sendertoken.mint(ada).token;
  assert.equal((await asScreen({ action: 'start', label: 'x' })).status, 403);
  let r = await asAgent(tok, { action: 'begin', label: 'x' });
  assert.deepEqual([r.status, (await r.json()).error], [400, 'say start, end, take or release']);
  r = await asAgent(tok, { action: 'start', label: '-x' });
  assert.deepEqual([r.status, (await r.json()).error], [400, 'a job cannot start with -']);
  assert.deepEqual(await jobsInStatus(), []);
});

test('kosmos#9217: the token names the caller, not a pane given in the body', async () => {
  const { ada, bo, boCard } = twoAgents();
  assert.ok(boCard && boCard.sessionName === bo, 'control: the fleet has the second agent');
  const pane = boCard.target;
  // Control: that pane, alone, does name the second agent, so the arm below can fail.
  const alone = await post({ action: 'start', label: 'by pane', from_pane: pane });
  assert.equal(alone.status, 200, await alone.clone().text());
  assert.deepEqual((await jobsInStatus()).map((j) => j.agent), [bo], 'control: the pane names the second agent');
  await post({ action: 'end', from_pane: pane });
  const tok = sendertoken.mint(ada).token;
  const r = await asAgent(tok, { action: 'start', label: 'whose', from_pane: pane });
  assert.equal(r.status, 200, await r.clone().text());
  assert.deepEqual((await jobsInStatus()).map((j) => j.agent), [ada], 'the token should name the caller, but the pane in the body did');
  await asAgent(tok, { action: 'end' });
});

test('kosmos#9217: with no credential at all, nothing is recorded', async () => {
  twoAgents();
  const r = await post({ action: 'start', label: 'nobody' });
  assert.ok(r.status === 403 || r.status === 503, 'status ' + r.status);
  assert.deepEqual(await jobsInStatus(), []);
});

test('kosmos#9217: GET /api/heavy refuses a read from another website', async () => {
  const r = await fetch(`${base}/api/heavy`, { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(r.status, 403);
  const ok = await fetch(`${base}/api/heavy`, { headers: { 'sec-fetch-site': 'same-origin' } });
  assert.equal(ok.status, 200, 'control: the page on this computer reads it');
});

test('kosmos#9217: an agent missing from the running rows keeps its job through the grace, then loses it; a partial read judges nobody', async () => {
  const { ada, bo, adaCard, boCard } = twoAgents();
  const tok = sendertoken.mint(ada).token;
  assert.equal((await asAgent(tok, { action: 'start', label: 'graced' })).status, 200);
  const t0 = Date.now() + 1000;
  const others = [boCard];
  const at = (dt, complete = true) => heavyJobsNow({ running: others, offline: [], complete }, t0 + dt).map((j) => j.label);
  assert.deepEqual(at(0), ['graced'], 'missing on one read: kept');
  assert.deepEqual(at(60 * 1000), ['graced'], 'still inside the grace: kept');
  assert.deepEqual(at(60 * 1000 + 1, false), ['graced'], 'a partial read clears nothing new');
  assert.deepEqual(at(5 * 60 * 1000), [], 'missing past the grace: gone');
  // The same, but the agent comes back inside the grace: its clock starts again.
  assert.equal((await asAgent(tok, { action: 'start', label: 'back' })).status, 200);
  const t1 = t0 + 10 * 60 * 1000;
  const back = [adaCard, ...others];
  assert.deepEqual(heavyJobsNow({ running: others, offline: [], complete: true }, t1).map((j) => j.label), ['back']);
  assert.deepEqual(heavyJobsNow({ running: back, offline: [], complete: true }, t1 + 60 * 1000).map((j) => [j.label, j.name]), [['back', adaCard.name]], 'back: kept, with its name');
  assert.deepEqual(heavyJobsNow({ running: others, offline: [], complete: true }, t1 + 120 * 1000).map((j) => j.label), ['back'], 'missing again: a new grace, not the old one');
  assert.deepEqual(heavyJobsNow(null, t1 + 400 * 1000).map((j) => j.label), [], 'GET (no roster) honours a grace run out on an earlier read');
});

test('kosmos#9217: partial reads never start an agent\'s grace; the first complete one does', async () => {
  const { ada, bo, adaCard } = twoAgents();
  const tok = sendertoken.mint(bo).token;
  assert.equal((await asAgent(tok, { action: 'start', label: 'partial' })).status, 200);   // and clears any old mark
  const t2 = Date.now() + 60 * 60 * 1000;
  const others = [adaCard];
  const read = (dt, complete) => heavyJobsNow({ running: others, offline: [], complete }, t2 + dt).map((j) => j.label);
  assert.deepEqual(read(0, false), ['partial']);
  assert.deepEqual(read(10 * 60 * 1000, false), ['partial'], 'ten minutes of partial reads: kept, the clock never started');
  assert.deepEqual(read(10 * 60 * 1000 + 1, true), ['partial'], 'the first complete read starts the grace');
  assert.deepEqual(read(20 * 60 * 1000, true), [], 'and it runs out from there');
});

test('kosmos#9217: a job tied to a process stops being listed once that process exits', async () => {
  const { ada } = twoAgents();
  const tok = sendertoken.mint(ada).token;
  const child = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    const r = await asAgent(tok, { action: 'start', label: 'child job', pid: child.pid });
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual((await jobsInStatus()).map((j) => j.label), ['child job'], 'control: listed while it runs');
  } finally {
    const gone = new Promise((res) => child.once('exit', res));
    child.kill('SIGKILL');   // this test's own child, by its handle
    await gone;
  }
  assert.deepEqual(await jobsInStatus(), [], 'still listed after its process exited');
});

test('kosmos#9217: a complete read with every agent stopped still starts the grace', async () => {
  const { ada, bo, adaCard, boCard } = twoAgents();
  const tok = sendertoken.mint(ada).token;
  assert.equal((await asAgent(tok, { action: 'start', label: 'all stopped' })).status, 200);
  const t3 = Date.now() + 2 * 60 * 60 * 1000;
  const stopped = { running: [], offline: [adaCard, boCard], complete: true };
  assert.deepEqual(heavyJobsNow(stopped, t3).map((j) => [j.label, j.name]), [['all stopped', adaCard.name]]);
  assert.deepEqual(heavyJobsNow(stopped, t3 + 5 * 60 * 1000), [], 'every agent stopped: the job still clears after the grace');
  assert.equal((await asAgent(tok, { action: 'start', label: 'empty read' })).status, 200);
  const none = { running: [], offline: [], complete: true };
  assert.deepEqual(heavyJobsNow(none, t3 + 10 * 60 * 1000).map((j) => j.label), ['empty read']);
  assert.deepEqual(heavyJobsNow(none, t3 + 20 * 60 * 1000).map((j) => j.label), ['empty read'], 'control: a read with no rows at all judges nobody');
  await asAgent(tok, { action: 'end' });
});

test('kosmos#9217: a missing mark does not outlive the job it was about', async () => {
  const { ada, bo, boCard } = twoAgents();
  const hj = require('./engine/heavyjobs');
  const others = { running: [boCard], offline: [], complete: true };
  const t4 = Date.now() + 4 * 60 * 60 * 1000;
  assert.equal(hj.start({ root: store.ROOT, agent: ada, label: 'first', now: t4 }).ok, true);
  assert.deepEqual(heavyJobsNow(others, t4).map((j) => j.label), ['first'], 'the mark starts here');
  assert.equal(hj.end({ root: store.ROOT, agent: ada }).ended, 1);
  assert.deepEqual(heavyJobsNow(others, t4 + 1000), [], 'no job: its mark goes with it');
  // A record made without the route (so nothing clears the mark there): a fresh grace, not the old one.
  assert.equal(hj.start({ root: store.ROOT, agent: ada, label: 'second', now: t4 + 5 * 60 * 1000 }).ok, true);
  assert.deepEqual(heavyJobsNow(others, t4 + 5 * 60 * 1000).map((j) => j.label), ['second'], 'a fresh grace: the old mark would have cleared it at once');
  assert.equal(hj.end({ root: store.ROOT, agent: ada }).ended, 1);
});

test('kosmos#9217: GET /api/heavy names each job by the name the board shows', async () => {
  const { ada } = twoAgents();
  const tok = sendertoken.mint(ada).token;
  assert.equal((await asAgent(tok, { action: 'start', label: 'named' })).status, 200);
  const status = await (await fetch(`${base}/api/status`)).json();
  const row = (status.agents || []).find((a) => a.sessionName === ada);
  assert.ok(row && row.name && row.name !== ada, 'control: this fleet gives the agent a name other than its session name');
  const got = await (await fetch(`${base}/api/heavy`, { headers: { 'x-kosmos-agent-token': tok } })).json();
  assert.deepEqual(got.jobs.map((j) => [j.label, j.name]), [['named', row.name]]);
  await asAgent(tok, { action: 'end' });
});

test('kosmos#9217: a read that is not complete but shows the agent running keeps its job, and clears the mark', async () => {
  const { ada, bo, adaCard, boCard } = twoAgents();
  const tok = sendertoken.mint(ada).token;
  assert.equal((await asAgent(tok, { action: 'start', label: 'seen running' })).status, 200);
  const t5 = Date.now() + 6 * 60 * 60 * 1000;
  const without = { running: [boCard], offline: [], complete: true };
  const withAda = { running: [adaCard, boCard], offline: [], complete: false };
  assert.deepEqual(heavyJobsNow(without, t5).map((j) => j.label), ['seen running'], 'a complete read caught it mid-restart: the mark starts');
  assert.deepEqual(heavyJobsNow(withAda, t5 + 5 * 60 * 1000).map((j) => j.label), ['seen running'], 'running in the rows this read holds, yet judged gone by an old mark');
  assert.deepEqual(heavyJobsNow(without, t5 + 5 * 60 * 1000 + 1).map((j) => j.label), ['seen running'], 'the mark was cleared: missing again is a new grace');
  await asAgent(tok, { action: 'end' });
});

test('kosmos#9222: GET /api/heavy lists a job no read could check, marked, to the agent that holds it only; the board\'s status does not', async () => {
  const { ada, bo } = twoAgents();
  const tok = sendertoken.mint(ada).token;
  const rs = require('./engine/restoresink');
  const hj = require('./engine/heavyjobs');
  const was = { processStart: rs.processStart, pidAlive: rs.pidAlive };
  rs.pidAlive = () => true;
  rs.processStart = () => 'Fri Nov 27 01:00:00 2026';
  try {
    assert.equal(hj.start({ root: store.ROOT, agent: ada, label: 'overnight', pid: 424242, now: Date.now() - 13 * 60 * 60 * 1000 }).ok, true);
    rs.processStart = () => undefined;   // ps cannot answer
    assert.deepEqual(await jobsInStatus(), [], 'the board showed a job it could not check');
    const got = await (await fetch(`${base}/api/heavy`, { headers: { 'x-kosmos-agent-token': tok } })).json();
    assert.deepEqual(got.jobs.map((j) => [j.label, j.pid, j.unchecked]), [['overnight', 424242, true]]);
    const other = await (await fetch(`${base}/api/heavy`, { headers: { 'x-kosmos-agent-token': sendertoken.mint(bo).token } })).json();
    assert.deepEqual(other.jobs, [], 'another agent was shown, and told to end, a hidden job it cannot end');
    const nobody = await (await fetch(`${base}/api/heavy`)).json();
    assert.deepEqual(nobody.jobs, [], 'a caller with no agent named was shown a hidden job');
  } finally { Object.assign(rs, was); await asAgent(tok, { action: 'end', pid: 424242 }); }
});

test('kosmos#9222: an agent named by its pane alone (no token) is listed its own hidden job', async () => {
  const { ada, adaCard } = twoAgents();
  const rs = require('./engine/restoresink');
  const hj = require('./engine/heavyjobs');
  const was = { processStart: rs.processStart, pidAlive: rs.pidAlive };
  rs.pidAlive = () => true;
  rs.processStart = () => 'Fri Nov 27 01:00:00 2026';
  try {
    assert.equal(hj.start({ root: store.ROOT, agent: ada, label: 'by pane', pid: 434343, now: Date.now() - 13 * 60 * 60 * 1000 }).ok, true);
    rs.processStart = () => undefined;
    const got = await (await fetch(`${base}/api/heavy?from_pane=${encodeURIComponent(adaCard.target)}`)).json();
    assert.deepEqual(got.jobs.map((j) => [j.label, j.unchecked]), [['by pane', true]], 'its pane did not name it');
  } finally { Object.assign(rs, was); hj.end({ root: store.ROOT, agent: ada, pid: 434343 }); }
});

test('kosmos#9217 slice 2: take is the turn on a free computer, a kept place behind a holder, and the status lists the line', async () => {
  const { ada, bo } = twoAgents();
  const ta = sendertoken.mint(ada).token, tb = sendertoken.mint(bo).token;
  let r = await asAgent(ta, { action: 'take', label: 'ada suite' });
  assert.equal(r.status, 200, await r.clone().text());
  const mine = await r.json();
  assert.deepEqual([mine.turn, mine.job.label], [true, 'ada suite']);
  assert.deepEqual((await jobsInStatus()).map((j) => j.agent), [ada], 'the turn is the heavy job, as start records it');
  r = await asAgent(tb, { action: 'take', label: 'bo validation' });
  const wait = await r.json();
  assert.deepEqual([wait.turn, wait.place, wait.holder.agent, wait.ahead], [false, 1, ada, []]);
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.deepEqual(status.heavyLine.map((e) => [e.agent, e.label]), [[bo, 'bo validation']]);
  assert.ok(status.heavyLine[0].name && status.heavyLine[0].name !== bo, 'the line carries the name the board shows');
  const got = await (await fetch(`${base}/api/heavy`, { headers: { 'x-kosmos-agent-token': tb } })).json();
  assert.deepEqual(got.line.map((e) => e.agent), [bo], 'GET /api/heavy lists the line too');
  assert.deepEqual(await (await asAgent(ta, { action: 'release' })).json(), { ok: true, left: 0, ended: 1, others: 0 });
  r = await asAgent(tb, { action: 'take', label: 'bo validation' });
  assert.equal((await r.json()).turn, true, 'released, the turn goes to the front of the line');
  assert.deepEqual((await (await fetch(`${base}/api/status`)).json()).heavyLine, []);
  assert.deepEqual(await (await asAgent(tb, { action: 'release' })).json(), { ok: true, left: 0, ended: 1, others: 0 });
});

test('kosmos#9217 slice 2: a page cannot take a turn, and a refused take writes no place', async () => {
  const { ada } = twoAgents();
  const ta = sendertoken.mint(ada).token;
  assert.equal((await asScreen({ action: 'take', label: 'x' })).status, 403);
  const r = await asAgent(ta, { action: 'take', label: 'a\nb' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'say what the job is on one line');
  assert.deepEqual((await (await fetch(`${base}/api/status`)).json()).heavyLine, []);
  assert.deepEqual(await jobsInStatus(), []);
});

test('kosmos#9217 slice 2: a take alone starts a missing waiter\'s grace and, once it has run out, drops the place (no page polling needed)', async () => {
  const { ada } = twoAgents();
  const ta = sendertoken.mint(ada).token;
  const lineFile = require('node:path').join(store.ROOT, require('./engine/heavyturns').FILE);
  const t0 = Date.now();
  fs.writeFileSync(lineFile, JSON.stringify([{ agent: 'hv-ghost-gone', label: 'left', pid: null, pidStart: null, since: t0, at: t0, front: null, missed: 0 }]));
  heavyMissingSince.delete('hv-ghost-gone');
  let r = await (await asAgent(ta, { action: 'take', label: 'ada suite' })).json();
  assert.deepEqual([r.turn, r.place, (r.ahead || []).map((e) => e.agent)], [false, 2, ['hv-ghost-gone']], 'inside the grace the place is kept');
  assert.ok(heavyMissingSince.has('hv-ghost-gone'), 'the take did not start the missing waiter\'s grace');
  heavyMissingSince.set('hv-ghost-gone', Date.now() - 91 * 1000);   // as if 91 s had passed
  r = await (await asAgent(ta, { action: 'take', label: 'ada suite' })).json();
  assert.equal(r.turn, true, 'past the grace, the gone waiter still held the front');
  await asAgent(ta, { action: 'release' });
});

test('kosmos#9217 slice 2: one status read runs ps at most 8 times for the jobs and the line together', () => {
  const rs = require('./engine/restoresink');
  const was = { processStart: rs.processStart, pidAlive: rs.pidAlive };
  let ps = 0;
  rs.pidAlive = () => true;
  rs.processStart = () => { ps += 1; return 'A'; };
  const p = require('node:path');
  const now = Date.now(), H = 60 * 60 * 1000;
  const jobsFile = p.join(store.ROOT, require('./engine/heavyjobs').FILE), lineFile = p.join(store.ROOT, require('./engine/heavyturns').FILE);
  try {
    // Ten aged jobs and ten places that asked a minute ago, each tied to a process with a recorded start: each wants a ps read.
    fs.writeFileSync(jobsFile, JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ agent: 'hv-j' + i, label: 'j', pid: 97100 + i, pidStart: 'A', since: now - 13 * H, at: now - 13 * H }))));
    fs.writeFileSync(lineFile, JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ agent: 'hv-w' + i, label: 'w', pid: 97200 + i, pidStart: 'A', since: now - H, at: now - 60 * 1000, front: null, missed: 0 }))));
    heavyJobsNow(null, now);
    assert.ok(ps <= 8, 'ps ran ' + ps + ' times in one read of the jobs and the line');
    assert.ok(ps >= 1, 'control: the read asked ps at all');
  } finally {
    Object.assign(rs, was);
    fs.rmSync(jobsFile, { force: true }); fs.rmSync(lineFile, { force: true });
  }
});

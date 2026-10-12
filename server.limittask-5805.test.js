'use strict';

/**
 * #5805: the task message route, driven end to end. An assignee out of usage is kept (nothing typed, `delivered` says
 * held, the summary says kept and not to send it again); an idle assignee is typed into as before (the CONTROL).
 *
 *   node --test server.limittask-5805.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-limittask-5805-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const chat = require('./engine/chat');
const messages = require('./engine/messages');
const limitqueue = require('./engine/limitqueue');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');
const sendertoken = require('./engine/sendertoken');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => { try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function chicagoDay(ms) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' }).formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.month} ${p.day}`;
}
const RULE = '─'.repeat(80) + '\n';
const LIMIT_SCREEN = '❯ hello\n'
  + `  ⎿  You've hit your weekly limit · resets ${chicagoDay(Date.now() + 3 * 24 * 3600e3)} at 3pm (America/Chicago)\n`
  + '✻ Sautéed for 0s · done 10:35 PM\n' + RULE + '❯ \n' + RULE + '  casey · Opus 4.8 · 7d 100%\n';

async function sendTask(caseyState, headers) {
  const board = fleet.install([
    fleet.agent('mara', { state: 'idle' }),
    fleet.agent('casey', caseyState === 'rate_limited' ? { state: 'rate_limited', runner: 'claude', command: 'claude', screen: LIMIT_SCREEN }
      : caseyState === 'signed_out' ? { state: null, runner: 'grok', command: 'grok', screen: '' } : { state: 'idle' }),   // #5948: signed_out reads its state from the report
  ]);
  const calls = [];
  chat.setRunner((args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    if (args[0] === 'capture-pane') return { ran: true, spawnFailed: false, status: 0, out: caseyState === 'rate_limited' ? LIMIT_SCREEN : '', err: '' };
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser(() => {});
  const realAll = projects.readAll, realSay = tasks.say, realWho = tasks.whoOf;
  projects.readAll = () => [{ id: 'p5805', name: 'Launch', agents: ['mara', 'casey'] }];
  tasks.say = (id, num) => ({ number: Number(num) });
  tasks.whoOf = () => ['mara', 'casey'];
  try {
    const res = await fetch(base + '/api/project/p5805/task/7/message', {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ text: 'ship it' }),
    });
    const text = await res.text();
    const pasted = calls.filter((a) => a[0] === 'set-buffer').map((a) => a[a.length - 1]).join('');
    return { code: res.status, json: JSON.parse(text), pasted, kept: limitqueue.list('casey') };
  } finally {
    projects.readAll = realAll; tasks.say = realSay; tasks.whoOf = realWho;
    chat.setRunner(null); chat.setDryRun(true); chat.resetForTests(); messages.resetForTests();
    board.restore();
  }
}
test.beforeEach(() => { limitqueue.resetForTests(); fs.rmSync(limitqueue.dir(), { recursive: true, force: true }); });

test('#5805: from the screen, an assignee out of usage is kept and not typed; the other assignee is told', async () => {
  const r = await sendTask('rate_limited', { 'sec-fetch-site': 'same-origin' });
  assert.equal(r.code, 200, JSON.stringify(r.json));
  const casey = r.json.delivered.find((d) => d.agent === 'casey');
  assert.equal(casey.state, messages.HELD_STATE, JSON.stringify(r.json.delivered));
  assert.ok(Date.parse(casey.heldUntil) > Date.now(), 'no reset time on the held outcome');
  assert.equal(r.json.delivered.find((d) => d.agent === 'mara').state, chat.DELIVERY.PLACED);
  assert.match(r.json.summary, /^Told mara\. Kept, not typed yet: casey is out of usage until .*; Kosmos types it after the reset\. Do not send it again\.$/, r.json.summary);
  assert.equal((r.pasted.match(/\[Kosmos task 7 - Launch\]/g) || []).length, 1, 'casey was typed into as well as mara');
  assert.equal(r.kept.length, 1, 'not kept for casey');
  assert.deepEqual([r.kept[0].kind, r.kept[0].from, r.kept[0].about], ['task', '', 'task 7 in Launch']);
  assert.match(r.kept[0].envelope, /^\[Kosmos task 7 - Launch\] The person said: "ship it"/);
});

test('#5805 CONTROL: an idle assignee is typed into as before, nothing kept', async () => {
  const r = await sendTask('idle', { 'sec-fetch-site': 'same-origin' });
  assert.equal(r.code, 200, JSON.stringify(r.json));
  assert.equal(r.json.delivered.find((d) => d.agent === 'casey').state, chat.DELIVERY.PLACED, JSON.stringify(r.json.delivered));
  assert.equal(r.kept.length, 0);
  assert.equal((r.pasted.match(/\[Kosmos task 7 - Launch\]/g) || []).length, 2, 'both assignees should have been typed into');
});

test('#5805: an agent\'s task message to an assignee out of usage is kept under that agent\'s name, and mara is not typed into for her own message', async () => {
  const r = await sendTask('rate_limited', { 'x-kosmos-agent-token': sendertoken.mint('mara').token });
  assert.equal(r.code, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.delivered.map((d) => [d.agent, d.state]), [['casey', messages.HELD_STATE]]);
  assert.equal(r.kept.length, 1);
  assert.equal(r.kept[0].from, 'mara');
  assert.equal(r.pasted, '', 'something was typed: ' + r.pasted.slice(0, 200));
});

test('#5842: the route keeps a task line with its task (project id and number), so its outcome can be recorded there', async () => {
  const r = await sendTask('rate_limited', { 'sec-fetch-site': 'same-origin' });
  assert.equal(r.code, 200, JSON.stringify(r.json));
  assert.equal(r.kept.length, 1, 'not kept for casey');
  assert.deepEqual([r.kept[0].projectId, r.kept[0].task, r.kept[0].person], ['p5805', 7, true]);
  // An agent's send carries the task but is not the person's.
  const a = await sendTask('rate_limited', { 'x-kosmos-agent-token': sendertoken.mint('mara').token });
  const fromMara = a.kept.find((e) => e.from === 'mara');
  assert.ok(fromMara, 'the agent\'s line was not kept');
  assert.deepEqual([fromMara.projectId, fromMara.task, fromMara.person], ['p5805', 7, undefined]);
});

test('#5948 review 3: an assignee whose sign-in stopped working is kept, and the route says signed out (heldFor), not out of usage', async () => {
  const selfreport = require('./engine/selfreport');
  // The report is keyed by the board name; casey's card is casey.
  assert.equal(selfreport.record('casey', { state: 'blocked', auto: true, on: 'provider api (authentication_failed)', owner: 'provider', because: 'Not signed in.' }).recorded, true);
  try {
    const r = await sendTask('signed_out', { 'sec-fetch-site': 'same-origin' });
    assert.equal(r.code, 200, JSON.stringify(r.json));
    const casey = r.json.delivered.find((d) => d.agent === 'casey');
    assert.equal(casey.state, messages.HELD_STATE, JSON.stringify(r.json.delivered));
    assert.equal(casey.heldFor, 'signin', JSON.stringify(casey));
    assert.doesNotMatch(r.json.summary, /usage/, r.json.summary);
    assert.equal(r.kept.length, 1);
    assert.equal(r.kept[0].signin, true);
  } finally { fs.rmSync(selfreport.DIR, { recursive: true, force: true }); }
});

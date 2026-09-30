'use strict';

/**
 * #4733: the setup guide's words are masked for secrets (#3769's third layer) on the three writes that
 * layer did not cover: `kosmos task message`, the note on `kosmos task built`, and the text of a status
 * report. Each arm posts through the real route with the guide's own agent token and reads what was
 * STORED (and, for a task message, what was typed to the assignee). Each has a control: the same words
 * from another agent, sent the same way, are kept as sent.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 *
 *   node --test server.guide-mask-4733.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-guide-mask-4733-'));
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
const selfreport = require('./engine/selfreport');
const chat = require('./engine/chat');
const setupAssistant = require('./engine/setup-assistant');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const { MASK } = require('./engine/secretmask');

const GUIDE = 'guidebot';
const OTHER = 'helperbot';
const THIRD = 'mona';   // the assignee both of them write to
const KEY = ['sk-ant-', 'api03-', 'FakeKeyFor4733Tests_abcdefGHIJ012345'].join('');
const restore = [];
function stub(obj, key, value) { const was = obj[key]; obj[key] = value; restore.push(() => { obj[key] = was; }); }

let base;
let projectId;
const token = {};
const typed = [];   // every line the task message route hands to chat.deliverAsync
test.before(async () => {
  stub(setupAssistant, 'guideName', () => GUIDE);
  stub(setupAssistant, 'isGuideFolder', (n) => n === GUIDE);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const roster = fleet.install([fleet.agent(GUIDE, { state: 'idle' }), fleet.agent(OTHER, { state: 'idle' }), fleet.agent(THIRD, { state: 'idle' })]).agents;
  const p = projects.create({ name: 'Alpha' });
  for (const n of [GUIDE, OTHER, THIRD]) projects.addAgent(p.id, n, roster);
  projectId = p.id;
  for (const n of [GUIDE, OTHER]) {
    const minted = sendertoken.mint(n);
    assert.equal(minted.ok, true, minted.because);
    token[n] = minted.token;
  }
  stub(chat, 'deliverAsync', async (to, line) => { typed.push({ to, line }); return { state: 'delivered', at: new Date().toISOString() }; });
});
test.after(() => {
  for (const undo of restore.reverse()) undo();
  try { server.close(); } catch { /* already down */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const newTask = (sentence) => tasks.create(projectId, { sentence, who: THIRD }).number;
const stored = (n) => tasks.byNumber(projects.readAll().find((x) => x.id === projectId), n);
const post = async (p, body, who) => {
  const res = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-kosmos-agent-token': token[who] }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
};

test('#4733 a task message from the guide is recorded and previewed masked; another agent\'s is kept as sent', async () => {
  const n = newTask('Set up the mail account');
  const words = `The key is ${KEY}, paste it in.`;

  typed.length = 0;
  const g = await post(`/api/project/${projectId}/task/${n}/message`, { text: words }, GUIDE);
  assert.equal(g.status, 200, JSON.stringify(g.json));
  const afterGuide = JSON.stringify(taskchat.read(projectId, n));
  assert.ok(afterGuide.includes(`The key is ${MASK}, paste it in.`), 'the guide\'s message was not recorded masked: ' + afterGuide);
  assert.ok(!afterGuide.includes(KEY), 'the key reached the task\'s record');
  assert.ok(!JSON.stringify(g.json).includes(KEY), 'the key came back in the route\'s answer');
  assert.ok(typed.length >= 1, 'CONTROL: nothing was typed to the assignee, so the preview was not checked');
  assert.ok(typed.every((t) => !t.line.includes(KEY)), 'the key was typed to an assignee in the preview');
  assert.ok(typed.some((t) => t.line.includes(MASK)), 'the preview did not carry the masked words');

  typed.length = 0;
  const o = await post(`/api/project/${projectId}/task/${n}/message`, { text: words }, OTHER);
  assert.equal(o.status, 200, JSON.stringify(o.json));
  assert.ok(JSON.stringify(taskchat.read(projectId, n)).includes(words), 'CONTROL: another agent\'s message was changed');
  assert.ok(typed.some((t) => t.line.includes(KEY)), 'CONTROL: another agent\'s preview was changed');
});

test('#4733 the note on the guide\'s built mark is kept masked; another agent\'s is kept as sent', async () => {
  const note = `waiting on ${KEY}`;

  const n1 = newTask('Connect the calendar');
  const g = await post(`/api/project/${projectId}/task/${n1}/built`, { note }, GUIDE);
  assert.equal(g.status, 200, JSON.stringify(g.json));
  assert.equal(stored(n1).builtBy, GUIDE, 'CONTROL: the mark was not recorded as the guide\'s');
  assert.equal(stored(n1).builtNote, `waiting on ${MASK}`);
  assert.ok(!JSON.stringify(taskchat.read(projectId, n1)).includes(KEY), 'the key reached the task\'s history');
  assert.ok(!JSON.stringify(g.json).includes(KEY), 'the key came back in the route\'s answer');

  const n2 = newTask('Connect the drive');
  const o = await post(`/api/project/${projectId}/task/${n2}/built`, { note }, OTHER);
  assert.equal(o.status, 200, JSON.stringify(o.json));
  assert.equal(stored(n2).builtNote, note, 'CONTROL: another agent\'s note was changed');
});

test('#4733 the guide\'s status report is recorded masked in every free-text field; another agent\'s is kept as sent', async () => {
  const body = { state: 'needs_you', text: `I need you to confirm ${KEY}`, on: `the key ${KEY}`, owner: `whoever holds ${KEY}`, until: `after ${KEY}` };

  const g = await post('/api/report', body, GUIDE);
  assert.equal(g.status, 200, JSON.stringify(g.json));
  assert.equal(g.json.recorded, true, JSON.stringify(g.json));
  const gr = selfreport.read(GUIDE);
  assert.equal(gr.found, true);
  assert.equal(gr.because, `I need you to confirm ${MASK}`);
  assert.ok(!JSON.stringify(gr).includes(KEY), 'the key reached the guide\'s stored report: ' + JSON.stringify(gr));
  assert.ok(JSON.stringify(gr).includes(`the key ${MASK}`) && JSON.stringify(gr).includes(`whoever holds ${MASK}`), 'on and owner were not kept (masked): ' + JSON.stringify(gr));
  assert.ok(!JSON.stringify(g.json).includes(KEY), 'the key came back in the route\'s answer');

  const o = await post('/api/report', body, OTHER);
  assert.equal(o.status, 200, JSON.stringify(o.json));
  const or = selfreport.read(OTHER);
  assert.equal(or.because, body.text, 'CONTROL: another agent\'s report was changed');
  assert.equal(or.on, body.on, 'CONTROL: another agent\'s report was changed');
});

test('#4733 a report field that is not a string is passed on as it came (the mask never invents one)', async () => {
  const g = await post('/api/report', { state: 'working', text: 'Reading the inbox' }, GUIDE);
  assert.equal(g.status, 200, JSON.stringify(g.json));
  const gr = selfreport.read(GUIDE);
  assert.equal(gr.because, 'Reading the inbox');
  assert.equal(gr.on, null);
  assert.equal(gr.owner, null);
});

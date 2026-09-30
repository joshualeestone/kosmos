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

test('#4733 the guide\'s status report is recorded masked in every field kept as text; another agent\'s is kept as sent', async () => {
  const body = { state: 'needs_you', text: `I need you to confirm ${KEY}`, on: `the key ${KEY}`, owner: `whoever holds ${KEY}`, until: `after ${KEY}`, project: KEY };

  const g = await post('/api/report', body, GUIDE);
  assert.equal(g.status, 200, JSON.stringify(g.json));
  assert.equal(g.json.recorded, true, JSON.stringify(g.json));
  const gr = selfreport.read(GUIDE);
  assert.equal(gr.found, true);
  assert.equal(gr.because, `I need you to confirm ${MASK}`);
  assert.equal(gr.on, `the key ${MASK}`);
  assert.equal(gr.owner, `whoever holds ${MASK}`);
  assert.equal(gr.until, `after ${MASK}`);
  assert.equal(gr.project, MASK);
  assert.ok(!JSON.stringify(gr).includes(KEY), 'the key reached the guide\'s stored report: ' + JSON.stringify(gr));
  assert.ok(!JSON.stringify(g.json).includes(KEY), 'the key came back in the route\'s answer');

  const o = await post('/api/report', body, OTHER);
  assert.equal(o.status, 200, JSON.stringify(o.json));
  const or = selfreport.read(OTHER);
  for (const [field, sent] of [['because', body.text], ['on', body.on], ['owner', body.owner], ['until', body.until], ['project', body.project]]) {
    assert.equal(or[field], sent, `CONTROL: another agent's ${field} was changed`);
  }
});

test('#4733 a report field that is not a string is made text and masked for the guide (the store would make text of it unmasked)', async () => {
  const body = { state: 'needs_you', text: [`the key is ${KEY}`], on: [KEY], owner: [`holder ${KEY}`], until: [`after ${KEY}`] };

  const g = await post('/api/report', body, GUIDE);
  assert.equal(g.status, 200, JSON.stringify(g.json));
  assert.equal(g.json.recorded, true, JSON.stringify(g.json));
  const gr = selfreport.read(GUIDE);
  assert.equal(gr.because, `the key is ${MASK}`);
  assert.equal(gr.on, MASK);
  assert.equal(gr.owner, `holder ${MASK}`);
  assert.equal(gr.until, `after ${MASK}`);
  assert.ok(!JSON.stringify(gr).includes(KEY), 'the key reached the guide\'s stored report: ' + JSON.stringify(gr));

  // CONTROL: the same body from another agent is stored as the store has always made text of it, key and all.
  const o = await post('/api/report', body, OTHER);
  assert.equal(o.status, 200, JSON.stringify(o.json));
  const or = selfreport.read(OTHER);
  assert.equal(or.because, `the key is ${KEY}`, 'CONTROL: another agent\'s list was not stored as its text');
  assert.equal(or.on, KEY);
});

test('#4733 a guide report with no on or owner still records them as absent', async () => {
  const g = await post('/api/report', { state: 'working', text: 'Reading the inbox' }, GUIDE);
  assert.equal(g.status, 200, JSON.stringify(g.json));
  const gr = selfreport.read(GUIDE);
  assert.equal(gr.because, 'Reading the inbox');
  assert.equal(gr.on, null);
  assert.equal(gr.owner, null);
});

test('#4733 a report the guide made before the mask is not written again as it was when a post carries it onto a project', async () => {
  /* A working report as an older build stored it: straight into the store, key and all. */
  for (const who of [GUIDE, OTHER]) {
    const kept = selfreport.record(who, { state: 'working', because: `using ${KEY}`, on: `the ${KEY} step`, owner: `holder of ${KEY}`, until: `after ${KEY}` });
    assert.equal(kept.recorded, true, JSON.stringify(kept));
    assert.equal(selfreport.read(who).because, `using ${KEY}`, 'CONTROL: the old report was not stored with the key');
  }
  for (const who of [GUIDE, OTHER]) {
    const r = await post('/api/post', { project: projectId, text: 'Starting on the mail account.' }, who);
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  const gr = selfreport.read(GUIDE);
  assert.equal(gr.project, projectId, 'CONTROL: the post did not carry the report onto the project, so nothing was written again');
  assert.equal(gr.because, `using ${MASK}`);
  assert.equal(gr.on, `the ${MASK} step`);
  assert.equal(gr.owner, `holder of ${MASK}`);
  assert.equal(gr.until, `after ${MASK}`);
  const or = selfreport.read(OTHER);
  assert.equal(or.project, projectId, 'CONTROL: the other agent\'s report was not carried either');
  assert.equal(or.because, `using ${KEY}`, 'CONTROL: another agent\'s carried report was changed');
  assert.equal(or.owner, `holder of ${KEY}`, 'CONTROL: another agent\'s carried report was changed');
});

test('#4733 the mask runs before the store cuts a long report, and keeps its paragraph break', async () => {
  /* The key starts 20 characters before the 1000-character cap, so a cut made BEFORE the mask would leave its
     first 20 characters in the store, no longer shaped like a key. */
  const lead = 'Step one is done.\n' + 'x'.repeat(980 - 'Step one is done.\n'.length);
  const body = { state: 'working', text: lead + KEY + ' and then the rest' };
  assert.equal(lead.length, 980, 'CONTROL: the lead is not the length this test needs');

  const g = await post('/api/report', body, GUIDE);
  assert.equal(g.json.recorded, true, JSON.stringify(g.json));
  const gr = selfreport.read(GUIDE);
  assert.ok(gr.because.startsWith('Step one is done.\nxxx'), 'the paragraph break was lost: ' + gr.because.slice(0, 30));
  assert.ok(gr.because.includes(MASK), 'the mask is not in the stored report');
  assert.ok(!gr.because.includes(KEY.slice(0, 12)), 'part of the key was left in the stored report');

  const o = await post('/api/report', body, OTHER);
  assert.equal(o.json.recorded, true, JSON.stringify(o.json));
  assert.ok(selfreport.read(OTHER).because.endsWith(KEY.slice(0, 20)), 'CONTROL: the store did not cut another agent\'s report inside the key, so the arm above proved nothing about the cut');
});

'use strict';
/*
 * #5811: `geminiSeen` is the snapshot's input to the #5804 "(set to X)" decision. /api/status takes it off every row
 * before the page gets it (and safeRoster off every roster row), and still sends the decision (settingModelName). CONTROL: the snapshot the
 * route reads DOES carry the key, so its absence on the page is the route's doing.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gemseen-5811-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gemseen-5811-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gemseen-5811-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gemseen-5811-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gemseen-5811-launch-'));
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_HOME = process.env.HOME;
process.env.AGENT_WORKFORCE_GEMINI_HOME = path.join(process.env.HOME, '.gemini');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(process.env.HOME, '.claude');
fs.mkdirSync(process.env.AGENT_WORKFORCE_GEMINI_HOME, { recursive: true });
fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_CONFIG_ROOT, 'projects'), { recursive: true });
process.on('exit', () => {
  for (const d of [SANDBOX, process.env.HOME, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_LAUNCH]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const { start, server, safeRoster } = require('./server');
const fleet = require('./test-support/fleet');
const jobfix = require('./test-support/jobfixture');
const store = require('./engine/store');
const status = require('./engine/status');
const create = require('./engine/create');

test.before(async () => { await start(0); });
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } });

test('#5811: /api/status rows never carry geminiSeen, and still carry settingModelName', async (t) => {
  const b = fleet.install([fleet.agent('Ida', { state: 'idle' }), fleet.agent('Gem', { state: 'idle', runner: 'gemini', command: 'node' })]);
  t.after(() => b.restore());
  for (const name of ['Ida', 'Gem']) {
    assert.ok('geminiSeen' in b.agents.find((a) => a.name === name), `CONTROL: the snapshot card for ${name} carries the key`);
  }
  const r = await fetch(`http://127.0.0.1:${server.address().port}/api/status`);
  assert.equal(r.status, 200);
  const rows = ((await r.json()).agents || []).filter((a) => a.name === 'Ida' || a.name === 'Gem');
  assert.equal(rows.length, 2, 'both agents reached the page');
  for (const row of rows) {
    assert.ok(!('geminiSeen' in row), `${row.name}'s page row carries geminiSeen`);
    assert.ok('settingModelName' in row, `${row.name}'s page row lost settingModelName`);
  }
});

test('#5811: the roster the project routes read carries no geminiSeen either', (t) => {
  const b = fleet.install([fleet.agent('Ida', { state: 'idle' }), fleet.agent('Gem', { state: 'idle', runner: 'gemini', command: 'node' })]);
  t.after(() => b.restore());
  assert.ok('geminiSeen' in b.agents.find((a) => a.name === 'Gem'), 'CONTROL: the snapshot card carries the key');
  const rows = (safeRoster() || []).filter((a) => a.name === 'Ida' || a.name === 'Gem');
  assert.equal(rows.length, 2, 'both agents are on the roster');
  for (const row of rows) assert.ok(!('geminiSeen' in row), `${row.name}'s roster row carries geminiSeen`);
});

/* The whole path, end to end: a running Gemini agent of ours whose job is set to 2.5 Flash, whose newest reply (after
   this run began) came from 3.5 Flash, gets "(set to ...)" through /api/status. CONTROL: the same agent answering on
   its own model gets nothing, so the value is the decision's, not a constant. */
test('#5811: /api/status sends the decision\'s value for a switched Gemini agent, and null for one on its model', async (t) => {
  const NAME = 'gemswitch';
  const WORKDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gemseen-5811-wd-'));
  const GH = process.env.AGENT_WORKFORCE_GEMINI_HOME;
  const RUN_START = Date.parse('2026-10-10T19:00:00Z');
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.writeFileSync(jobfix.jobPath(NAME), jobfix.jobFor(NAME, path.join(SANDBOX, 'gemini'), path.join(SANDBOX, 'tmux'), 'gemini-2.5-flash', null, 'gemini'), 'utf8');
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'google' });
  const writeSession = (model) => {
    fs.writeFileSync(path.join(GH, 'projects.json'), JSON.stringify({ projects: { [WORKDIR]: 'gemswitch-slug' } }));
    const dir = path.join(GH, 'tmp', 'gemswitch-slug', 'chats');
    fs.mkdirSync(dir, { recursive: true });
    const at = '2026-10-10T19:01:00.000Z';
    const rows = [
      { sessionId: 'gem-5811', projectHash: 'h', startTime: '2026-10-10T19:00:30.000Z', lastUpdated: at, kind: 'main' },
      { id: 'u1', timestamp: '2026-10-10T19:00:30.000Z', type: 'user', content: [{ text: 'go' }] },
      { id: 'g1', timestamp: at, type: 'gemini', content: 'DONE', tokens: { input: 100, output: 5, cached: 0, thoughts: 0, tool: 0, total: 105 }, model },
    ];
    fs.writeFileSync(path.join(dir, 'session-2026-10-10T19-00-gem5811x.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  };
  t.after(() => {
    status.setSessionSource(null);
    for (const f of [jobfix.jobPath(NAME)]) { try { fs.rmSync(f, { force: true }); } catch { /* */ } }
    for (const d of [WORKDIR, path.join(GH, 'tmp')]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
    try { fs.rmSync(path.join(GH, 'projects.json'), { force: true }); } catch { /* */ }
  });
  const b = fleet.install([fleet.agent(NAME, { state: 'idle', runner: 'gemini', command: 'node' })]);
  t.after(() => b.restore());
  const card = b.agents.find((a) => a.name === NAME);
  status.setSessionSource(() => `${card.sessionName}\t${RUN_START / 1000}\n`);
  const row = async () => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/status`);
    assert.equal(r.status, 200);
    return ((await r.json()).agents || []).find((a) => a.name === NAME);
  };
  writeSession('gemini-3.5-flash');
  const switched = await row();
  assert.ok(switched, 'the Gemini agent reached the page');
  assert.equal(switched.settingModelName, status.modelDisplayName('gemini-2.5-flash'), JSON.stringify({ model: switched.model, modelName: switched.modelName, isNamedOurs: switched.isNamedOurs, state: switched.state }));
  writeSession('gemini-2.5-flash');
  assert.equal((await row()).settingModelName, null, 'CONTROL: the agent on its own model gets no note');
});

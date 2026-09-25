'use strict';
/**
 * #3739 (Josh, 2026-09-25): the setup guide is titled "Kosmos Guide", hidden from every list and count (bubble
 * only; ruled 09:22), and never reads "Unknown Model". /api/status marks its row `isGuide` (every row says
 * whether it is), gives it the title, names its runner's default model when nothing else is known, and leaves
 * it out of the counts.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-guide-hidden-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server, markGuide } = require('./server');
const fleet = require('./test-support/fleet');
const setupAssistant = require('./engine/setup-assistant');

const GUIDE = 'guidebot';
const restore = [];
function stub(obj, key, value) { const was = obj[key]; obj[key] = value; restore.push(() => { obj[key] = was; }); }

let base;
test.before(async () => {
  stub(setupAssistant, 'guideName', () => GUIDE);
  stub(setupAssistant, 'isGuideFolder', (n) => n === GUIDE);
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  for (const undo of restore.reverse()) undo();
  try { server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

test('#3739 /api/status marks the guide row, titles it, never leaves its model unknown, and counts it out', async () => {
  const board = fleet.install([fleet.agent(GUIDE, { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  try {
    const s = await (await fetch(base + '/api/status')).json();
    const guide = s.agents.find((a) => a.sessionName === GUIDE);
    const mara = s.agents.find((a) => a.sessionName === 'mara');
    assert.ok(guide && mara, 'CONTROL: both rows are in the payload (the page still finds the guide by name)');
    assert.equal(guide.isGuide, true);
    assert.equal(mara.isGuide, false, 'every row says whether it is the guide');
    assert.equal(guide.role, 'Kosmos Guide');
    assert.ok(guide.modelName || guide.plannedModelName, 'the guide has no model to show, so the page says Unknown');
    assert.equal(s.counts.total, 1, 'the guide was counted as an agent');
  } finally { board.restore(); }
});

test('#3739 with no guide, nothing is marked and every agent is counted', async () => {
  const was = setupAssistant.guideName;
  setupAssistant.guideName = () => null;
  const board = fleet.install([fleet.agent(GUIDE, { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  try {
    const s = await (await fetch(base + '/api/status')).json();
    assert.equal(s.agents.filter((a) => a.isGuide).length, 0);
    assert.equal(s.counts.total, 2);
  } finally { board.restore(); setupAssistant.guideName = was; }
});

test('#3739 a guide with no session yet (an offline row) is not counted in the total or not-running', async () => {
  // A worker folder with no pane is an offline row: the fresh-install state before the guide's first session.
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, GUIDE), { recursive: true });
  require('./engine/store').writeProfile(GUIDE, { provider: 'anthropic' });
  const board = fleet.install([fleet.agent('mara', { state: 'idle' })]);
  try {
    const s = await (await fetch(base + '/api/status')).json();
    const guide = s.agents.find((a) => a.sessionName === GUIDE);
    assert.ok(guide, 'CONTROL: the offline guide row is in the payload');
    assert.equal(guide.isGuide, true);
    assert.equal(guide.role, 'Kosmos Guide');
    assert.equal(s.counts.total, 1, 'an offline guide was counted as an agent');
    assert.equal(s.counts.notRunning, 0, 'an offline guide was counted as not running');
  } finally { board.restore(); fs.rmSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, GUIDE), { recursive: true, force: true }); }
});

test('#3739 markGuide names a default model for a Claude guide only (the OpenAI picker reads the field as a model id)', async () => {
  const board = fleet.install([fleet.agent(GUIDE, { state: 'idle' })]);
  try {
    const s = await (await fetch(base + '/api/status')).json();
    const real = s.agents.find((a) => a.sessionName === GUIDE);
    assert.ok(real, 'CONTROL: the fleet card is there');
    const base0 = { ...real, isGuide: undefined, role: undefined, modelName: null, plannedModelName: null };
    for (const runner of ['codex', 'gemini', 'grok']) {
      const [row] = markGuide([{ ...base0, runner }], GUIDE);
      assert.equal(row.plannedModelName, null, runner + ' guide was given a Claude default-model line');
      assert.equal(row.role, 'Kosmos Guide');
    }
    const [claude] = markGuide([{ ...base0, runner: 'claude' }], GUIDE);
    assert.equal(claude.plannedModelName, 'Claude (its default model)', 'CONTROL: a Claude guide is named');
  } finally { board.restore(); }
});

test('#3739 an unreadable removed list still marks the seeded guide, so it does not flicker onto the board', async () => {
  const removal = require('./engine/remove');
  const was = removal.removedNames;
  removal.removedNames = () => ({ ok: false });
  const board = fleet.install([fleet.agent(GUIDE, { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  try {
    const s = await (await fetch(base + '/api/status')).json();
    assert.equal((s.agents.find((a) => a.sessionName === GUIDE) || {}).isGuide, true, 'an unchecked read unmarked the guide');
    assert.equal(s.counts.total, 1);
  } finally { board.restore(); removal.removedNames = was; }
});

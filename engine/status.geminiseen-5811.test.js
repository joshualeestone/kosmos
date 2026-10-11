'use strict';

/**
 * #5811: what status.snapshot() puts on a running Gemini agent's card for the #5804 "(set to X)" decision, read end to
 * end from a real-SHAPED job and session (the #3296 ring test's sandbox), through a real fleet card.
 */

const test = require('node:test');
const jobfix = require('../test-support/jobfixture');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gemseen5811-')));
const GEMINI_HOME = path.join(SB, '.gemini');
fs.mkdirSync(GEMINI_HOME, { recursive: true });
const CONFIG_ROOT = path.join(SB, '.claude');
fs.mkdirSync(path.join(CONFIG_ROOT, 'projects'), { recursive: true });
const STORE = path.join(SB, 'Library', 'Application Support', 'AgentWorkforce');
fs.mkdirSync(STORE, { recursive: true });
process.env.AGENT_WORKFORCE_GEMINI_HOME = GEMINI_HOME;
process.env.AGENT_WORKFORCE_CONFIG_ROOT = CONFIG_ROOT;
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_DATA = STORE;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'LaunchAgents');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });
test.after(() => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ } });

const store = require('./store');
const status = require('./status');
const create = require('./create');
const fleet = require('../test-support/fleet');

const NAME = 'gem';
const WORKDIR = path.join(SB, 'work', 'gem');
fs.mkdirSync(WORKDIR, { recursive: true });
const REPLY_AT = '2026-10-10T19:01:00.000Z';

function writeSession(model) {
  fs.writeFileSync(path.join(GEMINI_HOME, 'projects.json'), JSON.stringify({ projects: { [WORKDIR]: 'gem-slug' } }));
  const dir = path.join(GEMINI_HOME, 'tmp', 'gem-slug', 'chats');
  fs.mkdirSync(dir, { recursive: true });
  const rows = [
    { sessionId: 'gem-5811', projectHash: 'h', startTime: '2026-10-10T19:00:30.000Z', lastUpdated: REPLY_AT, kind: 'main' },
    { id: 'u1', timestamp: '2026-10-10T19:00:30.000Z', type: 'user', content: [{ text: 'go' }] },
    { id: 'g1', timestamp: REPLY_AT, type: 'gemini', content: 'DONE',
      tokens: { input: 100, output: 5, cached: 0, thoughts: 0, tool: 0, total: 105 }, model },
  ];
  fs.writeFileSync(path.join(dir, 'session-2026-10-10T19-00-gem5811x.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
function writeJob(model) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.writeFileSync(jobfix.jobPath(NAME), jobfix.jobFor(NAME, path.join(SB, 'gemini'), path.join(SB, 'tmux'), model, null, 'gemini'), 'utf8');
}
function card(t) {
  const board = fleet.install([fleet.agent(NAME, { state: 'idle', runner: 'gemini', command: 'node' })]);
  t.after(() => board.restore());
  const c = board.agents.find((a) => a.name === NAME);
  assert.ok(c, 'the fleet produced no card');
  return c;
}

test('#5811: a found session puts the reply model, its time and the job\'s model on the card, from one read', (t) => {
  writeJob('gemini-2.5-flash');
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'google' });
  writeSession('gemini-3.5-flash');
  const c = card(t);
  assert.equal(c.model, 'gemini-3.5-flash', 'the model the newest reply named');
  assert.deepEqual(c.geminiSeen, { modelAt: Date.parse(REPLY_AT), planned: { id: 'gemini-2.5-flash', isDefault: false } });
  // The same job and session through the direct reader: one rule, so the row and a fresh read agree.
  assert.deepEqual(status.readGeminiSession(NAME).planned, create.plannedModelOf(NAME));
});

test('#5811: a job with no model gives the launcher default, marked default', (t) => {
  writeJob(null);
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'google' });
  writeSession('gemini-3.5-flash');
  const c = card(t);
  const pinned = require('./win32keyed').DEFAULT_MODEL.gemini;
  assert.deepEqual(c.geminiSeen && c.geminiSeen.planned, { id: pinned, isDefault: true });
});

test('#5811: no session file means nothing seen (CONTROL for the arms above: same job, same card path)', (t) => {
  writeJob('gemini-2.5-flash');
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'google' });
  fs.rmSync(path.join(GEMINI_HOME, 'tmp'), { recursive: true, force: true });
  fs.rmSync(path.join(GEMINI_HOME, 'projects.json'), { force: true });
  assert.equal(card(t).geminiSeen, null);
});

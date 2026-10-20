'use strict';
/**
 * #6716: a model borrowed from an agent's EARLIER session (its new one has not replied yet) is not what it runs. whoami
 * must not tell the agent it runs that; the live launch reading answers. CONTROL: with no new session the record is
 * the agent's own and is used.
 */
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-whoami-earlier-6716-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SANDBOX, 'config');
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });

const srv = require('./server');
const { whoamiFor } = srv;
const create = require('./engine/create');
const fleet = require('./test-support/fleet');
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

function session(name, file, rows, ageSec) {
  const dir = create.workerDir(name);
  fs.mkdirSync(dir, { recursive: true });
  const real = fs.realpathSync(dir);
  const proj = path.join(SANDBOX, 'config', 'projects', real.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(proj, { recursive: true });
  const full = path.join(proj, file);
  fs.writeFileSync(full, rows.map((r) => JSON.stringify({ cwd: real, ...r })).join('\n') + '\n');
  const t = Date.now() / 1000 - ageSec;
  fs.utimesSync(full, t, t);
}
const LIVE = { ok: true, runner: 'claude', account: null, model: 'claude-opus-5-5', configDir: null };

test('#6716: whoami does not report a borrowed earlier-session model as the running one', () => {
  session('switched', 'old.jsonl', [{ type: 'assistant', message: { model: 'claude-opus-4-8' } }], 600);
  session('switched', 'new.jsonl', [{ type: 'user', message: { content: 'hi' } }], 5);
  const card = fleet.install([fleet.agent('switched', { state: 'idle' })]).agents.find((a) => a.name === 'switched');
  const out = JSON.stringify(whoamiFor(card, [], LIVE));
  assert.ok(!out.includes('claude-opus-4-8'), 'whoami told the agent it runs its earlier session\'s model: ' + out);
  assert.ok(out.includes('claude-opus-5-5'), 'the live launch reading did not answer: ' + out);
});

test('#6716 CONTROL: a session that replied is the agent\'s own record and is used', () => {
  session('replied', 'only.jsonl', [{ type: 'assistant', message: { model: 'claude-opus-4-8' } }], 5);
  const card = fleet.install([fleet.agent('replied', { state: 'idle' })]).agents.find((a) => a.name === 'replied');
  const out = JSON.stringify(whoamiFor(card, [], LIVE));
  assert.ok(out.includes('claude-opus-4-8'), 'the control did not read the record: ' + out);
});

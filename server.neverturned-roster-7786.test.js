'use strict';
require('./test-support/tmpscope');   // kosmos#5334: this file's temp folders, removed when it exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-neverturned-7786-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-neverturned-7786-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-neverturned-7786-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-neverturned-7786-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-neverturned-7786-launch-'));
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

const { safeRoster } = require('./server');
const fleet = require('./test-support/fleet');
const jobfix = require('./test-support/jobfixture');
const store = require('./engine/store');
const status = require('./engine/status');
const create = require('./engine/create');


/* #7786 item 2: the task line reads `neverTurned` off the roster row joinTaskClaims is given, and that row is
   safeRoster's, not the snapshot's. A filter there that drops the field would put every task back on the old line with
   nothing red. Driven through the real producer (fleet.install, then status.snapshot) and the real safeRoster. */
const selfreport = require('./engine/selfreport');

test('#7786: the roster the project routes read carries neverTurned from the card', (t) => {
  const b = fleet.install([fleet.agent('Ida', { state: 'idle' }), fleet.agent('Bo', { state: 'idle' })]);
  t.after(() => b.restore());
  assert.equal(selfreport.record('Ida', { state: 'started', auto: true }).recorded, true, 'CONTROL: Ida launched');
  assert.equal(selfreport.record('Bo', { state: 'started', auto: true }).recorded, true, 'CONTROL: Bo launched');
  assert.equal(selfreport.record('Bo', { state: 'working', auto: true, text: 'answering a prompt' }).recorded, true, 'CONTROL: Bo took a turn');
  const rows = (safeRoster() || []).filter((a) => a.name === 'Ida' || a.name === 'Bo');
  assert.equal(rows.length, 2, 'both agents are on the roster');
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by.Ida.neverTurned, true, 'an idle agent that launched and never took a turn');
  assert.equal(by.Bo.neverTurned, false, 'CONTROL: an agent that has worked');
});

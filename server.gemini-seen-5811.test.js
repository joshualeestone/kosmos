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
process.on('exit', () => {
  for (const d of [SANDBOX, process.env.HOME, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_LAUNCH]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const { start, server, safeRoster } = require('./server');
const fleet = require('./test-support/fleet');

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

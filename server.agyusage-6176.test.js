'use strict';
require('./test-support/tmpscope');   // first: every temp folder this file makes is removed when it exits (#4273)
/**
 * #6176 slice 4: the Gemini-on-a-Google-subscription row in GET /api/accounts carries the usage Antigravity last
 * reported, asks for a new reading without waiting on it, and says a reading is on its way so the page reads again.
 * agy is never run: the runner is faked, and the binary is a stub that only exists (setup copied from
 * server.runners.test.js #3998).
 *
 *   node --test server.agyusage-6176.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-agyusage-6176-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_RUNNERS_DIR = path.join(SANDBOX, 'runners');
process.env.AGENT_WORKFORCE_CODEX_BIN = path.join(SANDBOX, 'no-such-codex');

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const agystatus = require('./engine/agystatus');
const agyusage = require('./engine/agyusage');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => {
  agyusage.setRunnerForTests(null); agyusage.resetForTests();
  agystatus.forget(); agystatus.setLastFileForTests(null); agystatus.resetForTests();
  delete process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN;
  server.closeAllConnections();
  server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const payload = (weeklyLeft) => JSON.stringify({ status: 'SUCCESS', num_turns: 0, command: { name: 'usage', data: { groups: [
  { name: 'Gemini Models', buckets: [
    { id: 'b-1', name: 'Weekly Limit Remaining', window: 'weekly', remaining_fraction: weeklyLeft, reset_time: new Date(Date.now() + 5 * 864e5).toISOString() },
    { id: 'b-2', name: 'Five Hour Limit Remaining', window: '5h', remaining_fraction: 1, reset_time: new Date(Date.now() + 3 * 3600e3).toISOString() } ] } ] } } });

test('#6176 slice 4: the Antigravity row asks once, says a reading is coming, then carries the Gemini usage', async () => {
  agystatus.setPlatformForTests('darwin');   // a Mac to agystatus and agyusage alike, so this runs on every CI runner
  const dir = path.join(SANDBOX, 'agylast'); fs.mkdirSync(dir, { recursive: true });
  agystatus.setLastFileForTests(() => path.join(dir, 'last.json'));
  const bin = path.join(dir, 'agy');
  fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = bin;
  agystatus.remember({ installed: true, signedIn: true });
  agyusage.resetForTests();
  agyusage.setTokenFileForTests(bin);   // agy's sign-in file, present (any existing file stands in)
  let runs = 0, finish = null;
  agyusage.setRunnerForTests((b, done) => { runs++; finish = () => done(null, payload(0.6)); });
  const row = async (q = '?agents=1') => {
    const res = await fetch(base + '/api/accounts' + q);
    assert.equal(res.status, 200);
    return ((await res.json()).accounts || []).find((a) => a && a.authMode === 'antigravity');
  };
  const r0 = await row('');
  assert.ok(r0, 'CONTROL: the signed-in subscription has its row');
  assert.equal(runs, 0, 'a read that was not Settings (no ?agents=1) asked agy');
  const r1 = await row();
  assert.equal(runs, 1, 'the row did not ask agy for a reading');
  assert.ok('limits' in r1 && r1.limits === null, 'a row with no reading yet did not say so: ' + JSON.stringify(r1));
  assert.equal(r1.connection.liveCheckPending, true, 'the page was not told a reading is on its way');
  const r2 = await row();
  assert.equal(runs, 1, 'a second read started a second agy while one was running');
  finish();
  await new Promise((r) => setImmediate(r));
  const r3 = await row();
  assert.equal(runs, 1, 'a read within the interval asked agy again');
  assert.ok(r3.limits && r3.limits.windows.length === 2, 'the reading did not reach the row: ' + JSON.stringify(r3));
  assert.equal(r3.limits.windows[1].usedPct, 40);
  assert.equal(r3.limits.windows[1].windowMinutes, 10080);
  assert.equal('liveCheckPending' in r3.connection, false, 'still said a reading is coming after it came');
  assert.ok(r2);
  // A failed run: the row says the asking stopped (usageStopped), and no further run starts.
  agyusage.resetForTests();
  agyusage.setTokenFileForTests(bin);
  let fails = 0;
  agyusage.setRunnerForTests((b, done) => { fails++; done(new Error('offline'), ''); });
  await row();
  await new Promise((r) => setImmediate(r));
  const rs = await row();
  assert.equal(fails, 1, 'a stopped reading asked agy again');
  assert.equal(rs.usageStopped, true, 'the row did not say the asking stopped');
  // Where no reading can be asked for (agystatus says Windows), the row carries no limits field: nothing is promised.
  agystatus.setPlatformForTests('win32');
  try {
    const rw = await row();
    assert.ok(rw, 'CONTROL: the row is still listed on Windows');
    assert.equal('limits' in rw, false, 'a Windows row promised a reading Kosmos never asks for');
  } finally { agystatus.setPlatformForTests(null); }
});
test.afterEach(() => agystatus.setPlatformForTests(null));

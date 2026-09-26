'use strict';

/**
 * #3946 items 9 and 10 through the real server (in-process, every root sandboxed, dry run): a swarm's
 * daily limit as a % of its account's weekly allowance. The settings PUT turns a % into tokens at once on a
 * calibrated account and keeps the tokens on an uncalibrated one; the sweep's calibration step measures the
 * account's tokens today against the weekly figure's movement and re-derives the limit; /api/accounts tells
 * the create screen which Claude accounts are calibrated.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-allowance-route-')));
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
const store = require('./engine/store');
const create = require('./engine/create');
const swarm = require('./engine/swarm');
const allowance = require('./engine/allowance');
const statusline = require('./engine/kosmos-statusline');
const { start, server, calibrateSwarmAllowances } = require('./server');

function lead(name, profile, configDir) {
  const dir = create.workerDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `# ${name}\n\n${swarm.START}\n${swarm.blockBody(3)}\n${swarm.END}\n`);
  store.writeProfile(name, profile);
  const pp = create.plistPath(name);
  fs.mkdirSync(path.dirname(pp), { recursive: true });
  fs.writeFileSync(pp, create.plistFor(name, '/bin/claude', '/bin/tmux', 'opus', configDir, 'claude'));
}
const FUTURE = Math.floor(Date.now() / 1000) + 3 * 86400;
function account(name, { calibrated } = {}) {
  const dir = mk(name);
  if (calibrated) fs.writeFileSync(path.join(dir, allowance.CALIBRATION_FILE), JSON.stringify({ tokensPerPoint: 1e6, at: Date.now() }));
  return dir;
}

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});
const put = (p, body) => fetch(base + p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('#3946 PUT: a % on a calibrated account is its tokens at once; uncalibrated, the tokens stand and the % is kept', async () => {
  lead('cal', swarm.birthProfile({ dailyTokenLimit: 1000 }), account('acct-cal', { calibrated: true }));
  lead('uncal', swarm.birthProfile({ dailyTokenLimit: 1000 }), account('acct-uncal'));
  const r = await put('/api/agent/cal/swarm', { dailyAllowancePct: 4 });
  assert.equal(r.status, 200, await r.text());
  const s = swarm.settingsOf(store.readProfile('cal'));
  assert.deepEqual([s.dailyAllowancePct, s.dailyTokenLimit], [4, 4e6]);
  const u = await put('/api/agent/uncal/swarm', { dailyAllowancePct: 4 });
  assert.equal(u.status, 200);
  const su = swarm.settingsOf(store.readProfile('uncal'));
  assert.deepEqual([su.dailyAllowancePct, su.dailyTokenLimit], [4, 1000], 'an uncalibrated account got a token number from nowhere');
  assert.equal((await put('/api/agent/cal/swarm', { dailyAllowancePct: 50 })).status, 400);
});

test('#3946 sweep: the account\'s tokens today over the figure\'s movement re-derive a % swarm\'s limit', () => {
  const dir = account('acct-sweep');
  const now = Date.now();
  const dayStart = swarm.startOfDay(now);
  fs.writeFileSync(path.join(dir, statusline.FILE), JSON.stringify({ usedPct: 44, resetsAt: FUTURE, at: now - 1000,
    history: [[dayStart - 3600e3, 40, FUTURE], [now - 1000, 44, FUTURE]] }));
  lead('hive', swarm.birthProfile({ dailyTokenLimit: 1000, dailyAllowancePct: 3 }), dir);
  lead('other', { role: 'pm' }, dir);
  // The real board cards (test-support/fleet), which is what the sweep is handed (safeRoster). Only the
  // lead's measured tokens are set by hand: the sandbox has no transcript for it to meter.
  const fleetMod = require('./test-support/fleet');
  const board = fleetMod.install([fleetMod.agent('hive', { state: 'idle' }), fleetMod.agent('other', { state: 'idle' })]);
  let did;
  try {
    const hive = board.card('hive');
    assert.ok(hive.swarm, 'the lead\'s real card carries no swarm field');
    const roster = [
      { ...hive, swarm: { ...hive.swarm, tokensToday: 3e6 } },
      board.card('other'),   // no transcript here: it counts nothing, and must not throw
    ];
    did = calibrateSwarmAllowances(roster, now);
  } finally { board.restore(); }
  assert.deepEqual(did, [{ name: 'hive', from: 1000, to: 2250000 }], JSON.stringify(did));
  assert.equal(allowance.readCalibration(dir, now).tokensPerPoint, 750000);
  assert.equal(swarm.settingsOf(store.readProfile('hive')).dailyTokenLimit, 2250000);
});

test('#3946 /api/accounts says which Claude account is calibrated', async () => {
  const def = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude');
  fs.mkdirSync(def, { recursive: true });
  // A signed-in default account, so the list has a row for it.
  fs.writeFileSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'person@example.com', accountUuid: 'u-3946' } }));
  fs.writeFileSync(path.join(def, allowance.CALIBRATION_FILE), JSON.stringify({ tokensPerPoint: 2e6, at: Date.now() }));
  const r = await fetch(base + '/api/accounts');
  assert.equal(r.status, 200);
  const rows = ((await r.json()) || {}).accounts || [];
  const row = rows.find((a) => a && a.provider === 'anthropic' && a.dir && fs.realpathSync(a.dir) === fs.realpathSync(def));
  assert.ok(row, 'the default Claude account is not listed: ' + JSON.stringify(rows.map((a) => [a.provider, a.dir])));
  assert.equal(row.weeklyTokensPerPoint, 2e6);
});

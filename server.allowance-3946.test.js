'use strict';

/**
 * #3946 items 9 and 10 through the real server (in-process, every root sandboxed, dry run): a swarm's
 * daily limit as a % of its account's weekly allowance. The settings PUT turns a % into tokens at once on a
 * calibrated account and keeps the tokens on an uncalibrated one; the sweep's calibration step measures the
 * account's tokens today against the weekly figure's movement and re-derives the limit; /api/accounts tells
 * the create screen which Claude accounts are calibrated.
 */

const fs = require('node:fs');
const jobfix = require('./test-support/jobfixture');   // #5432: the agent's job as this platform writes it (plist / systemd unit)
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-allowance-route-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
// #5432: on Linux the agent's job is a systemd user unit, kept in this sandbox too (a sandboxed board without it refuses
// every systemd call, so a create ends partial on a Linux runner). macOS and Windows never read it.
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = require('node:path').join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
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
  const pp = jobfix.jobPath(name);
  fs.mkdirSync(path.dirname(pp), { recursive: true });
  fs.writeFileSync(pp, jobfix.jobFor(name, '/bin/claude', '/bin/tmux', 'opus', configDir, 'claude'));
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
  // A % sent with a token number: on a calibrated account the tokens are the account's, not the ones sent.
  assert.equal((await put('/api/agent/cal/swarm', { dailyAllowancePct: 5, dailyTokenLimit: 1 })).status, 200);
  assert.equal(swarm.settingsOf(store.readProfile('cal')).dailyTokenLimit, 5e6, 'a token number sent with a % was kept');
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
      { ...hive, swarm: { ...hive.swarm, tokensToday: 3e6, metered: true } },   // measured in full
      board.card('other'),   // no transcript here: it counts nothing, and must not throw
    ];
    did = calibrateSwarmAllowances(roster, now);
  } finally { board.restore(); }
  assert.deepEqual(did, [{ name: 'hive', from: 1000, to: 1800000 }], JSON.stringify(did));
  assert.equal(allowance.readCalibration(dir, now).tokensPerPoint, 600000);
  assert.equal(swarm.settingsOf(store.readProfile('hive')).dailyTokenLimit, 1800000);
});

test('#3946 sweep: an account with no swarm on it is still calibrated, so its first swarm can be made in %', () => {
  const dir = account('acct-noswarm');
  const now = Date.now();
  const dayStart = swarm.startOfDay(now);
  fs.writeFileSync(path.join(dir, statusline.FILE), JSON.stringify({ usedPct: 44, resetsAt: FUTURE, at: now - 1000,
    history: [[dayStart - 3600e3, 40, FUTURE], [now - 1000, 44, FUTURE]] }));
  lead('plain', { role: 'pm' }, dir);
  const fleetMod = require('./test-support/fleet');
  const board = fleetMod.install([fleetMod.agent('plain', { state: 'idle' })]);
  let did;
  try {
    const card = board.card('plain');
    assert.equal(card.swarm, null, 'CONTROL: the fixture made a swarm, so this tests the wrong thing');
    did = calibrateSwarmAllowances([card], now, (n) => (n === 'plain' ? 5e6 : 0));
  } finally { board.restore(); }
  assert.deepEqual(did, [], 'no swarm, nothing to re-derive');
  assert.equal(allowance.readCalibration(dir, now).tokensPerPoint, 1e6, 'an account with no swarm was not calibrated');
});

test('#3946 sweep: an account whose count was not read in full this tick is left as it was', () => {
  const dir = account('acct-partial');
  const now = Date.now();
  const dayStart = swarm.startOfDay(now);
  fs.writeFileSync(path.join(dir, statusline.FILE), JSON.stringify({ usedPct: 44, resetsAt: FUTURE, at: now - 1000,
    history: [[dayStart - 3600e3, 40, FUTURE], [now - 1000, 44, FUTURE]] }));
  lead('partial-a', { role: 'pm' }, dir);
  lead('partial-b', { role: 'pm' }, dir);
  const fleetMod = require('./test-support/fleet');
  const board = fleetMod.install([fleetMod.agent('partial-a', { state: 'idle' }), fleetMod.agent('partial-b', { state: 'idle' })]);
  try {
    const cards = [board.card('partial-a'), board.card('partial-b')];
    calibrateSwarmAllowances(cards, now, (n) => (n === 'partial-a' ? 5e6 : NaN));
    assert.equal(allowance.readCalibration(dir, now), null, 'a partly read account was calibrated from half its count');
    calibrateSwarmAllowances(cards, now, (n) => (n === 'partial-a' ? 5e6 : 0));
    assert.equal(allowance.readCalibration(dir, now).tokensPerPoint, 1e6, 'CONTROL: read in full, it is calibrated');
  } finally { board.restore(); }
});

test('#3946 claudeAccountDirOf: the job\'s account, the default home when it names none, null for no job or another runner', () => {
  const status = require('./engine/status');
  const accounts = require('./engine/accounts');
  assert.equal(status.claudeAccountDirOf('nobody-here'), null, 'an agent with no job has no account');
  const acct = account('acct-dirof');
  lead('dirof-named', { role: 'pm' }, acct);
  assert.equal(status.claudeAccountDirOf('dirof-named'), acct);
  lead('dirof-default', { role: 'pm' }, null);
  assert.equal(status.claudeAccountDirOf('dirof-default'), path.join(accounts.HOME_FOR_TEST, '.claude'));
  const pp = jobfix.jobPath('dirof-codex');
  fs.mkdirSync(path.dirname(pp), { recursive: true });
  fs.mkdirSync(create.workerDir('dirof-codex'), { recursive: true });
  fs.writeFileSync(pp, jobfix.jobFor('dirof-codex', '/bin/codex', '/bin/tmux', 'gpt', acct, 'codex'));
  assert.equal(create.readJob('dirof-codex').runner, 'codex', 'CONTROL: the fixture job is not a codex one');
  assert.equal(status.claudeAccountDirOf('dirof-codex'), null, 'a codex agent was given a Claude account');
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

/* #6108: a Claude row carries the account's weekly reading (as Kosmos last recorded it) and the agents on it on this
   computer, so Settings can show both and offer a move before an agent runs out. */
test('#6108 /api/accounts: a Claude row carries its weekly reading and its agents here', async () => {
  const def = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude');
  fs.mkdirSync(def, { recursive: true });
  fs.writeFileSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'person@example.com', accountUuid: 'u-6108' } }));
  const at = Date.now() - 2 * 3600e3;
  fs.writeFileSync(path.join(def, statusline.FILE), JSON.stringify({ usedPct: 82, resetsAt: FUTURE, at, history: [[at, 82, FUTURE]] }));
  lead('usage-on-default', { role: 'writer' }, null);   // no configDir: the default account
  lead('usage-guide', { role: 'setup' }, null);         // the setup guide, also on the default account: never listed
  fs.writeFileSync(path.join(create.workerDir('usage-guide'), '.kosmos-setup-guide'), '');
  const other = account('acct-6108-other');
  lead('usage-on-other', { role: 'writer' }, other);    // CONTROL: on another account, must not be listed here
  const rows = ((await (await fetch(base + '/api/accounts?agents=1')).json()) || {}).accounts || [];
  const row = rows.find((a) => a && a.provider === 'anthropic' && a.dir && fs.realpathSync(a.dir) === fs.realpathSync(def));
  assert.ok(row, 'the default Claude account is not listed');
  assert.deepEqual(row.weekly, { usedPct: 82, resetsAt: FUTURE * 1000, at }, 'the weekly reading did not arrive, or not in ms');
  assert.ok(row.agentsHere && Array.isArray(row.agentsHere.names), 'no agentsHere on the row: ' + JSON.stringify(row.agentsHere));
  assert.ok(row.agentsHere.names.includes('usage-on-default'), 'the agent on this account is missing: ' + JSON.stringify(row.agentsHere));
  assert.ok(!row.agentsHere.names.includes('usage-on-other'), 'an agent on ANOTHER account was listed here');
  assert.equal(row.agentsHere.complete, true, 'every agent here was readable, so the list is complete');
  assert.ok(Array.isArray(row.agentsHere.moving), '#6174: the row does not send which agents are still moving');
  assert.ok(!row.agentsHere.names.includes('usage-guide'), 'the setup guide was listed among the account\'s agents');
  // A reading from a week that has already reset is not this week's: the row says there is none.
  fs.writeFileSync(path.join(def, statusline.FILE), JSON.stringify({ usedPct: 99, resetsAt: Math.floor(Date.now() / 1000) - 60, at }));
  const rows2 = ((await (await fetch(base + '/api/accounts?agents=1')).json()) || {}).accounts || [];
  const row2 = rows2.find((a) => a && a.provider === 'anthropic' && a.dir && fs.realpathSync(a.dir) === fs.realpathSync(def));
  assert.equal(row2.weekly, null, 'a reading from a week that has reset was shown as current');
});

test('#6108 the shared walk: a guard counts the setup guide, the accounts list does not', () => {
  const { enumerateAgentsOnAccount, claudeAgentsByAccount } = require('./server');
  const acct = account('acct-6108-guide');
  lead('guide-on-acct', { role: 'setup' }, acct);
  fs.writeFileSync(path.join(create.workerDir('guide-on-acct'), '.kosmos-setup-guide'), '');
  lead('worker-on-acct', { role: 'writer' }, acct);
  const guard = enumerateAgentsOnAccount(acct, false, 'claude');
  assert.ok(guard.usedBy.includes('guide-on-acct'), 'the disconnect guard no longer counts the guide: removing its account would strand it');
  assert.ok(guard.usedBy.includes('worker-on-acct'), 'CONTROL: the guard counts an ordinary agent');
  const list = claudeAgentsByAccount().on(acct, false);
  assert.ok(!list.includes('guide-on-acct'), 'the accounts list shows the setup guide');
  assert.ok(list.includes('worker-on-acct'), 'CONTROL: the list shows an ordinary agent');
});

test('#6108 the shared walk is fail-closed: an agent whose job cannot be read makes the list incomplete', () => {
  const { claudeAgentsByAccount } = require('./server');
  assert.equal(claudeAgentsByAccount().complete, true, 'CONTROL: with every job readable the list is complete');
  store.writeProfile('unreadable-6108', { role: 'writer' });
  fs.mkdirSync(create.workerDir('unreadable-6108'), { recursive: true });
  const jp = jobfix.jobPath('unreadable-6108');
  fs.mkdirSync(jp, { recursive: true });   // a folder where the job file should be: present, but not readable as a job
  try {
    assert.equal(claudeAgentsByAccount().complete, false, 'an agent whose job could not be read was treated as absent, so the list claimed to be whole');
  } finally { fs.rmSync(jp, { recursive: true, force: true }); }
});

test('#6108 /api/accounts says when an account cannot have a reading: its own status line, never a guess', async () => {
  const def = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude');
  fs.mkdirSync(def, { recursive: true });
  fs.writeFileSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'person@example.com', accountUuid: 'u-6108b' } }));
  const settings = path.join(def, 'settings.json');
  const blockedOf = async () => {
    const rows = ((await (await fetch(base + '/api/accounts?agents=1')).json()) || {}).accounts || [];
    const row = rows.find((a) => a && a.provider === 'anthropic' && a.dir && fs.realpathSync(a.dir) === fs.realpathSync(def));
    assert.ok(row, 'the default Claude account is not listed');
    return row.weeklyBlocked;
  };
  const away = path.join(SANDBOX, 'away-settings-6175.json');
  if (process.platform === 'win32') { assert.equal(await blockedOf(), 'windows'); return; }
  try {
    fs.rmSync(settings, { force: true });
    assert.equal(await blockedOf(), 'not-wired', 'an account with no status line was promised a reading that cannot come');
    fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: 'node /x/' + allowance.MARKER + ' ' + def } }));
    assert.equal(await blockedOf(), null, 'CONTROL: Kosmos\'s own status line was taken for someone else\'s');
    fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: '/usr/local/bin/my-status.sh' } }));
    assert.equal(await blockedOf(), 'own-statusline', 'an account with its own status line was not marked');
    fs.writeFileSync(settings, '{ not json');
    assert.equal(await blockedOf(), 'unreadable-settings', 'a settings file that cannot be parsed was promised a set-up that cannot happen');
    // #6175 review 13: a settings file that is a link away (or to nothing) is not offered a set-up the route always refuses.
    fs.rmSync(settings, { force: true });
    fs.writeFileSync(away, '{"theme":"light"}'); fs.symlinkSync(away, settings);
    assert.equal(await blockedOf(), 'linked-settings', 'a settings file linked elsewhere was offered a set-up that is always refused');
    fs.writeFileSync(away, JSON.stringify({ statusLine: { type: 'command', command: 'node /x/' + allowance.MARKER + ' ' + def } }));
    assert.equal(await blockedOf(), null, 'CONTROL: a linked file that already carries Kosmos\'s status line reads as set up');
    fs.rmSync(away, { force: true });
    assert.equal(await blockedOf(), 'linked-settings', 'a link to nothing was offered a set-up that is always refused');
  } finally { fs.rmSync(settings, { force: true }); fs.rmSync(away, { force: true }); }
});

/* #6175: an existing Claude account with no status line can have its usage reading set up from Settings; one with a
   status line of the person's own is left exactly as it is. */
test('#6175 the usage-reading route wires a not-set-up account and never replaces the person\'s own status line', async () => {
  const def = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude');
  fs.mkdirSync(def, { recursive: true });
  fs.writeFileSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'person@example.com', accountUuid: 'u-6175' } }));
  const settings = path.join(def, 'settings.json');
  const post = async (body) => {
    const r = await fetch(base + '/api/accounts/claude/usage-reading', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) });   // the page, as the browser sends it
    return { status: r.status, j: await r.json() };
  };
  const blockedOf = async () => {
    const rows = ((await (await fetch(base + '/api/accounts')).json()) || {}).accounts || [];
    const row = rows.find((a) => a && a.provider === 'anthropic' && a.dir && fs.realpathSync(a.dir) === fs.realpathSync(def));
    return row ? row.weeklyBlocked : 'unlisted';
  };
  if (process.platform === 'win32') {
    const r = await post({ dir: def });
    assert.equal(r.status, 409, 'Windows has no weekly reading to wire: ' + JSON.stringify(r));
    return;
  }
  const keyed = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude-keyed6175');
  try {
    fs.rmSync(settings, { force: true });
    assert.equal(await blockedOf(), 'not-wired', 'precondition: the account has no status line');
    // Review 11: only the person, from Settings: a request that is not from the page is refused and writes nothing.
    const noScreen = await fetch(base + '/api/accounts/claude/usage-reading', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: def }) });
    assert.equal(noScreen.status, 403, 'a request not from the page was let through');
    assert.ok(!fs.existsSync(settings), 'a request not from the page wrote a settings file');
    // Review 11: a settings file linked to a file outside the account's folder is left alone, byte for byte.
    const shared = path.join(SANDBOX, 'shared-settings-6175.json');
    fs.writeFileSync(shared, '{"theme":"light"}');
    fs.symlinkSync(shared, settings);
    const linked = await post({ dir: def });
    assert.equal(linked.status, 409, JSON.stringify(linked));
    assert.match(linked.j.because, /a link to a file elsewhere/, linked.j.because);
    assert.equal(fs.readFileSync(shared, 'utf8'), '{"theme":"light"}', 'a shared settings file was written');
    fs.rmSync(settings, { force: true }); fs.rmSync(shared, { force: true });
    const r = await post({ dir: def });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.j.wired, true);
    assert.ok(allowance.isOurs(JSON.parse(fs.readFileSync(settings, 'utf8')).statusLine), 'the settings file does not carry Kosmos\'s status line');
    assert.equal(await blockedOf(), null, 'the row still says it is not set up');
    assert.equal((await post({ dir: def })).j.changed, false, 'a second press rewrote a status line that was already right');
    // The person's own status line: refused, and the file is byte-for-byte as it was.
    const own = JSON.stringify({ statusLine: { type: 'command', command: '/usr/local/bin/my-status.sh' }, theme: 'dark' });
    fs.writeFileSync(settings, own);
    const refused = await post({ dir: def });
    assert.equal(refused.status, 409, JSON.stringify(refused));
    assert.match(refused.j.because, /its own status line/, refused.j.because);
    assert.equal(fs.readFileSync(settings, 'utf8'), own, 'the person\'s own status line was touched');
    // An API-key account (a stored key, no sign-in) is refused, and nothing is written into it (review 1). Review 3: the
    // key's live check is stubbed, so the fixture key never goes to Anthropic, and the folder is removed after.
    require('./engine/claudeaccounts').setFetcher(async () => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error' } } }));
    fs.mkdirSync(keyed, { recursive: true });
    fs.writeFileSync(require('./engine/claudeaccounts').keyFile(keyed), 'sk-ant-api03-' + 'x'.repeat(40) + '\n', { mode: 0o600 });
    const listedKeyed = ((await (await fetch(base + '/api/accounts')).json()) || {}).accounts || [];
    assert.ok(listedKeyed.some((a) => a && a.dir && fs.realpathSync(a.dir) === fs.realpathSync(keyed) && a.apiKey === true), 'precondition: the key account is listed as an API key');
    assert.equal((await post({ dir: keyed })).status, 400, 'an API-key account was wired');
    // Review 12: a caller not from the page is refused before any lookup: the same 403 for a key account and a non-account.
    const notPage = async (d) => (await fetch(base + '/api/accounts/claude/usage-reading', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: d }) })).status;
    assert.equal(await notPage(keyed), 403, 'a caller not from the page learned the folder is an API-key account');
    assert.equal(await notPage(path.join(SANDBOX, 'not-an-account')), 403, 'a caller not from the page learned the folder is not an account');
    assert.ok(!fs.existsSync(path.join(keyed, 'settings.json')), 'a settings file was written into an API-key account');
    // Only an account this computer lists, and a request it can read.
    assert.equal((await post({ dir: path.join(SANDBOX, 'not-an-account') })).status, 404);
    assert.equal((await post({})).status, 400);
    // A fault after the request was read is 500, and says no path (review 5).
    const al = require('./engine/allowance'); const realEnsure = al.ensureStatusLine;
    al.ensureStatusLine = () => { throw new Error('EACCES: permission denied, open \'/Users/someone/.claude/settings.json\''); };
    const errLog = console.error; console.error = () => {};
    try {
      const fault = await post({ dir: def });
      assert.equal(fault.status, 500, JSON.stringify(fault));
      assert.ok(!/\/Users\//.test(JSON.stringify(fault.j)), 'a path reached the page: ' + JSON.stringify(fault.j));
    } finally { al.ensureStatusLine = realEnsure; console.error = errLog; }
    const bad = await fetch(base + '/api/accounts/claude/usage-reading', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(bad.status, 400, 'a body that is not JSON was not refused as unreadable');
  } finally {
    fs.rmSync(settings, { force: true });
    fs.rmSync(path.join(SANDBOX, 'shared-settings-6175.json'), { force: true });
    fs.rmSync(keyed, { recursive: true, force: true });
    require('./engine/claudeaccounts').setFetcher(null);
  }
});

/* #6108: the page's "Moved X (stopped). It is not running now" depends on what the account route answers for a stopped
   agent. Pin it here, so a change to the route goes red rather than leaving the row's sentence untrue. */
test('#6108 the account route moves a stopped agent without starting it, and says it is not running', async () => {
  const from = account('acct-6108-from');
  /* The target must be an account the route knows: ~/.claude-<label> with a signed-in .claude.json, and its history
     shared with the default account (projects linked to ~/.claude/projects), as prepare() makes them. */
  const home = process.env.AGENT_WORKFORCE_HOME;
  fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
  const to = path.join(home, '.claude-6108to');
  fs.mkdirSync(to, { recursive: true });
  fs.writeFileSync(path.join(to, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'to@example.com', accountUuid: 'u-6108-to' } }));
  try { fs.symlinkSync(path.join(home, '.claude', 'projects'), path.join(to, 'projects')); } catch { /* already linked */ }
  lead('sleeper-6108', { role: 'writer' }, from);
  const r = await fetch(base + '/api/agent/sleeper-6108/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: to }) });
  const out = await r.json();

  assert.equal(out.outcome, 'partial', 'a stopped agent did not come back partial: ' + JSON.stringify(out));
  assert.match(String(out.because || ''), /is not running, so there is nothing to restart/, 'the reason no longer carries the exact phrase the page keys on');
  assert.equal(path.resolve(create.readJob('sleeper-6108').configDir), path.resolve(to), 'the account was not saved');
  // #6174 (a regression pin, not the comparison's test): a stopped agent has no session to note.
  assert.ok(!('sleeper-6108' in require('./engine/accountmoving').notes()), 'a stopped agent was noted as still running on its old account');
});

test('#6108 /api/accounts walks the agents only when asked (?agents=1): other pages do not pay for it', async () => {
  const rows = ((await (await fetch(base + '/api/accounts')).json()) || {}).accounts || [];
  const claude = rows.filter((a) => a && a.provider === 'anthropic');
  assert.ok(claude.length > 0, 'CONTROL: there is a Claude row to look at');
  assert.ok(claude.every((a) => !('agentsHere' in a)), 'a caller that did not ask got agentsHere');
});

test('#6174 an agent whose move came back partial while the same session runs is marked moving, until it restarts', () => {
  const { claudeAgentsByAccount } = require('./server');
  const accountmoving = require('./engine/accountmoving');
  const newAcct = account('acct-6174-new');
  const oldAcct = account('acct-6174-old');
  lead('mv-still-old', { role: 'writer' }, newAcct);   // moved here; its old session still runs
  lead('mv-restarted', { role: 'writer' }, newAcct);   // moved here; a new session has started since
  lead('mv-stopped', { role: 'writer' }, newAcct);     // moved here; no session at all
  lead('mv-back', { role: 'writer' }, oldAcct);        // moved away and back to the account it still runs on
  lead('mv-plain', { role: 'writer' }, newAcct);       // CONTROL: never had a partial move
  accountmoving.note('mv-still-old', 1000e3, oldAcct);
  accountmoving.note('mv-restarted', 1000e3, oldAcct);
  accountmoving.note('mv-stopped', 1000e3, oldAcct);
  accountmoving.note('mv-back', 1000e3, oldAcct);
  // Legacy-style sessions: the card's session is not the board name, and is what the start is read from.
  let starts = { 'mv-still-old-discord': 1000e3, 'mv-restarted-discord': 2000e3, 'mv-back-discord': 1000e3, 'mv-plain-discord': 500e3 };
  const deps = { sessionOf: (n) => (n === 'mv-stopped' ? null : n + '-discord'), startedAt: (s) => (s in starts ? starts[s] : null) };
  const by = claudeAgentsByAccount();
  assert.ok(by.on(newAcct, false).includes('mv-still-old'), 'listed by its launch file (the account it was moved to)');
  assert.deepEqual(by.moving(newAcct, false, deps), ['mv-still-old'], 'only the agent whose old session still runs is marked');
  assert.ok(!('mv-restarted' in accountmoving.notes()), 'a note whose session is readably another was not pruned');
  assert.ok('mv-stopped' in accountmoving.notes(), 'a note with no readable session was pruned (only a readable other session may be)');
  assert.deepEqual(by.moving(oldAcct, false, deps), [], 'an agent moved back to the account it still runs on was marked');
  // An agent that ran on the default account (from: null), moved to a named one: marked there, not on the default row.
  lead('mv-from-default', { role: 'writer' }, newAcct);
  accountmoving.note('mv-from-default', 1000e3, null);
  starts['mv-from-default-discord'] = 1000e3;
  assert.ok(claudeAgentsByAccount().moving(newAcct, false, deps).includes('mv-from-default'), 'a default-account agent moved away was not marked');
  // ...and one moved back to the default account it still runs on is not marked there.
  lead('mv-default-back', { role: 'writer' }, null);
  accountmoving.note('mv-default-back', 1000e3, null);
  starts['mv-default-back-discord'] = 1000e3;
  const def = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude');
  assert.ok(claudeAgentsByAccount().on(def, true).includes('mv-default-back'), 'CONTROL: it is listed on the default row');
  assert.ok(!claudeAgentsByAccount().moving(def, true, deps).includes('mv-default-back'), 'an agent back on the default account it runs on was marked');
  // Review 5: one whose note names the default folder by path (not null) is not marked on the default row either.
  lead('mv-default-path', { role: 'writer' }, null);
  accountmoving.note('mv-default-path', 1000e3, def);
  starts['mv-default-path-discord'] = 1000e3;
  assert.ok(!claudeAgentsByAccount().moving(def, true, deps).includes('mv-default-path'), 'a note naming the default folder by path marked it on the default row');
  // Once its session restarts, the mark goes.
  starts = { 'mv-still-old-discord': 3000e3 };
  assert.deepEqual(claudeAgentsByAccount().moving(newAcct, false, deps), [], 'a restarted agent is still marked moving');
});

test('#6174 restartForMove reads the start BEFORE the restart, notes only a PARTIAL with the same session, keeps the first account', () => {
  const { restartForMove } = require('./server');
  const accountmoving = require('./engine/accountmoving');
  const remove = require('./engine/remove');
  const run = (name, outcome, before, after, from) => {
    let reads = 0; let readsAtRestart = null;
    const deps = {
      sessionOf: (n) => n + '-discord',
      startedAt: () => { reads += 1; return reads === 1 ? before : after; },
      restart: () => { readsAtRestart = reads; return { outcome }; },
    };
    const back = restartForMove(name, from, deps);
    // Asserted here, not inside restart (restartForMove turns a throw there into a partial).
    assert.equal(readsAtRestart, 1, name + ': the start was not read before the restart');
    return back;
  };
  // Each non-noting case starts with a note an earlier move wrote, so "clears" is tested, not only "never writes".
  for (const k of ['rf-new', 'rf-gone', 'rf-refused', 'rf-unread']) accountmoving.note(k, 1000e3, '/acct/z');
  run('rf-same', remove.OUTCOME.PARTIAL, 1000e3, 1000e3, '/acct/a');
  run('rf-new', remove.OUTCOME.PARTIAL, 1000e3, 2000e3, '/acct/a');     // it did relaunch
  run('rf-gone', remove.OUTCOME.PARTIAL, 1000e3, null, '/acct/a');      // no session after
  run('rf-refused', remove.OUTCOME.REFUSED, 1000e3, 1000e3, '/acct/a'); // nothing confirmed as ours
  run('rf-unread', remove.OUTCOME.PARTIAL, null, null, '/acct/a');
  const n = accountmoving.notes();
  assert.deepEqual(n['rf-same'], { started: 1000e3, from: '/acct/a' }, 'a partial move with the same session running was not noted');
  for (const k of ['rf-new', 'rf-gone', 'rf-refused', 'rf-unread']) assert.ok(!(k in n), k + ' was noted');
  // Moved again while the same session still runs: the account it runs on is still the first one.
  run('rf-same', remove.OUTCOME.PARTIAL, 1000e3, 1000e3, '/acct/b');
  assert.equal(accountmoving.notes()['rf-same'].from, '/acct/a', 'a second partial move replaced the account it still runs on');
  // A move that restarted it clears the note.
  run('rf-same', remove.OUTCOME.RESTARTED, 1000e3, 1000e3, '/acct/b');
  assert.ok(!('rf-same' in accountmoving.notes()), 'a full restart left the note');
});

test('#6174 accountmoving: a failed reading marks nobody and keeps the note; isMoving is read-only; clearIf drops only that note', () => {
  const accountmoving = require('./engine/accountmoving');
  assert.equal(accountmoving.note('', 1), false);
  assert.equal(accountmoving.note('x-6174', NaN), false);
  accountmoving.note('x-6174', 5000);
  assert.equal(accountmoving.isMoving('x-6174', () => null), false, 'an unreadable session was marked');
  assert.ok('x-6174' in accountmoving.notes(), 'an unreadable reading dropped the note');
  assert.equal(accountmoving.isMoving('x-6174', () => { throw new Error('boom'); }), false);
  assert.equal(accountmoving.isMoving('x-6174', () => 5000), true, 'the same session is moving');
  assert.equal(accountmoving.isMoving('x-6174', () => 6000), false, 'another session is not');
  assert.ok('x-6174' in accountmoving.notes(), 'isMoving cleared the note (it is read-only)');
  // clearIf drops only that very note: a newer note for the name (another start) is kept.
  accountmoving.note('x-6174', 7000);
  assert.equal(accountmoving.clearIf('x-6174', 5000), false);
  assert.ok('x-6174' in accountmoving.notes(), 'clearIf dropped a note for another session');
  assert.equal(accountmoving.clearIf('x-6174', 7000), true);
  assert.ok(!('x-6174' in accountmoving.notes()), 'clearIf kept the note it was asked to drop');
  assert.equal(accountmoving.isMoving('never-6174', () => 1), false, 'an agent with no note was marked');
});

test('#6174 the session is found through the pane roster as remove.js does: the card tied to the agent, never a bystander', () => {
  const { claudeAgentsByAccount } = require('./server');
  const accountmoving = require('./engine/accountmoving');
  const acct = account('acct-6174-roster');
  lead('rs-tied', { role: 'writer' }, acct);     // its card's session is a legacy name, tied to it
  lead('rs-untied', { role: 'writer' }, acct);   // CONTROL: a pane under its name that is not tied to it
  accountmoving.note('rs-tied', 1000e3, null);
  accountmoving.note('rs-untied', 1000e3, null);
  // Real panes through the real roster (test-support/fleet): a tied agent (legacy session name) and a stranger's pane.
  const fleet = require('./test-support/fleet');
  fleet.install([fleet.agent('rs-tied'), fleet.stranger('rs-untied')]);
  try {
    const asked = []; const freshness = [];
    const deps = { startedAt: (s, fresh) => { asked.push(s); freshness.push(fresh); return 1000e3; } };
    assert.deepEqual(claudeAgentsByAccount().moving(acct, false, deps), ['rs-tied'], 'the tied card was not used, or a bystander was');
    assert.ok(asked.includes('rs-tied-discord'), 'the start was not read from the card\'s own session: ' + JSON.stringify(asked));
    assert.ok(!asked.includes('rs-untied'), 'a session not tied to the agent was read');
    // A cached start can be 2 s old and mark an agent that has just restarted: the list reads it fresh.
    assert.ok(freshness.length > 0 && freshness.every((f) => f === true), 'the list read a cached session start: ' + JSON.stringify(freshness));
  } finally { fleet.restore(); }
});

test('#6174 the account route reads the account it moves FROM before it writes the new one, and hands that to the restart', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'server.js'), 'utf8');
  const start = src.indexOf("const acctRoute = pathname.match(");
  assert.ok(start > 0, 'the account route was not found');
  const end = src.indexOf('\n  }\n', start);
  assert.ok(end > start, 'the end of the account route was not found');
  const route = src.slice(start, end);
  const from = route.indexOf('const fromDir = moveFromDir(name)');
  const write = route.indexOf('create.setAccount(name');
  assert.ok(from > 0 && write > 0, 'the from-read or the account write was not found in the route');
  // Read after the write, `from` would be the new account and the mark would hide on exactly its own row.
  assert.ok(from < write, 'the account moved from is read after the new one is written');
  assert.match(route, /restartForMove\(name, fromDir\b/, 'the restart is not given the account read before the move');
});

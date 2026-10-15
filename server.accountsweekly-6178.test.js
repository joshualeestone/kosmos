'use strict';

/**
 * kosmos#6178 through the real server (in-process, every root sandboxed, dry run): GET /api/status carries each
 * Claude account's weekly reading as `accountsWeekly`, the same value /api/accounts gives the account's row, and an
 * agent's `account.dir` joins to its entry. Another computer reads this through the sibling path (#4812).
 */

const fs = require('node:fs');
const jobfix = require('./test-support/jobfixture');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-accountsweekly-route-')));
const mk = (n) => { const d = path.join(SANDBOX, n); fs.mkdirSync(d, { recursive: true }); return d; };
process.env.AGENT_WORKFORCE_HOME = mk('home');
process.env.AGENT_WORKFORCE_DATA = mk('data');
process.env.AGENT_WORKFORCE_WORKERS = mk('workers');
process.env.AGENT_WORKFORCE_PROJECTS = mk('projects');
process.env.AGENT_WORKFORCE_LAUNCH = mk('launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = path.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./engine/store');
const create = require('./engine/create');
const statusline = require('./engine/kosmos-statusline');
const accountsweekly = require('./engine/accountsweekly');
const { start, server } = require('./server');

function lead(name, configDir) {
  const dir = create.workerDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `# ${name}\n\nYou are **${name}**.\n`);
  store.writeProfile(name, { role: 'writer' });
  const pp = jobfix.jobPath(name);
  fs.mkdirSync(path.dirname(pp), { recursive: true });
  fs.writeFileSync(pp, jobfix.jobFor(name, '/bin/claude', '/bin/tmux', 'opus', configDir, 'claude'));
}
const FUTURE = Math.floor(Date.now() / 1000) + 3 * 86400;
const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => {
  try { server.close(); } catch { /* best effort */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

test('#6178 /api/status carries each Claude account\'s weekly reading, equal to /api/accounts\'s, joinable by dir', async () => {
  accountsweekly.resetForTests();
  const def = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude');
  fs.mkdirSync(def, { recursive: true });
  fs.writeFileSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'person@example.com', accountUuid: 'u-6178' } }));
  const at = Date.now() - 3600e3;
  fs.writeFileSync(path.join(def, statusline.FILE), JSON.stringify({ usedPct: 67, resetsAt: FUTURE, at }));
  lead('weekly-on-default', null);

  const st = await (await fetch(base + '/api/status')).json();
  assert.ok(Array.isArray(st.accountsWeekly), 'no accountsWeekly in /api/status: ' + Object.keys(st).join(','));
  const entry = st.accountsWeekly.find((e) => e && real(e.dir) === real(def));
  assert.ok(entry, 'the default Claude account is not in accountsWeekly: ' + JSON.stringify(st.accountsWeekly));
  assert.equal(entry.email, 'person@example.com');
  assert.equal(entry.isDefault, true);
  assert.deepEqual(entry.weekly, { usedPct: 67, resetsAt: FUTURE * 1000, at });

  const rows = ((await (await fetch(base + '/api/accounts')).json()) || {}).accounts || [];
  const row = rows.find((a) => a && a.provider === 'anthropic' && a.dir && real(a.dir) === real(def));
  assert.ok(row, 'CONTROL: the default Claude account is not listed by /api/accounts');
  assert.deepEqual(entry.weekly, row.weekly, 'the two routes disagree about the same account');
  assert.equal(entry.blocked, row.weeklyBlocked, 'the two routes disagree about why there is no reading');

  const agent = (st.agents || []).find((a) => a && a.sessionName === 'weekly-on-default');
  assert.ok(agent, 'CONTROL: the fixture agent is not on the board: ' + JSON.stringify((st.agents || []).map((a) => a.sessionName)));
  // Exactly, as the page joins them (aoGroup compares the two strings): a realpath here would hide a join that fails there.
  assert.ok(agent.account && agent.account.dir === entry.dir, 'the agent does not join to its account entry by dir: ' + JSON.stringify([agent.account, entry.dir]));
});

test('#6178 a Claude list that cannot be read is sent as null ("could not read"), never as no accounts', async () => {
  accountsweekly.resetForTests();
  const accounts = require('./engine/accounts');
  const real = accounts.list;
  accounts.list = () => { throw new Error('unreadable for the test'); };
  try {
    const st = await (await fetch(base + '/api/status')).json();
    assert.equal(st.accountsWeekly, null, 'a failed list read went out as ' + JSON.stringify(st.accountsWeekly));
    assert.ok(Array.isArray(st.agents), 'CONTROL: the rest of the status still answered');
  } finally { accounts.list = real; }
  const ok = await (await fetch(base + '/api/status')).json();
  assert.ok(Array.isArray(ok.accountsWeekly), 'CONTROL: with the list readable again it is a list');
});

/* The real producer against the real consumer: a sibling read (a browser on another of the person's computers sends
   Sec-Fetch-Site: same-site) goes through statusForSibling (#4973), and the page's own parsers, lifted from
   web/index.html, must join what it sends. The first build was tested only against hand-written answers and the
   sibling cut sent none of it (found in review). */
test('#6178 a sibling read carries the accounts and the join, with no folder path, and the page parses it', async () => {
  accountsweekly.resetForTests();
  const def = path.join(process.env.AGENT_WORKFORCE_HOME, '.claude');
  fs.mkdirSync(def, { recursive: true });
  fs.writeFileSync(path.join(process.env.AGENT_WORKFORCE_HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'person@example.com', accountUuid: 'u-6178s' } }));
  const at = Date.now() - 3600e3;
  fs.writeFileSync(path.join(def, statusline.FILE), JSON.stringify({ usedPct: 71, resetsAt: FUTURE, at }));
  lead('sib-on-default', null);
  const res = await fetch(base + '/api/status', { headers: { 'sec-fetch-site': 'same-site' } });
  assert.equal(res.status, 200);
  const raw = await res.text();
  assert.ok(!raw.includes(SANDBOX) && !raw.includes(os.homedir()), 'a sibling answer carries a folder path of this computer');
  const sib = JSON.parse(raw);
  assert.ok(!('engine' in sib) && !('updateLog' in sib), 'CONTROL: this is the cut-down sibling answer (#4973)');
  assert.ok(Array.isArray(sib.accountsWeekly), 'the sibling answer carries no accountsWeekly: ' + Object.keys(sib).join(','));
  assert.equal(typeof sib.checkedAt, 'string');
  const entry = sib.accountsWeekly.find((e) => e.email === 'person@example.com');
  assert.ok(entry && /^a\d+$/.test(entry.key) && !('dir' in entry), 'the account is not keyed by an opaque id: ' + JSON.stringify(entry));
  assert.equal(entry.weekly.usedPct, 71);
  const agent = sib.agents.find((a) => a.sessionName === 'sib-on-default');
  assert.ok(agent && agent.acct === entry.key && agent.runner === 'claude' && agent.tied === true, 'the agent does not carry its account key, runner and tie: ' + JSON.stringify(agent));

  const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const slice = (name) => { const i = PAGE.indexOf('function ' + name + '('); assert.ok(i >= 0, name + ' moved'); return PAGE.slice(i, PAGE.indexOf('\n}\n', i) + 2); };
  const constLine = (name) => { const i = PAGE.indexOf('const ' + name + ' = '); assert.ok(i >= 0, name + ' moved'); return PAGE.slice(i, PAGE.indexOf('\n', i) + 1); };
  const page = new Function(constLine('AO_MAX_ACCOUNTS') + constLine('AO_MAX_AGENTS') + slice('aoStr') + slice('aoAccountsOf') + slice('aoAgentsOf') + slice('aoUnknownOf')
    + '\nreturn { aoAccountsOf, aoAgentsOf, aoUnknownOf };')();
  const accounts = page.aoAccountsOf(sib);
  const agents = page.aoAgentsOf(sib);
  const mine = accounts.find((e) => e.email === 'person@example.com');
  assert.ok(mine && mine.weekly && mine.weekly.usedPct === 71, 'the page did not parse the account: ' + JSON.stringify(accounts));
  assert.deepEqual(agents.filter((a) => a.acct === mine.key).map((a) => a.name).length >= 1, true, 'the page could not join the agent to its account');
  assert.equal(page.aoUnknownOf(sib), 0, 'a joined Claude agent was counted as could not be checked');
});

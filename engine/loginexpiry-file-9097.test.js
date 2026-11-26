'use strict';
/* kosmos#9097: off macOS, a Claude login's expiry is read from the config folder's .credentials.json (measured on the
 * Windows box 11-25: Claude Code 2.1.319 keeps it there, not in a keychain). Before this, the board read only the macOS
 * Keychain, so Windows never showed a login warning or an "Expires in N days" line. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const le = require('./loginexpiry');
/* The Windows warning test below drives status.computeLoginAdvisories, which reads names and accounts: sandbox the
   board's roots BEFORE status loads, as loginexpiry-snapshot-3532.test.js does, so nothing reads this Mac's files. */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'le9097-board-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const UNTIL = Date.UTC(2026, 10, 29, 2, 37, 55);   // the Windows box's own date, 2026-11-29T02:37:55Z
const ACCESS = UNTIL - 86400000;
const body = (o) => JSON.stringify({ claudeAiOauth: { accessToken: 'tok-not-read', refreshToken: 'ref-not-read', ...o } });

function home() {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'le9097-'));
  fs.mkdirSync(path.join(h, '.claude'));
  fs.writeFileSync(path.join(h, '.claude', '.credentials.json'), body({ refreshTokenExpiresAt: UNTIL, expiresAt: ACCESS }));
  fs.mkdirSync(path.join(h, '.claude-b'));
  fs.writeFileSync(path.join(h, '.claude-b', '.credentials.json'), body({ refreshTokenExpiresAt: UNTIL + 5, expiresAt: ACCESS }));
  return h;
}
const winRead = (h) => (service, ccd) => le.readCredDefault(service, ccd, { platform: 'win32', home: h });

test('kosmos#9097: on Windows the default account (no CLAUDE_CONFIG_DIR) is read from <home>/.claude/.credentials.json', () => {
  const h = home();
  const t = le.loginTimesFor(undefined, { readCred: winRead(h) });
  assert.deepStrictEqual(t, { refreshExpiresAt: UNTIL, accessExpiresAt: ACCESS });
  // (No macOS arm here: on a Mac it would read the real Keychain. The last test's control shows the old behaviour.)
});

test('kosmos#9097: a named CLAUDE_CONFIG_DIR is read from ITS folder, not the default one', () => {
  const h = home();
  assert.strictEqual(le.loginTimesFor(path.join(h, '.claude-b'), { readCred: winRead(h) }).refreshExpiresAt, UNTIL + 5);
  assert.strictEqual(le.loginTimesFor(path.join(h, '.claude'), { readCred: winRead(h) }).refreshExpiresAt, UNTIL);
});

test('kosmos#9097: only the two dates leave the reader; the tokens are never returned', () => {
  const h = home();
  const t = le.loginTimesFor(undefined, { readCred: winRead(h) });
  assert.deepStrictEqual(Object.keys(t).sort(), ['accessExpiresAt', 'refreshExpiresAt']);
  assert.ok(!JSON.stringify(t).includes('not-read'));
});

test('kosmos#9097: a folder outside the home, a missing file, or a bad file reads as nothing (fail soft)', () => {
  const h = home();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'le9097-out-'));
  fs.writeFileSync(path.join(outside, '.credentials.json'), body({ refreshTokenExpiresAt: UNTIL }));
  assert.strictEqual(le.loginTimesFor(outside, { readCred: winRead(h) }).refreshExpiresAt, null, 'outside the real home is never read');
  assert.strictEqual(le.loginTimesFor(path.join(h, '.claude-none'), { readCred: winRead(h) }).refreshExpiresAt, null);
  fs.writeFileSync(path.join(h, '.claude', '.credentials.json'), '{not json');
  assert.strictEqual(le.loginTimesFor(undefined, { readCred: winRead(h) }).refreshExpiresAt, null);
  assert.strictEqual(le.readCredDefault('x', undefined, { platform: 'win32', home: null }), null, 'no home, no read');
});

test('kosmos#9097: the async reader reads the same file off macOS', async () => {
  const h = home();
  const raw = await le.readCredAsync(le.serviceNameFor(undefined), undefined, { platform: 'linux', home: h });
  assert.strictEqual(JSON.parse(raw).claudeAiOauth.refreshTokenExpiresAt, UNTIL);
  assert.strictEqual(await le.readCredAsync('x', path.join(h, '.claude-none'), { platform: 'win32', home: h }), null);
});

test('kosmos#9097: an advisory is built on Windows for a login inside the warning window', () => {
  const h = home();
  const now = UNTIL - 3 * 86400000;   // three days before the box's date, as on 11-25
  const adv = le.advisoriesFor({ accounts: [{ ccd: undefined, agents: ['agent-a'] }], now, readCred: winRead(h) });
  assert.strictEqual(adv.length, 1, 'one warning for the default account');
  // CONTROL: the same account, read the old macOS-only way, gives no warning (the 11-25 Windows board's empty list).
  const none = le.advisoriesFor({ accounts: [{ ccd: undefined, agents: ['agent-a'] }], now, readCred: () => null });
  assert.strictEqual(none.length, 0);
});

test('kosmos#9097 review 1: a sandboxed board (its own HOME) never reads the real home default file', () => {
  const real = home();
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'le9097-sb-'));
  // HOME is the sandbox, outside the real home: the unset account is the sandbox's, and is refused, not the real one.
  assert.strictEqual(le.readCredDefault('x', undefined, { platform: 'linux', home: real, userHome: sandbox }), null);
  // CONTROL: HOME is the real home: the same call reads the real default file.
  assert.ok(le.readCredDefault('x', undefined, { platform: 'linux', home: real, userHome: real }));
});

test('kosmos#9097 review 1: on Windows the login warning finds the folder of each agent from its launch job', () => {
  const h = home();
  const status = require('./status');
  const fleet = require('../test-support/fleet');
  const now = UNTIL - 3 * 86400000;
  const panes = [
    status.parsePanes(fleet.line({ session: 'amy-discord', pane: '0.0' }))[0],
    status.parsePanes(fleet.line({ session: 'ben-discord', pane: '0.1' }))[0],
  ];
  // Controls: the fixture really passes the pane filter (else every assertion below is vacuous).
  assert.ok(panes.every((p) => status.isNamedOurs(p)), 'the fixture panes are ours');
  const jobs = { amy: { runner: 'claude', configDir: null }, ben: { runner: 'claude', configDir: path.join(h, '.claude-b') } };
  const opts = {
    platform: 'win32', readJob: (n) => jobs[n] || null, readCred: winRead(h), cache: { at: 0, value: [] },
    displayName: (n) => n, emailOf: () => null, rowDirs: new Set(),
  };
  const adv = status.computeLoginAdvisories(panes, now, opts);
  const named = adv.flatMap((a) => a.agents || []);
  assert.ok(named.includes('amy'), 'a default-account agent is warned about: ' + JSON.stringify(adv));
  assert.ok(named.includes('ben'), 'an agent on its own folder is warned about: ' + JSON.stringify(adv));
  // An agent with no readable Claude job is skipped, never guessed onto the default account.
  const noJob = status.computeLoginAdvisories(panes, now, { ...opts, readJob: (n) => (n === 'amy' ? null : jobs[n]), cache: { at: 0, value: [] } });
  assert.ok(!noJob.flatMap((a) => a.agents || []).includes('amy'), 'no job, no warning for that agent');
  const codex = status.computeLoginAdvisories(panes, now, { ...opts, readJob: (n) => (n === 'amy' ? { runner: 'codex' } : jobs[n]), cache: { at: 0, value: [] } });
  assert.ok(!codex.flatMap((a) => a.agents || []).includes('amy'), 'a non-Claude job is never in a Claude login warning');
  // CONTROL: the pane reader (the path Windows took before) finds no folder, so no warning: the 11-25 board's [].
  const before = status.computeLoginAdvisories(panes, now, { ...opts, readDetail: () => ({ ccd: undefined, pid: null }), cache: { at: 0, value: [] } });
  assert.strictEqual(before.length, 0);
});

test('kosmos#9097 review 2: off macOS an explicit <HOME>/.claude and an unset folder are ONE login, one warning', () => {
  const h = home();
  const now = UNTIL - 3 * 86400000;
  const agents = [{ name: 'amy' }, { name: 'ben' }];
  const ccdOf = { amy: null, ben: path.join(h, '.claude') };
  const run = (platform) => le.agentAdvisories({ agents, readCcd: (a) => ccdOf[a.name], now, readCred: winRead(h), platform, userHome: h });
  const win = run('win32');
  assert.strictEqual(win.length, 1, 'one notice for one login: ' + JSON.stringify(win));
  assert.deepStrictEqual(win[0].agents.sort(), ['amy', 'ben']);
  assert.strictEqual(win[0].ccd, null, 'the shared bucket is the default account, so its notice names the default row');
  // CONTROL: on macOS they stay two credentials (the #2129 class: the Keychain entry name differs).
  const mac = le.agentAdvisories({ agents, readCcd: (a) => ccdOf[a.name], now, readCred: () => body({ refreshTokenExpiresAt: UNTIL }), platform: 'darwin', userHome: h });
  assert.strictEqual(mac.length, 2);
});

test('kosmos#9097 review 2: the account row reads its login off macOS, with its folder', async () => {
  const live = require('./claudeloginlive');
  const h = home();
  const seen = [];
  live._clearForTest();
  live.setCredReaderForTests((service, ccd) => { seen.push([service, ccd]); return le.readCredAsync(service, ccd, { platform: 'win32', home: h }); });
  try {
    const own = path.join(h, '.claude-b');
    assert.strictEqual(await live.validUntil({ dir: own, isDefault: false }), UNTIL + 5);
    assert.strictEqual(await live.validUntil({ dir: path.join(h, '.claude'), isDefault: true }), UNTIL);
    assert.deepStrictEqual(seen.map((x) => x[1]), [own, undefined], 'the folder (undefined for the default) reaches the read');
  } finally { live.setCredReaderForTests(null); live._clearForTest(); }
  // CONTROL: with no reader set, a test context reads nothing (never a real credential).
  assert.strictEqual(await live.validUntil({ dir: path.join(h, '.claude-b'), isDefault: false }), null);
});

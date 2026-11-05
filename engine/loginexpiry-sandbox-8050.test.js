'use strict';
/* kosmos#8050: Kosmos's own keychain read answers a fixture on a board started by tools/browser-checks.sh.
 *   tools/run-tests.sh --only engine/loginexpiry-sandbox-8050.test.js
 * No arm can touch the real keychain: PATH holds only a fake `security`, which records that it ran. Its shebang names
 * /bin/sh and it uses only shell builtins. */
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const le = require('./loginexpiry');

const VAR = 'KOSMOS_BC_LOGIN_UNTIL_MS';
const FAKE_KEYCHAIN_DATE = 1234;
const FIXTURE_DATE = 4102488000000;   // the value tools/browser-checks.sh exports: its own test below holds them together
let dir;
let marker;
let saved;

beforeEach(() => {
  saved = { path: process.env.PATH, value: process.env[VAR], home: process.env.AGENT_WORKFORCE_HOME };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loginexpiry-8050-'));
  marker = path.join(dir, 'ran');
  const body = JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: FAKE_KEYCHAIN_DATE, expiresAt: FAKE_KEYCHAIN_DATE } });
  fs.writeFileSync(path.join(dir, 'security'), `#!/bin/sh\n: > '${marker}'\nprintf '%s' '${body}'\n`, { mode: 0o755 });
  process.env.PATH = dir;
  delete process.env[VAR];
  process.env.AGENT_WORKFORCE_HOME = dir;
});

afterEach(() => {
  process.env.PATH = saved.path;
  if (saved.value === undefined) delete process.env[VAR]; else process.env[VAR] = saved.value;
  if (saved.home === undefined) delete process.env.AGENT_WORKFORCE_HOME; else process.env.AGENT_WORKFORCE_HOME = saved.home;
  fs.rmSync(dir, { recursive: true, force: true });
});

const asyncDate = async (service) => JSON.parse(await le.readCredAsync(service)).claudeAiOauth.refreshTokenExpiresAt;

test('CONTROL: with the variable unset, both readers run security', async () => {
  assert.equal(le.refreshExpiryFor(undefined), FAKE_KEYCHAIN_DATE);
  assert.ok(fs.existsSync(marker), 'the sync reader did not run the fake, so the arms below prove nothing');
  fs.rmSync(marker);
  assert.equal(await asyncDate(le.DEFAULT_SERVICE), FAKE_KEYCHAIN_DATE);
  assert.ok(fs.existsSync(marker), 'the async reader did not run the fake, so the arms below prove nothing');
});

test('set: the default account reads the fixed date, and security never runs', async () => {
  process.env[VAR] = String(FIXTURE_DATE);
  assert.deepEqual(le.loginTimesFor(undefined), { refreshExpiresAt: FIXTURE_DATE, accessExpiresAt: FIXTURE_DATE });
  assert.equal(await asyncDate(le.DEFAULT_SERVICE), FIXTURE_DATE);
  assert.ok(!fs.existsSync(marker), 'security ran with the variable set');
});

test('set: any other account reads nothing, and security never runs', async () => {
  process.env[VAR] = String(FIXTURE_DATE);
  assert.equal(le.refreshExpiryFor('/some/config/dir'), null);
  assert.equal(await le.readCredAsync(le.serviceNameFor('/some/config/dir')), null);
  assert.ok(!fs.existsSync(marker), 'security ran with the variable set');
});

test('set on a board with no sandbox home: no date and no read, so a leak onto a real board cannot show a false one', async () => {
  process.env[VAR] = String(FIXTURE_DATE);
  delete process.env.AGENT_WORKFORCE_HOME;
  assert.equal(le.refreshExpiryFor(undefined), null);
  assert.equal(await le.readCredAsync(le.DEFAULT_SERVICE), null);
  assert.ok(!fs.existsSync(marker), 'security ran with the variable set');
});

let realHome = null;
try { realHome = os.userInfo().homedir; } catch { /* a uid with no passwd entry: the arms below that need it are skipped */ }
const homeCases = realHome ? [
  ['the real home', () => realHome],
  ['the real home with a slash', () => realHome + path.sep],
  ['above it', () => path.dirname(realHome)],
  ['the root', () => path.parse(realHome).root],
  ['a link to it', () => { const l = path.join(dir, 'link'); fs.symlinkSync(realHome, l); return l; }],
  ['a link above it', () => { const l = path.join(dir, 'link'); fs.symlinkSync(path.dirname(realHome), l); return l; }],
] : [];
// APFS, by default, answers to any case; a volume that does not would not resolve the spelling, so check it first.
if (realHome && realHome !== realHome.toUpperCase() && fs.existsSync(realHome.toUpperCase())) homeCases.push(['the real home in another case', () => realHome.toUpperCase()]);
for (const [label, homeOf] of homeCases) {
  test(`set with a "sandbox home" that is ${label}: no date and no read`, async () => {
    process.env[VAR] = String(FIXTURE_DATE);
    process.env.AGENT_WORKFORCE_HOME = homeOf();
    assert.equal(le.refreshExpiryFor(undefined), null);
    assert.equal(await le.readCredAsync(le.DEFAULT_SERVICE), null);
    assert.ok(!fs.existsSync(marker), 'security ran with the variable set');
  });
}

test('CONTROL: a sandbox home beside the real one, sharing its name as a prefix, is still a sandbox', { skip: !realHome }, () => {
  process.env[VAR] = String(FIXTURE_DATE);
  process.env.AGENT_WORKFORCE_HOME = `${realHome}-sandbox`;
  assert.equal(le.refreshExpiryFor(undefined), FIXTURE_DATE);
});

test('a real home that cannot be read: no date and no read, and neither reader throws or rejects', async () => {
  process.env[VAR] = String(FIXTURE_DATE);
  const real = os.userInfo;
  os.userInfo = () => { throw new Error('no passwd entry'); };
  try {
    assert.equal(le.refreshExpiryFor(undefined), null);
    assert.equal(await le.readCredAsync(le.DEFAULT_SERVICE), null);
  } finally { os.userInfo = real; }
  assert.ok(!fs.existsSync(marker), 'security ran with the variable set');
});

for (const bad of ['tomorrow', ' ', '-1', '1e12', 'Infinity', '9'.repeat(400), '9007199254740993']) {
  test(`a value that is not a usable whole number reads nothing (${JSON.stringify(bad.slice(0, 20))}): it cannot fall through to the real read`, async () => {
    process.env[VAR] = bad;
    assert.equal(le.refreshExpiryFor(undefined), null);
    assert.equal(await le.readCredAsync(le.DEFAULT_SERVICE), null);
    assert.ok(!fs.existsSync(marker), 'security ran on a bad value');
  });
}

test('an empty value counts as unset', () => {
  process.env[VAR] = '';
  assert.equal(le.refreshExpiryFor(undefined), FAKE_KEYCHAIN_DATE);
});

test('tools/browser-checks.sh sets it before any board boots', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'browser-checks.sh'), 'utf8');
  const set = src.search(/^export KOSMOS_BC_LOGIN_UNTIL_MS=\d+$/m);
  const boot = src.search(/^boot_board\w*\(\)/m);
  assert.ok(set >= 0, 'browser-checks.sh does not export the variable');
  assert.ok(src.includes(`export ${VAR}=${FIXTURE_DATE}\n`), 'browser-checks.sh exports a different date from this test');
  assert.ok(boot >= 0, 'browser-checks.sh no longer defines boot_board, so this order check reads nothing');
  assert.ok(set < boot, 'the export must come before the first board can boot');
  assert.ok(!/^\s*unset\b[^\n]*\bKOSMOS_BC_LOGIN_UNTIL_MS\b|env -u KOSMOS_BC_LOGIN_UNTIL_MS\b/m.test(src), 'browser-checks.sh unsets the variable it exports');
});

test('nothing else in the engine runs security, so these two readers are the whole seam', () => {
  const runsIt = /\b(?:execFile(?:Sync)?|spawn(?:Sync)?|exec(?:Sync)?)\(\s*['"`](?:\/usr\/bin\/)?security\b|find-generic-password/;
  // Those two name the command in words, for an agent's instructions and permissions; neither runs it.
  const onlyWords = new Set(['roles.js', 'setup-assistant.js']);
  const engine = __dirname;
  const callers = fs.readdirSync(engine)
    .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && !onlyWords.has(f))
    .filter((f) => runsIt.test(fs.readFileSync(path.join(engine, f), 'utf8')));
  // CONTROL: the pattern finds the readers it is meant to find.
  assert.deepEqual(callers, ['loginexpiry.js']);
  assert.ok(!runsIt.test(fs.readFileSync(path.join(engine, '..', 'server.js'), 'utf8')), 'server.js runs security itself');
});

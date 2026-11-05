'use strict';
/* kosmos#8050: a throwaway board started by tools/browser-checks.sh never reads this Mac's real keychain.
 *   node --test engine/loginexpiry-sandbox-8050.test.js
 * No arm can touch the real keychain: PATH holds only a fake `security`, which records that it ran. */
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const le = require('./loginexpiry');

const VAR = 'KOSMOS_BC_LOGIN_UNTIL_MS';
const FAKE_KEYCHAIN_DATE = 1234;
const FIXTURE_DATE = 4102444800000;
let dir;
let marker;
let saved;

beforeEach(() => {
  saved = { path: process.env.PATH, value: process.env[VAR] };
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loginexpiry-8050-'));
  marker = path.join(dir, 'ran');
  const body = JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: FAKE_KEYCHAIN_DATE, expiresAt: FAKE_KEYCHAIN_DATE } });
  fs.writeFileSync(path.join(dir, 'security'), `#!/bin/sh\n: > '${marker}'\nprintf '%s' '${body}'\n`, { mode: 0o755 });
  process.env.PATH = `${dir}:/usr/bin:/bin`;
  delete process.env[VAR];
});

afterEach(() => {
  process.env.PATH = saved.path;
  if (saved.value === undefined) delete process.env[VAR]; else process.env[VAR] = saved.value;
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

test('a value that is not a number reads nothing: it cannot fall through to the real read', async () => {
  process.env[VAR] = 'tomorrow';
  assert.equal(le.refreshExpiryFor(undefined), null);
  assert.equal(await le.readCredAsync(le.DEFAULT_SERVICE), null);
  assert.ok(!fs.existsSync(marker), 'security ran on a bad value');
});

test('an empty value counts as unset', () => {
  process.env[VAR] = '';
  assert.equal(le.refreshExpiryFor(undefined), FAKE_KEYCHAIN_DATE);
});

test('tools/browser-checks.sh sets it before any board boots', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'browser-checks.sh'), 'utf8');
  const set = src.search(/^export KOSMOS_BC_LOGIN_UNTIL_MS=\d+$/m);
  const boot = src.search(/^boot_board\(\)/m);
  assert.ok(set >= 0, 'browser-checks.sh does not export the variable');
  assert.ok(boot >= 0, 'browser-checks.sh no longer defines boot_board, so this order check reads nothing');
  assert.ok(set < boot, 'the export must come before the first board can boot');
});

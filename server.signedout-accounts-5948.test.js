'use strict';
/**
 * #5948 step 2, end to end through GET /api/accounts: a Grok agent whose job names an account folder with no sign-in
 * or key is reported in `unlistedAccounts` (and printed by `kosmos accounts`), never in `accounts`, so no account
 * picker offers it. CONTROL: an agent whose folder holds a key is listed in `accounts` and not as signed out.
 *
 *   node --test server.signedout-accounts-5948.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const jobfix = require('./test-support/jobfixture');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-signedout-accts-5948-'));
const HOME = nodePath.join(SANDBOX, 'home');
for (const d of [HOME, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'), nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_GROK_HOME = nodePath.join(HOME, '.grok');
process.env.AGENT_WORKFORCE_GEMINI_HOME = nodePath.join(HOME, '.gemini');
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

// The signed-out account: a folder an agent is set up to use, with neither a key file nor a sign-in file in it.
const GONE = nodePath.join(HOME, '.grok-gone');
fs.mkdirSync(GONE, { recursive: true });
// CONTROL: a folder that does hold a key.
const KEPT = nodePath.join(HOME, '.grok-kept');
fs.mkdirSync(KEPT, { recursive: true });
fs.writeFileSync(nodePath.join(KEPT, '.kosmos-grok-apikey'), 'xai-testkey-abcd', { mode: 0o600 });

const create = require('./engine/create');
const grokAccounts = require('./engine/grokaccounts');
fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
// A job pinned to the provider's DEFAULT folder, with no credential in it: skipped (it may run on the computer's own key).
const DEFAULT_GROK = process.env.AGENT_WORKFORCE_GROK_HOME;
fs.mkdirSync(DEFAULT_GROK, { recursive: true });
for (const [name, dir] of [['grokgone', GONE], ['grokkept', KEPT], ['grokdefault', DEFAULT_GROK]]) {
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(jobfix.jobPath(name), jobfix.jobFor(name, '/usr/bin/true', process.env.AGENT_WORKFORCE_TMUX_BIN, null, dir, 'grok'), 'utf8');
}
const { start, server } = require('./server');

let base;
test.before(async () => {
  grokAccounts.setFetcher(async () => ({ status: 200, body: { data: [] } }));   // never a real xAI call
  await start(0); base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  grokAccounts.setFetcher(null);
  try { server.close(); } catch { /* best effort */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('#5948: the agent\'s account with no credential is in unlistedAccounts, not in accounts; the kept one is the reverse', async () => {
  // Created agents join the board only in the real board process (createdroster), so each gets a pane here.
  const fleet = require('./test-support/fleet');
  const board = fleet.install([fleet.agent('grokgone', { state: null, runner: 'grok', command: 'grok', screen: '' }), fleet.agent('grokkept', { state: null, runner: 'grok', command: 'grok', screen: '' }),
    fleet.agent('grokdefault', { state: null, runner: 'grok', command: 'grok', screen: '' })]);
  let body;
  try { body = await (await fetch(base + '/api/accounts')).json(); } finally { board.restore(); }
  assert.ok(create.readJob('grokgone') && create.readJob('grokgone').configDir, 'setup: the job does not name its account folder');
  const accounts = body.accounts || [];
  const gone = body.unlistedAccounts || [];
  assert.ok(accounts.some((a) => a.provider === 'xai' && a.dir === KEPT), 'CONTROL: the folder with a key is not listed: ' + JSON.stringify(accounts.map((a) => a.dir)));
  assert.ok(!accounts.some((a) => a.dir === GONE), 'a folder with no credential was offered as an account');
  assert.deepEqual(gone.map((a) => [a.provider, a.dir, a.connection && a.connection.badge]), [['xai', GONE, 'signed_out']], JSON.stringify(gone));
  assert.ok(!gone.some((a) => a.dir === DEFAULT_GROK), 'the default Grok folder was reported, though it may run on the computer\'s own key');
  assert.equal(gone[0].usedBy.length, 1);
  assert.match(String(gone[0].usedBy[0]), /grokgone/i, 'attributed to the wrong agent: ' + JSON.stringify(gone[0].usedBy));
  const { answer } = require('./engine/accountline');
  assert.ok(answer(200, body).lines.some((l) => /^Grok: gone: not signed in: its sign-in or key is no longer on this computer/.test(l)),
    'kosmos accounts does not print it');
});

test('#5948 review 9: with a shared Grok key in this computer\'s secrets/env door, the same folder is "unlisted", not signed out', async () => {
  const door = require('./engine/tokendoor').DIR;
  assert.ok(nodePath.resolve(door).startsWith(nodePath.resolve(SANDBOX) + nodePath.sep), 'the door is not in this test\'s sandbox: ' + door);
  fs.mkdirSync(door, { recursive: true });
  fs.writeFileSync(nodePath.join(door, 'XAI_API_KEY'), 'xai-shared-key-abcd\n', { mode: 0o600 });
  const fleet = require('./test-support/fleet');
  const board = fleet.install([fleet.agent('grokgone', { state: null, runner: 'grok', command: 'grok', screen: '' })]);
  let body;
  try { body = await (await fetch(base + '/api/accounts')).json(); } finally { board.restore(); fs.rmSync(nodePath.join(door, 'XAI_API_KEY'), { force: true }); }
  const row = (body.unlistedAccounts || []).find((a) => a.dir === GONE);
  assert.ok(row, JSON.stringify(body.unlistedAccounts));
  assert.deepEqual([row.signedOut, row.sharedKey, row.connection.badge], [false, true, 'unlisted']);
});

test('#5948 review 14: when the profiles cannot be read, unlistedComplete is false and kosmos accounts does not say none are set up', async () => {
  const register = require('./engine/register');
  const real = register.known;
  register.known = () => ({ ok: false, names: [] });
  let body;
  try { body = await (await fetch(base + '/api/accounts')).json(); } finally { register.known = real; }
  assert.equal(body.unlistedComplete, false, JSON.stringify({ unlistedComplete: body.unlistedComplete }));
  const { answer } = require('./engine/accountline');
  assert.ok(!answer(200, { ...body, accounts: [] }).lines.some((l) => /No provider accounts are set up/.test(l)));
  // CONTROL: with the profiles readable again, the walk is complete.
  const again = await (await fetch(base + '/api/accounts')).json();
  assert.equal(again.unlistedComplete, true);
});

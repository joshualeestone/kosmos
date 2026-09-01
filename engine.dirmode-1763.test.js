'use strict';

/**
 * kosmos#1763: three token-store modules (cloudflare, tokendoor, githubdevice)
 * pass mode 0o700 to mkdirSync but never chmod the directory. mkdirSync's mode
 * applies on CREATE ONLY, so a pre-existing loose directory (an upgrade from a
 * build predating the mode arg, a restore, an rsync/tar without -p) keeps 0755
 * and leaks the token FILENAMES -- which are provider/agent names.
 *
 * 🛑 THE TRAP THIS FILE IS BUILT AROUND (from the card): a test that creates a
 * FRESH directory and asserts its mode PASSES WITHOUT ANY FIX, because the
 * create-time mode does apply there. So every arm below PLANTS A LOOSE MODE
 * FIRST and carries a precondition asserting the plant took, or it proves
 * nothing. Each arm reds if the chmod(DIR) is removed from its module.
 *
 * Scope: only the three modules that DECLARE mode 0o700 on mkdirSync (plus
 * remote.js, the precedent, and sendertoken.js, #1761). Modules that declare no
 * mode were left alone deliberately -- see the PR. remote.js's secureStateDir is
 * the pattern mirrored here.
 *
 *   node --test engine.dirmode-1763.test.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');

// One sandbox for all three modules, set BEFORE any require (each reads its data
// dir from the env at require time). githubdevice needs a HOME and an absent gh
// too, so provide both, travelling together.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-1763-'));
process.env.AGENT_WORKFORCE_HOME = SANDBOX;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_GH_BIN = path.join(SANDBOX, 'no-such-gh');

const cloudflare = require('./engine/cloudflare');
const tokendoor = require('./engine/tokendoor');     // exports DIR (the shared token-door dir)
const tokendoors = require('./engine/tokendoors');   // the door registry (byName/bySlug)
const gd = require('./engine/githubdevice');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

/** Plant `dir` at a loose mode and assert the plant actually took, so the arm
 *  is testing a genuinely-loose pre-existing directory, not a fresh one. */
function plantLoose(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(dir, 0o755);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o755,
    'plant precondition: the dir is loose (0755) before the token flow runs -- without this the arm proves nothing');
}

test('kosmos#1763: cloudflare tightens a pre-existing loose token dir on connect', async () => {
  plantLoose(cloudflare.DIR);
  cloudflare.setFetcher(async () => ({ ok: true, status: 200, body: { success: true, result: { id: 'abc123abc123abc123abc123abc123ab', status: 'active' } } }));
  const s = await cloudflare.connect('cf_test_token_abcdefghijklmnopqrstuvwxyz');
  assert.equal(s.connected, true, 'sanity: a good token was accepted, so the write path ran');
  assert.equal(fs.statSync(cloudflare.DIR).mode & 0o777, 0o700,
    'connect must tighten a pre-existing loose token dir to 0700 (reds without the chmod(DIR) fix)');
});

test('kosmos#1763: a token door tightens a pre-existing loose dir on connect', async () => {
  plantLoose(tokendoor.DIR);
  // A real door from the registry; they all share tokendoor.DIR + write path.
  const door = tokendoors.byName('Discord');
  door.setFetcher(async () => ({ ok: true, status: 200, body: { username: 'kittybot' } }));
  const st = await door.connect('fake-discord-token-for-this-test-0123456789');
  assert.equal(st.connected, true, 'sanity: the door accepted the token, so the write path ran');
  assert.equal(fs.statSync(tokendoor.DIR).mode & 0o777, 0o700,
    'the door must tighten a pre-existing loose token dir to 0700 (reds without the chmod(DIR) fix)');
});

// githubdevice runs the device flow end to end against a stub GitHub.
let answers = [];
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/device/code') { send(200, { device_code: 'dev-123', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 0 }); return; }
    if (req.url === '/token') { send(200, answers.length ? answers.shift() : { error: 'authorization_pending' }); return; }
    if (req.url === '/user') { req.headers.authorization === 'Bearer tok-live' ? send(200, { login: 'joshualeestone' }) : send(401, { message: 'Bad credentials' }); return; }
    send(404, {});
  });
});
test.before(async () => {
  await new Promise((ok) => stub.listen(0, '127.0.0.1', ok));
  const base = 'http://127.0.0.1:' + stub.address().port;
  process.env.AGENT_WORKFORCE_GITHUB_DEVICE_URL = base + '/device/code';
  process.env.AGENT_WORKFORCE_GITHUB_TOKEN_URL = base + '/token';
  process.env.AGENT_WORKFORCE_GITHUB_VERIFY_URL = base + '/user';
});
test.after(() => stub.close());
const settle = (ms) => new Promise((ok) => setTimeout(ok, ms));

test('kosmos#1763: githubdevice tightens a pre-existing loose token dir when the device flow completes', async () => {
  process.env.KOSMOS_GITHUB_CLIENT_ID = 'Iv1.testclient';
  plantLoose(gd.DIR);
  answers = [{ access_token: 'tok-live', token_type: 'bearer', scope: 'repo' }];
  const started = await gd.start();
  assert.equal(started.phase, 'awaiting', 'sanity: the flow started');
  await settle(400);
  const st = await gd.state();
  assert.equal(st.connected, true, 'sanity: the token landed, so the write path ran: ' + JSON.stringify(st));
  assert.equal(fs.statSync(gd.DIR).mode & 0o777, 0o700,
    'the completed device flow must tighten a pre-existing loose token dir to 0700 (reds without the chmod(DIR) fix)');
});

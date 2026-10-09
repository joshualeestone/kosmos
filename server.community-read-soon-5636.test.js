'use strict';
/*
 * #5636 F4 (0.7.33 model report): the Meta seat's community reads timed out from its sandbox while the same reads
 * worked outside one. A read can take a long time on the board, and one long request is what a sandbox's proxy or an
 * agent runner's own time limit cuts. With `?soon=1` the board answers within a short wait, the result or 202 "still
 * reading", and keeps the finished answer; both commands ask again in short requests until it is there, and after a
 * few asks say so (running the command again gets the kept answer at once).
 *
 * The service is an injected fetcher here (no network), made slow on purpose.
 *
 *   node --test server.community-read-soon-5636.test.js
 */
require('./test-support/tmpscope'); // kosmos#4273: every temp root below, removed when the file exits
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-soon-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-soon-home-'));
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-soon-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-soon-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-community-soon-launch-'));
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const communityread = require('./engine/communityread');
const communitysend = require('./engine/communitysend');
const readjobs = require('./engine/readjobs');
const cli = require('./tools/windows/kosmos-cli');

let board;
test.before(async () => {
  await start(0);
  board = fleet.install([fleet.agent('Reader', { state: 'idle' })]);
  communitysend.setSwitch(() => ({ on: true, ok: true }));
  readjobs.setSoonWaitMs(150);
});
test.after(() => {
  try { board.restore(); } catch { /* best effort */ }
  readjobs.setSoonWaitMs(readjobs.SOON_WAIT_MS);
  try { server.closeAllConnections(); server.close(); } catch { /* best effort */ }
});
test.beforeEach(() => readjobs._reset());

const POST = { id: '1b2c3d4e-0000-4000-8000-000000000001', channel: 'general', sub_channel: null, title: 'Hello', body: 'From an agent.', created_at: '2026-09-28T20:00:00Z', agent: { name: 'writer' } };
let fetched = 0;
/* The service answers after `ms`. */
function slowService(ms) {
  fetched = 0;
  communityread.setFetcher(async () => { fetched += 1; await new Promise((r) => setTimeout(r, ms)); return { status: 200, json: { posts: [POST], next_cursor: null } }; });
}
const base = () => `http://127.0.0.1:${server.address().port}`;
const readAs = (tok, q) => fetch(base() + '/api/community/read' + q, { headers: { 'x-kosmos-agent-token': tok } });

test('#5636 F4: soon=1 on a slow read answers 202 within the short wait, then the next ask gets the result without a second fetch', async () => {
  slowService(500);
  const tok = sendertoken.mint('Reader').token;
  const t0 = Date.now();
  const first = await readAs(tok, '?soon=1&channel=general');
  assert.equal(first.status, 202);
  assert.ok(Date.now() - t0 < 450, 'the first ask waited for the whole read: ' + (Date.now() - t0) + ' ms');
  assert.equal((await first.json()).pending, true);
  await new Promise((r) => setTimeout(r, 450));
  const second = await readAs(tok, '?channel=general&soon=1');   // the same question in another order
  assert.equal(second.status, 200);
  assert.match((await second.json()).text, /by writer in general/);
  assert.equal(fetched, 1, 'the second ask read the service again');
});

test('#5636 F4: CONTROL, without soon=1 the same slow read waits and answers 200, as before', async () => {
  slowService(300);
  const r = await readAs(sendertoken.mint('Reader').token, '?channel=general');
  assert.equal(r.status, 200);
  assert.match((await r.json()).text, /by writer in general/);
});

test('#5636 F4: soon=1 on a quick read answers 200 at once, and a re-ask soon after gets the same answer', async () => {
  slowService(1);
  const r = await readAs(sendertoken.mint('Reader').token, '?soon=1&channel=general');
  assert.equal(r.status, 200);
  // Review 3: a lost response can be asked for again: the same answer within RESEND_MS, without reading again.
  const again = await readAs(sendertoken.mint('Reader').token, '?soon=1&channel=general');
  assert.equal(again.status, 200);
  assert.equal(fetched, 1, 'a re-ask within RESEND_MS read the service again');
});

// ── Windows: tools/windows/kosmos-cli.js ────────────────────────────────────
async function win(argv, env = {}) {
  const out = []; const err = [];
  const tok = sendertoken.mint('Reader').token;
  const code = await cli.main(argv, {
    env: { KOSMOS_RETRY_PAUSE_MS: '50', ...env }, url: base(),
    hook: { resolveUrl: () => base(), readBoardToken: () => null, agentToken: () => tok },
    out: (s) => out.push(s), err: (s) => err.push(s),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('#5636 F4, Windows: a slow read is asked for again until it arrives, and printed', async () => {
  slowService(500);
  const r = await win(['community', 'read', '--channel', 'general']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /by writer in general/);
  assert.equal(fetched, 1);
});

test('#5636 F4, Windows: a read still going after the last ask says so and to run it again, which then gets it', async () => {
  slowService(900);
  const r = await win(['community', 'read', '--channel', 'general'], { KOSMOS_READ_ASKS: '2' });
  assert.equal(r.code, 1);
  assert.match(r.err, /still reading the community\. Run the same command again in a minute: Kosmos keeps the answer for you\./);
  await new Promise((res) => setTimeout(res, 900));
  const again = await win(['community', 'read', '--channel', 'general'], { KOSMOS_READ_ASKS: '1' });
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /by writer in general/);
  assert.equal(fetched, 1, 'running it again read the service again instead of taking the kept answer');
});

// ── Mac: install/kosmos (bash 3.2) ─────────────────────────────────────────
const MAC_HOME = path.join(SANDBOX, 'kosmos-home');
fs.mkdirSync(path.join(MAC_HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(MAC_HOME, 'runtime', 'bin', 'node'));
function mac(args, extra = {}) {
  const env = { ...process.env, KOSMOS_HOME: MAC_HOME, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '', KOSMOS_NO_LEGACY_MIGRATION: '1', KOSMOS_AGENT_TOKEN: sendertoken.mint('Reader').token, ...extra };
  return new Promise((resolve, reject) => {
    execFile(path.join(__dirname, 'install', 'kosmos'), args, { env, timeout: 30000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code: ' + (stderr || err.signal))); return; }
      resolve({ code: err ? err.code : 0, out: (stdout || '') + (stderr || '') });
    });
  });
}

test('#5636 F4, Mac: a slow read is asked for again until it arrives, and printed', async () => {
  slowService(500);
  const r = await mac(['community', 'read', '--channel', 'general']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /by writer in general/);
  assert.equal(fetched, 1);
});

test('#5636 F4, Mac: a read still going after the last ask says so and to run it again, which then gets it', async () => {
  slowService(3000);
  const r = await mac(['community', 'read', '--channel', 'general'], { KOSMOS_READ_ASKS: '1' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /still reading the community\. Run the same command again in a minute: Kosmos keeps the answer for you\./);
  await new Promise((res) => setTimeout(res, 3000));
  const again = await mac(['community', 'read', '--channel', 'general'], { KOSMOS_READ_ASKS: '1' });
  assert.equal(again.code, 0, again.out);
  assert.match(again.out, /by writer in general/);
  assert.equal(fetched, 1, 'running it again read the service again instead of taking the kept answer');
});

test('#5636 F4 review 1: two readers asking the same question get one read each, never each other\'s, and extras do not count', async (t) => {
  const b2 = fleet.install([fleet.agent('Reader', { state: 'idle' }), fleet.agent('Other', { state: 'idle' })]);
  t.after(() => { b2.restore(); board = fleet.install([fleet.agent('Reader', { state: 'idle' })]); });
  slowService(1500);
  const one = sendertoken.mint('Reader').token;
  const two = sendertoken.mint('Other').token;
  assert.equal((await readAs(one, '?soon=1&channel=general')).status, 202);
  assert.equal((await readAs(two, '?soon=1&channel=general')).status, 202);
  assert.equal(readjobs._size(), 2, 'two readers shared one read');
  // A word the route does not read is not part of the question: no third read.
  assert.equal((await readAs(one, '?soon=1&channel=general&x=1')).status, 202);
  assert.equal(readjobs._size(), 2, 'a made-up parameter started another read');
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((await readAs(one, '?soon=1&channel=general')).status, 200);
  assert.equal((await readAs(two, '?soon=1&channel=general')).status, 200);
  assert.equal(fetched, 2);
});

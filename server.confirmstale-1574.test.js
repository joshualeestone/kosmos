'use strict';
/**
 * #1574: the 281MB confirm is decided by the SERVER, in the same call that would
 * start the download, so a stale client cannot skip it.
 *
 * 🛑 THE SUBJECT IS A CLIENT THAT DOES NOT ASK. The page used to decide from
 * `FR.connect.willInstall`, a snapshot taken at page boot and refreshed only on
 * "Check again". On a board left open whose launcher is removed or broken AFTER
 * boot, that snapshot still says no install is needed, the confirm is skipped, and
 * ~281MB begins unannounced.
 *
 * ⚠️ SO THE HAPPY PATH IS NOT THE TEST. A run where the client confirms proves
 * nothing about this card: the defect only appears when the client believes no
 * confirmation is required. Every assertion below drives the route the way a STALE
 * page would drive it, and the confirming client is the CONTROL that proves the
 * refusal is caused by the missing flag rather than by the sandbox.
 *
 *   node --test server.confirmstale-1574.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-confirmstale-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
/* 🛑 A PATH THAT DOES NOT EXIST, which is the whole premise: with no runnable
   launcher, `start()` is genuinely about to download. Pointing this at /bin/echo
   (as the sibling server tests do) would make every assertion below vacuous,
   because no install would be pending and nothing would need confirming. */
process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(SANDBOX, 'no-such-claude');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const connect = require('./engine/connect');

let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => {
  await connect.cancel().catch(() => {});
  connect.resetForTests();
  server.closeAllConnections();
  server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const post = async (body) => {
  const res = await fetch(base + '/api/connect/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};

/* Between cells: no flow left running, and the record back to nothing. */
async function reset() {
  await connect.cancel().catch(() => {});
  connect.resetForTests();
}

test('#1574: a client that does not confirm is REFUSED, and nothing starts', async () => {
  await reset();
  /* Exactly what a stale page sends: it believes no install is coming, so it
     never asked anybody, and it says so honestly. */
  const got = await post({});
  assert.equal(got.status, 200, 'the route errored rather than answering with a verdict');
  assert.equal(got.json.needsInstallConfirm, true,
    'the server let an unconfirmed start through, so a stale page can begin a 281MB download unannounced');
  assert.notEqual(got.json.phase, 'downloading', 'a download began despite the refusal');
  assert.notEqual(got.json.phase, 'installing', 'an install began despite the refusal');
});

test('#1574: the refusal leaves NO flow behind, so the record is still idle', async () => {
  await reset();
  await post({});
  /* `start()` refuses BEFORE claiming a driver. If it refused after, there would be
     a live flow nobody can see and a Cancel that has something to cancel. */
  const st = connect.state();
  assert.notEqual(st.phase, 'downloading');
  assert.notEqual(st.phase, 'installing');
  const again = await post({});
  assert.equal(again.json.needsInstallConfirm, true,
    'the second unconfirmed press behaved differently from the first, so the refusal is not idempotent');
});

test('#1574: an explicit installConfirmed:false is refused exactly like an absent one', async () => {
  await reset();
  const got = await post({ installConfirmed: false });
  assert.equal(got.json.needsInstallConfirm, true,
    'saying no out loud was treated differently from saying nothing');
});

/* 🛑 THE CONTROL, AND WITHOUT IT EVERY ASSERTION ABOVE IS WORTHLESS. "Refused" is
   equally consistent with a sandbox where the route cannot start anything at all.
   The SAME route, in the SAME sandbox, differing only in the flag, must get past
   the confirm gate. */
test('control: the same request WITH the flag is not refused, so the flag is what refuses', async () => {
  await reset();
  const got = await post({ installConfirmed: true });
  assert.equal(got.status, 200);
  assert.notEqual(got.json.needsInstallConfirm, true,
    'the confirming client was refused too, so the refusal is not caused by the missing flag and these tests measure nothing');
});

/* The route's own validation, matching how its siblings treat a mangled field:
   a 400, never a silent falsy that would read as "did not confirm" and refuse. */
test('#1574: a non-boolean installConfirmed is a 400, not a silent falsy', async () => {
  await reset();
  const got = await post({ installConfirmed: 'yes' });
  assert.equal(got.status, 400, 'a mangled value was accepted');
  assert.match(String(got.json && got.json.error), /installConfirmed must be true or false/);
});

/* 🛑 THE PAGE MUST NOT BE ABLE TO ASSERT A CONFIRMATION NOBODY GAVE, which is the
   defect in one sentence. This reads the shipped page rather than the route,
   because the bug lived in a variable the route cannot see. */
test('#1574: the page only claims consent when a person actually pressed Confirm', () => {
  const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  const at = PAGE.indexOf('async function frConnectStart(');
  assert.ok(at > -1, 'frConnectStart is gone; this test is aimed at nothing');
  const body = PAGE.slice(at, PAGE.indexOf('\n}\n', at));
  assert.doesNotMatch(body, /^\s*FR_CONN_CONFIRMED = true;\s*$/m,
    'FR_CONN_CONFIRMED is set unconditionally again, so the skip path claims a confirmation nobody gave');
  assert.match(body, /if \(confirmed\) FR_CONN_CONFIRMED = true;/,
    'the flag is no longer gated on a real confirmation');
  assert.match(body, /frConnectStartConfirmed\(confirmed/,
    'the confirmation is no longer passed down to the request');
});

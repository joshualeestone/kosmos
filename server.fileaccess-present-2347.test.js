'use strict';

/*
 * kosmos#2347 item C (Josh 0.6.41: "S2 Next should gray until folder access is
 * allowed"). The S2 folder gate cannot read a folder-grant verdict on entry --
 * the file-access probe IS the TCC prompt, so there is deliberately no entry-time
 * reading (a periodic refresh re-introduces the #2125 permflood). So on entry
 * fileaccessstatus.read() is {checkable:false} and the gate fail-safes to enabled,
 * which is exactly what Josh saw. The fix exposes a PROMPT-FREE presence signal on
 * the file gate's own route -- nativePresent (a11y-status freshness the app already
 * maintains via axcheck, no folder access) -- so the front-end can gray S2 Next when
 * `nativePresent && !granted` without any entry-time folder probe.
 *
 * This drives the REAL /api/file-access-status route and controls nativePresent by
 * seeding (or not) a fresh a11y-status.json, proving the { ..., nativePresent } shape
 * Renet's S2 gate wires against.
 *
 *   node --test server.fileaccess-present-2347.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-fileaccess-present-2347-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
const DATA = nodePath.join(SANDBOX, 'data');
for (const d of [HOME, BIN, DATA, nodePath.join(SANDBOX, 'workers'),
  nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = DATA;
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.AGENT_WORKFORCE_CLAUDE_BIN = CLAUDE_BIN;
process.env.AGENT_WORKFORCE_TMUX_BIN = TMUX_BIN;

// store.ROOT resolves to AGENT_WORKFORCE_DATA/<store.APP> (engine/store.js), where
// a11ystatus.js reads a11y-status.json. nativePresent() is a11ystatus.read().checkable
// === true, which is true iff that file is present, well-formed, and fresh (< 5 min).
const store = require('./engine/store');
const STORE = nodePath.join(DATA, store.APP);
fs.mkdirSync(STORE, { recursive: true });
const A11Y = nodePath.join(STORE, 'a11y-status.json');
function seedNativePresent() {
  fs.writeFileSync(A11Y, JSON.stringify({ trusted: false, at: new Date().toISOString() }));
}
function clearNativePresent() {
  try { fs.rmSync(A11Y, { force: true }); } catch { /* already gone */ }
}

const { start, server } = require('./server');
let base = '';
test.before(async () => { await start(0); base = 'http://127.0.0.1:' + server.address().port; });
test.after(() => {
  try { server.close(); } catch { /* the port is going away anyway */ }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function fileAccessStatus() {
  const res = await fetch(base + '/api/file-access-status');
  assert.equal(res.status, 200, '/api/file-access-status did not answer 200');
  return res.json();
}

test('nativePresent is TRUE when the native app is maintaining a fresh a11y-status (real install)', async () => {
  seedNativePresent();
  const body = await fileAccessStatus();
  assert.equal(body.nativePresent, true,
    'the file gate cannot tell the native app is present, so S2 Next can never gray on entry: ' + JSON.stringify(body));
  // On a fresh install there is no folder verdict yet (the probe is the prompt), so
  // granted must NOT be true -- this is the case that must BLOCK Next.
  assert.notEqual(body.granted, true,
    'a granted verdict exists without any Allow-Access probe, which should be impossible on entry');
});

test('nativePresent is FALSE with no native writer (a browser tester) -> S2 fail-safes to enabled', async () => {
  clearNativePresent();
  const body = await fileAccessStatus();
  assert.equal(body.nativePresent, false,
    'with no native app the gate would still block Next and strand a browser tester: ' + JSON.stringify(body));
  // Entry with no native app: the file-access reading is uncheckable (ENOENT), so the
  // gate condition `nativePresent && !granted` is false -> Next enabled. Fail-safe holds.
  assert.equal(body.checkable, false, 'expected an uncheckable file-access reading when nothing has probed: ' + JSON.stringify(body));
});

test('a stale a11y-status does not count as present (nativePresent false) -> fail-safe, no false block', async () => {
  // Older than a11ystatus.STALE_AFTER_MS (5 min): the app is not currently maintaining
  // it, so it must not be read as "present" (that would block Next on a dead app).
  fs.writeFileSync(A11Y, JSON.stringify({ trusted: false, at: new Date(Date.now() - 10 * 60 * 1000).toISOString() }));
  const body = await fileAccessStatus();
  assert.equal(body.nativePresent, false,
    'a stale a11y-status was read as present, so a quit app would still block S2 Next: ' + JSON.stringify(body));
  clearNativePresent();
});

'use strict';
/**
 * promptrequest: the engine's WRITE side of the on-demand permission-prompt seam
 * (#1 / #2189). The load-bearing properties:
 *   - a request is recorded (so the native watcher can fire the prompt) ONLY when a
 *     native app is present to consume it -- otherwise {ok:false} so the UI falls back
 *     to opening Settings and a grant button is never dead;
 *   - the request-file NAMES match what the native app looks for, or the two miss each
 *     other silently across the language boundary.
 *
 *   node --test engine/promptrequest.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-promptreq-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

const store = require('./store');
const a11y = require('./a11ystatus');
const promptrequest = require('./promptrequest');

// Native presence is proxied by a FRESH a11y-status.json (the app rewrites it on
// launch and every 60s). These helpers put the module in each state.
function nativePresent() {
  fs.mkdirSync(path.dirname(a11y.FILE), { recursive: true });
  fs.writeFileSync(a11y.FILE, JSON.stringify({ trusted: false, at: new Date().toISOString() }));
}
function nativeStale() {
  fs.mkdirSync(path.dirname(a11y.FILE), { recursive: true });
  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // > STALE_AFTER_MS
  fs.writeFileSync(a11y.FILE, JSON.stringify({ trusted: false, at: old }));
}
function nativeAbsent() { try { fs.rmSync(a11y.FILE, { force: true }); } catch { /* */ } }
function requestFile(name) { return path.join(store.ROOT, name); }
function clearRequests() {
  for (const n of Object.values(promptrequest.REQUEST_FILE)) {
    try { fs.rmSync(requestFile(n), { force: true }); } catch { /* */ }
  }
}

test('native present: request(a11y) records the a11y request file and returns ok:true', () => {
  clearRequests(); nativePresent();
  const r = promptrequest.request('a11y');
  assert.deepEqual(r, { ok: true });
  assert.ok(fs.existsSync(requestFile('a11y-prompt-request')), 'the a11y request file must be written');
});

test('native present: request(file-access) records the file-access request file and returns ok:true', () => {
  clearRequests(); nativePresent();
  const r = promptrequest.request('file-access');
  assert.deepEqual(r, { ok: true });
  assert.ok(fs.existsSync(requestFile('file-access-prompt-request')), 'the file-access request file must be written');
});

test('THE FALLBACK CASE: no native app -> ok:false AND no request file (UI opens Settings)', () => {
  clearRequests(); nativeAbsent();
  const r = promptrequest.request('a11y');
  assert.equal(r.ok, false);
  assert.match(r.because, /no native app/i);
  assert.ok(!fs.existsSync(requestFile('a11y-prompt-request')),
    'a request nobody can consume must NOT be left on disk to fire a stray prompt later');
});

test('a STALE native reading counts as absent (the app is not currently maintaining it)', () => {
  clearRequests(); nativeStale();
  const r = promptrequest.request('file-access');
  assert.equal(r.ok, false, 'a >5min-old reading means no live app; fall back to Settings');
  assert.ok(!fs.existsSync(requestFile('file-access-prompt-request')));
});

test('an unknown kind is refused without touching the disk', () => {
  clearRequests(); nativePresent();
  const r = promptrequest.request('sleep');
  assert.equal(r.ok, false);
  assert.match(r.because, /unknown prompt kind/i);
});

test('ROUTE CONTRACT: server.js handles exactly the paths web/index.html POSTs', () => {
  // The HTTP route strings are a load-bearing contract with Renet's caller
  // (frFirePermission in web/index.html, #2342): if either side's path drifts, the
  // grant button silently falls back to Settings with no red anywhere. Pin the seam
  // from BOTH sides (read-only; this does not modify web/). Same discipline as the
  // engine<->Swift filename contract below.
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const web = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
  for (const route of ['/api/a11y-prompt', '/api/file-access-prompt']) {
    assert.ok(
      server.includes(`pathname === '${route}'`),
      `server.js no longer handles ${route}; the caller would 404 -> silent Settings fallback`,
    );
    assert.ok(
      web.includes(`'${route}'`),
      `web/index.html no longer POSTs ${route}; the trigger endpoint would go uncalled`,
    );
  }
});

test('CROSS-LANGUAGE CONTRACT: every request-file name is what the native app consumes', () => {
  // The engine writes these names; native-app/main.swift consumeRequest(named:) reads
  // them. A cross-language seam is two copies of one fact, so this asserts they agree
  // rather than trusting a comment. If either side renames without the other, this reds.
  const swift = fs.readFileSync(path.join(__dirname, '..', 'native-app', 'main.swift'), 'utf8');
  for (const name of Object.values(promptrequest.REQUEST_FILE)) {
    assert.ok(
      swift.includes(`consumeRequest(named: "${name}"`),
      `native app must consume the "${name}" request the engine writes`,
    );
  }
});

// ---- #3188 scoped diagnostic (launchd-ambient-env meta-sweep #3189) ----
// The file-access -> tmux folder prompt chain is complete in source and the resolvers
// are proven correct, so the failing rung is only observable on the running board. These
// pin the engine-side instrument that localizes it: request(opts.diag) reporting the drop
// rungs (root/nativePresent/wrote), wasConsumed reporting the consume rung, and -- the
// load-bearing invariant -- that turning the diagnostic on does NOT change the return for
// any existing caller.

test('#3188 diag: opts.diag reports the drop rungs; NO opts stays byte-identical', () => {
  clearRequests(); nativePresent();
  // The inert-for-existing-callers guarantee: no diag key, exact same object.
  assert.deepEqual(promptrequest.request('a11y'), { ok: true });
  clearRequests(); nativePresent();
  const r = promptrequest.request('file-access', { diag: true });
  assert.equal(r.ok, true);
  assert.ok(r.diag, 'diag is present only when opts.diag is set');
  assert.equal(r.diag.name, 'file-access-prompt-request');
  assert.equal(r.diag.nativePresent, true);
  assert.equal(r.diag.wrote, true);
  assert.equal(r.diag.root, store.ROOT, 'diag.root is the store.ROOT the file was dropped into');
  assert.equal(r.diag.file, requestFile('file-access-prompt-request'));
  assert.ok(fs.existsSync(r.diag.file), 'the reported file path is the one actually written');
});

test('#3188 diag: native absent -> nativePresent:false, wrote:false, ok:false, no file', () => {
  clearRequests(); nativeAbsent();
  const r = promptrequest.request('file-access', { diag: true });
  assert.equal(r.ok, false);
  assert.equal(r.diag.nativePresent, false);
  assert.equal(r.diag.wrote, false);
  assert.ok(!fs.existsSync(requestFile('file-access-prompt-request')),
    'native absent: nothing written, matching the non-diag fallback contract');
});

test('#3188 diag: unknown kind -> diag.name null, wrote:false, disk untouched', () => {
  clearRequests(); nativePresent();
  const r = promptrequest.request('sleep', { diag: true });
  assert.equal(r.ok, false);
  assert.match(r.because, /unknown prompt kind/i);
  assert.equal(r.diag.name, null);
  assert.equal(r.diag.wrote, false);
});

test('#3188 wasConsumed: present:true while the request sits, false once the native watcher deletes it', () => {
  clearRequests(); nativePresent();
  promptrequest.request('file-access');
  assert.deepEqual(promptrequest.wasConsumed('file-access'),
    { name: 'file-access-prompt-request', present: true });
  // The native watcher consumes by DELETING the file (main.swift consumeRequest); model that.
  fs.rmSync(requestFile('file-access-prompt-request'), { force: true });
  assert.deepEqual(promptrequest.wasConsumed('file-access'),
    { name: 'file-access-prompt-request', present: false });
  // An unknown kind names nothing and is never "present".
  assert.deepEqual(promptrequest.wasConsumed('sleep'), { name: null, present: false });
});

test('#3188 ROUTE: the file-access route wires the diag and STRIPS it off the wire', () => {
  // The store path must never reach the browser: the route logs diag server-side but
  // sends a rebuilt {ok,because}, not the raw diag-bearing `r`. Pin both halves (read-only).
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(server.includes("promptrequest.request('file-access', { diag: true })"),
    'the file-access route must request with the scoped diag enabled');
  assert.ok(server.includes("promptrequest.wasConsumed('file-access')"),
    'the consume-probe must read back the file-access request');
  assert.ok(server.includes('{ ok: !!(r && r.ok), because: r && r.because }'),
    'the route must send a stripped {ok,because}, never the raw r (which carries diag.root/file)');
});

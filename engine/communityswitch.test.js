'use strict';
/**
 * The Kosmos Community switch (#4288). Default ON with no file, OFF survives a restart,
 * an unreadable file reads OFF and not ok, and the two fields never clobber each other.
 * Sandboxed data root before the require.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-communityswitch-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const sw = require('./communityswitch');

function fresh() {
  try { fs.chmodSync(sw.FILE, 0o600); } catch { /* absent is fine */ }
  try { fs.rmSync(sw.FILE, { force: true, recursive: true }); } catch { /* absent is fine */ }
}
test.beforeEach(fresh);
test.after(() => { fresh(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

// A fresh require of the module, as a restarted board does.
function restarted() {
  delete require.cache[require.resolve('./communityswitch')];
  return require('./communityswitch');
}

test('the setting file lands under the sandboxed data root', () => {
  assert.ok(sw.FILE.startsWith(SANDBOX + nodePath.sep), `${sw.FILE} not under ${SANDBOX}`);
  assert.equal(nodePath.basename(sw.FILE), 'community.json');
});

test('no file (fresh or existing install) reads ON, ok, no notice owed, and writes nothing', () => {
  assert.deepEqual(sw.read(), { on: true, ok: true, noticeSeen: true });
  assert.equal(sw.participating(), true);
  assert.equal(fs.existsSync(sw.FILE), false, 'reading the default wrote a file');
});

test('OFF survives a restart, and ON again survives one too', () => {
  assert.deepEqual(sw.setOn(false), { ok: true });
  assert.deepEqual(restarted().read(), { on: false, ok: true, noticeSeen: true });
  assert.equal(restarted().participating(), false);
  assert.deepEqual(sw.setOn(true), { ok: true });
  assert.deepEqual(restarted().read(), { on: true, ok: true, noticeSeen: true });
});

test('an unparseable, non-object or array file reads OFF and NOT ok, so nothing is sent', () => {
  for (const body of ['{not json', '"on"', 'null', '[true]', '42']) {
    fs.mkdirSync(nodePath.dirname(sw.FILE), { recursive: true });
    fs.writeFileSync(sw.FILE, body);
    assert.deepEqual(sw.read(), { on: false, ok: false, noticeSeen: false }, `body ${body}`);
    assert.equal(sw.participating(), false, `body ${body}`);
  }
});

test('a file that exists but cannot be read (a folder in its place) reads OFF and NOT ok', () => {
  fs.mkdirSync(sw.FILE, { recursive: true });
  assert.deepEqual(sw.read(), { on: false, ok: false, noticeSeen: false });
  assert.equal(sw.participating(), false);
});

test('on must be exactly true: a truthy non-boolean reads OFF', () => {
  fs.mkdirSync(nodePath.dirname(sw.FILE), { recursive: true });
  for (const on of ['true', 1, 'yes']) {
    fs.writeFileSync(sw.FILE, JSON.stringify({ on }));
    assert.equal(sw.read().on, false, `on ${JSON.stringify(on)}`);
    assert.equal(sw.participating(), false, `on ${JSON.stringify(on)}`);
  }
});

test('setOn refuses anything but a boolean and writes nothing', () => {
  for (const on of ['false', 0, null, undefined, {}]) {
    const r = sw.setOn(on);
    assert.equal(r.ok, false, `on ${JSON.stringify(on)}`);
    assert.equal(r.because, 'that has to be on or off');
  }
  assert.equal(fs.existsSync(sw.FILE), false);
});

test('setOn keeps noticeSeen, and markNoticeSeen keeps on', () => {
  assert.deepEqual(sw.markNoticeSeen(), { ok: true });
  assert.deepEqual(sw.read(), { on: true, ok: true, noticeSeen: true }, 'marking the notice flipped the default on');
  sw.setOn(false);
  assert.deepEqual(sw.read(), { on: false, ok: true, noticeSeen: true }, 'turning off reset the notice');
  sw.markNoticeSeen();
  assert.deepEqual(sw.read(), { on: false, ok: true, noticeSeen: true }, 'marking the notice turned it back on');
});

test('a write over an unreadable file repairs it toward OFF, never ON', () => {
  fs.mkdirSync(nodePath.dirname(sw.FILE), { recursive: true });
  fs.writeFileSync(sw.FILE, '{not json');
  assert.deepEqual(sw.markNoticeSeen(), { ok: true });
  assert.deepEqual(sw.read(), { on: false, ok: true, noticeSeen: true });
});

test('migrate: an existing install is written ON with the notice pending, once', () => {
  assert.deepEqual(sw.migrate({ existingInstall: true }), { ok: true, wrote: true });
  assert.deepEqual(sw.read(), { on: true, ok: true, noticeSeen: false });
  sw.setOn(false);
  assert.deepEqual(sw.migrate({ existingInstall: true }), { ok: true, wrote: false }, 'the step ran twice');
  assert.deepEqual(sw.read(), { on: false, ok: true, noticeSeen: false }, 'a second run undid the person\'s OFF');
});

test('migrate: a fresh install is written ON with the notice already seen', () => {
  assert.deepEqual(sw.migrate({ existingInstall: false }), { ok: true, wrote: true });
  assert.deepEqual(sw.read(), { on: true, ok: true, noticeSeen: true });
});

test('migrate: an unreadable file is left exactly as it is', () => {
  fs.mkdirSync(nodePath.dirname(sw.FILE), { recursive: true });
  fs.writeFileSync(sw.FILE, '{not json');
  assert.deepEqual(sw.migrate({ existingInstall: true }), { ok: true, wrote: false });
  assert.equal(fs.readFileSync(sw.FILE, 'utf8'), '{not json');
});

test('migrate: a stat error other than ENOENT is not treated as no file (a self-looping link stays)', () => {
  /* ELOOP, not EACCES: a locked folder also blocks the write, so it cannot tell "refused" from "tried".
     A link to itself fails stat but would be replaced by the rename, so only a real refusal leaves it. */
  fs.mkdirSync(nodePath.dirname(sw.FILE), { recursive: true });
  fs.symlinkSync(nodePath.basename(sw.FILE), sw.FILE);
  try {
    assert.deepEqual(sw.migrate({ existingInstall: true }), { ok: false, wrote: false }, 'a stat error other than ENOENT was treated as no file');
    assert.equal(fs.lstatSync(sw.FILE).isSymbolicLink(), true, 'migrate wrote over a file it could not read');
  } finally { fs.rmSync(sw.FILE, { force: true }); }
});

test('a failed save says so and leaves the old value', () => {
  sw.setOn(false);
  const dir = nodePath.dirname(sw.FILE);
  fs.chmodSync(dir, 0o500);
  try {
    assert.deepEqual(sw.setOn(true), { ok: false, because: 'we could not save that setting' });
  } finally { fs.chmodSync(dir, 0o700); }
  assert.deepEqual(sw.read(), { on: false, ok: true, noticeSeen: true });
});

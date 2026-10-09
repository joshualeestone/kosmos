'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/**
 * kosmos#5434 slice 15: three owner-only records in Kosmos's own data save through securewrite.writeSecret, so the
 * bytes are flushed before the rename makes them the file (#5431), at exactly 0600, and a failed flush leaves the old
 * file: orgenroll's world id (and through the same writeWhole, the enrollment record and its markers), the applied
 * company policy (orgpolicy), and phone notifications' state, which holds a token (phonenotify).
 *
 *   node --test engine/secrets.fsync-5434.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOTS = [];
const tmp = (p) => { const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), p))); ROOTS.push(d); return d; };
process.env.AGENT_WORKFORCE_DATA = tmp('secrets-fsync-data-');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = tmp('secrets-fsync-tunnel-');
process.env.HOME = tmp('secrets-fsync-home-');
test.after(() => { for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true }); });

const orgenroll = require('./orgenroll');
const orgpolicy = require('./orgpolicy');
const phonenotify = require('./phonenotify');
const remote = require('./remote');

function recording(fn, failFsyncOf) {
  const events = [];
  const fdPath = new Map();
  const realOpen = fs.openSync;
  const realFsync = fs.fsyncSync;
  const realRename = fs.renameSync;
  fs.openSync = (p, ...rest) => { const fd = realOpen.call(fs, p, ...rest); fdPath.set(fd, String(p)); return fd; };
  fs.fsyncSync = (fd) => {
    const p = fdPath.get(fd);
    events.push(['fsync', p]);
    if (failFsyncOf && p && failFsyncOf(p)) { const e = new Error('injected'); e.code = 'EIO'; throw e; }
    return realFsync(fd);
  };
  fs.renameSync = (a, b) => { events.push(['rename', String(a), String(b)]); return realRename(a, b); };
  return Promise.resolve().then(fn).then(
    (out) => ({ events, out, err: null }),
    (err) => ({ events, out: undefined, err }),
  ).finally(() => { fs.openSync = realOpen; fs.fsyncSync = realFsync; fs.renameSync = realRename; });
}
const tempOf = (file) => (p) => p.startsWith(file + '.kosmos-') && p.endsWith('.tmp');
function flushedBeforeRename(events, file) {
  const r = events.findIndex((e) => e[0] === 'rename' && e[2] === file);
  assert.ok(r >= 0, 'no rename into ' + path.basename(file) + ': ' + JSON.stringify(events));
  assert.ok(events.slice(0, r).some((e) => e[0] === 'fsync' && e[1] === events[r][1]), 'the temp was not flushed before its rename');
}

/* Policy bundle fixture, as engine/orgpolicy-5534.test.js signs it. */
const NOW = 1_800_000_000;
const coordinator = crypto.generateKeyPairSync('ed25519');
const PINNED = coordinator.publicKey.export({ format: 'jwk' }).x;
function sign(payload) {
  const body = 'KST1.' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + crypto.sign(null, Buffer.from(body, 'ascii'), coordinator.privateKey).toString('base64url');
}
const POLICY = { providers_allowed: ['anthropic'], models_allowed: { anthropic: ['opus'] }, backup: { required: true, max_age_hours: 24 },
  telemetry: { required: true }, ai_policy: { name: 'Company', text: 'Be careful.' } };
let version = 0;
function placeBundle() {
  version += 1;
  fs.mkdirSync(path.dirname(orgpolicy.BUNDLE()), { recursive: true });
  fs.writeFileSync(orgpolicy.BUNDLE(), sign({ typ: 'org_policy', v: 1, org: 'org-1', version, iat: NOW - 10, exp: NOW + 86400, policy: POLICY }));
}

test('#5434 orgenroll world id: flushed before its rename, at 0600', async () => {
  const root = tmp('secrets-fsync-world-');
  const file = path.join(root, orgenroll.WORLD_ID_FILE);
  const { events, out } = await recording(() => orgenroll.worldId({ root }));
  assert.match(out, /^[0-9a-f]{32}$/);
  flushedBeforeRename(events, file);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('#5434 orgenroll world id: a failed flush mints nothing and leaves no temp', async () => {
  const root = tmp('secrets-fsync-world-');
  const file = path.join(root, orgenroll.WORLD_ID_FILE);
  const { events, out } = await recording(() => orgenroll.worldId({ root }), tempOf(file));
  assert.ok(events.some((e) => e[0] === 'fsync' && tempOf(file)(e[1] || '')), 'the temp was never flushed, so this tests nothing');
  assert.equal(out, null, 'an id whose flush failed was handed out');
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.endsWith('.tmp')), []);
});

test('#5434 orgpolicy applied record: flushed before its rename, at 0600', async () => {
  placeBundle();
  const { events, out } = await recording(() => orgpolicy.refresh({ now: NOW, pinned: PINNED }));
  assert.ok(out && out.applied && out.applied.version === version, 'the bundle was not applied: ' + JSON.stringify(out));
  flushedBeforeRename(events, orgpolicy.APPLIED());
  if (process.platform !== 'win32') assert.equal(fs.statSync(orgpolicy.APPLIED()).mode & 0o777, 0o600);
});

test('#5434 phone notifications state: flushed before its rename, at 0600', async () => {
  phonenotify.setAvailableForTests(true);
  const file = path.join(remote.stateDir(), 'phone-notify.json');
  const { events, out } = await recording(() => phonenotify.turnOff());
  assert.deepEqual(out, { ok: true });
  flushedBeforeRename(events, file);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('#5434 phone notifications state: a failed flush answers the refusal and leaves the old file', async () => {
  phonenotify.setAvailableForTests(true);
  const file = path.join(remote.stateDir(), 'phone-notify.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ on: true }) + '\n', { mode: 0o600 });
  const before = fs.readFileSync(file, 'utf8');
  const { events, out } = await recording(() => phonenotify.turnOff(), tempOf(file));
  assert.ok(events.some((e) => e[0] === 'fsync' && tempOf(file)(e[1] || '')), 'the temp was never flushed, so this tests nothing');
  assert.deepEqual(out, { ok: false, because: 'we could not save that setting' });
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'a save whose flush failed changed the file');
});

'use strict';
/**
 * kosmos#5744 slice 2b: engine/backupmemberkey.js registers this computer's member backup key, epoch 1 first, and
 * after a lost key the next epoch, against a fake coordinator that applies the member-key route's rules
 * (docs/coordinator-api.md in kosmos-relay) and OPENS every wrap with the company's secret for the exact
 * (org, member, epoch), as the real one does: a wrap for the wrong context is refused there and here.
 *
 *   node --test engine/backupmemberkey-5744.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-memberkey-5744-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const store = require('./store');
const backupkeys = require('./backupkeys');
const mk = require('./backupmemberkey');

const ORG = 'org1', MEMBER = 'acct1';

/* A coordinator with the route's rules: first key is epoch 1; the same key again is a repeat; a new key only at
   current + 1 and only when `day` allows; another key at the current epoch is 409 member_key_exists; any other epoch
   is 400 member_key_wrong_epoch with currentEpoch. Every wrap must open to member_public for (org, member, epoch). */
function fakeCoordinator({ day = true } = {}) {
  const company = backupkeys.newMemberKey();   // the org key pair (an X25519 pair like any other)
  const kept = new Map();   // epoch -> pk (b64url)
  const calls = [];
  const refuse = (status, code, because, currentEpoch) => ({ ok: false, because, refusal: { status, code, currentEpoch: currentEpoch === undefined ? null : currentEpoch } });
  const macRequest = async (method, route, body) => {
    calls.push({ route, body });
    if (route === mk.BACKUP_KEY_ROUTE) return { ok: true, data: { org: ORG, member: MEMBER, epoch: 1, public_key: company.pk.toString('base64url') } };
    if (route !== mk.MEMBER_KEY_ROUTE) return { ok: false, because: 'no such route' };
    const current = kept.size ? Math.max(...kept.keys()) : 0;
    const pk = Buffer.from(body.member_public, 'base64url');
    const opened = backupkeys.unwrapMemberKey(company.sk, Buffer.from(body.wrap, 'base64url'), { org: ORG, member: MEMBER, epoch: String(body.epoch) }, pk);
    // The real route opens the wrap before it compares keys.
    if (body.epoch === current && !opened) return refuse(400, 'member_wrap_unopenable', 'no');
    if (body.epoch === current && kept.get(current) === body.member_public) return { ok: true, data: { epoch: current, member_public: body.member_public } };
    if (body.epoch === current) return refuse(409, 'member_key_exists', 'another key holds this epoch');
    if (body.epoch !== current + 1) return refuse(400, 'member_key_wrong_epoch', 'not current or next', current);
    if (current >= 1 && !day) return refuse(429, 'member_key_rotation_wait', 'wait a day');
    if (!opened) return refuse(400, 'member_wrap_unopenable', 'the wrap did not open');
    // The route's unique index: one key is never registered at two epochs.
    if ([...kept.values()].includes(body.member_public)) return refuse(409, 'member_key_reused', 'make a new key');
    kept.set(body.epoch, body.member_public);
    return { ok: true, data: { epoch: body.epoch, member_public: body.member_public } };
  };
  return { macRequest, kept, calls, company, setDay: (d) => { day = d; }, setCurrent: (e, pk) => kept.set(e, pk) };
}
const keyFile = () => path.join(store.ROOT, 'backupkeys', fs.readdirSync(path.join(store.ROOT, 'backupkeys'))[0]);
const loseTheKey = () => fs.rmSync(path.join(store.ROOT, 'backupkeys'), { recursive: true, force: true });

test.beforeEach(loseTheKey);
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

test('#5744 2b: a first key is registered at epoch 1, wrapped so the company key opens it, and kept 0600', async () => {
  const c = fakeCoordinator();
  const r = await mk.ensureMemberKey({ macRequest: c.macRequest });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.epoch, 1);
  assert.equal(c.kept.get(1), r.publicKey.toString('base64url'));
  assert.equal(fs.statSync(keyFile()).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(keyFile())).mode & 0o777, 0o700);
});

test('#5744 2b: a key Kosmos+ already took is answered from disk, with no second registration', async () => {
  const c = fakeCoordinator();
  const first = await mk.ensureMemberKey({ macRequest: c.macRequest });
  const again = await mk.ensureMemberKey({ macRequest: c.macRequest });
  assert.deepEqual([again.ok, again.epoch, again.publicKey.equals(first.publicKey)], [true, 1, true]);
  assert.equal(c.calls.filter((x) => x.route === mk.MEMBER_KEY_ROUTE).length, 1, 'registered twice');
});

test('#5744 2b: a lost key starts the next epoch with a new key (409 at the current epoch)', async () => {
  const c = fakeCoordinator();
  const first = await mk.ensureMemberKey({ macRequest: c.macRequest });
  loseTheKey();
  const r = await mk.ensureMemberKey({ macRequest: c.macRequest });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.epoch, 2);
  assert.equal(r.publicKey.equals(first.publicKey), false, 'the lost key came back');
  assert.equal(c.kept.get(1), first.publicKey.toString('base64url'), 'the old epoch key must stay');
  assert.equal(c.kept.get(2), r.publicKey.toString('base64url'));
});

test('#5744 2b: a lost key when the current epoch is later reads currentEpoch and goes one past it', async () => {
  const c = fakeCoordinator();
  await mk.ensureMemberKey({ macRequest: c.macRequest });
  loseTheKey(); await mk.ensureMemberKey({ macRequest: c.macRequest });   // epoch 2
  loseTheKey(); await mk.ensureMemberKey({ macRequest: c.macRequest });   // epoch 3
  // A key file that still says epoch 1, unregistered (an old crash): 400 wrong_epoch with currentEpoch 3, then 4.
  loseTheKey();
  const before = await mk.ensureMemberKey({ macRequest: async (m, r2, b) => (r2 === mk.BACKUP_KEY_ROUTE ? c.macRequest(m, r2, b) : { ok: false, because: 'offline' }) });
  assert.equal(before.ok, false);
  assert.equal(JSON.parse(fs.readFileSync(keyFile(), 'utf8')).keys['1'].registered, false, 'no key was kept for epoch 1 while offline');
  const r = await mk.ensureMemberKey({ macRequest: c.macRequest });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.epoch, 4);
});

test('#5744 2b: inside the day a new epoch waits, keeps its key, and registers it once the day is up', async () => {
  const c = fakeCoordinator({ day: false });
  await mk.ensureMemberKey({ macRequest: c.macRequest });
  loseTheKey();
  const wait = await mk.ensureMemberKey({ macRequest: c.macRequest });
  assert.equal(wait.ok, false);
  assert.deepEqual([wait.waiting, wait.pendingEpoch, 'epoch' in wait], [true, 2, false], JSON.stringify(wait));
  const keptPk = JSON.parse(fs.readFileSync(keyFile(), 'utf8')).keys['2'].pk;
  c.setDay(true);
  const r = await mk.ensureMemberKey({ macRequest: c.macRequest });
  assert.deepEqual([r.ok, r.epoch, r.publicKey.toString('base64url')], [true, 2, keptPk], 'a different key was sent after the wait');
});

test('#5744 2b: the key is on disk before it is sent, so an answer lost after Kosmos+ kept it is a repeat, not a new epoch', async () => {
  const c = fakeCoordinator();
  const lost = async (m, route, b) => { const r = await c.macRequest(m, route, b); return route === mk.MEMBER_KEY_ROUTE ? { ok: false, because: 'the answer was lost' } : r; };
  const first = await mk.ensureMemberKey({ macRequest: lost });
  assert.equal(first.ok, false);
  assert.equal(c.kept.size, 1, 'Kosmos+ kept it');
  const r = await mk.ensureMemberKey({ macRequest: c.macRequest });
  assert.deepEqual([r.ok, r.epoch], [true, 1], JSON.stringify(r));
  assert.equal(c.kept.size, 1, 'a second epoch was started for a key Kosmos+ already had');
});

test('#5744 2b: a malformed company answer, an unreadable key file and a failed backup-key call register nothing', async () => {
  const c = fakeCoordinator();
  const good = { org: ORG, member: MEMBER, public_key: c.company.pk.toString('base64url') };
  for (const broken of [{ org: 'o\nx' }, { member: '' }, { public_key: 'AA' }]) {
    const bad = async (m, route, b) => (route === mk.BACKUP_KEY_ROUTE ? { ok: true, data: { ...good, ...broken } } : c.macRequest(m, route, b));
    assert.equal((await mk.ensureMemberKey({ macRequest: bad })).ok, false, JSON.stringify(broken));
  }
  const off = async () => ({ ok: false, because: 'backups are off', refusal: { status: 404, code: 'backup_off', currentEpoch: null } });
  const r = await mk.ensureMemberKey({ macRequest: off });
  assert.deepEqual([r.ok, r.refusal.code], [false, 'backup_off']);
  await mk.ensureMemberKey({ macRequest: c.macRequest });
  fs.writeFileSync(keyFile(), 'not json');
  const unreadable = await mk.ensureMemberKey({ macRequest: c.macRequest });
  assert.equal(unreadable.ok, false);
  assert.equal(fs.readFileSync(keyFile(), 'utf8'), 'not json', 'an unreadable key file was overwritten');
  assert.equal(c.calls.filter((x) => x.route === mk.MEMBER_KEY_ROUTE).length, 1, 'something was registered past a bad answer');
});

// Not a red arm for the one-at-a-time chain: reading the file and writing a new key have no await between them, so
// a second call already sees the first call's key without the chain. It pins the outcome either way.
test('#5744 2b: two calls at once agree on one key with Kosmos+', async () => {
  const c = fakeCoordinator();
  const [a, b] = await Promise.all([mk.ensureMemberKey({ macRequest: c.macRequest }), mk.ensureMemberKey({ macRequest: c.macRequest })]);
  assert.deepEqual([a.ok, b.ok, a.epoch, b.epoch], [true, true, 1, 1], JSON.stringify([a, b]));
  assert.equal(a.publicKey.equals(b.publicKey), true);
  assert.equal(c.kept.size, 1, 'a second epoch was started');
  assert.equal(JSON.parse(fs.readFileSync(keyFile(), 'utf8')).keys['1'].pk, c.kept.get(1), 'the key on disk is not the one Kosmos+ took');
});

test('#5744 2b: currentEpoch 0 (no key at all) moves a kept later-epoch key to epoch 1', async () => {
  const c = fakeCoordinator();
  // A kept, unregistered key for epoch 3 (an old account): Kosmos+ has none, so it answers wrong_epoch with 0.
  const k = backupkeys.newMemberKey();
  await mk.ensureMemberKey({ macRequest: async (m, route, b) => (route === mk.BACKUP_KEY_ROUTE ? c.macRequest(m, route, b) : { ok: false, because: 'offline' }) });
  const file = keyFile();
  const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
  kept.keys = { 3: { sk: k.sk.toString('base64url'), pk: k.pk.toString('base64url'), registered: false } };
  fs.writeFileSync(file, JSON.stringify(kept));
  const r = await mk.ensureMemberKey({ macRequest: c.macRequest });
  assert.deepEqual([r.ok, r.epoch], [true, 1], JSON.stringify(r));
  assert.equal(c.kept.get(1), k.pk.toString('base64url'));
});

test('#5744 2b: member_key_reused gets one fresh key at the same epoch; a 429 with no code starts nothing', async () => {
  const c = fakeCoordinator();
  const run = async (refusal) => {
    loseTheKey();
    const sent = [];
    const r = await mk.ensureMemberKey({ macRequest: async (m, route, b) => {
      if (route === mk.BACKUP_KEY_ROUTE) return c.macRequest(m, route, b);
      sent.push(b);
      return { ok: false, because: 'no', refusal };
    } });
    return { r, sent };
  };
  const reused = await run({ status: 409, code: 'member_key_reused', currentEpoch: null });
  assert.equal(reused.r.ok, false);
  assert.deepEqual(reused.sent.map((b) => b.epoch), [1, 1], 'a new epoch, or more than one fresh key');
  assert.notEqual(reused.sent[0].member_public, reused.sent[1].member_public, 'the reused key was sent again');
  const limited = await run({ status: 429, code: null, currentEpoch: null });
  assert.equal(limited.r.ok, false);
  assert.deepEqual(limited.sent.map((b) => b.epoch), [1]);
});

test('#5744 2b: a key folder that already exists with looser permissions is made owner-only', async () => {
  fs.mkdirSync(path.join(store.ROOT, 'backupkeys'), { recursive: true });
  fs.chmodSync(path.join(store.ROOT, 'backupkeys'), 0o755);
  const c = fakeCoordinator();
  assert.equal((await mk.ensureMemberKey({ macRequest: c.macRequest })).ok, true);
  assert.equal(fs.statSync(path.join(store.ROOT, 'backupkeys')).mode & 0o777, 0o700);
});

test('#5744 2b: a kept key Kosmos+ already holds at an older epoch (answer lost, then the epoch moved) gets a fresh key', async () => {
  const c = fakeCoordinator();
  // A CONSTRUCTED state the plan's premise excludes (only the enrolled computer reaches the route), built to reach the
  // fresh-key path: the answer to epoch 1 is lost after Kosmos+ kept the key, then epoch 2 is set by hand.
  const lost = async (m, route, b) => { const r = await c.macRequest(m, route, b); return route === mk.MEMBER_KEY_ROUTE ? { ok: false, because: 'the answer was lost' } : r; };
  await mk.ensureMemberKey({ macRequest: lost });
  c.setCurrent(2, backupkeys.newMemberKey().pk.toString('base64url'));
  const r = await mk.ensureMemberKey({ macRequest: c.macRequest });
  // epoch 1: wrong epoch, current 2 -> 3 with the kept key -> member_key_reused (it is epoch 1's) -> a fresh key at 3.
  assert.deepEqual([r.ok, r.epoch], [true, 3], JSON.stringify(r));
  assert.notEqual(c.kept.get(3), c.kept.get(1), 'one key at two epochs');
});

test('#5744 2b: an ok answer that does not name what was sent is not taken as registered', async () => {
  const c = fakeCoordinator();
  const odd = async (m, route, b) => (route === mk.MEMBER_KEY_ROUTE ? { ok: true, data: { epoch: 7 } } : c.macRequest(m, route, b));
  const r = await mk.ensureMemberKey({ macRequest: odd });
  assert.equal(r.ok, false);
  assert.equal(JSON.parse(fs.readFileSync(keyFile(), 'utf8')).keys['1'].registered, false);
});

test('#5744 2b: a key another process registered during a rotation is answered, not replaced', async () => {
  const c = fakeCoordinator();
  const theirs = backupkeys.newMemberKey();
  const r = await mk.ensureMemberKey({ macRequest: async (m, route, b) => {
    if (route === mk.BACKUP_KEY_ROUTE) return c.macRequest(m, route, b);
    // Meanwhile another process on this data root registered its own key at epoch 1 and wrote the file.
    const file = keyFile();
    fs.writeFileSync(file, JSON.stringify({ org: ORG, member: MEMBER, keys: { 1: { sk: theirs.sk.toString('base64url'), pk: theirs.pk.toString('base64url'), registered: true } } }));
    return { ok: false, because: 'another key holds this epoch', refusal: { status: 409, code: 'member_key_exists', currentEpoch: null } };
  } });
  assert.deepEqual([r.ok, r.epoch], [true, 1], JSON.stringify(r));
  assert.equal(r.publicKey.equals(theirs.pk), true);
  assert.equal(JSON.parse(fs.readFileSync(keyFile(), 'utf8')).keys['1'].pk, theirs.pk.toString('base64url'), 'their key was replaced');
});

test('#5744 2b: a key in the file that is not canonical base64url is not read as a key', async () => {
  const c = fakeCoordinator();
  await mk.ensureMemberKey({ macRequest: c.macRequest });
  const file = keyFile();
  const kept = JSON.parse(fs.readFileSync(file, 'utf8'));
  kept.keys['1'].pk = kept.keys['1'].pk + '!';   // decodes to the same 32 bytes in Node, but is not what was written
  fs.writeFileSync(file, JSON.stringify(kept));
  const r = await mk.ensureMemberKey({ macRequest: c.macRequest });
  assert.equal(r.ok, false);
  assert.match(r.because, /could not be read/);
});

test('#5744 2b: a key file made unreadable during a rotation is left as it is', async () => {
  const c = fakeCoordinator();
  const r = await mk.ensureMemberKey({ macRequest: async (m, route, b) => {
    if (route === mk.BACKUP_KEY_ROUTE) return c.macRequest(m, route, b);
    fs.writeFileSync(keyFile(), 'broken by someone else');
    return { ok: false, because: 'another key holds this epoch', refusal: { status: 409, code: 'member_key_exists', currentEpoch: null } };
  } });
  assert.equal(r.ok, false);
  assert.equal(fs.readFileSync(keyFile(), 'utf8'), 'broken by someone else');
});

test('#5744 2b: a key another process registered before a fresh-key refresh is answered, not replaced', async () => {
  const c = fakeCoordinator();
  const theirs = backupkeys.newMemberKey();
  const r = await mk.ensureMemberKey({ macRequest: async (m, route, b) => {
    if (route === mk.BACKUP_KEY_ROUTE) return c.macRequest(m, route, b);
    fs.writeFileSync(keyFile(), JSON.stringify({ org: ORG, member: MEMBER, keys: { 1: { sk: theirs.sk.toString('base64url'), pk: theirs.pk.toString('base64url'), registered: true } } }));
    return { ok: false, because: 'make a new key', refusal: { status: 409, code: 'member_key_reused', currentEpoch: null } };
  } });
  assert.deepEqual([r.ok, r.epoch, r.publicKey.equals(theirs.pk)], [true, 1, true], JSON.stringify(r));
  assert.equal(JSON.parse(fs.readFileSync(keyFile(), 'utf8')).keys['1'].pk, theirs.pk.toString('base64url'));
});

test('#5744 2b: a file error is said without its path', async () => {
  const c = fakeCoordinator();
  const sw = require('./securewrite');
  const real = sw.writeSecret;
  sw.writeSecret = () => { const e = new Error("EACCES: permission denied, open '/Users/someone/Library/backupkeys/x.json'"); e.code = 'EACCES'; throw e; };
  let r;
  try { r = await mk.ensureMemberKey({ macRequest: c.macRequest }); } finally { sw.writeSecret = real; }
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.because, 'the backup key could not be set up on this computer (EACCES)');
});

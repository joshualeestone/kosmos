'use strict';
/**
 * kosmos#7404 slice D: a personal backup restored on this computer, through the real snapshot, grant fetcher, run, sink
 * and world. Only Kosmos+ (macRequest), the store (fetch) and the personal record are stand-ins.
 *
 *   node --test engine/personalrestore-7404.test.js
 */
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#4273)
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-prestore-7404-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.HOME = SANDBOX;
fs.mkdirSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true });
const backupkeys = require('./backupkeys');
const fmt = require('./backupformat');
const memberkeys = require('./backupmemberkey');
const snap = require('./backupsnapshot');
const worlds = require('./worlds');
const pk = require('./personalbackupkey');
const pr = require('./personalrestore');

const NOW = Date.parse('2026-10-08T12:00:00Z');
const GRANTED = Math.floor(NOW / 1000);
const PERIOD = snap.periodOf(NOW);
const SNAP_ID = '20261008T115500Z-0a1b2c3d';
const b64 = (b) => Buffer.from(b).toString('base64url');
let seq = 0;

/* A real personal snapshot, and a Kosmos+ and a store that answer for it. */
async function world(over = {}) {
  seq += 1;
  const pair = { org: 'porg' + seq, member: 'pacct' + seq };
  const member = backupkeys.newMemberKey();
  memberkeys.writeKeys(pair.org, pair.member, { 1: { sk: member.sk, pk: member.pk, registered: true } });
  const root = fs.mkdtempSync(path.join(SANDBOX, 'home-'));
  fs.mkdirSync(path.join(root, 'workers', 'ann'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workers', 'ann', 'notes.md'), 'came back\n');
  if (over.twoFiles) fs.writeFileSync(path.join(root, 'workers', 'ann', 'second.md'), crypto.randomBytes(9000).toString('hex'));
  const nk = crypto.randomBytes(32), dev = crypto.generateKeyPairSync('ed25519');
  const ctx = { ...pair, epoch: '1', period: PERIOD, snapshot: SNAP_ID };
  const objects = new Map();
  let n = 0, mkey = null;
  const r = await snap.takeSnapshot({ roots: [{ name: 'workers', path: path.join(root, 'workers') }], memberPk: member.pk, namingKey: nk, namingKeyId: backupkeys.namingKeyId(nk), deviceKey: dev.privateKey, ctx,
    ...(over.noProof ? {} : { proofKey: fmt.memberProofKey(member.sk) }) }, {
    now: () => NOW,
    uploadChunks: async (d, batch) => {
      const keys = new Map(), lockedUntil = new Map();
      for (const { name, object } of batch) { n += 1; const k = `${pair.org}/${pair.member}/1/${PERIOD}/${String(n).padStart(64, '0')}`; objects.set(k, Buffer.from(object)); keys.set(name, k); lockedUntil.set(name, NOW + 40 * 86400000); }
      return { ok: true, keys, lockedUntil, bucket: 'bucket/' };
    },
    uploadManifest: async (d, bytes) => { mkey = `${pair.org}/${pair.member}/1/${PERIOD}/${'f'.repeat(64)}`; objects.set(mkey, Buffer.from(bytes)); return { ok: true, key: mkey, lockedUntilMs: NOW + 40 * 86400000 }; },
  });
  assert.equal(r.ok, true, r.because);
  const bytes = objects.get(mkey);
  const row = { key: mkey, period: PERIOD, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size: bytes.length, granted_at: GRANTED, snapshot: SNAP_ID, readable: true };
  const calls = [];
  const url = (k) => `https://store.example/bucket/${k}?sig=x`;
  const macRequest = async (m, route, body) => {
    calls.push({ route, body });
    if (route === pk.MINE_ROUTE) return { ok: true, data: { ...pair, keys: [{ epoch: 1, member_public: b64(member.pk), wrap: b64(Buffer.from('w')), recovery_public: b64(Buffer.alloc(32, 1)), recovery_tag: 'ab'.repeat(32) }] } };
    if (route === '/v1/org/backup/mine/manifests') return { ok: true, data: { member: pair.member, epoch: 1, more: false, manifests: [row] } };
    if (route === '/v1/org/backup/mine/read') {
      if (over.refuseRead) return { ok: false, because: 'mac-request: {"error":"raw tunnel line","code":"x"}', refusal: { status: 429 } };
      return { ok: true, data: { member: pair.member, epoch: 1, expires_at: GRANTED + 300, manifest: { key: row.key, sha256: row.sha256, size: row.size, snapshot: SNAP_ID, url: url(row.key) }, objects: body.keys.map((k) => ({ key: k, url: url(k) })) } };
    }
    throw new Error('unexpected route ' + route);
  };
  const fetch = async (u) => {
    const k = decodeURIComponent(new URL(u).pathname).slice('/bucket/'.length);
    const b = objects.get(k);
    return b ? new Response(b, { status: 200 }) : new Response('', { status: 404 });
  };
  const personalbackup = { restoreRecord: () => ({ state: over.state || 'on', rec: { org: { id: pair.org }, world: 'w' } }) };
  const base = worlds.baseRoot(process.env);
  return { pair, calls, row, base, opts: { macRequest, fetch, personalbackup, base, maxTotalBytes: 2 ** 30 } };
}

test('the list is the person\'s, and says when a backup cannot be restored', async () => {
  const w = await world();
  const r = await pr.listBackups(w.opts);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.backups, [{ key: w.row.key, epoch: 1, takenAt: Date.parse('2026-10-08T11:55:00Z') / 1000, problem: null }]);
});

test('one snapshot comes back into a new Kosmos of its own', async () => {
  const w = await world();
  const r = await pr.restoreFiles({ key: w.row.key }, { ...w.opts, memberName: 'Ann' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.restored, 1);
  assert.equal(r.failed, 0);
  assert.deepEqual(r.moved, ['workers']);
  const dir = worlds.worldBaseDir(worlds.baseRoot(process.env), r.world);
  assert.equal(fs.readFileSync(path.join(dir, 'workers', 'ann', 'notes.md'), 'utf8'), 'came back\n');
  const reads = w.calls.filter((c) => c.route.endsWith('/mine/read'));
  assert.ok(reads.length >= 1);
  assert.ok(reads.every((c) => c.body.member === undefined && Object.keys(c.body).sort().join() === 'epoch,keys,manifest'), 'the member is the signature\'s, never the body\'s');
});

test('a manifest without the proof is refused, and its files never land', async () => {
  const w = await world({ noProof: true });
  const made = allWorlds(w);
  const r = await pr.restoreFiles({ key: w.row.key }, w.opts);
  assert.equal(r.ok, false);
  assert.match(r.because, /could not be proved to be yours/);
  assert.equal(r.restored, undefined);
  assert.equal(allWorlds(w), made, 'refused before a Kosmos was made');
});

const listed = (w) => worlds.listWorlds(w.base).length;
const allWorlds = (w) => worlds.readRegistry(w.base).worlds.length;
test('a key Kosmos+ does not list, no record here, and no held key each stop before anything is made', async () => {
  const w = await world();
  const before = listed(w);
  const none = await pr.restoreFiles({ key: 'nope' }, w.opts);
  assert.equal(none.code, 'no_such_backup');
  const off = await world({ state: 'off' });
  assert.equal((await pr.restoreFiles({ key: off.row.key }, off.opts)).code, 'not_on');
  const needs = await world({ state: 'needs-key' });
  const asked = await pr.restoreFiles({ key: needs.row.key }, needs.opts);
  assert.equal(asked.code, 'no_keys');
  assert.match(asked.because, /recovery code/);
  assert.equal(listed(needs), before, 'none of these made a Kosmos');
  const bare = await world();
  memberkeys.writeKeys(bare.pair.org, bare.pair.member, {});
  assert.equal((await pr.listBackups(bare.opts)).code, 'no_keys');
});

test('a refused grant stops the restore with its reason, and the empty Kosmos does not stay', async () => {
  const w = await world({ refuseRead: true });
  const before = allWorlds(w);
  const r = await pr.restoreFiles({ key: w.row.key }, w.opts);
  assert.equal(r.ok, false);
  assert.match(r.because, /as much as an hour allows/);
  assert.doesNotMatch(r.because, /raw tunnel/, 'never the tunnel\'s own line');
  assert.equal(r.world, undefined);
  assert.equal(allWorlds(w), before, 'no Kosmos was made, hidden or not, so a retry spends no name');
});

test('a run that stopped part way keeps its Kosmos and says so; a failed finish does too', async () => {
  const w = await world();
  const stops = { ...require('./restorerun'), runRestore: async () => ({ ok: false, because: 'stopped', partial: true }) };
  const r = await pr.restoreFiles({ key: w.row.key }, { ...w.opts, restorerun: stops });
  assert.deepEqual([r.ok, r.because, r.partial], [false, 'stopped', true]);
  assert.ok(r.world);
  const held = worlds.worldBaseDir(w.base, r.world);
  const records = fs.readdirSync(held, { recursive: true }).filter((f) => String(f).endsWith(require('./restoresink').RECORD_NAME));
  assert.equal(records.length, 1, 'the sink\'s record stays for a later slice to carry on from');
  const none = { ...require('./restorerun'), runRestore: async () => ({ ok: false, because: 'stopped' }) };
  let hiddenDir = null;
  const n = await pr.restoreFiles({ key: w.row.key }, { ...w.opts, restorerun: none, worlds: { ...worlds, hideWorld: (b, id) => { hiddenDir = worlds.worldBaseDir(b, worlds.readRegistry(b).worlds.find((x) => x.id === id)); return worlds.hideWorld(b, id); } } });
  assert.equal(n.world, undefined);
  assert.equal(fs.readdirSync(hiddenDir, { recursive: true }).filter((f) => String(f).endsWith(require('./restoresink').RECORD_NAME)).length, 0, 'an empty one keeps none');
  const finish = { ...require('./restoreworld'), finishRestoreWorld: () => ({ ok: false, because: 'could not move', moved: [], kept: [], heldBack: [], failedFiles: 7, fetchProblems: [] }) };
  const f = await pr.restoreFiles({ key: w.row.key }, { ...w.opts, restoreworld: finish });
  assert.deepEqual([f.ok, f.because, f.partial, f.failed], [false, 'could not move', true, 7]);
});

test('a sink that refuses, a sink that will not close, a finish that throws and an unreadable disk each answer in their own words', async () => {
  const w = await world();
  const realSink = require('./restoresink');
  const noSink = await pr.restoreFiles({ key: w.row.key }, { ...w.opts, restoresink: { ...realSink, createRestoreSink: () => { throw new Error('no'); } } });
  assert.match(noSink.because, /could not be used/);
  assert.equal(noSink.world, undefined, 'nothing landed, so the empty Kosmos went off the list');
  const hideFails = await pr.restoreFiles({ key: w.row.key }, { ...w.opts, restoresink: { ...realSink, createRestoreSink: () => { throw new Error('no'); } }, worlds: { ...worlds, hideWorld: () => { throw new Error('no'); } } });
  assert.ok(hideFails.world, 'one that could not be hidden is named');
  assert.match(hideFails.because, /An empty Kosmos named/);
  const noClose = await pr.restoreFiles({ key: w.row.key }, { ...w.opts, restoresink: { ...realSink, createRestoreSink: (...a) => { const s = realSink.createRestoreSink(...a); const c = s.close; s.close = (o) => { c.call(s, o); throw new Error('no'); }; return s; } } });
  assert.deepEqual([noClose.ok, noClose.partial], [false, true]);
  assert.match(noClose.because, /your files were restored/);
  const throwing = await pr.restoreFiles({ key: w.row.key }, { ...w.opts, restoreworld: { ...require('./restoreworld'), finishRestoreWorld: () => { throw new Error('no'); } } });
  assert.deepEqual([throwing.ok, throwing.partial, !!throwing.world], [false, true, true]);
  const { maxTotalBytes, ...noBudget } = w.opts;
  const realStat = fs.statfsSync;
  fs.statfsSync = () => ({ bavail: 2 ** 21, bsize: 4096 });   // 8 GiB free
  try {
    const room = await pr.restoreFiles({ key: w.row.key }, noBudget);
    assert.equal(room.ok, true, JSON.stringify(room));
    fs.statfsSync = () => ({ bavail: 1, bsize: 4096 });   // past the margin: nothing fits
    const full = await pr.restoreFiles({ key: w.row.key }, noBudget);
    assert.equal(full.ok, false);
    fs.statfsSync = () => { throw new Error('no'); };
    const disk = await pr.restoreFiles({ key: w.row.key }, noBudget);
    assert.match(disk.because, /free space on this computer could not be read/);
  } finally { fs.statfsSync = realStat; }
});

test('the copies a restore holds are zeroed on every path, and a list never holds one', async () => {
  const w = await world();
  const real = require('./personalbackupkey');
  const seen = [];
  const spy = { ...real, personalRestoreKeys: async (o, a) => { seen.push(a.withSecrets); const r = await real.personalRestoreKeys(o, a); seen.push(r); return r; } };
  await pr.listBackups({ ...w.opts, personalbackupkey: spy });
  assert.equal(seen[0], false);
  assert.equal('sk' in seen[1].epochs[0], false);
  seen.length = 0;
  await pr.restoreFiles({ key: 'nope' }, { ...w.opts, personalbackupkey: spy });
  assert.equal(seen[0], true);
  assert.ok(seen[1].epochs[0].sk.every((b) => b === 0), 'an early refusal zeroes it');
  seen.length = 0;
  await pr.restoreFiles({ key: w.row.key }, { ...w.opts, personalbackupkey: spy });
  assert.ok(seen[1].epochs[0].sk.every((b) => b === 0), 'so does a finished run');
});

test('on a named Kosmos the restored one goes on the list the switcher reads, not inside that Kosmos', async () => {
  const w = await world();
  const { base, ...noBase } = w.opts;
  const booted = fs.mkdtempSync(path.join(SANDBOX, 'booted-base-'));
  const worldenv = require('./worldenv');
  const realBooted = worldenv.bootedBaseDir;
  worldenv.bootedBaseDir = () => booted;
  try {
    const here = listed(w);
    const r = await pr.restoreFiles({ key: w.row.key }, noBase);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(worlds.listWorlds(booted).some((x) => x.id === r.world.id), 'the base the board booted from, not this process\'s data root');
    assert.equal(listed(w), here);
  } finally { worldenv.bootedBaseDir = realBooted; }
});

test('two restores do not run at once, and a finished one frees the next', async () => {
  const w = await world();
  const first = pr.restoreFiles({ key: w.row.key }, w.opts);
  assert.equal((await pr.restoreFiles({ key: w.row.key }, w.opts)).code, 'restore_running');
  assert.equal((await first).ok, true);
  assert.notEqual((await pr.restoreFiles({ key: 'nope' }, w.opts)).code, 'restore_running');
});

test('a batch of the size asked for is what is granted', async () => {
  const { readGrantFetcher } = require('./restorefetch');
  const key = (i) => `o/m/1/${PERIOD}/${String(i).padStart(64, '0')}`;
  const asked = [];
  const manifest = { key: key(0), period: PERIOD, sha256: 'a'.repeat(64), size: 1 };
  const url = (k) => `https://s.example/${k}`;
  const f = readGrantFetcher({ org: 'o', member: 'm', epoch: 1, manifest, grantKeys: 2, fetch: async () => new Response(Buffer.from('x')), grant: async (b) => {
    asked.push(b.keys.length);
    return { ok: true, answer: { member: 'm', epoch: 1, expires_at: GRANTED + 300, manifest: { key: manifest.key, sha256: manifest.sha256, size: 1, url: url(manifest.key) }, objects: b.keys.map((k) => ({ key: k, url: url(k) })) } };
  } });
  const keys = [key(1), key(2), key(3)];
  assert.equal((await f.plan(keys)).ok, true);
  for (const k of keys) assert.ok(await f.fetchObject(k, { maxBytes: 10 }));
  assert.ok(asked.length > 1 && asked.every((n) => n <= 2), asked.join());
});

test('the batch fits mac-request at the ids Kosmos+ makes and at the longest it could', () => {
  const check = ((key) => JSON.stringify({ epoch: 1, manifest: key, keys: new Array(pr.batchFor(key)).fill(key) }).length);
  const key = (n) => `${'o'.repeat(n)}/${'m'.repeat(n)}/1/2026-W44/${'a'.repeat(64)}`;
  assert.equal(pr.batchFor(key(32)), 400);
  assert.ok(check(key(32)) <= 64 * 1024);
  assert.ok(pr.batchFor(key(128)) < 400);
  assert.ok(check(key(128)) <= 64 * 1024);
});

test('the list is newest first, with a backup of no readable time last', async () => {
  const w = await world();
  const older = { ...w.row, key: w.row.key.replace(/f{64}$/, 'e'.repeat(64)), snapshot: '20261007T115500Z-0a1b2c3d' };
  const broken = { ...w.row, key: w.row.key.replace(/f{64}$/, 'd'.repeat(64)), snapshot: 'not-a-time' };
  const macRequest = async (m, route, body) => (route.endsWith('/mine/manifests') ? { ok: true, data: { member: w.pair.member, manifests: [older, w.row, broken] } } : w.opts.macRequest(m, route, body));
  const r = await pr.listBackups({ ...w.opts, macRequest });
  assert.deepEqual(r.backups.map((b) => b.key), [w.row.key, older.key, broken.key]);
  assert.ok(r.backups[2].problem);
});

test('a recovery code still waiting here is told apart from one to enter', async () => {
  const w = await world();
  const r = await pr.listBackups({ ...w.opts, personalbackup: { restoreRecord: () => ({ state: 'needs-key', codeWaiting: true, rec: { org: { id: 'x' } } }) } });
  assert.equal(r.code, 'code_waiting');
  assert.deepEqual(require('./personalbackup').restoreRecord({ root: path.join(SANDBOX, 'nothing-here') }), { state: 'off', rec: null, codeWaiting: false });
});

test('a key that is not a string stops at once', async () => {
  assert.equal((await pr.restoreFiles({}, {})).code, 'no_such_backup');
});

test('a store that will not answer, a 5xx grant and a swapped manifest each say so, before any Kosmos', async () => {
  const w = await world();
  const made = allWorlds(w);
  const gone = await pr.restoreFiles({ key: w.row.key }, { ...w.opts, fetch: async () => new Response('', { status: 404 }) });
  assert.equal(gone.ok, false);
  assert.match(gone.because, /could not be fetched/);
  let tries = 0;
  const down = await pr.restoreFiles({ key: w.row.key }, { ...w.opts, macRequest: async (m, route, body) => {
    if (route.endsWith('/mine/read')) { tries += 1; return { ok: false, because: 'x', refusal: { status: 503 } }; }
    return w.opts.macRequest(m, route, body);
  } });
  assert.equal(down.ok, false);
  assert.ok(tries > 1, 'a 5xx is not a refusal: it is tried again');
  const swapped = await pr.restoreFiles({ key: w.row.key }, { ...w.opts, fetch: async () => new Response(Buffer.from('other')) });
  assert.match(swapped.because, /not the one Kosmos\+ recorded/);
  assert.equal(allWorlds(w), made);
});

test('a manifest key Kosmos+ could not have made stops before any grant', async () => {
  const w = await world();
  const bad = { ...w.row, key: `${w.pair.org}/${w.pair.member}/1/${PERIOD}/short` };
  const macRequest = async (m, route, body) => (route.endsWith('/mine/manifests') ? { ok: true, data: { member: w.pair.member, manifests: [bad] } } : w.opts.macRequest(m, route, body));
  const r = await pr.restoreFiles({ key: bad.key }, { ...w.opts, macRequest });
  assert.match(r.because, /could not have stored/);
  assert.equal(w.calls.filter((c) => c.route.endsWith('/mine/read')).length, 0);
});

test('a list cut on this computer says so, as one cut by Kosmos+ does', async () => {
  const w = await world();
  const many = Array.from({ length: 5001 }, (_, i) => ({ ...w.row, key: w.row.key.replace(/f{64}$/, String(i).padStart(64, '0')) }));
  const macRequest = async (m, route, body) => (route.endsWith('/mine/manifests') ? { ok: true, data: { member: w.pair.member, manifests: many } } : w.opts.macRequest(m, route, body));
  const r = await pr.listBackups({ ...w.opts, macRequest });
  assert.equal(r.more, true);
  assert.equal(r.backups.length, 5000);
});

test('a real run stopped by a refusal part way keeps what landed, its Kosmos and its record, and names what it has', async () => {
  const w = await world({ twoFiles: true });
  const real = require('./restorefetch');
  const one = { ...real, readGrantFetcher: (o) => real.readGrantFetcher({ ...o, grantKeys: 1 }) };
  let chunkReads = 0;
  const macRequest = async (m, route, body) => {
    if (route.endsWith('/mine/read') && body.keys.length) { chunkReads += 1; if (chunkReads > 1) return { ok: false, because: 'x', refusal: { status: 429 } }; }
    return w.opts.macRequest(m, route, body);
  };
  const r = await pr.restoreFiles({ key: w.row.key }, { ...w.opts, macRequest, restorefetch: one });
  assert.deepEqual([r.ok, r.partial, r.restored], [false, true, 1], JSON.stringify(r));
  assert.match(r.because, /as much as an hour allows/);
  assert.ok(r.world);
  assert.ok(r.details.failed.length >= 1, 'the file that did not come back is named');
  const dir = worlds.worldBaseDir(w.base, r.world);
  assert.equal(fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(require('./restoresink').RECORD_NAME)).length, 1);
});

test('a snapshot under an older key opens with that key, and a key not held is reported, not hidden', async () => {
  const w = await world();
  const old = memberkeys.readKeys(w.pair.org, w.pair.member).keys['1'];
  const held2 = backupkeys.newMemberKey();
  memberkeys.writeKeys(w.pair.org, w.pair.member, { 1: { sk: old.sk, pk: old.pk, registered: true }, 2: { sk: held2.sk, pk: held2.pk, registered: true } });
  const rowOf = (epoch, pkBytes) => ({ epoch, member_public: b64(pkBytes), wrap: b64(Buffer.from('w')), recovery_public: b64(Buffer.alloc(32, 1)), recovery_tag: 'ab'.repeat(32) });
  const third = backupkeys.newMemberKey();
  const asked = [];
  const macRequest = async (m, route, body) => {
    if (route === pk.MINE_ROUTE) return { ok: true, data: { ...w.pair, keys: [rowOf(1, old.pk), rowOf(2, held2.pk), rowOf(3, third.pk)] } };
    if (route.endsWith('/mine/manifests')) { asked.push(body.epoch); return { ok: true, data: { member: w.pair.member, manifests: body.epoch === 1 ? [w.row] : [] } }; }
    return w.opts.macRequest(m, route, body);
  };
  const list = await pr.listBackups({ ...w.opts, macRequest });
  assert.deepEqual(asked, [2, 1], 'newest key first, and never one this computer does not hold');
  assert.equal(list.keyMissing, true);
  const r = await pr.restoreFiles({ key: w.row.key }, { ...w.opts, macRequest });
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('another account\'s list, and each refusal, in this module\'s words', async () => {
  const w = await world();
  const say = (got) => async (m, route, body) => (route.endsWith('/mine/manifests') ? got : w.opts.macRequest(m, route, body));
  assert.match((await pr.listBackups({ ...w.opts, macRequest: say({ ok: true, data: { member: 'someone-else', manifests: [] } }) })).because, /another backup/);
  assert.match((await pr.listBackups({ ...w.opts, macRequest: say({ ok: false, because: 'raw', refusal: { status: 409, code: 'personal_backup_key_pending' } }) })).because, /not available from Kosmos\+/);
  assert.match((await pr.listBackups({ ...w.opts, macRequest: say({ ok: false, because: 'raw', refusal: { status: 403 } }) })).because, /not the one holding/);
  assert.match((await pr.listBackups({ ...w.opts, macRequest: say({ ok: false, because: 'raw' }) })).because, /could not be reached/);
  const older = await pr.restoreFiles({ key: 'x' }, { ...w.opts, macRequest: say({ ok: true, data: { member: w.pair.member, more: true, manifests: [] } }) });
  assert.match(older.because, /older than the ones Kosmos\+ lists/);
});

test('the real state check says on once this computer\'s key step is done', () => {
  const pb = require('./personalbackup');
  const rec = { org: { id: 'porg' }, world: 'w' };
  const root = fs.mkdtempSync(path.join(SANDBOX, 'gate-'));
  fs.writeFileSync(path.join(root, 'personal-key-ready'), JSON.stringify({ org: 'porg', world: 'w', keyOrg: 'porg', member: 'm' }));
  const orgenroll = { JOIN_UNKNOWN_FILE: 'join', LEAVE_PENDING_FILE: 'leave', readEnrollment: () => rec };
  assert.deepEqual(pb.restoreRecord({ root, orgenroll, personalbackupkey: { hasPendingCode: () => false } }), { state: 'on', rec, codeWaiting: false });
  assert.deepEqual(pb.restoreRecord({ root, orgenroll, personalbackupkey: { hasPendingCode: () => true } }), { state: 'needs-key', rec, codeWaiting: true });
});

test('files that landed keep their Kosmos, however the run ended', async () => {
  const w = await world();
  const stops = { ...require('./restorerun'), runRestore: async () => ({ ok: false, because: 'stopped', result: { restored: ['a'], failed: [] } }) };
  const r = await pr.restoreFiles({ key: w.row.key }, { ...w.opts, restorerun: stops });
  assert.deepEqual([r.partial, r.restored, !!r.world], [true, 1, true]);
});

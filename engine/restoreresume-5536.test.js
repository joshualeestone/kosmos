/**
 * kosmos#5536 slice 3: a restore that stopped part way continues where it stopped, into the same folder. The sink
 * keeps a record (engine/restoresink.js record/resume), a resumed root must hold only what the record names, and
 * restore skips what is already there (engine/backuprestore.js has(), engine/restorerun.js's plan). Real
 * filesystem, real snapshot; only the store, the coordinator and the clock are fakes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hpkeKeyPair } = require('./hpke');
const { namingKeyId } = require('./backupkeys');
const devkeyhist = require('./devkeyhist');
const snap = require('./backupsnapshot');
const rr = require('./restorerun');
const rf = require('./restorefetch');
const { createRestoreSink, RECORD_NAME } = require('./restoresink');

const NOW = Date.parse('2026-10-08T12:00:00Z');
const PERIOD = '2026-W41';
const LOCK = Date.parse('2026-11-11T00:15:00Z');
const SNAP_ID = '20261008T115500Z-0a1b2c3d';
const GRANTED = Math.floor(NOW / 1000);
const escrow = crypto.generateKeyPairSync('ed25519');
devkeyhist.setVerifyingKeyForTests(escrow.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32));
const rawPub = (k) => k.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const keyOf = () => `o1/m1/1/${PERIOD}/${crypto.randomBytes(32).toString('hex')}`;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/* A fresh root, as restoresink.test.js makes them (inside the profile on Windows). */
const insideHome = (dir) => {
  const rel = path.relative(fs.realpathSync.native(os.homedir()), fs.realpathSync.native(dir));
  return !(rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel));
};
const freshBase = process.platform === 'win32' && !insideHome(os.tmpdir()) ? os.homedir() : os.tmpdir();
const fresh = (t) => { const d = fs.mkdtempSync(path.join(freshBase, 'kosmos-resume-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

function history(entries, issuedAt) {
  const msg = devkeyhist.encodeHead('o1', 'm1', entries, issuedAt);
  return { org: 'o1', member: 'm1', entries, issuedAt, signature: crypto.sign(null, msg, escrow.privateKey).toString('base64url') };
}

/* A real snapshot of six files, with the coordinator's own key shape, kept in memory. */
async function oneSnapshot(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'krestoreresume-src-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'kosmos');
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  const files = {};
  for (let i = 1; i <= 6; i += 1) files[i % 2 ? `notes/n${i}.md` : `f${i}.txt`] = Buffer.from(`file number ${i}\n`.repeat(50 * i));
  for (const [rel, b] of Object.entries(files)) fs.writeFileSync(path.join(root, rel), b);
  const member = hpkeKeyPair(), nk = crypto.randomBytes(32), dev = crypto.generateKeyPairSync('ed25519');
  const objects = new Map();
  let manifestKey = null;
  const deps = {
    now: () => NOW,
    uploadChunks: async (d, batch) => {
      const keys = new Map(), lockedUntil = new Map();
      for (const { name, object } of batch) { const k = keyOf(); objects.set(k, Buffer.from(object)); keys.set(name, k); lockedUntil.set(name, LOCK); }
      return { ok: true, keys, lockedUntil, bucket: 'bucket/' };
    },
    uploadManifest: async (d, bytes) => { manifestKey = keyOf(); objects.set(manifestKey, Buffer.from(bytes)); return { ok: true, key: manifestKey, lockedUntilMs: LOCK }; },
  };
  const r = await snap.takeSnapshot({ root, memberPk: member.pk, namingKey: nk, namingKeyId: namingKeyId(nk), deviceKey: dev.privateKey,
    ctx: { org: 'o1', member: 'm1', epoch: '1', period: PERIOD, snapshot: SNAP_ID } }, deps);
  assert.equal(r.ok, true, r.because);
  const mb = objects.get(manifestKey);
  return { files, member, dev, objects, record: { key: manifestKey, period: PERIOD, snapshot: SNAP_ID, sha256: sha(mb), size: mb.length, granted_at: GRANTED } };
}

/* A coordinator applying the read route's rules, and a store behind it (as engine/restorefetch-5536.test.js). */
function world(objects, rec) {
  const w = { calls: [], gets: [], refuseChunksAfter: Infinity };
  const issued = new Map();
  let chunkGrants = 0;
  w.grant = async (body) => {
    w.calls.push(JSON.parse(JSON.stringify(body)));
    if (body.keys.length && ++chunkGrants > w.refuseChunksAfter) return { ok: false, because: 'no release' };
    const at = Math.floor(NOW / 1000) + 300;
    const url = (k) => { const u = `https://store.test/${k}?sig=${w.calls.length}`; issued.set(u, k); return u; };
    return { ok: true, answer: { member: body.member, epoch: body.epoch, expires_at: at,
      manifest: { key: rec.key, sha256: rec.sha256, size: rec.size, url: url(rec.key) }, objects: body.keys.map((k) => ({ key: k, url: url(k) })) } };
  };
  w.fetch = async (u) => {
    w.gets.push(u);
    const k = issued.get(u);
    if (w.dropKeys && w.dropKeys.has(k)) return new Response('', { status: 404 });
    const b = k && objects.get(k);
    return b ? new Response(b, { status: 200 }) : new Response('', { status: 404 });
  };
  return w;
}

const run = (s, w, sink) => {
  const f = rf.readGrantFetcher({ grant: w.grant, fetch: w.fetch, now: () => NOW, sleep: () => Promise.resolve(), org: 'o1', member: 'm1', epoch: 1, manifest: s.record });
  return rr.runRestore({ org: 'o1', member: 'm1', epoch: 1, manifest: s.record, memberSk: s.member.sk,
    history: history([{ kind: 'enrol', key: rawPub(s.dev.publicKey), at: GRANTED - 86400, backfill: false }], GRANTED + 60), now: GRANTED + 120,
    fetchObject: f.fetchObject, plan: f.plan, planned: f.planned, sink, maxTotalBytes: 2 ** 30 });
};

const onDisk = (root, files) => Object.entries(files).filter(([rel, b]) => {
  try { return fs.readFileSync(path.join(root, ...rel.split('/'))).equals(b); } catch { return false; }
}).map(([rel]) => rel).sort();

test('#5536 slice 3: a restore stopped part way continues into the same folder, fetching only what is still missing', async (t) => {
  const s = await oneSnapshot(t);
  const root = fresh(t);
  // Run 1: two files' chunks are missing at the store, so they fail; the rest restore and are recorded.
  const w1 = world(s.objects, s.record);
  const sink1 = createRestoreSink(root, { record: true });
  const all = [...s.objects.keys()].filter((k) => k !== s.record.key);
  w1.dropKeys = new Set(all.slice(0, 2));
  const r1 = await run(s, w1, sink1);
  sink1.close({ keepRecord: true });
  assert.equal(r1.ok, true, r1.because);
  assert.ok(r1.result.failed.length >= 1 && r1.result.restored.length >= 1, JSON.stringify(r1.result));
  assert.ok(fs.existsSync(path.join(root, RECORD_NAME)), 'kept for the resume');
  const first = onDisk(root, s.files);
  assert.deepEqual(first, [...r1.result.restored].sort());
  // Run 2: the same folder, resumed. Every file comes back, and only the missing files' chunks are asked for.
  const w2 = world(s.objects, s.record);
  const sink2 = createRestoreSink(root, { resume: true });
  for (const rel of first) assert.equal(sink2.has(rel, sha(s.files[rel]), s.files[rel].length), true, rel);
  const r2 = await run(s, w2, sink2);
  sink2.close();
  assert.equal(r2.ok, true, r2.because);
  assert.equal(r2.result.failed.length, 0, JSON.stringify(r2.result.failed));
  assert.equal(r2.result.alreadyHeld, first.length);
  assert.deepEqual(onDisk(root, s.files), Object.keys(s.files).sort());
  const fetched = w2.gets.map((u) => new URL(u).pathname.slice(1)).filter((k) => k !== s.record.key);
  const planned = w2.calls.flatMap((c) => c.keys);
  assert.ok(fetched.length > 0 && fetched.length < all.length, `${fetched.length} of ${all.length} chunks fetched again`);
  assert.deepEqual([...new Set(planned)].sort(), [...new Set(fetched)].sort(), 'planned exactly what was fetched: no grant for a held file');
  assert.equal(fs.existsSync(path.join(root, RECORD_NAME)), false, 'a finished restore leaves no record');
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.startsWith('.kosmos-restore-')), [], 'nor a temp folder');
});

/* A root a stopped restore left: files a.txt and d/b.txt committed through a recording sink, record kept. */
function stoppedRoot(t) {
  const root = fresh(t);
  const sink = createRestoreSink(root, { record: true });
  for (const [rel, text] of [['a.txt', 'alpha'], ['d/b.txt', 'beta']]) { const o = sink.begin(rel); o.write(Buffer.from(text)); o.commit(); }
  sink.close({ keepRecord: true });
  return root;
}

test('#5536 slice 3: a resumed folder must hold only what the record names; each change refuses, by name (control: untouched resumes)', (t) => {
  const ok = stoppedRoot(t);
  const control = createRestoreSink(ok, { resume: true });
  assert.equal(control.has('a.txt', sha(Buffer.from('alpha')), 5), true);
  assert.equal(control.has('d/b.txt', sha(Buffer.from('beta')), 4), true);
  assert.equal(control.has('a.txt', sha(Buffer.from('other')), 5), false, 'another content is not held');
  control.close();
  const cases = [
    ['a file added', (r) => fs.writeFileSync(path.join(r, 'planted.txt'), 'x'), /did not put there/],
    ['a folder added', (r) => fs.mkdirSync(path.join(r, 'extra')), /did not put there/],
    ['a file changed', (r) => fs.writeFileSync(path.join(r, 'a.txt'), 'ALPHA'), /has changed/],
    ['a file grown', (r) => fs.appendFileSync(path.join(r, 'd', 'b.txt'), '!'), /has changed/],
    ['a file replaced by a link', (r) => { fs.rmSync(path.join(r, 'a.txt')); fs.symlinkSync('/etc/hosts', path.join(r, 'a.txt')); }, /link the restore did not make/],
    ['a folder replaced by a link', (r) => { fs.rmSync(path.join(r, 'd'), { recursive: true }); fs.symlinkSync(os.tmpdir(), path.join(r, 'd'), 'junction'); }, /link the restore did not make/],
    ['the record removed', (r) => fs.rmSync(path.join(r, RECORD_NAME)), /no restore record/],
    ['the record damaged', (r) => fs.appendFileSync(path.join(r, RECORD_NAME), 'not json\n'), /damaged/],
    ['the record naming a path outside', (r) => fs.appendFileSync(path.join(r, RECORD_NAME), `${JSON.stringify({ path: '../x', size: 1, sha256: 'a'.repeat(64) })}\n`), /damaged/],
    ['the record naming the temp prefix', (r) => fs.appendFileSync(path.join(r, RECORD_NAME), `${JSON.stringify({ path: '.kosmos-restore-x/y', size: 1, sha256: 'a'.repeat(64) })}\n`), /damaged/],
  ];
  if (process.platform !== 'win32') {
    cases.push(['the record readable by others', (r) => fs.chmodSync(path.join(r, RECORD_NAME), 0o644), /not a private file/]);
    const elsewhere = fresh(t);
    cases.push(['the record a link', (r) => { const rec = path.join(r, RECORD_NAME); const moved = path.join(elsewhere, `${path.basename(r)}.record`); fs.renameSync(rec, moved); fs.symlinkSync(moved, rec); }, /no restore record/]);
  }
  for (const [label, change, why] of cases) {
    const r = stoppedRoot(t);
    change(r);
    assert.throws(() => createRestoreSink(r, { resume: true }), why, label);
  }
  // And a fresh sink still refuses a stopped root (it is not empty): resuming is only ever asked for.
  assert.throws(() => createRestoreSink(stoppedRoot(t)), /empty/);
});

test('#5536 slice 3: the record is written before each file is published, so a refused or interrupted commit never poisons a resume', (t) => {
  const root = fresh(t);
  const sink = createRestoreSink(root, { record: true });
  const o1 = sink.begin('a.txt'); o1.write(Buffer.from('first')); o1.commit();
  // The same name again (two manifest entries the collision check missed): refused, and the first file kept.
  const o2 = sink.begin('a.txt'); o2.write(Buffer.from('second'));
  assert.throws(() => o2.commit(), /EEXIST/);
  o2.abort();
  // A line for a file that never got published (as a crash between the record and the link would leave).
  fs.appendFileSync(path.join(root, RECORD_NAME), `${JSON.stringify({ path: 'gone/c.txt', size: 3, sha256: sha(Buffer.from('ccc')) })}\n`);
  sink.close({ keepRecord: true });
  const lines = fs.readFileSync(path.join(root, RECORD_NAME), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.path), ['a.txt', 'a.txt', 'gone/c.txt'], 'written before the link, refused or not');
  assert.equal(lines[0].sha256, sha(Buffer.from('first')), 'the hash of the bytes the sink wrote');
  const r = createRestoreSink(root, { resume: true });
  assert.equal(r.has('a.txt', sha(Buffer.from('first')), 5), true, 'the file on disk matches one of its lines');
  assert.equal(r.has('a.txt', sha(Buffer.from('second')), 6), false, 'not the refused one');
  assert.equal(r.has('gone/c.txt', sha(Buffer.from('ccc')), 3), false, 'an absent file is dropped, not held');
  const o3 = r.begin('gone/c.txt'); o3.write(Buffer.from('ccc')); o3.commit();
  r.close();
  assert.equal(fs.readFileSync(path.join(root, 'gone', 'c.txt'), 'utf8'), 'ccc');
});

test('#5536 slice 3: a stopped run\'s temp folder is cleared on resume, the record is private, and close keeps it only when asked', (t) => {
  const root = stoppedRoot(t);
  const stale = path.join(root, '.kosmos-restore-0123456789abcdef');
  fs.mkdirSync(stale, { mode: 0o700 });
  fs.writeFileSync(path.join(stale, 'half'), 'x');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(root, RECORD_NAME)).mode & 0o777, 0o600);
  const r = createRestoreSink(root, { resume: true });
  assert.equal(fs.existsSync(stale), false, 'cleared');
  r.close({ keepRecord: true });
  assert.ok(fs.existsSync(path.join(root, RECORD_NAME)), 'kept when asked');
  createRestoreSink(root, { resume: true }).close();
  assert.equal(fs.existsSync(path.join(root, RECORD_NAME)), false, 'removed by default');
  // Without record or resume the sink writes no record at all (every existing caller).
  const plain = fresh(t);
  const p = createRestoreSink(plain);
  const o = p.begin('x.txt'); o.write(Buffer.from('x')); o.commit();
  assert.equal(p.has('x.txt', sha(Buffer.from('x')), 1), false, 'a fresh sink holds nothing');
  p.close({ keepRecord: true });
  assert.deepEqual(fs.readdirSync(plain), ['x.txt']);
});

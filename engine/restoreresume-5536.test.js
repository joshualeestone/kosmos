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
const { createRestoreSink, RECORD_NAME, LOCK_NAME, setRecordMaxBytesForTests } = require('./restoresink');
const { spawnSync } = require('child_process');

const NOW = Date.parse('2026-10-08T12:00:00Z');
const PERIOD = '2026-W41';
const LOCK = Date.parse('2026-11-11T00:15:00Z');
const SNAP_ID = '20261008T115500Z-0a1b2c3d';
const GRANTED = Math.floor(NOW / 1000);
const SNAP = `${SNAP_ID} test-manifest`;   // what a caller names the restore by
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
  const sink1 = createRestoreSink(root, { record: true, snapshot: SNAP });
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
  const sink2 = createRestoreSink(root, { resume: true, snapshot: SNAP });
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
  const sink = createRestoreSink(root, { record: true, snapshot: SNAP });
  for (const [rel, text] of [['a.txt', 'alpha'], ['d/b.txt', 'beta']]) { const o = sink.begin(rel); o.write(Buffer.from(text)); o.commit(); }
  sink.close({ keepRecord: true });
  return root;
}

test('#5536 slice 3: a resumed folder must hold only what the record names; each change refuses, by name (control: untouched resumes)', (t) => {
  const ok = stoppedRoot(t);
  const control = createRestoreSink(ok, { resume: true, snapshot: SNAP });
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
    assert.throws(() => createRestoreSink(r, { resume: true, snapshot: SNAP }), why, label);
  }
  // And a fresh sink still refuses a stopped root (it is not empty): resuming is only ever asked for.
  assert.throws(() => createRestoreSink(stoppedRoot(t)), /empty/);
});

test('#5536 slice 3: the record is written before each file is published, so a refused or interrupted commit never poisons a resume', (t) => {
  const root = fresh(t);
  const sink = createRestoreSink(root, { record: true, snapshot: SNAP });
  const o1 = sink.begin('a.txt'); o1.write(Buffer.from('first')); o1.commit();
  // The same name again (two manifest entries the collision check missed): refused, and the first file kept.
  const o2 = sink.begin('a.txt'); o2.write(Buffer.from('second'));
  assert.throws(() => o2.commit(), /EEXIST/);
  o2.abort();
  // A line for a file that never got published (as a crash between the record and the link would leave).
  fs.appendFileSync(path.join(root, RECORD_NAME), `${JSON.stringify({ path: 'gone/c.txt', size: 3, sha256: sha(Buffer.from('ccc')) })}\n`);
  sink.close({ keepRecord: true });
  const lines = fs.readFileSync(path.join(root, RECORD_NAME), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines[0], { snapshot: SNAP }, 'the first line names the snapshot');
  assert.deepEqual(lines.slice(1).map((l) => l.path), ['a.txt', 'a.txt', 'gone/c.txt'], 'written before the link, refused or not');
  assert.equal(lines[1].sha256, sha(Buffer.from('first')), 'the hash of the bytes the sink wrote');
  const r = createRestoreSink(root, { resume: true, snapshot: SNAP });
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
  const r = createRestoreSink(root, { resume: true, snapshot: SNAP });
  assert.equal(fs.existsSync(stale), false, 'cleared');
  r.close({ keepRecord: true });
  assert.ok(fs.existsSync(path.join(root, RECORD_NAME)), 'kept when asked');
  createRestoreSink(root, { resume: true, snapshot: SNAP }).close();
  assert.equal(fs.existsSync(path.join(root, RECORD_NAME)), false, 'removed by default');
  // Without record or resume the sink writes no record at all (every existing caller).
  const plain = fresh(t);
  const p = createRestoreSink(plain);
  const o = p.begin('x.txt'); o.write(Buffer.from('x')); o.commit();
  assert.equal(p.has('x.txt', sha(Buffer.from('x')), 1), false, 'a fresh sink holds nothing');
  p.close({ keepRecord: true });
  assert.deepEqual(fs.readdirSync(plain), ['x.txt']);
});

test('#5536 slice 3 review 1: a record names its snapshot, and a resume of another snapshot refuses (control: the same one resumes)', (t) => {
  assert.throws(() => createRestoreSink(fresh(t), { record: true }), /must name its snapshot/);
  assert.throws(() => createRestoreSink(fresh(t), { resume: true }), /must name its snapshot/);
  const root = stoppedRoot(t);
  assert.throws(() => createRestoreSink(root, { resume: true, snapshot: 'another snapshot' }), /another backup/);
  createRestoreSink(root, { resume: true, snapshot: SNAP }).close();
  const noHead = stoppedRoot(t);
  const rec = path.join(noHead, RECORD_NAME);
  fs.writeFileSync(rec, fs.readFileSync(rec, 'utf8').split('\n').slice(1).join('\n'));
  assert.throws(() => createRestoreSink(noHead, { resume: true, snapshot: SNAP }), /damaged/, 'a record with no snapshot line');
  const long = stoppedRoot(t);
  fs.appendFileSync(path.join(long, RECORD_NAME), `${JSON.stringify({ path: 'a/'.repeat(2100) + 'b', size: 1, sha256: 'a'.repeat(64) })}\n`);
  assert.throws(() => createRestoreSink(long, { resume: true, snapshot: SNAP }), /damaged/, 'a path past 4096');
});

test('#5536 slice 3 review 1: names compare in NFC, so a name the filesystem stored in another form still resumes', (t) => {
  const root = fresh(t);
  const nfc = 'café.md', nfd = 'café.md';
  const sink = createRestoreSink(root, { record: true, snapshot: SNAP });
  const o = sink.begin(nfc); o.write(Buffer.from('coffee')); o.commit();
  sink.close({ keepRecord: true });
  // As HFS+ would hand it back: the same file under its NFD spelling.
  const [only] = fs.readdirSync(root).filter((n) => n !== RECORD_NAME);
  if (only === nfc) { fs.renameSync(path.join(root, nfc), path.join(root, `${nfd}.tmp`)); fs.renameSync(path.join(root, `${nfd}.tmp`), path.join(root, nfd)); }
  const r = createRestoreSink(root, { resume: true, snapshot: SNAP });
  assert.equal(r.has(nfc, sha(Buffer.from('coffee')), 6), true, 'found by its NFC name');
  assert.equal(r.has(nfd, sha(Buffer.from('coffee')), 6), true, 'and asked for in either form');
  r.close();
});

test('#5536 slice 3 review 1: a recorded file with a second name, or a file or folder open to others, refuses', { skip: process.platform === 'win32' && 'POSIX modes' }, (t) => {
  const hard = stoppedRoot(t);
  fs.linkSync(path.join(hard, 'a.txt'), path.join(fresh(t), 'elsewhere'));
  assert.throws(() => createRestoreSink(hard, { resume: true, snapshot: SNAP }), /another name/);
  const open = stoppedRoot(t);
  fs.chmodSync(path.join(open, 'a.txt'), 0o644);
  assert.throws(() => createRestoreSink(open, { resume: true, snapshot: SNAP }), /open to other users/);
  const dir = stoppedRoot(t);
  fs.chmodSync(path.join(dir, 'd'), 0o755);
  assert.throws(() => createRestoreSink(dir, { resume: true, snapshot: SNAP }), /open to other users/);
  createRestoreSink(stoppedRoot(t), { resume: true, snapshot: SNAP }).close();   // control
});

test('#5536 slice 3 review 1: a record that would pass its cap is dropped, and the sink says the restore cannot be continued', (t) => {
  setRecordMaxBytesForTests(400);
  try {
    const root = fresh(t);
    const sink = createRestoreSink(root, { record: true, snapshot: SNAP });
    for (let i = 0; i < 3; i += 1) { const o = sink.begin(`f${i}.txt`); o.write(Buffer.from('x')); o.commit(); }
    assert.equal(sink.recordLost, false, 'three lines fit');
    for (let i = 3; i < 6; i += 1) { const o = sink.begin(`f${i}.txt`); o.write(Buffer.from('x')); o.commit(); }
    assert.equal(sink.recordLost, true);
    sink.close({ keepRecord: true });
    assert.equal(fs.existsSync(path.join(root, RECORD_NAME)), false, 'no record a resume would refuse as too large');
    assert.equal(fs.readdirSync(root).filter((n) => /^f\d\.txt$/.test(n)).length, 6, 'the restore itself went on');
    assert.throws(() => createRestoreSink(root, { resume: true, snapshot: SNAP }), /no restore record/);
  } finally { setRecordMaxBytesForTests(256 * 1024 * 1024); }
});

test('#5536 slice 3 review 2: folders that differ only in case, one folder on this disk, still resume (skipped on a case-sensitive disk)', (t) => {
  const probe = fresh(t);
  fs.mkdirSync(path.join(probe, 'A'));
  if (!fs.existsSync(path.join(probe, 'a'))) { t.skip('a case-sensitive disk keeps A and a apart, so there is nothing to fold'); return; }
  const root = fresh(t);
  const sink = createRestoreSink(root, { record: true, snapshot: SNAP });
  for (const [rel, text] of [['A/x.txt', 'ex'], ['a/y.txt', 'why']]) { const o = sink.begin(rel); o.write(Buffer.from(text)); o.commit(); }
  sink.close({ keepRecord: true });
  const r = createRestoreSink(root, { resume: true, snapshot: SNAP });
  assert.equal(r.has('A/x.txt', sha(Buffer.from('ex')), 2), true);
  assert.equal(r.has('a/y.txt', sha(Buffer.from('why')), 3), true, 'found though the disk may spell it A/y.txt');
  r.close();
});

test('#5536 slice 3 review 2: a record whose last line was torn by a power cut still resumes, and the next line starts on its own', (t) => {
  const root = stoppedRoot(t);
  const rec = path.join(root, RECORD_NAME);
  fs.appendFileSync(rec, '{"path":"c.txt","si');
  const r = createRestoreSink(root, { resume: true, snapshot: SNAP });
  assert.equal(r.has('a.txt', sha(Buffer.from('alpha')), 5), true);
  const o = r.begin('c.txt'); o.write(Buffer.from('gamma')); o.commit();
  r.close({ keepRecord: true });
  const lines = fs.readFileSync(rec, 'utf8').split('\n').filter(Boolean);
  for (const l of lines) JSON.parse(l);   // every line whole: the torn one was cut back off
  assert.equal(JSON.parse(lines[lines.length - 1]).path, 'c.txt');
  createRestoreSink(root, { resume: true, snapshot: SNAP }).close();   // and it resumes again
});

test('#5536 slice 3 review 2: a short record write is finished, and a first line that fails leaves a fresh root empty', (t) => {
  const real = fs.writeSync;
  try {
    // Half of each record line at a time, as a write near a full disk may return.
    fs.writeSync = function (fd, buf, off, len, pos) {
      if (Buffer.isBuffer(buf) && buf.includes('"sha256"') && typeof len === 'number' && len > 8) return real.call(fs, fd, buf, off, Math.ceil(len / 2), pos);
      return real.apply(fs, arguments);
    };
    const root = fresh(t);
    const sink = createRestoreSink(root, { record: true, snapshot: SNAP });
    for (const rel of ['a.txt', 'b.txt']) { const o = sink.begin(rel); o.write(Buffer.from(rel)); o.commit(); }
    sink.close({ keepRecord: true });
    fs.writeSync = real;
    const lines = fs.readFileSync(path.join(root, RECORD_NAME), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(lines.slice(1).map((l) => l.path), ['a.txt', 'b.txt']);
    // The snapshot line's write fails: the sink refuses, and the root is as empty as it was given.
    fs.writeSync = function (fd, buf) {
      if (Buffer.isBuffer(buf) && buf.includes('"snapshot"')) { const e = new Error('no space'); e.code = 'ENOSPC'; throw e; }
      return real.apply(fs, arguments);
    };
    const empty = fresh(t);
    assert.throws(() => createRestoreSink(empty, { record: true, snapshot: SNAP }), /could not open the restore record \(ENOSPC\)/);
    assert.deepEqual(fs.readdirSync(empty), []);
  } finally { fs.writeSync = real; }
});

test('#5536 slice 3 review 2: two names that are one name in NFC refuse, where the disk can hold both (skipped where it cannot)', (t) => {
  const root = fresh(t);
  const sink = createRestoreSink(root, { record: true, snapshot: SNAP });
  const o = sink.begin('café.md'); o.write(Buffer.from('coffee')); o.commit();
  sink.close({ keepRecord: true });
  // A second entry spelled in NFD beside it: only a normalisation-sensitive disk (ext4, say) can hold both.
  try { fs.writeFileSync(path.join(root, 'café.md'), 'coffee', { flag: 'wx', mode: 0o600 }); } catch { t.skip('this disk holds one name for both forms'); return; }
  if (fs.readdirSync(root).filter((n) => n.normalize('NFC') === 'café.md').length < 2) { t.skip('this disk folded the two names'); return; }
  assert.throws(() => createRestoreSink(root, { resume: true, snapshot: SNAP }), /two names that are one name/);
});

test('#5536 slice 3 review 3: a record write that fails part way is cut back, so the next line is whole and the folder still resumes', (t) => {
  const real = fs.writeSync;
  const root = fresh(t);
  const sink = createRestoreSink(root, { record: true, snapshot: SNAP });
  const o1 = sink.begin('a.txt'); o1.write(Buffer.from('alpha')); o1.commit();
  let failNext = true;
  try {
    // A full disk: half of b.txt's line goes down, then the write fails.
    fs.writeSync = function (fd, buf, off, len, pos) {
      if (failNext && Buffer.isBuffer(buf) && buf.includes('"sha256"')) {
        failNext = false;
        real.call(fs, fd, buf, off, Math.ceil(len / 2), pos);
        const e = new Error('no space'); e.code = 'ENOSPC'; throw e;
      }
      return real.apply(fs, arguments);
    };
    const o2 = sink.begin('b.txt'); o2.write(Buffer.from('beta'));
    assert.throws(() => o2.commit(), /no space/);
    o2.abort();
  } finally { fs.writeSync = real; }
  assert.equal(fs.existsSync(path.join(root, 'b.txt')), false, 'not published without its line');
  const o3 = sink.begin('c.txt'); o3.write(Buffer.from('gamma')); o3.commit();
  sink.close({ keepRecord: true });
  const lines = fs.readFileSync(path.join(root, RECORD_NAME), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(lines.slice(1).map((l) => l.path), ['a.txt', 'c.txt']);
  const r = createRestoreSink(root, { resume: true, snapshot: SNAP });
  assert.equal(r.has('c.txt', sha(Buffer.from('gamma')), 5), true);
  r.close();
});

test('#5536 slice 3 review 3: Finder and Explorer metadata in a half-restored folder does not stop it continuing (control: other files still refuse)', (t) => {
  const root = stoppedRoot(t);
  // As a file browser writes them: the ordinary umask, 0644 (review 4: 0600 here could not fail on the real case).
  fs.writeFileSync(path.join(root, '.DS_Store'), 'finder', { mode: 0o644 });
  fs.writeFileSync(path.join(root, 'd', 'Thumbs.db'), 'thumbs', { mode: 0o644 });
  fs.writeFileSync(path.join(root, 'd', 'desktop.ini'), 'ini', { mode: 0o644 });
  if (process.platform !== 'win32') for (const f of ['.DS_Store', 'd/Thumbs.db', 'd/desktop.ini']) fs.chmodSync(path.join(root, f), 0o644);
  createRestoreSink(root, { resume: true, snapshot: SNAP }).close({ keepRecord: true });
  assert.ok(fs.existsSync(path.join(root, '.DS_Store')), 'left where it was');
  fs.writeFileSync(path.join(root, 'd', 'notes.txt'), 'planted', { mode: 0o600 });
  assert.throws(() => createRestoreSink(root, { resume: true, snapshot: SNAP }), /did not put there/);
});

test('#5536 slice 3 review 3: one recording sink per folder at a time; a lock left by a process that is gone is taken over', (t) => {
  const root = stoppedRoot(t);
  const first = createRestoreSink(root, { resume: true, snapshot: SNAP });
  assert.throws(() => createRestoreSink(root, { resume: true, snapshot: SNAP }), /already running; wait for it to finish/);
  const o = first.begin('later.txt'); o.write(Buffer.from('still mine')); o.commit();   // the first sink was not disturbed
  first.close({ keepRecord: true });
  assert.equal(fs.existsSync(path.join(root, LOCK_NAME)), false, 'released at close');
  // Another process that is alive holds it (this one's parent stands in): refused, by name.
  fs.writeFileSync(path.join(root, LOCK_NAME), `${process.ppid}\n`, { mode: 0o600 });
  assert.throws(() => createRestoreSink(root, { resume: true, snapshot: SNAP }), /already running; wait for it to finish/);
  // A crash: the lock names a process that has exited.
  const gone = spawnSync(process.execPath, ['-e', '0']).pid;
  fs.writeFileSync(path.join(root, LOCK_NAME), `${gone}\n`, { mode: 0o600 });
  const r = createRestoreSink(root, { resume: true, snapshot: SNAP });
  assert.equal(r.has('later.txt', sha(Buffer.from('still mine')), 10), true);
  r.close();
  // A refused resume releases the lock it took.
  const other = stoppedRoot(t);
  assert.throws(() => createRestoreSink(other, { resume: true, snapshot: 'another snapshot' }), /another backup/);
  assert.equal(fs.existsSync(path.join(other, LOCK_NAME)), false);
  // And a sink with no record takes no lock (every existing caller).
  const plain = fresh(t);
  const p = createRestoreSink(plain);
  assert.equal(fs.existsSync(path.join(plain, LOCK_NAME)), false);
  p.close();
});

test('#5536 slice 3 review 3: the record is cut back by bytes, so a damaged byte earlier in it does not move the cut', (t) => {
  const root = stoppedRoot(t);
  const rec = path.join(root, RECORD_NAME);
  // A line holding a byte that is not UTF-8 (it decodes to three), then a torn tail.
  fs.appendFileSync(rec, Buffer.concat([Buffer.from('{"path":"x'), Buffer.from([0xff]), Buffer.from('y.txt","size":1,"sha256":"' + 'a'.repeat(64) + '"}\n{"path":"torn')]));
  const r = createRestoreSink(root, { resume: true, snapshot: SNAP });
  const o = r.begin('n.txt'); o.write(Buffer.from('new')); o.commit();
  r.close({ keepRecord: true });
  const raw = fs.readFileSync(rec);
  const tail = raw.subarray(raw.lastIndexOf(0x0a, raw.length - 2) + 1).toString('utf8');
  assert.equal(JSON.parse(tail).path, 'n.txt', 'the new line starts on its own line, not inside the damaged one');
  createRestoreSink(root, { resume: true, snapshot: SNAP }).close();
});

test('#5536 slice 3 review 4: a .DS_Store the backup held that Finder then rewrote is not held, and the resume goes on', (t) => {
  const root = fresh(t);
  const sink = createRestoreSink(root, { record: true, snapshot: SNAP });
  for (const [rel, text] of [['d/.DS_Store', 'from the backup'], ['d/k.txt', 'kept']]) { const o = sink.begin(rel); o.write(Buffer.from(text)); o.commit(); }
  sink.close({ keepRecord: true });
  // Finder replaces it with its own, at its own mode.
  fs.rmSync(path.join(root, 'd', '.DS_Store'));
  fs.writeFileSync(path.join(root, 'd', '.DS_Store'), 'finder wrote this', { mode: 0o644 });
  const r = createRestoreSink(root, { resume: true, snapshot: SNAP });
  assert.equal(r.has('d/.DS_Store', sha(Buffer.from('from the backup')), 15), false, 'not held: restore will try it and report it');
  assert.equal(r.has('d/k.txt', sha(Buffer.from('kept')), 4), true);
  r.close({ keepRecord: true });
  // Rewritten at 0600 (a stricter umask): it reaches the hash check, and is still only not held.
  fs.rmSync(path.join(root, 'd', '.DS_Store'));
  fs.writeFileSync(path.join(root, 'd', '.DS_Store'), 'finder again', { mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(path.join(root, 'd', '.DS_Store'), 0o600);
  const r2 = createRestoreSink(root, { resume: true, snapshot: SNAP });
  assert.equal(r2.has('d/.DS_Store', sha(Buffer.from('from the backup')), 15), false);
  r2.close({ keepRecord: true });
  // Any other recorded file rewritten still refuses (control).
  fs.writeFileSync(path.join(root, 'd', 'k.txt'), 'changed');
  assert.throws(() => createRestoreSink(root, { resume: true, snapshot: SNAP }), /has changed/);
});

test('#5536 slice 3 review 4: a lock this process left open says so, and a lock that cannot be written does not stay behind', (t) => {
  const root = stoppedRoot(t);
  const open = createRestoreSink(root, { resume: true, snapshot: SNAP });
  assert.throws(() => createRestoreSink(root, { resume: true, snapshot: SNAP }), /already running; wait for it to finish/);
  open.close({ keepRecord: true });
  // A lock of this thread whose token no open sink holds (a sink that was never closed and is gone): stale.
  const { threadId } = require('worker_threads');
  fs.writeFileSync(path.join(root, LOCK_NAME), `${process.pid} ${threadId} ${'0'.repeat(24)}\n`, { mode: 0o600 });
  createRestoreSink(root, { resume: true, snapshot: SNAP }).close({ keepRecord: true });
  // An empty lock (one caught before it was written, in the old scheme): busy while new, stale once old.
  fs.writeFileSync(path.join(root, LOCK_NAME), '', { mode: 0o600 });
  assert.throws(() => createRestoreSink(root, { resume: true, snapshot: SNAP }), /already running; wait for it to finish/);
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(path.join(root, LOCK_NAME), old, old);
  createRestoreSink(root, { resume: true, snapshot: SNAP }).close({ keepRecord: true });
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.startsWith(LOCK_NAME)), [], 'no lock and no pending lock left');
  const real = fs.writeSync;
  try {
    fs.writeSync = function (fd, buf) {
      if (typeof buf === 'string' && buf.startsWith(`${process.pid} `)) { const e = new Error('no space'); e.code = 'ENOSPC'; throw e; }
      return real.apply(fs, arguments);
    };
    const empty = fresh(t);
    assert.throws(() => createRestoreSink(empty, { record: true, snapshot: SNAP }), /restore lock \(ENOSPC\)/);
    assert.deepEqual(fs.readdirSync(empty), [], 'the fresh folder is left as given');
  } finally { fs.writeSync = real; }
});

test('#5536 slice 3 review 5: a pending lock a crash left is cleared, and close releases the lock even when its cleanup fails', (t) => {
  const root = stoppedRoot(t);
  fs.writeFileSync(path.join(root, `${LOCK_NAME}.0123456789abcdef01234567`), '1 0 x\n', { mode: 0o600 });
  createRestoreSink(root, { resume: true, snapshot: SNAP }).close({ keepRecord: true });
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.startsWith(LOCK_NAME)), []);
  const sink = createRestoreSink(root, { resume: true, snapshot: SNAP });
  const real = fs.rmSync;
  try {
    // The temp folder cannot be removed (as an open handle on Windows does): close throws, and still releases the lock.
    fs.rmSync = function (p, o) { if (typeof p === 'string' && path.basename(p).startsWith('.kosmos-restore-') && !path.basename(p).startsWith(LOCK_NAME) && path.basename(p) !== RECORD_NAME) { const e = new Error('busy'); e.code = 'EBUSY'; throw e; } return real.call(fs, p, o); };
    assert.throws(() => sink.close({ keepRecord: true }), /busy/);
  } finally { fs.rmSync = real; }
  assert.equal(fs.existsSync(path.join(root, LOCK_NAME)), false, 'released');
  createRestoreSink(root, { resume: true, snapshot: SNAP }).close();
});

test('#5536 slice 3 review 6: a lock a crash left with its pending second name is taken over, and another name does not matter', (t) => {
  const root = stoppedRoot(t);
  const lockFile = path.join(root, LOCK_NAME);
  const dead = spawnSync(process.execPath, ['-e', '0']).pid;
  const tok = 'b'.repeat(24);
  fs.writeFileSync(`${lockFile}.${tok}`, `${dead} 0 ${tok}\n`, { mode: 0o600 });
  fs.linkSync(`${lockFile}.${tok}`, lockFile);   // the crash: linked, pending not yet removed
  const r = createRestoreSink(root, { resume: true, snapshot: SNAP });
  r.close({ keepRecord: true });
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.startsWith(LOCK_NAME)), [], 'both names cleared');
  // A second name made elsewhere does not matter (review 7: only the owner identity in it is used): a dead owner's
  // lock is still taken over.
  fs.writeFileSync(lockFile, `${dead} 0 ${tok}\n`, { mode: 0o600 });
  fs.linkSync(lockFile, path.join(fresh(t), 'elsewhere'));
  createRestoreSink(root, { resume: true, snapshot: SNAP }).close({ keepRecord: true });
});

test('#5536 slice 3 review 6: a lock written before this computer last started is stale, even if its pid is alive again', (t) => {
  const root = stoppedRoot(t);
  const lockFile = path.join(root, LOCK_NAME);
  // A live pid (this process's parent), but the lock dates from before the boot: the pid is someone else's now.
  fs.writeFileSync(lockFile, `${process.ppid} 0 ${'c'.repeat(24)}\n`, { mode: 0o600 });
  const beforeBoot = new Date(Date.now() - os.uptime() * 1000 - 60000);
  fs.utimesSync(lockFile, beforeBoot, beforeBoot);
  createRestoreSink(root, { resume: true, snapshot: SNAP }).close({ keepRecord: true });
  // Control: the same lock written since the boot is busy.
  fs.writeFileSync(lockFile, `${process.ppid} 0 ${'c'.repeat(24)}\n`, { mode: 0o600 });
  assert.throws(() => createRestoreSink(root, { resume: true, snapshot: SNAP }), /already running; wait for it to finish/);
});

test('#5536 slice 3 review 7: an owner is its pid AND its start time, so a reused pid is not the owner (POSIX)', { skip: process.platform === 'win32' && 'no cheap start time on Windows (stated)' }, (t) => {
  const root = stoppedRoot(t);
  const lockFile = path.join(root, LOCK_NAME);
  // As the sink reads it: Linux from /proc, elsewhere ps in a fixed locale and time zone.
  const startOf = (pid) => {
    if (process.platform === 'linux') {
      const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      return `linux ${fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()} ${st.slice(st.lastIndexOf(')') + 2).split(' ')[19]}`;
    }
    return spawnSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', env: { LC_ALL: 'C', LANG: 'C', TZ: 'UTC0', PATH: '/bin:/usr/bin' } }).stdout.trim();
  };
  const parentStart = startOf(process.ppid);
  assert.ok(parentStart, 'ps reads a start time here');
  // The live parent with its own start time: busy.
  fs.writeFileSync(lockFile, `${process.ppid} 0 ${'d'.repeat(24)} ${parentStart}\n`, { mode: 0o600 });
  assert.throws(() => createRestoreSink(root, { resume: true, snapshot: SNAP }), /already running; wait for it to finish/);
  // The same live pid with another start time: some other process now has that pid, so the lock is stale.
  fs.writeFileSync(lockFile, `${process.ppid} 0 ${'d'.repeat(24)} Mon Jan  1 00:00:00 2001\n`, { mode: 0o600 });
  createRestoreSink(root, { resume: true, snapshot: SNAP }).close({ keepRecord: true });
  // And a lock this sink writes carries its own start time.
  const s2 = createRestoreSink(root, { resume: true, snapshot: SNAP });
  assert.ok(fs.readFileSync(lockFile, 'utf8').trim().endsWith(startOf(process.pid)), 'the start time is in the lock');
  s2.close({ keepRecord: true });
});

test('#5536 slice 3 review 8: a live owner in another time zone and language is still the owner (POSIX)', { skip: process.platform === 'win32' && 'POSIX start time', timeout: 30000 }, async (t) => {
  const root = stoppedRoot(t);
  const { spawn } = require('child_process');
  // A second Kosmos, started with other settings, holds a resumed sink of this folder open.
  const code = `const { createRestoreSink } = require(${JSON.stringify(path.join(__dirname, 'restoresink'))});
    const s = createRestoreSink(${JSON.stringify(root)}, { resume: true, snapshot: ${JSON.stringify(SNAP)} });
    process.stdout.write('ready\\n'); setTimeout(() => { s.close({ keepRecord: true }); }, 4000);`;
  const child = spawn(process.execPath, ['-e', code], { env: Object.assign({}, process.env, { TZ: 'Asia/Tokyo', LC_ALL: 'fr_FR.UTF-8', LANG: 'fr_FR.UTF-8' }), stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => { try { child.kill(); } catch { /* gone */ } });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('ready')) resolve(); });
    child.on('exit', (c) => reject(new Error(`the holder exited first (${c})`)));
  });
  // This process, in its own settings: busy, not stale.
  assert.throws(() => createRestoreSink(root, { resume: true, snapshot: SNAP }), /already running; wait for it to finish/);
  await new Promise((resolve) => child.on('exit', resolve));
  createRestoreSink(root, { resume: true, snapshot: SNAP }).close({ keepRecord: true });   // and free once it closed
});

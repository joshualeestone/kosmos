/**
 * kosmos#5536 (E0.7) step 3: engine/restoresink.js meets each sink duty engine/backuprestore.js states, measured on
 * the real filesystem. Each refusal has a working control.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createRestoreSink, isPrivateGroup } = require('./restoresink');
const bf = require('./backupformat');
const { hpkeKeyPair } = require('./hpke');
const br = require('./backuprestore');

/* Tests that replace fs or process functions restore them in finally, and rely on node:test running this file's
   tests one at a time. */
/* A fresh root. On Windows the sink needs one inside the user's profile, so a TEMP outside it (C:\\Windows\\Temp, a TEMP
   on another drive) falls back to the profile; elsewhere the temp folder is fine. */
const insideHome = (dir) => {
  const rel = path.relative(fs.realpathSync.native(os.homedir()), fs.realpathSync.native(dir));
  return !(rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel));
};
const freshBase = process.platform === 'win32' && !insideHome(os.tmpdir()) ? os.homedir() : os.tmpdir();
const fresh = (t) => { const d = fs.mkdtempSync(path.join(freshBase, 'kosmos-sink-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const listAll = (d) => fs.readdirSync(d, { recursive: true }).sort();
/* The temp folder's contents, waited for on Windows: the sink's own cleanup of a just-written file can lose a moment
   to Defender or the indexer there, and leaves the rest to close(). */
const tempContents = (d) => {
  const temp = fs.readdirSync(d).find((n) => n.startsWith('.kosmos-restore-'));
  for (let i = 0; ; i++) {
    const left = fs.readdirSync(path.join(d, temp));
    if (!left.length || process.platform !== 'win32' || i >= 20) return left;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
};
/* A link to a folder: a junction on Windows (no privilege needed, so the realistic attacker), a symlink elsewhere
   (the type is ignored off Windows). */
const linkFolder = (target, at) => fs.symlinkSync(target, at, 'junction');

test('#5536 sink: the root must be a fresh, real, absolute folder (control: an empty folder is accepted)', (t) => {
  const d = fresh(t);
  assert.throws(() => createRestoreSink('relative/dir'), /absolute/);
  const full = fresh(t); fs.writeFileSync(path.join(full, 'x'), 'x');
  assert.throws(() => createRestoreSink(full), /empty/);
  const link = path.join(fresh(t), 'link');
  linkFolder(d, link);
  assert.throws(() => createRestoreSink(link), /real folder/);
  assert.throws(() => createRestoreSink(link + path.sep), /real folder/, 'a trailing separator does not get a symlinked root past the check');
  if (process.platform !== 'win32') {
    const open = fresh(t); fs.chmodSync(open, 0o777);
    assert.throws(() => createRestoreSink(open), /not be writable by other users/, 'a root other users can write in is refused');
    assert.deepEqual(fs.readdirSync(open), [], 'and the probe left nothing behind');
    fs.chmodSync(open, 0o775);
    createRestoreSink(open).close();  // CONTROL: group-writable is accepted...
    assert.equal(fs.statSync(open).mode & 0o777, 0o700, '...and made 0700, so a shared group (macOS staff) cannot write in it');
    const realGetuid = process.getuid;
    process.getuid = () => realGetuid() + 1;
    try { assert.throws(() => createRestoreSink(fresh(t)), /a folder you own/, 'a folder owned by someone else is refused'); } finally { process.getuid = realGetuid; }
    // Something planted while the root was still group-writable, before the chmod, refuses.
    const planted = fresh(t); fs.chmodSync(planted, 0o775);
    const realChmod0 = fs.chmodSync;
    fs.chmodSync = (p2, m) => { realChmod0(p2, m); if (p2 === fs.realpathSync.native(planted)) fs.mkdirSync(path.join(planted, 'agents'), { mode: 0o777 }); };
    try { assert.throws(() => createRestoreSink(planted), /appeared in the root/); } finally { fs.chmodSync = realChmod0; }
    // A drive that reports success but ignores the permission change (a CIFS dynperm or FUSE mount): the mode is read
    // back, and a root still group-writable is refused (#5536, E0.7 review round 19).
    const ignored = fresh(t); fs.chmodSync(ignored, 0o775);
    const realChmod1 = fs.chmodSync;
    fs.chmodSync = (p2, m) => { if (p2 !== fs.realpathSync.native(ignored)) realChmod1(p2, m); };   // a silent no-op on the root
    try { assert.throws(() => createRestoreSink(ignored), /could not be made private \(the drive ignored/); } finally { fs.chmodSync = realChmod1; }
    assert.deepEqual(fs.readdirSync(ignored), [], 'nothing (no temp folder, no probe) was written into a root never made private');
    // A folder in the root that belongs to someone else is not written into.
    const own = fresh(t), so = createRestoreSink(own);
    const first = so.begin('shared/a.md'); first.write(Buffer.from('a')); first.commit();
    const realUid = process.getuid;
    process.getuid = () => realUid() + 1;
    let second;
    try { second = so.begin('shared/b.md'); second.write(Buffer.from('b')); assert.throws(() => second.commit(), /belongs to another user/); } finally { process.getuid = realUid; }
    second.abort(); so.close();
    // The probe never writes through a name that is already there (a swapped-in link to someone's file).
    const pr = fresh(t), realMkdir = fs.mkdirSync;
    fs.mkdirSync = (dir, o) => { realMkdir(dir, o); if (path.basename(dir).startsWith('.kosmos-restore-')) fs.writeFileSync(path.join(dir, 'probe'), 'important'); };
    try { assert.throws(() => createRestoreSink(pr), /cannot write in the restore folder \(EEXIST\)/); } finally { fs.mkdirSync = realMkdir; }
    // The resolved root must be the folder just checked: a swap between the two reads refuses.
    const checked = fresh(t), elsewhere = fresh(t), realNative = fs.realpathSync.native;
    fs.realpathSync.native = (p2) => (p2 === checked ? elsewhere : realNative(p2));
    try { assert.throws(() => createRestoreSink(checked), /changed while it was being checked/); } finally { fs.realpathSync.native = realNative; }
    // A parent other users can write in (not sticky) could swap the root itself.
    const parent = fresh(t); fs.chmodSync(parent, 0o777);
    const child = path.join(parent, 'r'); fs.mkdirSync(child, { mode: 0o700 });
    assert.throws(() => createRestoreSink(child), /lets other users replace it/);
    fs.chmodSync(parent, 0o775);
    // A shared group (macOS staff), stated rather than read from this host, whose own groups may be private.
    const realRead0 = fs.readFileSync;
    fs.readFileSync = (f, ...rest) => (f === '/etc/group' ? 'staff:x:20:alice,bob\n' : realRead0(f, ...rest));
    try { assert.throws(() => createRestoreSink(child), /lets other users replace it/, 'group write on a parent (macOS staff) too'); } finally { fs.readFileSync = realRead0; }
    // ...unless that group is the user's private group (Linux user-private groups with umask 002).
    const pgid = fs.statSync(parent).gid, realGetgid = process.getgid, realRead = fs.readFileSync;
    process.getgid = () => pgid;
    fs.readFileSync = (f, ...rest) => (f === '/etc/group' ? `${os.userInfo().username}:x:${pgid}:\n` : realRead(f, ...rest));
    try { createRestoreSink(child).close(); } finally { process.getgid = realGetgid; fs.readFileSync = realRead; }
    fs.chmodSync(child, 0o700);
    fs.chmodSync(parent, 0o1777);
    createRestoreSink(child).close();  // CONTROL: a sticky shared parent (as /tmp is) cannot have the root swapped
    fs.chmodSync(parent, 0o700);
    // A folder further up counts too: a grandparent others can write in could swap the whole tree.
    const grand = fresh(t), mid = path.join(grand, 'mid'), deepRoot = path.join(mid, 'r');
    fs.mkdirSync(mid, { mode: 0o700 }); fs.mkdirSync(deepRoot, { mode: 0o700 }); fs.chmodSync(grand, 0o777);
    assert.throws(() => createRestoreSink(deepRoot), /lets other users replace it/);
    fs.chmodSync(grand, 0o700);
    // A folder above the root owned by someone else (not root) refuses, whatever its mode.
    const realStat = fs.statSync, theirs = fs.realpathSync.native(grand);
    fs.statSync = (p2, o) => { const r = realStat(p2, o); if (p2 === theirs) return Object.assign(Object.create(Object.getPrototypeOf(r)), r, { uid: 54321 }); return r; };
    try { assert.throws(() => createRestoreSink(deepRoot), /belongs to another user/, 'an ancestor owned by another user'); } finally { fs.statSync = realStat; }
    const priv = fresh(t), realChmod = fs.chmodSync;
    fs.chmodSync = () => { const e = new Error('not permitted'); e.code = 'EPERM'; throw e; };
    try { assert.throws(() => createRestoreSink(priv), /could not make the root private \(EPERM\)/); } finally { fs.chmodSync = realChmod; }
    assert.deepEqual(fs.readdirSync(priv), [], 'and nothing was made in the root before it was private');
  }
  const s = createRestoreSink(d);
  s.close();
  assert.deepEqual(fs.readdirSync(d), [], 'CONTROL: accepted, and close leaves the folder as it found it');
});

test('#5536 sink: bytes never sit at the final path before commit, and an abort leaves nothing', (t) => {
  const d = fresh(t), s = createRestoreSink(d);
  const out = s.begin('agents/a/memory.md');
  out.write(Buffer.from('half'));
  assert.equal(fs.existsSync(path.join(d, 'agents/a/memory.md')), false, 'nothing at the final path while writing');
  out.write(Buffer.from(' and the rest'));
  out.commit();
  assert.equal(fs.readFileSync(path.join(d, 'agents/a/memory.md'), 'utf8'), 'half and the rest');
  // Windows has no POSIX modes (it reports 0o666 for a writable file), so the mode is checked where modes exist.
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(path.join(d, 'agents/a/memory.md')).mode & 0o777, 0o600, 'private by default');
    assert.equal(fs.statSync(path.join(d, 'agents/a')).mode & 0o777, 0o700, 'folders too');
  }
  const gone = s.begin('agents/a/notes.md');
  gone.write(Buffer.from('never'));
  gone.abort();
  assert.deepEqual(tempContents(d), [], 'an abort removes its temp file at once, not only at close');
  s.close();
  assert.deepEqual(listAll(d), ['agents', 'agents/a', 'agents/a/memory.md'].map((p) => p.split('/').join(path.sep)), 'the aborted file and the temp folder are gone');
});

test('#5536 sink: commit never replaces a name already there, and the first file is untouched', (t) => {
  const d = fresh(t), s = createRestoreSink(d);
  const a = s.begin('Readme.md'); a.write(Buffer.from('first')); a.commit();
  assert.throws(() => a.commit(), /already committed or aborted/, 'a second commit is refused clearly');
  assert.throws(() => a.write(Buffer.from('more')), /already committed or aborted/, 'so is a write after it');
  const b = s.begin('Readme.md'); b.write(Buffer.from('second'));
  assert.throws(() => b.commit(), /EEXIST/);
  b.abort();
  assert.equal(fs.readFileSync(path.join(d, 'Readme.md'), 'utf8'), 'first');
  // On a case-insensitive volume (the macOS default) a case variant is the same name and is refused too.
  const caseInsensitive = fs.existsSync(path.join(d, 'README.md'));
  const c = s.begin('README.md'); c.write(Buffer.from('third'));
  if (caseInsensitive) assert.throws(() => c.commit(), /EEXIST/);
  else c.commit();
  c.abort();
  assert.equal(fs.readFileSync(path.join(d, 'Readme.md'), 'utf8'), 'first', 'CONTROL either way: the first file is never replaced');
  s.close();
});

test('#5536 sink: a symlink placed in the root cannot carry a file outside it (control: a real folder works)', (t) => {
  const d = fresh(t), outside = fresh(t), s = createRestoreSink(d);
  linkFolder(outside, path.join(d, 'evil'));
  const deep = s.begin('evil/sub/deeper/x.md'); deep.write(Buffer.from('x'));
  assert.throws(() => deep.commit(), /outside the root/);
  deep.abort();
  // A link already in place where a folder will be made is refused at commit (begin makes no folders).
  const out = s.begin('ok/y.md'); out.write(Buffer.from('y'));
  linkFolder(outside, path.join(d, 'ok'));
  assert.throws(() => out.commit(), /outside the root/);
  out.abort();
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing, not even a folder, was made outside the root');
  const fine = s.begin('real/z.md'); fine.write(Buffer.from('z')); fine.commit();
  assert.equal(fs.readFileSync(path.join(d, 'real/z.md'), 'utf8'), 'z', 'CONTROL');
  s.close();
});

test('#5536 sink: refuses paths that are not plain, and its own temp folder (control: a fullwidth name stays literal)', (t) => {
  const d = fresh(t), s = createRestoreSink(d);
  for (const bad of ['', '/abs', 'a//b', '.', 'a/./b', '../x', 'a/..', 'a\\b', 'n\0ul', 'a:b', 'tab\tx', 'trail.', 'trail ', 'KOSMOS~1/x.md', 'a/PROGRA~1/b']) assert.throws(() => s.begin(bad), /plain relative/, JSON.stringify(bad));
  const temp = fs.readdirSync(d).find((n) => n.startsWith('.kosmos-restore-'));
  assert.ok(temp, 'the temp folder exists while the sink is open');
  assert.throws(() => s.begin(`${temp}/x`), /temp folder/);
  assert.throws(() => s.begin(`${temp.toUpperCase()}/x`), /temp folder/, 'the same name on a case-insensitive volume');
  const w = s.begin('．．/x.md'); w.write(Buffer.from('w')); w.commit();
  assert.equal(fs.readFileSync(path.join(d, '．．', 'x.md'), 'utf8'), 'w', 'a fullwidth dot name is a folder of that name, not a parent');
  s.close();
});

test('#5536 sink: restoreSnapshot through the real sink restores byte for byte and leaves no trace of a bad file', async (t) => {
  const member = hpkeKeyPair(), nk = crypto.randomBytes(32), dev = crypto.generateKeyPairSync('ed25519');
  const ctx = { org: 'o', member: 'm', epoch: 'e', period: 'p', snapshot: 's' };
  const store = new Map();
  const entry = (p, data) => {
    const chunks = bf.chunkBuffer(data, { min: 512, avg: 2048, max: 8192 }).map((c) => { const { name, object } = bf.sealNamedChunk(member.pk, nk, c); store.set(name, object); return name; });
    return { path: p, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), chunks };
  };
  const good = crypto.randomBytes(30000), bad = crypto.randomBytes(5000);
  const files = [entry('agents/a/memory.md', good), entry('agents/a/bad.md', bad)];
  const badChunk = files[1].chunks[0];
  const m = bf.sealManifest(member.pk, dev.privateKey, ctx, { files });
  const d = fresh(t), sink = createRestoreSink(d);
  const r = await br.restoreSnapshot({ memberSk: member.sk, namingKey: nk, devicePubAtSnapshot: dev.publicKey, ctx, manifestObject: m,
    fetchChunk: (n) => (n === badChunk ? store.get(files[0].chunks[0]) : store.get(n)), sink, maxTotalBytes: 2 ** 30 });
  sink.close();
  assert.deepEqual(r.restored, ['agents/a/memory.md']);
  assert.equal(r.failed[0].path, 'agents/a/bad.md');
  assert.ok(fs.readFileSync(path.join(d, 'agents/a/memory.md')).equals(good), 'byte for byte on disk');
  assert.deepEqual(listAll(d), ['agents', 'agents/a', 'agents/a/memory.md'].map((p) => p.split('/').join(path.sep)), 'no half file, no temp folder');
});

test('#5536 sink: folders are made only at commit, a failed file leaves none, and a case-variant folder still works', (t) => {
  const d = fresh(t), s = createRestoreSink(d);
  const bad = s.begin('lonely/deep/f.md'); bad.write(Buffer.from('half'));
  assert.equal(fs.existsSync(path.join(d, 'lonely')), false, 'begin makes no folders');
  bad.abort();
  const a = s.begin('x/a.md'); a.write(Buffer.from('a')); a.commit();
  const dup = s.begin('x/y/z.md'); dup.write(Buffer.from('1')); dup.commit();
  const clash = s.begin('x/y/z.md'); clash.write(Buffer.from('2'));
  assert.throws(() => clash.commit(), /EEXIST/);
  clash.abort();
  const lone = s.begin('only/here/f.md'); lone.write(Buffer.from('f'));
  fs.writeFileSync(path.join(d, 'only'), 'a file where a folder goes');
  assert.throws(() => lone.commit(), /a file is where a folder/);
  lone.abort();
  fs.rmSync(path.join(d, 'only'));
  // Folders this commit made are removed when a later step fails: a name too long for the filesystem fails the
  // next mkdir (long folder) or the link (long file name) after a new folder was made.
  const long = 'n'.repeat(300);
  const lf = s.begin(`made1/${long}/f.md`); lf.write(Buffer.from('f'));
  assert.throws(() => lf.commit(), /ENAMETOOLONG|EINVAL|ENOENT/);
  lf.abort();
  const ll = s.begin(`made2/${long}.md`); ll.write(Buffer.from('f'));
  assert.throws(() => ll.commit(), /ENAMETOOLONG|EINVAL|ENOENT/);
  ll.abort();
  assert.equal(fs.existsSync(path.join(d, 'made1')) || fs.existsSync(path.join(d, 'made2')), false, 'the folders made for a failed commit are gone');
  const c = s.begin('X/b.md'); c.write(Buffer.from('b')); c.commit();
  assert.equal(fs.readFileSync(path.join(d, 'X', 'b.md'), 'utf8'), 'b', 'CONTROL: a folder spelled in another case is still usable');
  s.close();
  const left = listAll(d).filter((p) => !p.startsWith('x') && !p.startsWith('X'));
  assert.deepEqual(left, [], 'no empty folders from files that failed');
});

test('#5536 sink: a drive without hard links is refused when the sink is made, with a clear reason', (t) => {
  const d = fresh(t), real = fs.linkSync;
  fs.linkSync = () => { const e = new Error('operation not permitted'); e.code = 'EPERM'; throw e; };
  try { assert.throws(() => createRestoreSink(d), /cannot hold a restore \(no hard links: EPERM\)/); } finally { fs.linkSync = real; }
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = () => { const e = new Error('no space'); e.code = 'ENOSPC'; throw e; };
  try { assert.throws(() => createRestoreSink(d), /cannot write in the restore folder \(ENOSPC\)/, 'a full disk is not reported as a drive without links'); } finally { fs.writeFileSync = realWrite; }
  assert.deepEqual(fs.readdirSync(d), [], 'and leaves the folder as it found it');
  createRestoreSink(d).close();  // CONTROL: with links, it is made
});

test('#5536 sink: once the file is published, a folder fsync the filesystem refuses does not fail the commit', (t) => {
  const d = fresh(t), s = createRestoreSink(d), real = fs.fsyncSync;
  const out = s.begin('net/f.md'); out.write(Buffer.from('f'));
  let calls = 0;
  fs.fsyncSync = (fd) => { if (++calls === 2) { const e = new Error('not supported'); e.code = 'EINVAL'; throw e; } return real(fd); };
  try { out.commit(); } finally { fs.fsyncSync = real; }
  assert.deepEqual(tempContents(d), [], 'the temp link was removed at commit, before close');
  assert.equal(calls >= 2 || process.platform === 'win32', true, 'the folder fsync was attempted (not on Windows)');
  assert.equal(fs.readFileSync(path.join(d, 'net', 'f.md'), 'utf8'), 'f');
  s.close();
  assert.deepEqual(listAll(d), ['net', path.join('net', 'f.md')], 'committed, and no temp link left behind');
  const s2 = createRestoreSink(fresh(t)), stuck = s2.begin('z.md'), realWrite = fs.writeSync;
  fs.writeSync = () => 0;
  try { assert.throws(() => stuck.write(Buffer.from('z')), /made no progress/, 'a write that makes no progress fails instead of spinning'); } finally { fs.writeSync = realWrite; }
  stuck.abort(); s2.close();
});

test('#5536 sink: on Windows the root must be inside the user folder, spelled any way (8.3 short names included)', { skip: process.platform !== 'win32' && 'Windows only' }, (t) => {
  const inside = fresh(t);  // under %TEMP% (the runner spells it with a short name, C:\Users\RUNNER~1\...), or under the
  // profile itself where TEMP lies outside it, in which case no short name is exercised
  createRestoreSink(inside).close();  // CONTROL: the profile, however it is spelled, is accepted
  const outside = path.join(path.parse(os.tmpdir()).root, `kosmos-sink-outside-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(outside);
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  assert.throws(() => createRestoreSink(outside), /inside your user folder/);
});

test('#5536 sink: on macOS an ACL on the root is removed, so other accounts cannot write in it past the 0700 mode', { skip: process.platform !== 'darwin' && 'macOS only' }, (t) => {
  const { spawnSync } = require('child_process');
  const d = fresh(t);
  assert.equal(spawnSync('/bin/chmod', ['+a', 'everyone allow add_file,add_subdirectory,delete_child,list,search', d]).status, 0);
  assert.match(spawnSync('/bin/ls', ['-led', d], { encoding: 'utf8' }).stdout, /everyone allow/, 'CONTROL: the ACL is there before');
  createRestoreSink(d).close();
  assert.doesNotMatch(spawnSync('/bin/ls', ['-led', d], { encoding: 'utf8' }).stdout, /allow/, 'and gone after');
});

test('#5536 sink: group write above the root is allowed only when the group is the user\'s private group', { skip: process.platform === 'win32' && 'POSIX only' }, () => {
  const me = os.userInfo().username, gid = process.getgid();
  assert.equal(isPrivateGroup(gid, () => `${me}:x:${gid}:\n`), true, 'CONTROL: a group named after the user, no other members');
  assert.equal(isPrivateGroup(gid, () => `${me}:x:${gid}:${me}\n`), true, 'listing only the user is still private');
  assert.equal(isPrivateGroup(gid, () => `${me}:x:${gid}:${me},someone\n`), false, 'another member');
  assert.equal(isPrivateGroup(gid, () => `staff:x:${gid}:\n`), false, 'a group named otherwise (macOS staff)');
  assert.equal(isPrivateGroup(gid + 1, () => `${me}:x:${gid + 1}:\n`), false, 'not the user\'s own gid');
  assert.equal(isPrivateGroup(gid, () => { throw new Error('no file'); }), false, 'unreadable: not private');
});

test('#5536 sink: on macOS an ACL that cannot be removed refuses with the tool\'s own reason', { skip: process.platform !== 'darwin' && 'macOS only' }, (t) => {
  const cp = require('child_process'), realSpawn = cp.spawnSync;
  cp.spawnSync = (cmd, args, o) => (cmd === '/bin/chmod' ? { status: 1, stderr: 'Operation not supported', stdout: '' } : realSpawn(cmd, args, o));
  // restoresink took spawnSync at load, so reload it with the stub in place.
  delete require.cache[require.resolve('./restoresink')];
  try {
    const fresh2 = require('./restoresink');
    assert.throws(() => fresh2.createRestoreSink(fresh(t)), /chmod -N exited 1: Operation not supported\); choose a folder on this Mac's own disk/);
  } finally { cp.spawnSync = realSpawn; delete require.cache[require.resolve('./restoresink')]; }
});

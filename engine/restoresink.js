/**
 * kosmos#5536 (E0.7) step 3, the sink: where engine/backuprestore.js writes a restored snapshot on this computer.
 * restoreSnapshot streams each file into a sink and commits it only after it verified; this is that sink, for a
 * folder on disk, and it carries the duties backuprestore.js states for any sink:
 *
 *  - The root is a fresh folder the person chose: absolute, a real directory (not a symlink), and empty, on a
 *    volume that supports hard links (checked when the sink is created; exFAT, FAT32 and some network shares do not).
 *  - Bytes go to a temp file in a folder inside the root, never at the final path, until commit.
 *  - Commit publishes with link(), which never replaces anything: a name already there (a file this restore
 *    committed, or one a case-insensitive volume treats as the same name) refuses the commit.
 *  - Folders are created only at commit, one at a time, each checked to be a real folder inside the root before
 *    the next is made in it, so a symlink already in the root when a file commits carries nothing outside it. The
 *    check and the link are separate steps: a process writing into the root during the restore could swap a folder
 *    between them. The root rules below keep other users out; another process of the same user is not defended
 *    against, which is why the root must be a fresh folder nothing else uses. A commit that fails removes the
 *    folders it made, so a bad file leaves no empty folders behind.
 *  - Files are written 0600 and folders 0700 (POSIX; on Windows they inherit the folder's ACL): a manifest carries no
 *    modes, and this is someone's work.
 *
 * The caller creates the root itself (a folder a person picked may already hold a .DS_Store and is then refused).
 * ACLs on the folders above the root are not read (the root's own are: stripped on macOS, masked by 0700 on Linux).
 * On Linux, a folder above the root in the user's private group with an ACL naming another user reports group
 * write, which the private-group exemption then allows; only a user who granted that ACL themselves is exposed.
 * On macOS a root on a volume that ignores ownership is refused first. The root is then made 0700, the mode read
 * back (refused if the drive ignored it), and its macOS ACL removed, before the temp folder and hard-link probe; if a
 * probe then refuses, the folder keeps that tighter mode.
 * Every call is synchronous (writes, fsyncs, and on Windows short retry sleeps), so a large restore blocks its thread:
 * the restore engine should run it in a worker or a child process, not on the board's event loop. On macOS fsync does
 * not force data to the platters (that is F_FULLFSYNC), so a power loss can still lose recent files.
 * On Windows a root outside the user's profile (another drive, say) is refused: the folder picker must offer one
 * inside the profile.
 * Files are not restored executable (a manifest carries no modes). The path backstop below applies on every
 * platform, so a Mac name such as 'a:b' or 'notes.' does not restore anywhere.
 * Use it only through restoreSnapshot: it takes paths that already passed backuprestore.js's pathProblem and rechecks
 * only the plain-relative shape and a few Windows hazards, not device names (on Windows a name such as CON would be
 * made as a literal, hard-to-delete file) or invisible characters.
 * A crash mid-restore leaves the temp folder (hidden on a Mac, not on Windows) in the root, which then is not empty:
 * restore into a new folder, or remove the old one first. Only a file's own folder is fsynced after it is published,
 * so after a power loss a folder made by that commit may need its parent re-synced (a re-run restores it). close()
 * expects every begun file to be committed or aborted first (restoreSnapshot always does), and throws if the temp
 * folder cannot be removed (an open handle on Windows), so call it outside a finally that must not throw.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const TEMP_PREFIX = '.kosmos-restore-';
// slice 3: the resume record, a fixed name in the root. It starts with TEMP_PREFIX, so begin() refuses it as a
// manifest path and no restored file can take or replace it.
const RECORD_NAME = `${TEMP_PREFIX}record`;
let RECORD_MAX_BYTES = 256 * 1024 * 1024;   // written AND read to this cap (review 1)
/* Test seam: a cap a test can reach without writing 256 MB. */
function setRecordMaxBytesForTests(n) { RECORD_MAX_BYTES = n; }
const RESUME_MAX_ENTRIES = 1000000;   // files and folders walked when a root is resumed
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
// The shape of an NTFS 8.3 short name, the same rule backuprestore.js's pathProblem uses: on Windows such a name can
// alias another folder, the temp folder included (.kosmos-restore-... answers to KOSMOS~1).
const { SHORT_NAME_RE } = require('./backuprestore');
const CLOSE_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES']);

/* Remove a tree, retrying the codes Windows uses while antivirus or the indexer holds a just-written file. */
function removeTree(dir) {
  for (let attempt = 1; ; attempt += 1) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch (e) {
      if (process.platform !== 'win32' || !CLOSE_RETRY_CODES.has(e.code) || attempt >= 8) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * attempt);
    }
  }
}

/* True when gid is this user's private group (the Linux user-private-group scheme): the user's own gid, named after
   the user in /etc/group, listing no other member. Only /etc/group is read: another account whose primary gid is the
   same group (set in /etc/passwd by an administrator) is not seen, and a group served by NSS or LDAP reads as not
   private, which refuses rather than allows. macOS's shared 'staff' is not private. readGroups is injectable. */
function isPrivateGroup(gid, readGroups = () => fs.readFileSync('/etc/group', 'utf8')) {
  if (gid !== process.getgid()) return false;
  let text;
  try { text = readGroups(); } catch { return false; }
  const user = os.userInfo().username;
  return text.split('\n').some((line) => {
    const [name, , id, members = ''] = line.split(':');
    return Number(id) === gid && name === user && members.split(',').every((m) => m === '' || m === user);
  });
}

/* macOS: remove every ACL entry on dir and confirm none is left (chmod sets mode bits only, and an inherited ACL can
   still let other accounts write). Throws if it cannot. */
function stripAclDarwin(dir) {
  const r = spawnSync('/bin/chmod', ['-N', dir], { encoding: 'utf8' });
  const ls = spawnSync('/bin/ls', ['-led', dir], { encoding: 'utf8' });
  if (r.status !== 0 || ls.status !== 0 || ls.stdout.split('\n').filter((l) => /^\s*\d+: /.test(l)).length) {
    const why = r.status !== 0 ? `chmod -N exited ${r.status}: ${String(r.stderr || '').trim()}` : 'entries remain';
    throw new Error(`restoresink: could not remove the access-control entries on the root (${why}); choose a folder on this Mac's own disk`);
  }
}

/* macOS: whether the volume holding dir ignores ownership (mount flag noowners, "Ignore ownership on this volume",
   common on external drives): there 0700 and the owner check keep nobody out. df -P names dir's mount point (so no
   case or Unicode matching of paths here); its flags come from that exact mount's line in /sbin/mount. Anything it
   cannot read or find refuses (fails closed). */
function ignoresOwnershipDarwin(dir) {
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10 * 1000 });
    if (r.error || r.status !== 0) throw new Error(`restoresink: could not check the root's volume (${cmd}: ${r.error ? r.error.code || r.error.message : 'exited ' + r.status})`);
    return String(r.stdout || '');
  };
  const dfLast = run('/bin/df', ['-P', dir]).trim().split('\n').pop();
  const mp = (/\d+%\s+(\/.*)$/.exec(dfLast) || [])[1];
  if (!mp) throw new Error("restoresink: could not check the root's volume (df named no mount point)");
  // Exactly this mount point: the " (" after it must be the line's LAST, so "/Volumes/foo (bar)" never matches
  // "/Volumes/foo". The last such line, as on stacked mounts the visible one is listed last.
  const exact = (l) => { const at = l.lastIndexOf(` on ${mp} (`); return at >= 0 && at + 4 + mp.length === l.lastIndexOf(' (') && l.endsWith(')'); };
  const line = run('/sbin/mount', []).split('\n').filter(exact).pop();
  if (!line) throw new Error(`restoresink: could not check the root's volume (no mount line for ${mp})`);
  return line.slice(line.lastIndexOf(' (') + 2, -1).split(', ').map((f) => f.trim()).includes('noowners');
}

/* The plain-relative shape begin() accepts, as a function so the resume record is held to the same rule. */
function plainSegments(rel) {
  const segs = typeof rel === 'string' ? rel.split('/') : [];
  // The plain-relative shape, plus a backstop for a caller that skipped pathProblem: no ':' (a drive or an NTFS
  // stream), no control characters, no trailing dot or space (which Windows would trim to another name).
  if (!segs.length || segs.some((s) => s === '' || s === '.' || s === '..' || s.includes('\\') || /[\x00-\x1f:]/.test(s) || /[. ]$/.test(s) || SHORT_NAME_RE.test(s))) {
    return null;
  }
  return segs;
}

/* Open a file for reading only if it is still the file just lstat-ed (dev and ino): O_NOFOLLOW is 0 on Windows, so
   the identity check is what refuses a link swapped in there (review 1). null when it is not a plain file. */
function openSame(file, at, flags) {
  let fd;
  try { fd = fs.openSync(file, flags | (fs.constants.O_NOFOLLOW || 0)); } catch { return null; }
  const st = fs.fstatSync(fd, { bigint: true });
  if (!st.isFile() || st.dev !== at.dev || st.ino !== at.ino) { fs.closeSync(fd); return null; }
  return { fd, st };
}

/* sha256 of the plain file at `file`, which must still be the one lstat-ed as `at`; null otherwise. */
function hashFile(file, at) {
  const o = openSame(file, at, fs.constants.O_RDONLY);
  if (!o) return null;
  try {
    const h = crypto.createHash('sha256');
    const buf = Buffer.alloc(1024 * 1024);
    let size = 0;
    for (;;) {
      const n = fs.readSync(o.fd, buf, 0, buf.length, null);
      if (n <= 0) break;
      h.update(buf.subarray(0, n));
      size += n;
    }
    return { sha256: h.digest('hex'), size };
  } finally { fs.closeSync(o.fd); }
}

/* POSIX: a recorded file or folder others could read or write (the sink made them 0600 and 0700), another user's,
   or a file with a second name (another hard link outside the record's reach) is not one this restore can vouch for. */
function untrusted(at, isFile) {
  if (process.platform === 'win32') return isFile && at.nlink > 1n ? 'has another name (a hard link)' : null;
  if (at.uid !== BigInt(process.getuid())) return 'belongs to another user';
  if (at.mode & 0o077n) return 'is open to other users';
  if (isFile && at.nlink > 1n) return 'has another name (a hard link)';
  return null;
}

/* The record: a first line { snapshot } naming what this restore restores, then { path, size, sha256 } per file, as
   path (NFC) -> every { size, sha256 } written for it. A line is written before its link, so a path can carry lines
   that never became the file (a link refused because the name was taken, or a crash before it); the file on disk must
   match one of them. Returns { snapshot, held, at } (at: the record's own lstat). Throws on anything else. */
function readRecord(rootReal) {
  const file = path.join(rootReal, RECORD_NAME);
  let at;
  try { at = fs.lstatSync(file, { bigint: true }); } catch (e) {
    throw new Error(`restoresink: this folder holds no restore record to continue from (${e.code || e.message})`);
  }
  if (at.isSymbolicLink() || !at.isFile()) throw new Error('restoresink: this folder holds no restore record to continue from (not a plain file)');
  if (untrusted(at, true)) throw new Error('restoresink: the restore record is not a private file of yours');
  if (at.size > BigInt(RECORD_MAX_BYTES)) throw new Error('restoresink: the restore record is larger than any restore writes');
  const o = openSame(file, at, fs.constants.O_RDONLY);
  if (!o) throw new Error('restoresink: this folder holds no restore record to continue from (it changed while it was opened)');
  let text;
  try { text = fs.readFileSync(o.fd, 'utf8'); } finally { fs.closeSync(o.fd); }
  const lines = text.split('\n').filter((l) => l !== '');
  let head;
  try { head = JSON.parse(lines[0] || 'null'); } catch { head = null; }
  if (!head || typeof head !== 'object' || typeof head.snapshot !== 'string' || !head.snapshot || head.snapshot.length > 512) {
    throw new Error('restoresink: the restore record is damaged');
  }
  const held = new Map();
  for (const line of lines.slice(1)) {
    let e;
    try { e = JSON.parse(line); } catch { throw new Error('restoresink: the restore record is damaged'); }
    // The 4096 limit pathProblem gives begin(), held here too (review 1: a path of 100,000 segments hung the walk).
    if (!e || typeof e !== 'object' || typeof e.path !== 'string' || e.path.length > 4096 || !plainSegments(e.path)
      || e.path.split('/')[0].toLowerCase().startsWith(TEMP_PREFIX)
      || !Number.isSafeInteger(e.size) || e.size < 0 || typeof e.sha256 !== 'string' || !SHA256_HEX_RE.test(e.sha256)) {
      throw new Error('restoresink: the restore record is damaged');
    }
    const k = e.path.normalize('NFC');
    if (!held.has(k)) held.set(k, []);
    held.get(k).push({ size: e.size, sha256: e.sha256 });
  }
  return { snapshot: head.snapshot, held, at };
}

/* Resume (slice 3): the root must hold only what the record says this restore put there. Old temp folders (a stopped
   run leaves one) are cleared first, as their files may be second names of published ones. Then every entry is walked
   without following a link: the record; folders on the way to a recorded file; and recorded files, each re-hashed to
   one of its lines. Names compare in NFC (review 1: HFS+ hands back NFD, so a recorded 'café' must still be found),
   and two entries that are one name in NFC refuse. A recorded file that is absent is dropped (its line was written
   before a link that never happened). Anything else refuses. Returns path (NFC) -> { size, sha256 } held. */
function verifyResumable(rootReal, held, recordAt) {
  for (const name of fs.readdirSync(rootReal)) {
    if (!name.startsWith(TEMP_PREFIX) || name === RECORD_NAME) continue;
    const at = fs.lstatSync(path.join(rootReal, name), { bigint: true });
    if (at.isDirectory() && !at.isSymbolicLink() && !untrusted(at, false)) removeTree(path.join(rootReal, name));
  }
  const kept = new Map();
  const folders = new Set();
  for (const [rel] of held) {
    const segs = rel.split('/');
    for (let i = 1; i < segs.length; i += 1) folders.add(segs.slice(0, i).join('/'));
  }
  let seen = 0;
  const walk = (dirRel) => {
    const dirAbs = dirRel ? path.join(rootReal, ...dirRel.split('/')) : rootReal;
    const names = new Set();
    for (const name of fs.readdirSync(dirAbs)) {
      if ((seen += 1) > RESUME_MAX_ENTRIES) throw new Error('restoresink: this folder holds more than a restore makes');
      const nfc = name.normalize('NFC');
      const rel = dirRel ? `${dirRel}/${nfc}` : nfc;
      if (names.has(nfc)) throw new Error(`restoresink: this folder holds two names that are one name, so it cannot be continued (${rel})`);
      names.add(nfc);
      const abs = path.join(dirAbs, name);
      const at = fs.lstatSync(abs, { bigint: true });
      // The record itself, and only the very file readRecord read (review 1: on Windows a link there was never looked at).
      if (!dirRel && name === RECORD_NAME) {
        if (at.isSymbolicLink() || at.dev !== recordAt.dev || at.ino !== recordAt.ino) throw new Error('restoresink: the restore record changed while it was read');
        continue;
      }
      if (at.isSymbolicLink()) throw new Error(`restoresink: this folder has a link the restore did not make, so it cannot be continued (${rel})`);
      if (at.isDirectory()) {
        if (!folders.has(rel)) throw new Error(`restoresink: this folder holds something the restore did not put there, so it cannot be continued (${rel})`);
        const why = untrusted(at, false);
        if (why) throw new Error(`restoresink: a folder in this restore ${why}, so it cannot be continued (${rel})`);
        walk(rel);
        continue;
      }
      const lines = held.get(rel);
      if (!at.isFile() || !lines) throw new Error(`restoresink: this folder holds something the restore did not put there, so it cannot be continued (${rel})`);
      const why = untrusted(at, true);
      if (why) throw new Error(`restoresink: a restored file ${why}, so it cannot be continued (${rel})`);
      const got = hashFile(abs, at);
      const match = got && lines.find((w) => w.size === got.size && w.sha256 === got.sha256);
      if (!match) throw new Error(`restoresink: a restored file has changed since the restore stopped, so it cannot be continued (${rel})`);
      kept.set(rel, match);
    }
  };
  walk('');
  return kept;
}

/** A sink over the empty folder at root. Throws unless root is a fresh folder. Call close() when the restore ends.
    opts (slice 3, both off by default, so a sink made without them behaves exactly as before):
      record: keep a resume record in the root, a line per file written (and fsynced) before the file is published
      resume: continue a restore that stopped: root must be a folder an earlier record: true sink wrote, holding only
              what its record names (verifyResumable); implies record. has(rel, sha256, size) then says whether a file
              is already there, so restore skips it.
      snapshot: REQUIRED with either: what this restore restores (the snapshot id and the manifest's sha256, say). A
              resume refuses a record of another snapshot (review 1: two snapshots would mix in one folder silently).
    recordLost: true once the record passed RECORD_MAX_BYTES and was dropped, so this restore cannot be continued.
    close({ keepRecord }) removes the record unless keepRecord: keep it when the restore stopped part way. */
function createRestoreSink(root, opts = {}) {
  const resume = !!(opts && opts.resume);
  const keepRecordOn = resume || !!(opts && opts.record);
  const snapshot = opts && opts.snapshot;
  if (keepRecordOn && (typeof snapshot !== 'string' || !snapshot || snapshot.length > 512 || /[\x00-\x1f]/.test(snapshot))) {
    throw new Error('restoresink: a recorded or resumed restore must name its snapshot');
  }
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('restoresink: the root must be an absolute path');
  root = path.resolve(root);  // a trailing separator would make lstat follow a symlinked root
  const st = fs.lstatSync(root, { bigint: true });  // bigint: an NTFS file id can exceed 2^53
  if (!st.isDirectory()) throw new Error('restoresink: the root must be a real folder, not a file or a symlink');
  if (!resume && fs.readdirSync(root).length) throw new Error('restoresink: the root must be empty (restore into a fresh folder)');
  // POSIX: the person's own folder, before anything is made in it (a group member's folder could be written by its
  // owner, and its mode could not be tightened below).
  if (process.platform !== 'win32' && st.uid !== BigInt(process.getuid())) throw new Error('restoresink: the root must be a folder you own');
  // The native realpath: the JS one does not expand Windows 8.3 short names (RUNNER~1), so two spellings of one
  // folder would compare unequal (#4267 measured it). Then the resolved folder must be the one just checked: a swap
  // between the two reads would point every later step somewhere the checks never looked.
  const rootReal = fs.realpathSync.native(root);
  const st2 = fs.lstatSync(rootReal, { bigint: true });
  if (!st2.isDirectory() || st2.dev !== st.dev || st2.ino !== st.ino) throw new Error('restoresink: the root changed while it was being checked');
  // POSIX: no folder above the root may let anyone else swap the root or a folder on the way to it, by its mode
  // bits (ACLs on these folders are not read). Each must be owned by this user or by root, and not writable by
  // others, nor by its group unless that group is the user's private group; a sticky folder (as /tmp is) is fine.
  if (process.platform !== 'win32') {
    for (let up = path.dirname(rootReal); ; up = path.dirname(up)) {
      const u = fs.statSync(up);
      const ownedOk = u.uid === process.getuid() || u.uid === 0;
      const sticky = (u.mode & 0o1000) !== 0;
      const othersWrite = (u.mode & 0o002) !== 0;
      const groupWrite = (u.mode & 0o020) !== 0 && !(u.uid === process.getuid() && isPrivateGroup(u.gid));
      if (!ownedOk) throw new Error(`restoresink: a folder above the root belongs to another user (${up})`);
      if ((othersWrite || groupWrite) && !sticky) throw new Error(`restoresink: a folder above the root lets other users replace it, or its drive keeps no permissions such as exFAT (${up})`);
      if (path.dirname(up) === up) break;
    }
  }
  // Limit who could race the folder checks. Windows: Node cannot read an ACL, so the root must be inside the user's
  // profile, which is theirs alone by default (a folder made at C:\ grants Authenticated Users write access). POSIX:
  // refuse a root others can write in now, then make it 0700 (below), since a group such as macOS's shared 'staff'
  // would otherwise let every local account write in it. The folder above the root must be private too (the user's
  // home or a temp folder made for this): whoever can write there can swap the root itself (checked above).
  if (process.platform === 'win32') {
    const rel = path.relative(fs.realpathSync.native(os.homedir()), rootReal);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('restoresink: on Windows the root must be inside your user folder');
  }
  // Trust the root before writing anything in it: refuse one other users can write in (a drive without
  // permissions, such as exFAT, reports every folder that way), make it 0700 so a shared group (macOS staff) cannot
  // write in it either, confirm the mode took, then check it is still empty, so nothing planted before the chmod survives it.
  if (process.platform !== 'win32') {
    if (st.mode & 0o002n) throw new Error('restoresink: the root must not be writable by other users (or the drive keeps no permissions, such as exFAT)');
    // On a volume that ignores ownership 0700 means nothing: refused before the chmod.
    if (process.platform === 'darwin' && ignoresOwnershipDarwin(rootReal)) throw new Error("restoresink: the root is on a volume that ignores ownership (Get Info: \"Ignore ownership on this volume\"), so it cannot be made private; choose a folder on this computer's own disk");
    try { fs.chmodSync(rootReal, 0o700); } catch (e) { throw new Error(`restoresink: could not make the root private (${e.code || e.message})`); }
    // Read the mode back, from the same folder (dev/ino): a mount can accept chmod and ignore it. The mask is 0o077,
    // not 0o022, on purpose: a restore is someone's work, so a root others can READ is refused too.
    const st3 = fs.lstatSync(rootReal, { bigint: true });
    if (st3.dev !== st.dev || st3.ino !== st.ino) throw new Error('restoresink: the root changed after it was made private');
    if (st3.mode & 0o077n) throw new Error("restoresink: the root could not be made private (the drive ignored the permission change); choose a folder on this computer's own disk");
    if (process.platform === 'darwin') stripAclDarwin(rootReal);
    if (!resume && fs.readdirSync(rootReal).length) throw new Error('restoresink: something appeared in the root while it was being made private');
  }
  // slice 3: a resumed root is proved by its record, after the root itself passed every check above.
  let rec = null;
  if (resume) {
    rec = readRecord(rootReal);
    if (rec.snapshot !== snapshot) throw new Error('restoresink: this folder holds a restore of another backup, so it cannot be continued with this one; restore into a fresh folder');
  }
  const held = resume ? verifyResumable(rootReal, rec.held, rec.at) : new Map();

  const tempName = TEMP_PREFIX + crypto.randomBytes(8).toString('hex');
  const tempDir = path.join(rootReal, tempName);
  fs.mkdirSync(tempDir, { mode: 0o700 });
  const probe = path.join(tempDir, 'probe');
  try {
    fs.writeFileSync(probe, '', { mode: 0o600, flag: 'wx' });
  } catch (e) {
    removeTree(tempDir);
    throw new Error(`restoresink: cannot write in the restore folder (${e.code || e.message})`);
  }
  try {
    fs.linkSync(probe, `${probe}-link`);
  } catch (e) {
    removeTree(tempDir);
    throw new Error(`restoresink: this drive cannot hold a restore (no hard links: ${e.code || e.message}); choose a folder on another drive`);
  }
  try { removeTree(`${probe}-link`); removeTree(probe); } catch (e) {
    try { removeTree(tempDir); } catch { /* reported below */ }
    throw new Error(`restoresink: could not clean up the probe (${e.code || e.message})`);
  }
  // slice 3: opened only now, after every check passed, so a refused fresh root is left as empty as it was given.
  let recordFd = null;
  let recordBytes = rec ? Number(rec.at.size) : 0;
  let recordLost = false;
  // Written to the same cap the reader holds: past it the record is dropped (a restore this large cannot be
  // continued), never left for a resume that would refuse it as too large.
  const recordWrite = (line) => {
    if (recordFd === null) return;
    const n = Buffer.byteLength(line);
    if (recordBytes + n > RECORD_MAX_BYTES) {
      const f = recordFd; recordFd = null; recordLost = true;
      try { fs.closeSync(f); } finally { fs.rmSync(path.join(rootReal, RECORD_NAME), { force: true }); }
      return;
    }
    fs.writeSync(recordFd, line);
    fs.fsyncSync(recordFd);
    recordBytes += n;
  };
  if (keepRecordOn) {
    const file = path.join(rootReal, RECORD_NAME);
    // A fresh restore creates it (never over an existing one); a resumed one appends to the one it just read.
    const flags = resume ? fs.constants.O_WRONLY | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW || 0)
      : fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_APPEND;
    try {
      recordFd = fs.openSync(file, flags, 0o600);
      // A resumed record must be the very file read and verified above (review 1: O_NOFOLLOW is 0 on Windows).
      if (rec) { const st = fs.fstatSync(recordFd, { bigint: true }); if (st.dev !== rec.at.dev || st.ino !== rec.at.ino) throw new Error('it changed after it was read'); }
      else recordWrite(`${JSON.stringify({ snapshot })}\n`);
    } catch (e) {
      if (recordFd !== null) { try { fs.closeSync(recordFd); } catch { /* reported below */ } recordFd = null; }
      try { removeTree(tempDir); } catch { /* reported below */ }
      throw new Error(`restoresink: could not open the restore record (${e.code || e.message})`);
    }
  }

  /* Make each folder on the way, one segment at a time, proving each is a real folder inside the root before
     descending. Returns { dir, made } (made: the folders this call created, outermost first). */
  const makeParents = (segs) => {
    let dir = rootReal;
    const made = [];
    try {
      for (const seg of segs.slice(0, -1)) {
        dir = path.join(dir, seg);
        try { fs.mkdirSync(dir, { mode: 0o700 }); made.push(dir); } catch (e) { if (e.code !== 'EEXIST') throw e; }
        const at = fs.lstatSync(dir);
        if (at.isSymbolicLink()) throw new Error('restoresink: a folder on the way resolves outside the root');
        if (!at.isDirectory()) throw new Error('restoresink: a file is where a folder on the way should be');
        if (process.platform !== 'win32' && at.uid !== process.getuid()) throw new Error('restoresink: a folder on the way belongs to another user');
      }
    } catch (e) { removeMade(made); throw e; }
    return { dir, made };
  };
  const removeMade = (made) => {
    for (const d of [...made].reverse()) { try { fs.rmdirSync(d); } catch { /* not empty: another file is in it */ } }
  };
  const syncDir = (dir) => {
    if (process.platform === 'win32') return;  // Windows cannot open a folder to fsync it
    const fd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  };

  return {
    root: rootReal,
    /** slice 3: true when a resumed root already holds rel with exactly this content (proved when the sink opened). */
    get recordLost() { return recordLost; },
    has(rel, sha256, size) {
      const h = typeof rel === 'string' ? held.get(rel.normalize('NFC')) : undefined;
      return !!h && h.sha256 === sha256 && h.size === size;
    },
    begin(rel) {
      const segs = plainSegments(rel);
      if (!segs) throw new Error('restoresink: not a plain relative path');
      // A file committed into the temp folder would be deleted by close() while reported restored. The temp name's
      // 64 random bits keep a manifest from naming it; this prefix refusal (first segment only, where the temp folder
      // sits; lower case, not APFS or NTFS folding) is a second, weaker line. A Mac file with that prefix does not
      // restore.
      if (segs[0].toLowerCase().startsWith(TEMP_PREFIX)) throw new Error('restoresink: that name is reserved for the restore\'s own temp folder');
      const tmp = path.join(tempDir, crypto.randomBytes(12).toString('hex'));
      let fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      const closeFd = () => { if (fd !== null) { const f = fd; fd = null; fs.closeSync(f); } };
      // slice 3: the record's hash is of the bytes this sink wrote, never a caller's claim about them.
      const digest = crypto.createHash('sha256');
      let written = 0;
      return {
        write(buf) {
          if (fd === null) throw new Error('restoresink: this file was already committed or aborted');
          for (let off = 0; off < buf.length;) {
            const n = fs.writeSync(fd, buf, off, buf.length - off);
            if (n <= 0) throw new Error('restoresink: the write made no progress');
            off += n;
          }
          digest.update(buf);
          written += buf.length;
        },
        commit() {
          if (fd === null) throw new Error('restoresink: this file was already committed or aborted');
          fs.fsyncSync(fd);
          closeFd();
          // slice 3: the record line goes first and is fsynced, so a file that is published is always recorded (a
          // line whose link then fails names an absent file, which a resume drops).
          recordWrite(`${JSON.stringify({ path: segs.join('/'), size: written, sha256: digest.digest('hex') })}\n`);
          const { dir, made } = makeParents(segs);
          try {
            fs.linkSync(tmp, path.join(dir, segs[segs.length - 1]));  // EEXIST when anything holds the name
          } catch (e) { removeMade(made); throw e; }
          // Published from here on: a folder fsync some filesystems refuse (network, FUSE) or a failed temp cleanup
          // does not undo that, so neither fails the commit. Only the file's own folder is fsynced.
          try { syncDir(dir); } catch { /* best effort */ }
          try { fs.unlinkSync(tmp); } catch { /* close() removes the temp folder */ }
        },
        abort() {
          try { closeFd(); } finally { fs.rmSync(tmp, { force: true }); }
        },
      };
    },
    /** Removes the temp folder, and the record unless keepRecord. Files already committed stay. */
    close(o = {}) {
      if (recordFd !== null) { const f = recordFd; recordFd = null; fs.closeSync(f); if (!(o && o.keepRecord)) fs.rmSync(path.join(rootReal, RECORD_NAME), { force: true }); }
      removeTree(tempDir);
    },
  };
}

module.exports = {
  createRestoreSink,
  RECORD_NAME,
  setRecordMaxBytesForTests,
  isPrivateGroup,  // exported for its test only
};

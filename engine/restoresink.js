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
 * The root is made 0700 (and its macOS ACL removed) before the temp folder and hard-link probe; if a probe then
 * refuses, the folder keeps that tighter mode.
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

/** A sink over the empty folder at root. Throws unless root is a fresh folder. Call close() when the restore ends. */
function createRestoreSink(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('restoresink: the root must be an absolute path');
  root = path.resolve(root);  // a trailing separator would make lstat follow a symlinked root
  const st = fs.lstatSync(root, { bigint: true });  // bigint: an NTFS file id can exceed 2^53
  if (!st.isDirectory()) throw new Error('restoresink: the root must be a real folder, not a file or a symlink');
  if (fs.readdirSync(root).length) throw new Error('restoresink: the root must be empty (restore into a fresh folder)');
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
  // write in it either, then check it is still empty, so nothing planted before the chmod survives it.
  if (process.platform !== 'win32') {
    if (st.mode & 0o002n) throw new Error('restoresink: the root must not be writable by other users (or the drive keeps no permissions, such as exFAT)');
    try { fs.chmodSync(rootReal, 0o700); } catch (e) { throw new Error(`restoresink: could not make the root private (${e.code || e.message})`); }
    if (process.platform === 'darwin') stripAclDarwin(rootReal);
    if (fs.readdirSync(rootReal).length) throw new Error('restoresink: something appeared in the root while it was being made private');
  }
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
    begin(rel) {
      const segs = typeof rel === 'string' ? rel.split('/') : [];
      // The plain-relative shape, plus a backstop for a caller that skipped pathProblem: no ':' (a drive or an NTFS
      // stream), no control characters, no trailing dot or space (which Windows would trim to another name).
      if (!segs.length || segs.some((s) => s === '' || s === '.' || s === '..' || s.includes('\\') || /[\x00-\x1f:]/.test(s) || /[. ]$/.test(s) || SHORT_NAME_RE.test(s))) {
        throw new Error('restoresink: not a plain relative path');
      }
      // A file committed into the temp folder would be deleted by close() while reported restored. The temp name's
      // 64 random bits keep a manifest from naming it; this prefix refusal (first segment only, where the temp folder
      // sits; lower case, not APFS or NTFS folding) is a second, weaker line. A Mac file with that prefix does not
      // restore.
      if (segs[0].toLowerCase().startsWith(TEMP_PREFIX)) throw new Error('restoresink: that name is reserved for the restore\'s own temp folder');
      const tmp = path.join(tempDir, crypto.randomBytes(12).toString('hex'));
      let fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
      const closeFd = () => { if (fd !== null) { const f = fd; fd = null; fs.closeSync(f); } };
      return {
        write(buf) {
          if (fd === null) throw new Error('restoresink: this file was already committed or aborted');
          for (let off = 0; off < buf.length;) {
            const n = fs.writeSync(fd, buf, off, buf.length - off);
            if (n <= 0) throw new Error('restoresink: the write made no progress');
            off += n;
          }
        },
        commit() {
          if (fd === null) throw new Error('restoresink: this file was already committed or aborted');
          fs.fsyncSync(fd);
          closeFd();
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
    /** Removes the temp folder. Files already committed stay. */
    close() { removeTree(tempDir); },
  };
}

module.exports = {
  createRestoreSink,
  isPrivateGroup,  // exported for its test only
};

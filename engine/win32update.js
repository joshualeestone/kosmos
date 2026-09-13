'use strict';
/**
 * The Windows in-app updater, slice S2: download, verify and STAGE a newer Windows build.
 * It never swaps anything in. The swap (S3) and the button (S4) are later slices; nothing in the
 * product calls `prepare()` yet, and SELF_INSTALL is still darwin-only.
 *
 * 🔑 THE WHOLE SLICE WRITES INSIDE ONE FOLDER, `<ROOT>\.kosmos-update\` (WORK), where ROOT is
 * the unpacked Kosmos folder the board runs from. On the same volume as ROOT, so the S3 swap is
 * renames rather than copies. Every write below goes through `workGuard`, and the suite records
 * every path the file system is asked to write while a prepare runs.
 *
 * The flow is the design's B0-B4:
 *   B0  preconditions, each a sentence (and the live-execution gate, convention 3);
 *   B1  the Windows pointer, read with the S1 rule (update.pointerFor / update.readManifest);
 *   B2  the checksum sidecar, then the versioned zip streamed into WORK\download.part while hashing,
 *       under caps on size and time; computed = pointer = sidecar;
 *   B3  the bytes that were hashed, unpacked with engine/win32zip.js into WORK\staged,
 *       allow-listed to ENTRIES;
 *   B4  the staged tree checked: its manifest, its app version, its required files, its node.exe
 *       actually running, whether that node.exe differs from the anchored one, and the board
 *       identity it will answer with.
 *
 * Returns `{ ok: true, version, sha256, stagedDir, runtimeChanged, expectedIdentity }` or
 * `{ ok: false, because }`, and never throws for an expected failure.
 *
 * A CLI for the live check (a dry run unless --yes):
 *     node engine/win32update.js --prepare --root <folder> [--base <url>] [--channel staging] [--world <id>] [--yes]
 */

const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const liveExec = require('./live-execution');
const store = require('./store');
const update = require('./update');
const win32anchor = require('./win32anchor');
const win32board = require('./win32board');
const win32handoff = require('./win32handoff');
const win32orphan = require('./win32orphan');
const win32zip = require('./win32zip');

const MEGABYTE = 1024 * 1024;

/* The scratch folder and the things in it. */
const WORK_DIRNAME = '.kosmos-update';
const DOWNLOAD_PART_NAME = 'download.part';
const STAGED_DIRNAME = 'staged';
const LOCK_NAME = 'prepare.lock';
const STATUS_NAME = 'prepare-status.json';

/**
 * What a Kosmos build must contain, in the build's own words: this is the list
 * tools/build-kosmos-windows.sh checks its zip against (`for want in ...`, plus its separate
 * `bin/kosmos` check), and engine/win32update.test.js pins the two equal.
 */
const REQUIRED_ENTRIES = Object.freeze([
  'Kosmos.exe',
  'open-board.js',
  '! READ ME FIRST - Windows will warn you.txt',
  'manifest.json',
  'runtime/node.exe',
  'app/server.js',
  'app/web/index.html',
  'app/engine/kosmos-report-hook.js',
  'bin/kosmos-cli.js',
  'bin/kosmos.ps1',
  'bin/kosmos',
]);
/**
 * The top-level names an update may bring, and so the only names S3 may move in ROOT. Derived
 * from REQUIRED_ENTRIES (every top-level entry of a build is required), so there is one list. A
 * second pin in the suite reads every `$STAGE/<name>` the build script writes, so a new
 * top-level entry cannot ship without this list learning it. `Projects`, and anything else a
 * person keeps in the Kosmos folder, is never among them.
 */
const ENTRIES = Object.freeze([...new Set(REQUIRED_ENTRIES.map((entry) => entry.split('/')[0]))]);

/* The caps. The real 0.6.55 zip is 37 MB and unpacks to about 100 MB, of which node.exe is
   92.8 MB; each cap is several times what a build is, so a real build never meets one and a
   runaway download or a hostile archive always does. */
/** Bytes downloaded for the zip: about 7x the 37 MB build. The download is held in memory as
    well as written to WORK, so this is also the memory cap. */
const MAX_DOWNLOAD_BYTES = 256 * MEGABYTE;
/** Wall time for the zip: 37 MB at 1 Mbit/s takes about 5 minutes. */
const MAX_DOWNLOAD_MS = 15 * 60 * 1000;
/** The pointer and the sidecar are under 1 KB each. */
const MAX_SMALL_FETCH_BYTES = 64 * 1024;
const MAX_SMALL_FETCH_MS = 15 * 1000;
/** Entries in the archive: the real build has 139. */
const MAX_ARCHIVE_ENTRIES = 5000;
/** One unpacked file: node.exe is 92.8 MB. */
const MAX_ENTRY_BYTES = 256 * MEGABYTE;
/** Everything unpacked: about 5x the real build. */
const MAX_UNPACKED_BYTES = 512 * MEGABYTE;
/** `node.exe -p process.version` answers in well under a second; an antivirus scan of a freshly
    written 92 MB binary can take several. */
const STAGED_NODE_TIMEOUT_MS = 20 * 1000;
/** Free space needed next to ROOT, as a multiple of the zip: the zip itself, the unpacked tree
    (about 2.7x), and room left over for the person's own work. */
const DISK_HEADROOM_MULTIPLE = 4;
/** The age after which a lock whose owner CANNOT BE VERIFIED (no pid, or a pid check that errors)
    is taken as stale: twice the longest a whole prepare can take. A lock whose owner is verifiably
    running is never stale, whatever its age (see readLock). */
const STALE_LOCK_MS = 2 * MAX_DOWNLOAD_MS;
/** A lock whose contents cannot be read is taken as held while it is this young. The lock is
    published whole (a hard link to a finished file), so an unreadable one is damaged or from
    something else, and a few seconds is ample for any writer to be done with it. */
const UNREADABLE_LOCK_GRACE_MS = 5 * 1000;
/** Tries at the lock before refusing: enough to take it after clearing one stale lock, or after
    losing a race to a clearer, without spinning. */
const MAX_LOCK_ATTEMPTS = 3;
/** How many dead clear claims one clear steps past before giving up. Each is left by a clearer
    that died inside a microsecond window, so even one is rare. */
const MAX_CLEAR_CLAIM_STEPS = 8;
/** How long the one `tasklist` lookup of a lock owner's program may take. It answers in well under
    a second; a slow machine or a scanner can stretch that, and a lookup that runs out holds the
    lock (the safe direction). */
const PROCESS_IMAGE_LOOKUP_TIMEOUT_MS = 5 * 1000;
/** Tries at removing the lock on release, this far apart. A scanner or backup tool that opens the
    file without delete sharing lets go within moments; one that holds it longer leaves the lock to
    the next prepare in this board (releaseLock). */
const LOCK_RELEASE_TRIES = 3;
const LOCK_RELEASE_WAIT_MS = 50;
/** A lock that exists but cannot be read is read again this many times, this far apart, before it
    is called broken: a lock that is being deleted cannot be opened for a moment (Windows answers
    EPERM for a file whose delete is pending), and a broken one stays unreadable. */
const UNREADABLE_LOCK_CONFIRM_TRIES = 3;
const UNREADABLE_LOCK_CONFIRM_WAIT_MS = 20;
/**
 * The only environment the staged node.exe is run with. It is a freshly downloaded binary, and
 * the board's own environment can carry credentials (an API key, a token) and a NODE_OPTIONS that
 * would load code into it. SystemRoot and windir are what Windows' own DLLs look for; TEMP and
 * TMP give Node a temp folder; PATH is the DLL search path.
 */
const STAGED_NODE_ENV_KEYS = Object.freeze(['SystemRoot', 'windir', 'TEMP', 'TMP', 'PATH']);

const DEFAULT_LIMITS = Object.freeze({
  maxDownloadBytes: MAX_DOWNLOAD_BYTES,
  maxDownloadMs: MAX_DOWNLOAD_MS,
  maxSmallFetchBytes: MAX_SMALL_FETCH_BYTES,
  maxSmallFetchMs: MAX_SMALL_FETCH_MS,
  maxEntries: MAX_ARCHIVE_ENTRIES,
  maxEntryBytes: MAX_ENTRY_BYTES,
  maxUnpackedBytes: MAX_UNPACKED_BYTES,
  stagedNodeTimeoutMs: STAGED_NODE_TIMEOUT_MS,
  diskHeadroomMultiple: DISK_HEADROOM_MULTIPLE,
});

const LIVE_REFUSAL = 'Kosmos is not allowed to change files on this computer from here (live execution is off), so nothing was downloaded';

class PrepareRefusal extends Error {
  constructor(because) { super(because); this.name = 'PrepareRefusal'; }
}
function refuse(because) { throw new PrepareRefusal(because); }

function sizeInWords(bytes) {
  return bytes < MEGABYTE ? `${bytes} bytes` : `${Math.round(bytes / MEGABYTE)} MB`;
}
function firstLine(e) { return String((e && e.message) || e).split('\n')[0]; }
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function samePath(a, b) {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}
/** Is `child` the folder `parent`, or somewhere inside it? By spelling only; see realPathOf. */
function insideOrEqual(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || !(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel));
}
/**
 * Where a path really is: junctions, symlinks, `subst` drives and 8.3 short spellings resolved by
 * the operating system. A path that does not exist yet resolves through its nearest existing
 * ancestor, with the rest of it appended.
 */
function realPathOf(target) {
  let existing = path.resolve(target);
  const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(existing), ...rest); } catch { /* go up */ }
    const parent = path.dirname(existing);
    if (parent === existing) return path.resolve(target);
    rest.unshift(path.basename(existing));
    existing = parent;
  }
}
/* win32board.bundleRoot joins with path.win32 (the platform it is asked about). On Windows that
   is the host's own joiner; on another host (this suite on a Mac) the win32-joined name is mapped
   back to the host separator, so the one layout check still reads the sandbox. */
function hostExists(file) {
  return fs.existsSync(path.sep === '\\' ? file : file.split('\\').join('/'));
}
function defaultLog(line) {
  try { process.stderr.write('[win32update] ' + line + '\n'); } catch { /* stderr gone */ }
}
function defaultFreeBytes(dir) {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}
function sha256OfFile(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const chunk = Buffer.allocUnsafe(MEGABYTE);
    let n;
    while ((n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

/**
 * The one guard every write in a prepare goes through: a path strictly inside WORK, or a throw.
 * WORK itself is created once, directly, before anything else.
 */
function workGuard(work) {
  return (target) => {
    if (samePath(target, work) || !insideOrEqual(target, work)) throw new Error(`refusing to write ${target}, which is outside ${work}`);
    return target;
  };
}

/** How the staged interpreter is run: from its own folder, with a timeout, no window, and only
    STAGED_NODE_ENV_KEYS from this process's environment. */
function stagedNodeLaunch(nodeExe, timeoutMs) {
  const env = {};
  for (const key of STAGED_NODE_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return {
    file: nodeExe,
    args: ['-p', 'process.version'],
    options: { cwd: path.dirname(nodeExe), env, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  };
}
function runStagedNode(nodeExe, timeoutMs) {
  const launch = stagedNodeLaunch(nodeExe, timeoutMs);
  return String(cp.execFileSync(launch.file, launch.args, launch.options)).trim();
}

/** Does the staged node.exe differ from the anchored one the fleet runs on? The anchor's own
    size rule first (win32anchor.interpreterSizeDiffers), then a sha-256 for the equal-size case. */
function interpreterDiffers(stagedNode, anchoredNode) {
  if (win32anchor.interpreterSizeDiffers(stagedNode, anchoredNode)) return true;
  return sha256OfFile(stagedNode) !== sha256OfFile(anchoredNode);
}

/**
 * The world the new board will serve, which is half of the identity it answers with. An explicit
 * one wins; then this board's own (worldenv.bootedWorld(), what server.js puts in its header);
 * then, outside a board (the live-check CLI), the registry's active world, read the way
 * worldenv's boot reads it.
 */
function resolveWorld(explicit) {
  if (explicit) return explicit;
  const booted = require('./worldenv').bootedWorld();
  if (booted) return booted;
  const worlds = require('./worlds');
  try { return worlds.activeWorld(worlds.baseRoot(process.env)).id; } catch { return worlds.DEFAULT_ID; }
}

/* ─── B0 ─────────────────────────────────────────────────────────────────────────────────── */

/** The folders an update must never move or write into, with the name a person knows them by. */
function protectedFolders(env, home) {
  const projects = require('./projects'); // lazy: projects.js pulls in chat and instructions
  const folders = [
    ['the Kosmos data folder', store.ROOT],
    ['the projects folder', projects.projectsRoot()],
    ["the agents' folders", store.workersRootFor(process.env, process.env.AGENT_WORKFORCE_HOME || os.homedir())],
  ];
  try {
    folders.push(['the folder Kosmos starts from at logon', win32anchor.anchorDir(process.platform, home, env)]);
  } catch (e) {
    folders.push(['the folder Kosmos starts from at logon', null, firstLine(e)]);
  }
  return folders;
}

let preparing = false;

/** The first B0 precondition that fails, as a sentence, or null. Reads only. */
function preconditionRefusal(root, env, home) {
  const realRoot = realPathOf(root);
  for (const form of [root, realRoot]) {
    if (path.parse(form).root === form) return `${root} is the top of a drive, and the updater only replaces a Kosmos folder`;
  }
  const work = path.join(root, WORK_DIRNAME);
  const moved = [WORK_DIRNAME, ...ENTRIES].map((entry) => path.join(root, entry));
  /* Compared twice: as spelled, and as the operating system resolves them, so a junction, a
     `subst` drive or a short name cannot make a protected folder look separate from ROOT. */
  for (const [label, dir, why] of protectedFolders(env, home)) {
    if (!dir) return `we could not work out where ${label} is (${why || 'no detail'}), so an update could not be sure to leave it alone`;
    const realDir = realPathOf(dir);
    if (insideOrEqual(root, dir) || insideOrEqual(realRoot, realDir)) {
      return `${root} is inside ${label} (${dir}), and an update must never move anything there`;
    }
    for (const entry of moved) {
      if (insideOrEqual(dir, entry) || insideOrEqual(realDir, realPathOf(entry))) return `${label} (${dir}) is inside ${entry}, which an update replaces`;
    }
  }
  if (!win32board.bundleRoot({ platform: 'win32', root, exists: hostExists })) {
    return `${root} is not a Kosmos for Windows folder (it has no runtime\\node.exe and app\\server.js)`;
  }
  const pointer = win32anchor.readPointer(process.platform, home, env);
  const engine = path.join(root, 'app', 'engine');
  if (!pointer) return 'Kosmos has no record of which folder it starts from, so an update could not take effect. Double-click Kosmos.exe once, then try again';
  if (!samePath(pointer, engine) && !samePath(realPathOf(pointer), realPathOf(engine))) {
    return `Kosmos starts from ${pointer}, not from ${engine}, so updating ${root} would not change what runs`;
  }
  let st = null;
  try { st = fs.lstatSync(work); } catch { st = null; }
  if (st && st.isSymbolicLink()) return `the updater's folder ${work} is a link to somewhere else`;
  if (st && !st.isDirectory()) return `the updater's folder ${work} is a file, not a folder`;
  if (preparing) return 'an update is already being prepared';
  return null;
}

/* ─── the lock ───────────────────────────────────────────────────────────────────────────── */

/**
 * What a lock file (or a clear claim, which has the same shape) on disk says about its owner, by
 * the lock's one rule:
 *   - an owner that is verifiably RUNNING holds it, whatever its age. A running prepare is
 *     bounded by its own download and time caps, and a hung one lets go when its process exits.
 *     The one exception: the lock names the program that took it (`exe`) and the process now
 *     running under that pid is verifiably a DIFFERENT program. Windows hands a dead pid to a new
 *     process within a few hundred process starts, so a prepare killed by a restart can leave a
 *     lock whose pid a long-lived service now has; that lock is dead (pidNowBelongsToAnotherProgram);
 *   - an owner that is verifiably GONE does not;
 *   - an owner that cannot be verified -- the file is unreadable, names no pid, or the pid check
 *     itself errors -- falls to the age rule: an unreadable file is held for
 *     UNREADABLE_LOCK_GRACE_MS after it was written, any other for STALE_LOCK_MS after the
 *     earlier of its `at` and the file's own mtime (so an `at` in the future cannot hold forever).
 * 🛑 NO WALL-CLOCK ARITHMETIC EVER OVERRULES A LIVE OWNER. A clock can be stepped by hours while a
 * prepare runs (time sync after a logon), and a live owner must never lose its lock to that.
 * A lock that is a folder, or that stays unreadable while it exists, is `broken`: nothing can tell
 * whose it is, and it is never removed automatically.
 * `judge` is `{ clock, processImage, log }`, from takeLock.
 * Returns `{ gone }`, `{ broken, why }`, or `{ held, text, pid, why }`; `text` is the exact
 * contents read.
 */
function readLock(lockPath, judge) {
  const c = judge.clock;
  let st;
  let text = null;
  for (let tries = 1; ; tries += 1) {
    try { st = fs.statSync(lockPath); } catch { return { gone: true }; }
    if (st.isDirectory()) return { broken: true, why: 'is a folder, not a file' };
    try { text = fs.readFileSync(lockPath, 'utf8'); break; } catch (e) {
      /* Removed between the look and the read: gone, and the caller tries again. */
      if (e && e.code === 'ENOENT') return { gone: true };
      if (tries >= UNREADABLE_LOCK_CONFIRM_TRIES) return { broken: true, why: 'cannot be read', code: (e && e.code) || 'unknown' };
      sleepSync(UNREADABLE_LOCK_CONFIRM_WAIT_MS);
    }
  }
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!body || typeof body !== 'object') {
    const young = c.now() - st.mtimeMs < UNREADABLE_LOCK_GRACE_MS;
    return { held: young, text, pid: null, why: young ? 'unreadable, and only just written' : 'unreadable, and not new' };
  }
  const pid = Number.isInteger(body.pid) && body.pid > 0 ? body.pid : null;
  const at = Number(body.at);
  const owner = pid ? win32orphan.pidState(pid) : 'unknown';
  if (owner === 'alive') {
    const other = pidNowBelongsToAnotherProgram(pid, body.exe, judge);
    if (other) return { held: false, text, pid, why: `its process id now belongs to another program (${other})` };
    return { held: true, text, pid, why: 'its process is running' };
  }
  if (owner === 'gone') return { held: false, text, pid, why: 'no longer running' };
  const written = Number.isFinite(at) ? Math.min(at, st.mtimeMs) : st.mtimeMs;
  const recent = c.now() - written < STALE_LOCK_MS;
  return { held: recent, text, pid, why: recent ? 'recent, and its owner cannot be checked' : 'old, and its owner cannot be checked' };
}

/** The wall clock the age rule reads. A seam for the suite; it never decides a live owner's lock. */
const SYSTEM_CLOCK = Object.freeze({ now: () => Date.now() });

/** A program name `tasklist` and a lock can both carry without loss: printable ASCII, no `?`. */
const PLAIN_IMAGE_NAME = /^[\x20-\x3e\x40-\x7e]+$/;

/**
 * The name a lock records for the program that took it (`exe`), or null to record none, which keeps
 * the plain pid rule (the safe direction). A name is recorded only when `tasklist` will name the
 * same process the same way, because a mismatch reads as a reused pid and clears a LIVE lock:
 *   - plain printable ASCII only: `tasklist` prints a non-ASCII name with `?` and U+FFFD in place of
 *     its letters (measured: `nodeé-тест.exe` came back `node�-????.exe`);
 *   - the launched name must be the file's real name, compared case-insensitively: a process started
 *     through a file symlink reports the symlink's name in execPath and the target's in `tasklist`
 *     (measured: `symlinked-name.exe` against `node.exe`), and an 8.3 short name differs from the
 *     long one. `realpathNative` is fs.realpathSync.native, a seam for the suite.
 */
function processImageStamp(execPath, realpathNative) {
  const launched = path.basename(String(execPath));
  if (!PLAIN_IMAGE_NAME.test(launched)) return null;
  let real;
  try { real = path.basename(String(realpathNative(execPath))); } catch { return null; }
  return launched.toLowerCase() === real.toLowerCase() ? launched.toLowerCase() : null;
}
let ownProcessImageStamp;
function ownProcessImage() {
  if (ownProcessImageStamp === undefined) ownProcessImageStamp = processImageStamp(process.execPath, fs.realpathSync.native);
  return ownProcessImageStamp;
}

/**
 * The program image `tasklist` reports for `pid` ("node.exe"), or null when its answer has no row
 * for that pid (the process has gone, or the answer is not the CSV asked for).
 */
function processImageFromTasklist(output, pid) {
  for (const line of String(output).split(/\r?\n/)) {
    const row = /^"([^"]+)","(\d+)"/.exec(line.trim());
    if (row && Number(row[2]) === pid) return row[1];
  }
  return null;
}
function processImageByTasklist(pid) {
  const out = cp.execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
    encoding: 'utf8', timeout: PROCESS_IMAGE_LOOKUP_TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return processImageFromTasklist(out, pid);
}
/** Windows only: elsewhere a lock keeps the plain pid rule. */
const DEFAULT_PROCESS_IMAGE = process.platform === 'win32' ? processImageByTasklist : null;

/**
 * Is the live process with this pid verifiably a different program from the one that took the lock
 * (`stamped`, its `exe`)? Returns that program's name, or null. Every doubt holds the lock:
 *   - a lock with no `exe` (an earlier format), or no lookup on this platform: null;
 *   - a lookup that fails, times out or cannot be read: null, and the code is logged;
 *   - an answer that is not a plain name (a `?` or U+FFFD where `tasklist` lost letters): null;
 *   - the same program: null. Another node.exe that was handed the pid holds the lock until it
 *     exits, which is the residual, in the safe direction.
 */
function pidNowBelongsToAnotherProgram(pid, stamped, judge) {
  if (typeof stamped !== 'string' || !stamped || typeof judge.processImage !== 'function') return null;
  let image;
  try { image = judge.processImage(pid); } catch (e) {
    judge.log(`could not check which program process ${pid} is (code=${(e && e.code) || 'unknown'}); holding its lock`);
    return null;
  }
  if (typeof image !== 'string' || !PLAIN_IMAGE_NAME.test(image)) {
    judge.log(`could not check which program process ${pid} is (code=unparsed); holding its lock`);
    return null;
  }
  return image.toLowerCase() === stamped.toLowerCase() ? null : image.toLowerCase();
}

/**
 * The exact text of a lock this process took and then could not remove on release (releaseLock),
 * or null. The next takeLock in this process treats a lock with exactly these bytes as stale.
 */
let leftBehindLockText = null;

const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) { Atomics.wait(SLEEP_CELL, 0, 0, ms); }

function brokenLockRefusal(file, why) {
  return `Kosmos could not take its update lock: the lock file ${file} ${why}, so the updater cannot tell whether another update is running. Remove that file by hand, then try again`;
}

/**
 * Remove a file of this prepare's own that it no longer needs (a draft, a claim, a link probe),
 * and never throw: another prepare's sweep or cleanup can be removing the same file at that
 * moment, which Windows answers with EPERM rather than ENOENT. A leftover is left for the next
 * holder's sweep. Only the code is logged, because the raw error names internal paths.
 */
function removeOwnLeftover(file, what, log) {
  try { fs.rmSync(file, { force: true }); } catch (e) {
    log(`could not remove ${what} (code=${(e && e.code) || 'unknown'}); the next prepare to hold the lock sweeps it`);
  }
}

/**
 * Can this drive hard-link at all? Links the draft to a fresh unique name, then removes that. Asked
 * only after a link has failed, so a drive is called link-incapable only when a link that nothing
 * else can be interfering with fails too.
 */
function driveCanHardLink(draft, log) {
  const probe = `${draft}.${crypto.randomBytes(4).toString('hex')}.probe`;
  try { fs.linkSync(draft, probe); } catch { return false; }
  removeOwnLeftover(probe, 'a link probe', log);
  return true;
}

const HARD_LINK_REFUSAL = "Kosmos could not take its update lock: this drive can't make the hard links the updater needs (common on FAT32 or exFAT drives), so update by hand, or keep Kosmos on an NTFS drive";
const SWEPT_DRAFT_REFUSAL = 'another update is already being prepared';

/**
 * Publish `draft` under `name` by hard link: atomic, and EEXIST when the name is taken. Returns
 * true when published, false when taken or busy. Any other failure is read by what is on disk,
 * not by its code, because Windows answers EPERM for more than one cause:
 *   - the draft is gone: a prepare that holds the lock swept it, so one is running (a delete that
 *     races the link answers EPERM as often as ENOENT);
 *   - the draft is there and links to a fresh name: the drive can link, and the name was busy (a
 *     lock whose delete is pending cannot be linked over), so the caller looks again;
 *   - the draft is there and cannot link even to a fresh name: FAT32 and exFAT, which have no hard
 *     links (EPERM, EXDEV or ENOTSUP, depending on the driver).
 * Only the error code is logged, because the raw error names internal paths.
 */
function publishByLink(draft, name, log) {
  try {
    fs.linkSync(draft, name);
    return true;
  } catch (e) {
    const code = (e && e.code) || 'unknown';
    if (code === 'EEXIST') return false;
    if (!fs.existsSync(draft)) refuse(SWEPT_DRAFT_REFUSAL);
    if (driveCanHardLink(draft, log)) {
      log(`the prepare lock's link failed with code=${code} on a drive that can link; looking again`);
      return false;
    }
    if (!fs.existsSync(draft)) refuse(SWEPT_DRAFT_REFUSAL);
    log(`could not take the prepare lock: link failed with code=${code}`);
    return refuse(HARD_LINK_REFUSAL);
  }
}

/**
 * Remove a stale lock, and only that exact lock.
 *
 * 🛑 NOTHING IS MOVED ASIDE. Renaming the shared name aside and reading it again cannot be made
 * safe: a second prepare can clear the same stale lock and link its own before the rename, the
 * rename then moves that LIVE lock, a third prepare links into the gap, and the restore can only
 * fail, leaving two holders. So instead:
 *   1. take the CLAIM for this exact lock, `<lock>.<hash of its contents>.clearing`, published by
 *      link, so one prepare holds it; every prepare that judged the same lock stale computes the
 *      same name;
 *   2. holding it, read the lock again; if it is not byte for byte the lock judged stale, leave
 *      it (somebody else replaced it) and let the caller start over;
 *   3. otherwise unlink it. Nothing can have removed or replaced it in between: removing needs
 *      this claim, and a new lock can only be linked once the name is free.
 * A claim lives for microseconds. One left by a clearer that died is judged like a lock
 * (readLock). A dead one is stepped PAST, with the next claim name hashing it in, and never
 * deleted, so no two clearers can disagree about which claim is current. The holder's sweep in
 * prepare() removes the leftovers.
 */
function clearStaleLock(lockPath, stale, draft, log, hooks, judge) {
  let key = crypto.createHash('sha256').update(String(stale.text)).digest('hex');
  for (let step = 0; step < MAX_CLEAR_CLAIM_STEPS; step += 1) {
    const claim = `${lockPath}.${key.slice(0, 16)}.clearing`;
    if (!publishByLink(draft, claim, log)) {
      const other = readLock(claim, judge);
      if (other.gone) continue;
      if (other.broken) refuse(brokenLockRefusal(claim, other.why));
      if (other.held) refuse(`another update is already being prepared (process ${other.pid || 'unknown'} is clearing an old lock)`);
      key = crypto.createHash('sha256').update(key + String(other.text)).digest('hex');
      continue;
    }
    try {
      let now = null;
      try { now = fs.readFileSync(lockPath, 'utf8'); } catch { now = null; }
      if (now === null || now !== stale.text) return;
      if (typeof hooks.beforeRemove === 'function') hooks.beforeRemove();
      /* A scanner can still hold the lock (the one a release could not remove, most often). The
         raw error names the lock's full path, so only its code is logged, and leftBehindLockText
         stays set for a later prepare to try again.
         ENOENT is the goal already met: the verified stale lock vanished before the unlink (a
         scanner's quarantine, a cleanup tool, a person). That is safe to go on from, because
         clearing never makes this prepare the owner: takeLock still takes the lock only by the
         exclusive link of its draft, so a prepare that linked its own lock in the meantime keeps
         it and this one refuses as busy. */
      try { fs.unlinkSync(lockPath); } catch (e) {
        if (!(e && e.code === 'ENOENT')) {
          log(`could not remove a stale prepare lock yet (code=${(e && e.code) || 'unknown'})`);
          refuse('another update is already being prepared (an old lock could not be removed yet)');
        }
        log('the stale prepare lock was already gone when its claim came to remove it (code=ENOENT)');
      }
      if (stale.text === leftBehindLockText) leftBehindLockText = null;
      log(`cleared a stale prepare lock (process ${stale.pid || 'unknown'}, ${stale.why})`);
    } finally {
      removeOwnLeftover(claim, 'its clear claim', log);
    }
    return;
  }
  refuse('another update is already being prepared (an old lock could not be cleared)');
}

/**
 * Take the prepare lock, or refuse. Returns the exact text written, so release can tell the lock
 * is still this prepare's.
 *
 * The lock is PUBLISHED WHOLE: its contents go into a draft file first, and the draft is
 * hard-linked to the lock's name, which either succeeds atomically or fails with EEXIST. So no
 * reader ever sees a lock without its owner in it. A lock that readLock calls stale is removed
 * only through clearStaleLock; a lock with a running owner never is.
 *
 * The lock names the program that took it (`exe`), when `tasklist` will name it the same way
 * (processImageStamp), so a lock whose pid Windows has since handed to a different program is dead
 * (readLock).
 *
 * A lock with exactly the text of one this process could not remove on release
 * (leftBehindLockText) is stale, and is cleared through the claim like any other. Only a finished
 * prepare in this process wrote those bytes, and `preparing` rules out a running one here.
 *
 * `hooks.beforeClear` (between judging a lock stale and claiming it) and `hooks.beforeRemove`
 * (holding the claim, after reading the stale lock again and before removing it) are test seams
 * for the races; `hooks.clock` ({ now }) stands in for the wall clock, and `hooks.processImage`
 * (pid => program name) for the `tasklist` lookup (null turns the check off).
 *
 * Removing the draft afterwards can fail (another prepare's sweep removing it at the same moment);
 * that is logged and never turns a lock this prepare took into a throw.
 */
function takeLock(lockPath, log, hooks) {
  const h = hooks || {};
  const judge = {
    clock: h.clock || SYSTEM_CLOCK,
    processImage: h.processImage !== undefined ? h.processImage : DEFAULT_PROCESS_IMAGE,
    log,
  };
  const now = judge.clock.now();
  const unique = `${process.pid}-${now}-${crypto.randomBytes(4).toString('hex')}`;
  const draft = `${lockPath}.${unique}.draft`;
  const exe = ownProcessImage();
  const text = JSON.stringify({ pid: process.pid, at: now, ...(exe ? { exe } : {}), token: unique });
  fs.writeFileSync(draft, text, { flag: 'wx' });
  try {
    for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt += 1) {
      if (publishByLink(draft, lockPath, log)) return text;
      let seen = readLock(lockPath, judge);
      if (seen.gone) continue;
      if (seen.held && leftBehindLockText !== null && seen.text === leftBehindLockText) {
        seen = { ...seen, held: false, why: 'left behind by an earlier prepare in this board that could not remove it' };
      }
      if (seen.broken) {
        log(`the prepare lock ${seen.why}${seen.code ? ` (code=${seen.code})` : ''}`);
        refuse(brokenLockRefusal(lockPath, seen.why));
      }
      if (seen.held) refuse(`another update is already being prepared (${seen.pid ? 'process ' + seen.pid : 'its lock is ' + seen.why})`);
      if (typeof h.beforeClear === 'function') h.beforeClear();
      clearStaleLock(lockPath, seen, draft, log, h, judge);
    }
    refuse('another update is already being prepared');
  } finally {
    removeOwnLeftover(draft, 'its lock draft', log);
  }
}

/**
 * Once a prepare HOLDS the lock, remove what attempts that died mid-lock left beside it: drafts,
 * clear claims, link probes, and asides from the lock's first design. Only a holder may: a racer
 * whose draft this removes refuses as busy (publishByLink).
 *
 * 🧹 BEST-EFFORT FOR EVERY ERROR. This is housekeeping, and it runs in a prepare that already holds
 * the lock, so nothing it meets may fail that prepare: another prepare's cleanup removing the same
 * file (EPERM), a scanner holding it, a stray folder with a leftover's name, even EIO. Real disk
 * trouble surfaces in the download and staging that follow. Each failure is logged by its code and
 * the entry's own name (never the full path) and the entry is left.
 */
function sweepLockLeftovers(work, inWork, log) {
  for (const name of fs.readdirSync(work)) {
    if (!name.startsWith(LOCK_NAME + '.')) continue;
    try { fs.rmSync(inWork(path.join(work, name)), { force: true }); } catch (e) {
      log(`left a leftover beside the prepare lock for later (code=${(e && e.code) || 'unknown'} entry=${name})`);
    }
  }
}

/**
 * Release the lock only if it is still the one this prepare took.
 *
 * A scanner or backup tool can hold the file without delete sharing, so the read and the removal
 * are tried LOCK_RELEASE_TRIES times. If the lock still cannot be removed it would name this
 * board's own live process and refuse every later prepare here until a restart, so its exact text
 * is remembered (leftBehindLockText) for the next takeLock in this process to clear through the
 * claim. Failures are logged by code, since the raw errors name internal paths.
 */
function releaseLock(lockPath, text, log) {
  for (let tries = 1; ; tries += 1) {
    let now = null;
    try { now = fs.readFileSync(lockPath, 'utf8'); } catch (e) {
      if (e && e.code === 'ENOENT') return;
      log(`could not read the prepare lock to release it (code=${(e && e.code) || 'unknown'}, try ${tries} of ${LOCK_RELEASE_TRIES})`);
    }
    if (now !== null && now !== text) { log('the prepare lock was taken over while this prepare ran; leaving it'); return; }
    if (now === text) {
      try { fs.rmSync(lockPath, { force: true }); return; } catch (e) {
        log(`could not remove the prepare lock (code=${(e && e.code) || 'unknown'}, try ${tries} of ${LOCK_RELEASE_TRIES})`);
      }
    }
    if (tries >= LOCK_RELEASE_TRIES) {
      leftBehindLockText = text;
      log('left the prepare lock behind; the next prepare in this board clears it');
      return;
    }
    sleepSync(LOCK_RELEASE_WAIT_MS);
  }
}

/* ─── the network ────────────────────────────────────────────────────────────────────────── */

/**
 * GET a URL under a deadline. Resolves to `{ res, done }`, where `done()` clears the deadline
 * timer and must be called once the body has been read. Refuses with a sentence on no answer or
 * a non-2xx answer, and logs the URL and the status.
 */
async function open(doFetch, url, what, deadlineAt, log) {
  log(`GET ${url}`);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(0, deadlineAt - Date.now()));
  const done = () => clearTimeout(timer);
  let res;
  try {
    res = await doFetch(url, { signal: ctl.signal, cache: 'no-store' });
  } catch (e) {
    done();
    log(`GET failed url=${url} error=${firstLine(e)}`);
    refuse(`we could not reach the release host for ${what} (${firstLine(e)})`);
  }
  if (!res || !res.ok) {
    done();
    const status = res ? res.status : 'no answer';
    log(`GET failed url=${url} status=${status}`);
    refuse(`the release host answered ${status} for ${what}`);
  }
  return { res, done };
}

/**
 * Read a response body chunk by chunk, handing each to `onChunk`, under a byte cap and a deadline.
 * The deadline is enforced here as well as by the fetch's abort signal, so a transport that
 * ignores the signal still cannot hang the update. Returns the byte count.
 */
async function readBody(res, { what, maxBytes, startedAt, deadlineAt, onChunk }) {
  const tooSlow = () => refuse(`${what} took longer than the ${Math.round((deadlineAt - startedAt) / 1000)} seconds allowed`);
  if (!res.body || typeof res.body.getReader !== 'function') refuse(`the release host sent no ${what}`);
  const reader = res.body.getReader();
  let total = 0;
  try {
    for (;;) {
      const left = deadlineAt - Date.now();
      if (left <= 0) tooSlow();
      let timer;
      const timeUp = new Promise((resolve) => { timer = setTimeout(() => resolve(null), left); });
      let step;
      try { step = await Promise.race([reader.read(), timeUp]); } finally { clearTimeout(timer); }
      if (step === null) tooSlow();
      if (step.done) break;
      total += step.value.byteLength;
      if (total > maxBytes) refuse(`${what} is larger than the ${sizeInWords(maxBytes)} this updater will download`);
      onChunk(step.value);
    }
  } catch (e) {
    try { reader.cancel().catch(() => {}); } catch { /* already closed */ }
    if (e instanceof PrepareRefusal) throw e;
    if (Date.now() >= deadlineAt) tooSlow();
    refuse(`the download of ${what} was interrupted (${firstLine(e)})`);
  }
  return total;
}

async function fetchSmallText(doFetch, url, what, limits, log) {
  const startedAt = Date.now();
  const deadlineAt = startedAt + limits.maxSmallFetchMs;
  const { res, done } = await open(doFetch, url, what, deadlineAt, log);
  const chunks = [];
  try {
    await readBody(res, { what, maxBytes: limits.maxSmallFetchBytes, startedAt, deadlineAt, onChunk: (c) => chunks.push(Buffer.from(c)) });
  } finally { done(); }
  return Buffer.concat(chunks).toString('utf8');
}

/** The sidecar publish-kosmos-windows.sh writes: `shasum -a 256 <name>`, so "<hex>  <name>". */
function sidecarSha(text, versioned) {
  const m = /^([0-9a-fA-F]{64})(?:[ \t]+\*?(\S+))?\s*$/.exec(String(text).trim());
  if (!m) refuse(`the checksum file the site published for ${versioned} could not be read`);
  if (m[2] && m[2] !== versioned) refuse(`the checksum file the site published names ${m[2]}, not ${versioned}`);
  return m[1].toLowerCase();
}

/* ─── B1 ─────────────────────────────────────────────────────────────────────────────────── */

async function readOffer(ctx) {
  const pointerUrl = `${ctx.base}/${update.pointerFor('win32', ctx.channel)}`;
  const text = await fetchSmallText(ctx.fetch, pointerUrl, 'the update pointer', ctx.limits, ctx.log);
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  /* The S1 rule: an x.y.z version, a 64-hex sha256, and `versioned` naming exactly this
     version's build for this arch. `artifact` (the moving alias) is never read. */
  const latest = update.readManifest('win32', body, ctx.arch);
  if (!latest) refuse(`the update pointer at ${pointerUrl} does not name a Windows build for this computer (${ctx.arch})`);
  const installed = (readJson(path.join(ctx.root, 'app', 'package.json')) || {}).version;
  if (!update.newer(latest.version, installed)) {
    refuse(`this Kosmos is ${installed || 'of an unknown version'} and the site offers ${latest.version}, so there is nothing newer to install`);
  }
  if (ctx.expectVersion && latest.version !== ctx.expectVersion) {
    refuse(`the site now offers ${latest.version}, not the ${ctx.expectVersion} that was on offer, so check for updates again`);
  }
  return latest;
}

/* ─── B2 ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * Returns `{ sha256, bytes }`: the download's hash and the very bytes that were hashed, which B3
 * unpacks. The copy in WORK\download.part is written alongside, and never read back, so nothing
 * can change the bytes between the hash and the unpack.
 */
async function download(ctx, latest) {
  const sidecarUrl = `${ctx.base}/${latest.versioned}.sha256`;
  const published = sidecarSha(await fetchSmallText(ctx.fetch, sidecarUrl, 'the update checksum', ctx.limits, ctx.log), latest.versioned);
  if (published !== latest.sha256) {
    refuse(`the site's checksum file and its update pointer disagree about ${latest.versioned}, so neither can be trusted`);
  }

  const zipUrl = `${ctx.base}/${latest.versioned}?v=${encodeURIComponent(latest.version)}`;
  const startedAt = Date.now();
  const deadlineAt = startedAt + ctx.limits.maxDownloadMs;
  const { res, done } = await open(ctx.fetch, zipUrl, 'the update', deadlineAt, ctx.log);
  const hash = crypto.createHash('sha256');
  const chunks = [];
  let received = 0;
  let declared = null;
  try {
    const header = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : null;
    declared = header !== null && /^\d+$/.test(String(header).trim()) ? Number(header) : null;
    if (declared !== null && declared > ctx.limits.maxDownloadBytes) {
      refuse(`the update is ${sizeInWords(declared)}, larger than the ${sizeInWords(ctx.limits.maxDownloadBytes)} this updater will download`);
    }
    /* B0's free-disk precondition, run here because this is where the size is first known. */
    const need = ctx.limits.diskHeadroomMultiple * (declared !== null ? declared : ctx.limits.maxDownloadBytes);
    const free = ctx.freeBytes(ctx.work);
    if (free < need) {
      refuse(`there is not enough free disk space next to your Kosmos folder: the update needs about ${sizeInWords(need)} free and there is ${sizeInWords(free)}`);
    }
    const fd = fs.openSync(ctx.inWork(ctx.part), 'wx');
    try {
      received = await readBody(res, {
        what: 'the update', maxBytes: ctx.limits.maxDownloadBytes, startedAt, deadlineAt,
        onChunk: (chunk) => {
          hash.update(chunk);
          chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
          fs.writeSync(fd, chunk);
        },
      });
    } finally { fs.closeSync(fd); }
  } finally { done(); }
  if (declared !== null && received < declared) {
    refuse(`the download stopped early: ${received} of ${declared} bytes arrived`);
  }
  if (declared !== null && received > declared) {
    refuse(`the release host sent ${received} bytes after announcing ${declared}, so the download is not the file it described`);
  }
  const computed = hash.digest('hex');
  if (computed !== latest.sha256) {
    refuse('the downloaded update does not match the checksum the site published for it, so it was damaged on the way or is not the build the site names');
  }
  ctx.log(`downloaded ${latest.versioned}: ${received} bytes, sha256 ${computed}`);
  return { sha256: computed, bytes: Buffer.concat(chunks, received) };
}

/* ─── B3 ─────────────────────────────────────────────────────────────────────────────────── */

function unpackRefusal(e) {
  return e instanceof win32zip.ZipRefusal
    ? 'the downloaded update could not be unpacked: ' + e.message
    : `the downloaded update could not be unpacked (${firstLine(e)})`;
}

function unpack(ctx, bytes) {
  const zipLimits = {
    allowedTopLevel: ENTRIES,
    maxEntries: ctx.limits.maxEntries,
    maxEntryBytes: ctx.limits.maxEntryBytes,
    maxTotalBytes: ctx.limits.maxUnpackedBytes,
  };
  let listing;
  try { listing = win32zip.readZipDirectory(bytes, zipLimits); } catch (e) { refuse(unpackRefusal(e)); }
  const unpacked = listing.reduce((n, entry) => n + entry.uncompressedSize, 0);
  const free = ctx.freeBytes(ctx.work);
  if (free < unpacked) {
    refuse(`there is not enough free disk space next to your Kosmos folder: the update unpacks to ${sizeInWords(unpacked)} and there is ${sizeInWords(free)} free`);
  }
  try { win32zip.extractZip(bytes, ctx.inWork(ctx.staged), zipLimits); } catch (e) { refuse(unpackRefusal(e)); }
  fs.rmSync(ctx.inWork(ctx.part), { force: true });
}

/* ─── B4 ─────────────────────────────────────────────────────────────────────────────────── */

function verifyStaged(ctx, latest) {
  const staged = ctx.staged;
  const manifest = readJson(path.join(staged, 'manifest.json'));
  if (!manifest) refuse('the update has no readable manifest.json');
  if (manifest.platform !== 'win32') refuse(`the update's manifest.json is for ${JSON.stringify(manifest.platform)}, not Windows`);
  if (manifest.version !== latest.version) refuse(`the update's manifest.json says ${JSON.stringify(manifest.version)}, but the site published it as ${latest.version}`);
  if (manifest.arch !== ctx.arch) refuse(`the update's manifest.json is for ${JSON.stringify(manifest.arch)}, not this computer (${ctx.arch})`);
  const pkg = readJson(path.join(staged, 'app', 'package.json'));
  if (!pkg || pkg.version !== latest.version) {
    refuse(`the update's app says it is ${pkg ? JSON.stringify(pkg.version) : 'no version at all'}, but the site published it as ${latest.version}`);
  }
  for (const entry of REQUIRED_ENTRIES) {
    let st = null;
    try { st = fs.statSync(path.join(staged, ...entry.split('/'))); } catch { st = null; }
    if (!st || !st.isFile()) refuse(`the update is missing ${entry.split('/').join('\\')}`);
  }

  const stagedNode = path.join(staged, 'runtime', 'node.exe');
  let printed = '';
  try {
    printed = String(ctx.runStagedNode(stagedNode, ctx.limits.stagedNodeTimeoutMs)).trim();
  } catch (e) {
    const why = e && e.code === 'ETIMEDOUT' ? `it did not answer within ${Math.round(ctx.limits.stagedNodeTimeoutMs / 1000)} seconds` : firstLine(e);
    refuse(`the Node runtime inside the update did not run (${why})`);
  }
  if (!/^v\d+\.\d+\.\d+$/.test(printed)) refuse(`the Node runtime inside the update did not report a version (it printed ${JSON.stringify(printed.slice(0, 80))})`);
  const namedNode = manifest.node && manifest.node.version;
  if (namedNode && printed !== namedNode) refuse(`the Node runtime inside the update is ${printed}, but its manifest.json names ${namedNode}`);

  const anchoredNode = path.join(win32anchor.anchorDir(process.platform, ctx.home, ctx.env), win32anchor.NODE_NAME);
  const runtimeChanged = interpreterDiffers(stagedNode, anchoredNode);

  /* The identity the new board will answer with, from the two functions server.js computes its
     own header with, over the staged app and the world the new board will serve. */
  const build = win32handoff.buildIdentity(path.join(staged, 'app'));
  if (!build) refuse('the update\'s app has no version to identify it by');
  return { runtimeChanged, expectedIdentity: win32handoff.boardIdentity(build, resolveWorld(ctx.world)) };
}

/* ─── prepare ────────────────────────────────────────────────────────────────────────────── */

/**
 * Download, verify and stage the newest Windows build into `<ROOT>\.kosmos-update\staged`.
 *
 * Options, each with the production default:
 *   root      the Kosmos folder (win32board.bundleRoot())
 *   base      the release host (update.releaseBase())
 *   channel   'prod' or 'staging' (update.updateChannel('win32'))
 *   arch      process.arch
 *   expectVersion  when given, the version the person accepted; a pointer that moved is refused
 *   world     the world the new board will serve (resolveWorld: this board's, else the registry's)
 * and the seams a suite or the live-check CLI sets: platform, env, home, fetch, freeBytes,
 * runStagedNode, liveExecutionAllowed, limits, log, lockHooks.
 */
async function prepare(opts) {
  const o = opts || {};
  const log = typeof o.log === 'function' ? o.log : defaultLog;
  const platform = o.platform || process.platform;
  const env = o.env || process.env;
  const home = o.home || os.homedir();
  if (platform !== 'win32') return { ok: false, because: 'the in-app updater is for Kosmos on Windows, and this is not Windows' };
  const given = o.root || win32board.bundleRoot({ platform });
  if (!given) return { ok: false, because: 'this Kosmos is not running from the Windows download, so there is nothing for the updater to replace' };
  const root = path.resolve(given);
  const base = String(o.base || update.releaseBase()).replace(/\/+$/, '');

  const b0 = preconditionRefusal(root, env, home);
  if (b0) { log(`refused before starting: ${b0}`); return { ok: false, because: b0 }; }
  const allowed = typeof o.liveExecutionAllowed === 'function' ? o.liveExecutionAllowed : liveExec.liveExecutionAllowed;
  if (!allowed()) {
    liveExec.refuseOrWarn('engine/win32update.js', 'prepare', ['--root', root, '--base', base]);
    return { ok: false, because: LIVE_REFUSAL };
  }

  const work = path.join(root, WORK_DIRNAME);
  const inWork = workGuard(work);
  const ctx = {
    root, work, inWork, base, env, home, log,
    part: path.join(work, DOWNLOAD_PART_NAME),
    staged: path.join(work, STAGED_DIRNAME),
    channel: o.channel || update.updateChannel('win32'),
    arch: o.arch || process.arch,
    expectVersion: o.expectVersion || null,
    world: o.world || null,
    limits: { ...DEFAULT_LIMITS, ...(o.limits || {}) },
    fetch: typeof o.fetch === 'function' ? o.fetch : fetch,
    freeBytes: typeof o.freeBytes === 'function' ? o.freeBytes : defaultFreeBytes,
    runStagedNode: typeof o.runStagedNode === 'function' ? o.runStagedNode : runStagedNode,
  };
  const lockPath = path.join(work, LOCK_NAME);

  preparing = true;
  let lockText = null;
  let result;
  try {
    if (!fs.existsSync(work)) fs.mkdirSync(work);
    if (!samePath(fs.realpathSync.native(work), path.join(fs.realpathSync.native(root), WORK_DIRNAME))) {
      refuse(`the updater's folder ${work} leads somewhere else`);
    }
    lockText = takeLock(inWork(lockPath), log, o.lockHooks);
    sweepLockLeftovers(work, inWork, log);
    /* Whatever an earlier attempt left. Both are WORK's own. */
    fs.rmSync(inWork(ctx.part), { force: true });
    fs.rmSync(inWork(ctx.staged), { recursive: true, force: true });

    const latest = await readOffer(ctx);
    const downloaded = await download(ctx, latest);
    unpack(ctx, downloaded.bytes);
    const verified = verifyStaged(ctx, latest);
    result = { ok: true, version: latest.version, sha256: downloaded.sha256, stagedDir: ctx.staged, runtimeChanged: verified.runtimeChanged, expectedIdentity: verified.expectedIdentity };
  } catch (e) {
    if (e instanceof PrepareRefusal) {
      result = { ok: false, because: e.message };
    } else {
      log(`unexpected failure: ${(e && e.stack) || e}`);
      result = { ok: false, because: `the update could not be prepared (${firstLine(e)})` };
    }
  } finally {
    preparing = false;
  }

  if (lockText) {
    if (!result.ok) {
      try { fs.rmSync(inWork(ctx.part), { force: true }); } catch (e) { log(`could not remove ${ctx.part}: ${firstLine(e)}`); }
      try { fs.rmSync(inWork(ctx.staged), { recursive: true, force: true }); } catch (e) { log(`could not remove ${ctx.staged}: ${firstLine(e)}`); }
    }
    try {
      fs.writeFileSync(inWork(path.join(work, STATUS_NAME)), JSON.stringify({ ...result, at: new Date().toISOString() }, null, 2) + '\n');
    } catch (e) { log(`could not record the outcome: ${firstLine(e)}`); }
    try { releaseLock(inWork(lockPath), lockText, log); } catch (e) { log(`could not remove the prepare lock: ${firstLine(e)}`); }
  }
  log(result.ok ? `staged ${result.version} in ${result.stagedDir}` : `could not prepare the update: ${result.because}`);
  return result;
}

/* ─── the live-check CLI ─────────────────────────────────────────────────────────────────── */

const USAGE = 'usage: node engine/win32update.js --prepare --root <folder> [--base <url>] [--channel prod|staging] [--world <id>] [--yes]';

function parseCliArgs(argv) {
  const a = { prepare: false, yes: false, root: null, base: null, channel: null, world: null, unknown: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--prepare') a.prepare = true;
    else if (arg === '--yes') a.yes = true;
    else if (['--root', '--base', '--channel', '--world'].includes(arg)) { a[arg.slice(2)] = argv[i + 1] || null; i += 1; }
    else a.unknown = arg;
  }
  return a;
}

/**
 * `--yes` is the operator's explicit opt-in, and it stands in for allowLiveExecution(), which
 * only server.js's real start may call. Without it this prints what it would do and exits 2.
 * Without `--world`, the world is the registry's active one (resolveWorld), and the dry run says
 * which.
 */
async function cliMain(argv, write) {
  const out = typeof write === 'function' ? write : (s) => process.stdout.write(s);
  const a = parseCliArgs(argv);
  if (!a.prepare || !a.root || a.unknown) { out(USAGE + '\n'); return 64; }
  if (!a.yes) {
    const root = path.resolve(a.root);
    out(JSON.stringify({
      dryRun: true, root, base: a.base || update.releaseBase(), channel: a.channel || update.updateChannel('win32'),
      world: resolveWorld(a.world),
      writesUnder: path.join(root, WORK_DIRNAME),
      because: 'nothing was downloaded: add --yes to download, verify and stage the update',
    }, null, 2) + '\n');
    return 2;
  }
  const r = await prepare({ root: a.root, base: a.base, channel: a.channel, world: a.world, liveExecutionAllowed: () => true });
  out(JSON.stringify(r, null, 2) + '\n');
  return r.ok ? 0 : 1;
}

module.exports = {
  prepare, cliMain, runStagedNode, stagedNodeLaunch, workGuard, takeLock, sweepLockLeftovers, resolveWorld,
  processImageFromTasklist, processImageStamp,
  REQUIRED_ENTRIES, ENTRIES, WORK_DIRNAME, DEFAULT_LIMITS, STAGED_NODE_ENV_KEYS,
};

/* Guarded on being the main module: requiring this file must never download anything. */
if (require.main === module) {
  cliMain(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => { process.stderr.write(String((e && e.stack) || e) + '\n'); process.exitCode = 1; },
  );
}

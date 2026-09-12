'use strict';
/**
 * The Windows in-app updater, slice S2: download, verify and STAGE a newer Windows build.
 * It never swaps anything in. The swap (S3) and the button (S4) are later slices; nothing in the
 * product calls `prepare()` yet, and SELF_INSTALL is still darwin-only.
 *
 * 🔑 THE WHOLE SLICE WRITES INSIDE ONE FOLDER, `<ROOT>\.kosmos-update\` (WORK), where ROOT is
 * the unpacked Kosmos folder the board runs from. On the same volume as ROOT, so the S3 swap is
 * renames rather than copies. Every write below goes through `inWork()`, and the suite snapshots
 * everything outside WORK before and after.
 *
 * The flow is the design's B0-B4:
 *   B0  preconditions, each a sentence (and the live-execution gate, convention 3);
 *   B1  the Windows pointer, read with the S1 rule (update.pointerFor / update.readManifest);
 *   B2  the checksum sidecar, then the versioned zip streamed into WORK\download.part while hashing,
 *       under caps on size and time; computed = pointer = sidecar;
 *   B3  unpacked with engine/win32zip.js into WORK\staged, allow-listed to ENTRIES;
 *   B4  the staged tree checked: its manifest, its app version, its required files, its node.exe
 *       actually running, whether that node.exe differs from the anchored one, and the board
 *       identity it will answer with.
 *
 * Returns `{ ok: true, version, sha256, stagedDir, runtimeChanged, expectedIdentity }` or
 * `{ ok: false, because }`, and never throws for an expected failure.
 *
 * A CLI for the live check (a dry run unless --yes):
 *     node engine/win32update.js --prepare --root <folder> [--base <url>] [--channel staging] [--yes]
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

/* The scratch folder and the three things in it. */
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
/** Bytes downloaded for the zip: about 7x the 37 MB build. */
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
/** A lock older than a whole prepare can take belongs to a prepare that is not coming back. */
const STALE_LOCK_MS = 2 * MAX_DOWNLOAD_MS;

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
/** Is `child` the folder `parent`, or somewhere inside it? */
function insideOrEqual(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || !(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel));
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
 * Run the staged interpreter once. It is a freshly downloaded binary, so it gets a timeout and no
 * NODE_OPTIONS from this process (a --require there would run inside it).
 */
function runStagedNode(nodeExe, timeoutMs) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  return String(cp.execFileSync(nodeExe, ['-p', 'process.version'], {
    encoding: 'utf8', timeout: timeoutMs, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env,
  })).trim();
}

/** Does the staged node.exe differ from the anchored one the fleet runs on? Size first, then
    sha-256, so the common "same Node" case is two stats and two hashes, never a copy. */
function interpreterDiffers(stagedNode, anchoredNode) {
  let anchoredSize;
  try { anchoredSize = fs.statSync(anchoredNode).size; } catch { return true; }
  if (fs.statSync(stagedNode).size !== anchoredSize) return true;
  return sha256OfFile(stagedNode) !== sha256OfFile(anchoredNode);
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
  if (path.parse(root).root === root) {
    return `${root} is the top of a drive, and the updater only replaces a Kosmos folder`;
  }
  const work = path.join(root, WORK_DIRNAME);
  for (const [label, dir, why] of protectedFolders(env, home)) {
    if (!dir) return `we could not work out where ${label} is (${why || 'no detail'}), so an update could not be sure to leave it alone`;
    if (insideOrEqual(root, dir)) return `${root} is inside ${label} (${dir}), and an update must never move anything there`;
    for (const entry of [WORK_DIRNAME, ...ENTRIES]) {
      const moved = path.join(root, entry);
      if (insideOrEqual(dir, moved)) return `${label} (${dir}) is inside ${moved}, which an update replaces`;
    }
  }
  if (!win32board.bundleRoot({ platform: 'win32', root, exists: hostExists })) {
    return `${root} is not a Kosmos for Windows folder (it has no runtime\\node.exe and app\\server.js)`;
  }
  const pointer = win32anchor.readPointer(process.platform, home, env);
  const engine = path.join(root, 'app', 'engine');
  if (!pointer) return 'Kosmos has no record of which folder it starts from, so an update could not take effect. Double-click Kosmos.exe once, then try again';
  if (!samePath(pointer, engine)) return `Kosmos starts from ${pointer}, not from ${engine}, so updating ${root} would not change what runs`;
  let st = null;
  try { st = fs.lstatSync(work); } catch { st = null; }
  if (st && st.isSymbolicLink()) return `the updater's folder ${work} is a link to somewhere else`;
  if (st && !st.isDirectory()) return `the updater's folder ${work} is a file, not a folder`;
  if (preparing) return 'an update is already being prepared';
  return null;
}

/* ─── the lock ───────────────────────────────────────────────────────────────────────────── */

function takeLock(lockPath, log) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() })); } finally { fs.closeSync(fd); }
      return;
    } catch (e) {
      if (!e || e.code !== 'EEXIST') throw e;
      const held = readJson(lockPath) || {};
      const alive = Number.isInteger(held.pid) && win32orphan.pidAlive(held.pid);
      const fresh = Number(held.at) > Date.now() - STALE_LOCK_MS;
      if (alive && fresh) refuse(`another update is already being prepared (process ${held.pid})`);
      log(`clearing a stale prepare lock (process ${held.pid}, ${alive ? 'too old' : 'no longer running'})`);
      fs.rmSync(lockPath, { force: true });
    }
  }
  refuse('another update is already being prepared');
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
async function readBody(res, { what, maxBytes, deadlineAt, onChunk }) {
  if (!res.body || typeof res.body.getReader !== 'function') refuse(`the release host sent no ${what}`);
  const reader = res.body.getReader();
  let total = 0;
  try {
    for (;;) {
      const left = deadlineAt - Date.now();
      if (left <= 0) refuse(`${what} took longer than the ${Math.round((deadlineAt - res.startedAt) / 1000)} seconds allowed`);
      let timer;
      const timeUp = new Promise((resolve) => { timer = setTimeout(() => resolve(null), left); });
      let step;
      try { step = await Promise.race([reader.read(), timeUp]); } finally { clearTimeout(timer); }
      if (step === null) refuse(`${what} took longer than the ${Math.round((deadlineAt - res.startedAt) / 1000)} seconds allowed`);
      if (step.done) break;
      total += step.value.byteLength;
      if (total > maxBytes) refuse(`${what} is larger than the ${sizeInWords(maxBytes)} this updater will download`);
      onChunk(step.value);
    }
  } catch (e) {
    try { reader.cancel().catch(() => {}); } catch { /* already closed */ }
    if (e instanceof PrepareRefusal) throw e;
    if (Date.now() >= deadlineAt) refuse(`${what} took longer than the ${Math.round((deadlineAt - res.startedAt) / 1000)} seconds allowed`);
    refuse(`the download of ${what} was interrupted (${firstLine(e)})`);
  }
  return total;
}

async function fetchSmallText(doFetch, url, what, limits, log) {
  const startedAt = Date.now();
  const deadlineAt = startedAt + limits.maxSmallFetchMs;
  const { res, done } = await open(doFetch, url, what, deadlineAt, log);
  res.startedAt = startedAt;
  const chunks = [];
  try {
    await readBody(res, { what, maxBytes: limits.maxSmallFetchBytes, deadlineAt, onChunk: (c) => chunks.push(Buffer.from(c)) });
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
  res.startedAt = startedAt;
  const hash = crypto.createHash('sha256');
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
        what: 'the update', maxBytes: ctx.limits.maxDownloadBytes, deadlineAt,
        onChunk: (chunk) => { hash.update(chunk); fs.writeSync(fd, chunk); },
      });
    } finally { fs.closeSync(fd); }
  } finally { done(); }
  if (declared !== null && received !== declared) {
    refuse(`the download stopped early: ${received} of ${declared} bytes arrived`);
  }
  const computed = hash.digest('hex');
  if (computed !== latest.sha256) {
    refuse('the downloaded update does not match the checksum the site published for it, so it was damaged on the way or is not the build the site names');
  }
  ctx.log(`downloaded ${latest.versioned}: ${received} bytes, sha256 ${computed}`);
  return computed;
}

/* ─── B3 ─────────────────────────────────────────────────────────────────────────────────── */

function unpackRefusal(e) {
  return e instanceof win32zip.ZipRefusal
    ? 'the downloaded update could not be unpacked: ' + e.message
    : `the downloaded update could not be unpacked (${firstLine(e)})`;
}

function unpack(ctx) {
  const zipLimits = {
    allowedTopLevel: ENTRIES,
    maxEntries: ctx.limits.maxEntries,
    maxEntryBytes: ctx.limits.maxEntryBytes,
    maxTotalBytes: ctx.limits.maxUnpackedBytes,
  };
  const buf = fs.readFileSync(ctx.part);
  let listing;
  try { listing = win32zip.readZipDirectory(buf, zipLimits); } catch (e) { refuse(unpackRefusal(e)); }
  const unpacked = listing.reduce((n, entry) => n + entry.uncompressedSize, 0);
  const free = ctx.freeBytes(ctx.work);
  if (free < unpacked) {
    refuse(`there is not enough free disk space next to your Kosmos folder: the update unpacks to ${sizeInWords(unpacked)} and there is ${sizeInWords(free)} free`);
  }
  try { win32zip.extractZip(buf, ctx.inWork(ctx.staged), zipLimits); } catch (e) { refuse(unpackRefusal(e)); }
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
     own header with, over the staged app and the world this board serves. */
  const build = win32handoff.buildIdentity(path.join(staged, 'app'));
  if (!build) refuse('the update\'s app has no version to identify it by');
  const world = ctx.world || require('./worldenv').bootedWorld() || require('./worlds').DEFAULT_ID;
  return { runtimeChanged, expectedIdentity: win32handoff.boardIdentity(build, world) };
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
 *   world     the world the new board will serve (worldenv.bootedWorld())
 * and the seams a suite or the live-check CLI sets: platform, env, home, fetch, freeBytes,
 * runStagedNode, liveExecutionAllowed, limits, log.
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
  const inWork = (target) => {
    if (samePath(target, work) || !insideOrEqual(target, work)) throw new Error(`refusing to write ${target}, which is outside ${work}`);
    return target;
  };
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
  let lockHeld = false;
  let result;
  try {
    if (!fs.existsSync(work)) fs.mkdirSync(work);
    if (!samePath(fs.realpathSync(work), path.join(fs.realpathSync(root), WORK_DIRNAME))) {
      refuse(`the updater's folder ${work} leads somewhere else`);
    }
    takeLock(inWork(lockPath), log);
    lockHeld = true;
    /* Whatever an earlier attempt left. Both are WORK's own. */
    fs.rmSync(inWork(ctx.part), { force: true });
    fs.rmSync(inWork(ctx.staged), { recursive: true, force: true });

    const latest = await readOffer(ctx);
    const sha256 = await download(ctx, latest);
    unpack(ctx);
    const verified = verifyStaged(ctx, latest);
    result = { ok: true, version: latest.version, sha256, stagedDir: ctx.staged, runtimeChanged: verified.runtimeChanged, expectedIdentity: verified.expectedIdentity };
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

  if (lockHeld) {
    if (!result.ok) {
      try { fs.rmSync(inWork(ctx.part), { force: true }); } catch (e) { log(`could not remove ${ctx.part}: ${firstLine(e)}`); }
      try { fs.rmSync(inWork(ctx.staged), { recursive: true, force: true }); } catch (e) { log(`could not remove ${ctx.staged}: ${firstLine(e)}`); }
    }
    try {
      fs.writeFileSync(inWork(path.join(work, STATUS_NAME)), JSON.stringify({ ...result, at: new Date().toISOString() }, null, 2) + '\n');
    } catch (e) { log(`could not record the outcome: ${firstLine(e)}`); }
    try { fs.rmSync(inWork(lockPath), { force: true }); } catch (e) { log(`could not remove the prepare lock: ${firstLine(e)}`); }
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
 */
async function cliMain(argv, write) {
  const out = typeof write === 'function' ? write : (s) => process.stdout.write(s);
  const a = parseCliArgs(argv);
  if (!a.prepare || !a.root || a.unknown) { out(USAGE + '\n'); return 64; }
  if (!a.yes) {
    const root = path.resolve(a.root);
    out(JSON.stringify({
      dryRun: true, root, base: a.base || update.releaseBase(), channel: a.channel || update.updateChannel('win32'),
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
  prepare, cliMain, runStagedNode,
  REQUIRED_ENTRIES, ENTRIES, WORK_DIRNAME, DEFAULT_LIMITS,
};

/* Guarded on being the main module: requiring this file must never download anything. */
if (require.main === module) {
  cliMain(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => { process.stderr.write(String((e && e.stack) || e) + '\n'); process.exitCode = 1; },
  );
}

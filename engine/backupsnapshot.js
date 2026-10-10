'use strict';
/**
 * kosmos#5535 (E0.6) build-order step 3: the snapshot walker. One snapshot of a work Kosmos, composed from the
 * reviewed parts on main:
 *   engine/backupscan.js    what may leave (path deny-list, content scan with redaction, the real-path check)
 *   engine/backupformat.js  content-defined chunks, sealed and named; the manifest, sealed and signed
 *   engine/backupupload.js  the chunk uploader and the manifest uploader
 *
 * Order, and why: files are walked, decided and chunked one at a time; sealed chunks the period does not hold yet are
 * uploaded in bounded batches; the manifest is sealed and uploaded LAST. A snapshot without a manifest is incomplete
 * and ignored (design v1 section 4), so a crash or a refused grant never leaves one that looks whole.
 *
 * The period: chunks are named with the period's naming key BEFORE any grant, so ctx.period must be the period the
 * coordinator will grant in (periodOf, its period_of). Every granted chunk key carries its period
 * (<org>/<account>/<epoch>/<period>/<random>), and so must every index entry; a key from another period stops the
 * run. The manifest is granted only inside ctx.period too, so its key, the coordinator's record of it and its sealed
 * context always name the same period (a run that crosses Monday 00:00 UTC stops as newPeriod and starts again).
 *
 * What is read, and how:
 *  - The deny-list (backupscan pathDecision) is applied BEFORE anything is opened: a denied folder (.git, .ssh,
 *    secrets/ ...) is pruned during the walk and recorded once; a denied file is recorded without being read.
 *  - Hard links are never read (a file with more than one name): a hard-linked tree, such as a pnpm node_modules, is
 *    never backed up, and each such file is named in `skipped`.
 *  - Links are never followed (a followed link needs a check-then-read, and a folder link can loop): each is
 *    recorded as skipped.
 *  - A file is opened once, without following a final link and without blocking (a FIFO swapped in cannot hang the
 *    run), and the open descriptor must be a regular file with the device and inode the walk saw. (O_NOFOLLOW,
 *    O_NONBLOCK and O_NOCTTY are POSIX: where the platform lacks them, as on Windows, they are 0, and the device,
 *    inode and real-path checks below are what holds.) Its real path is then checked (inside the work Kosmos, naming
 *    the same inode, and the deny-list again on it), and at most maxFile + 1 bytes are read.
 *    KNOWN RESIDUAL: only the FINAL path component is pinned. Node has no openat or F_GETPATH, so every check resolves
 *    the folders again; a process running as this person that keeps swapping a folder inside the work Kosmos for a link
 *    and back can, with timing luck, have a file from outside read. Such a process can already read those files itself,
 *    and the content scan still runs on what is read.
 *
 * Memory: sealed chunks wait in batches of at most batchBytes; one file is read whole and scanned in one call
 * (backupscan works on one buffer), so the per-file peak is set by the two caps (see MAX_FILE): about 300 MB resident
 * at either measured ceiling.
 *
 * Results stay on this Mac. `because` is a sentence for the person or the log here: the walker's own are fixed text (an
 * unexpected error gives only its code, never its message, which can carry paths), and an uploader's refusal is passed
 * on as the uploader wrote it (its own reviewed sentences). Names in the manifest are checked for credential kinds
 * secretmask names; a generic long token used as a name (secretmask's long_token, which fires on ordinary long names
 * too) is not masked, a known residual.
 *
 * Not here: key storage (the member public key, the naming key and the device key are inputs), persisting the period
 * index (the caller keeps it: `added` is returned on every result, failed or not), the schedule and freshness.
 */
const crypto = require('crypto');
const nodeFs = require('fs');
const path = require('path');
const { CDC, chunkBuffer, chunkName, sealNamedChunk, sealManifest, checkBackupContext } = require('./backupformat');
const { scanFile, pathDecision, insideWorkKosmos } = require('./backupscan');
const { uploadChunks, uploadManifest, MAX_MANIFEST } = require('./backupupload');
const { pathProblem, collisionKey, collidingPaths } = require('./backuprestore');
const { mask } = require('./secretmask');
const { namingKeyId: namingKeyIdOf } = require('./backupkeys');
/* A name holding something shaped like a credential (names were never checked, so a file named after a
   pasted token put it in the manifest). secretmask on each segment, specific kinds only: its generic long_token fires
   on ordinary long names (measured: 271 of 8,146 real paths), the specific kinds on 1 (an "xai" in a plan name).
   Returns the name with those parts masked, or null when nothing fired. */
function nameMasked(name) {
  const m = mask(name);
  return m.fired.some((f) => f.kind !== 'long_token') ? m.text : null;
}

const FORMAT = 1;
// A file is read whole to be scanned (backupscan works on one buffer), so a bigger one is skipped, and says so.
// Measured (review 39), backupscan.scanFile on this Mac: a 66 MB real binary (photos) 235 ms and 290 MB resident; text
// is far dearer: 3 MB 202 ms and 300 MB, 7 MB 1.5 s and about 1 GB, 14 MB 2.5 s and 1.5 GB (secretmask over the whole
// text), in one synchronous call the walker cannot interrupt. So two caps: 64 MB for a file, 4 MB for one that looks
// like text. A file over either is skipped and named, never scanned.
const MAX_FILE = 64 * 1024 * 1024;
const MAX_TEXT = 4 * 1024 * 1024;
/* Looks like text to the scanner: no NUL in the first 8 KiB (UTF-8 and the like), or UTF-16 (a BOM, or every other byte
   NUL), which backupscan decodes and scans as text. A cheap stand-in for the scanner's own decision: a binary with no
   early NUL is capped as text, which only skips it (the safe side). */
function looksLikeText(buf) {
  const head = buf.subarray(0, 8192);
  if (head.length >= 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))) return true;
  if (!head.includes(0)) return true;
  let zerosOdd = 0, zerosEven = 0;
  for (let i = 0; i < Math.min(head.length, 512); i++) if (head[i] === 0) { if (i % 2) zerosOdd++; else zerosEven++; }
  const half = Math.min(head.length, 512) / 2;
  return zerosOdd >= half * 0.9 || zerosEven >= half * 0.9;
}
// Sealed chunk bytes held before a batch is uploaded.
const BATCH_BYTES = 64 * 1024 * 1024;
// Restore's own default ceiling on entries (engine/backuprestore.js MAX_FILES).
const MAX_FILES = 500000;
// The manifest's JSON must fit the coordinator's ceiling after framing and padding (Padme adds at most about 12%).
const MANIFEST_JSON_BUDGET = Math.floor(MAX_MANIFEST * 0.8);
const MAX_SKIPPED = 100000;
const MAX_DEPTH = 256;
const SPLIT_WINDOW = 8;   // segments joined when looking for a credential split across folder names
// The clock skew tolerated between this Mac and the coordinator, as backupupload's clock check does (an hour): within it
// of a Monday, the context may name either neighbouring period, since the coordinator's clock decides the grant's.
const SKEW_MS = 60 * 60 * 1000;
const periodsNear = (t) => new Set([periodOf(t - SKEW_MS), periodOf(t), periodOf(t + SKEW_MS)]);
// The coordinator's allowance per member per weekly period (docs/coordinator-api.md "Allowances"): chunk objects and
// bytes, spent at grant time. A snapshot that could pass either is refused before it spends any.
// The bound is cautious (chunks at the 256 KiB minimum, redaction doubling every file), so it refuses at roughly 25 GB
// of files by that arithmetic (an estimate, not measured), though real chunks average 1 MiB; the refusal says so.
const CHUNK_ALLOWANCE = 200000, BYTE_ALLOWANCE = 64 * 2 ** 30;
// A sealed chunk object at most: the chunk, Padme padding (at most about 12%, here 13%), framing; never below the floor.
const sealedMax = (n) => Math.max(4148, Math.ceil(n * 1.13) + 4096);
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MONDAY_EPOCH = Date.UTC(1970, 0, 5);   // the first Monday 00:00 UTC after the Unix epoch
const CHUNK_NAME_LEN = 64;
// The longest object key the walker accepts (the coordinator's are about 140: two ids, epoch, period, two 32-hex ids).
const MAX_KEY_LEN = 256;
// The bounds backupupload.uploadManifest puts on a chunk's lock end (its LOCK_MAX_MS, plus an hour), checked here up front.
const LOCK_FLOOR_MS = Date.UTC(2020, 0, 1), LOCK_MAX_MS = 39 * 86400 * 1000;
const ownerOf = (key) => key.split('/').slice(0, 2).join('/');
/* The lock a manifest granted at time t gets: its period's end + 30 days + 15 minutes (backup.rs manifest_retain_until,
   RETAIN_AFTER_PERIOD_SECS and GRANT_SECS). An index chunk must outlast it (checked here, not after uploads). */
const manifestLockAt = (t) => MONDAY_EPOCH + (Math.floor((t - MONDAY_EPOCH) / WEEK_MS) + 1) * WEEK_MS + 30 * DAY_MS + 15 * 60 * 1000;
/* The member key a chunk was sealed to, as recorded in each index entry: the first 16 bytes of a domain-tagged SHA-256 of
   the public key, hex. An index entry under another member key cannot be named (the new private key cannot open it). */
const memberKeyIdOf = (pk) => crypto.createHash('sha256').update('kosmos-backup v1 member-key-id\0').update(pk).digest().subarray(0, 16).toString('hex');

/** The coordinator's period label for a time: the ISO week of the Monday 00:00 UTC that starts it, "2026-W41". (The
    coordinator falls back to "p<start>" for a time its time crate cannot hold, outside years -9999 to 9999; takeSnapshot refuses a clock
    whose year is past 9998, either way, before using this.) */
function periodOf(ms) {
  const start = MONDAY_EPOCH + Math.floor((ms - MONDAY_EPOCH) / WEEK_MS) * WEEK_MS;
  // ISO week-numbering year: the year of the Thursday of that week.
  const thursday = new Date(start + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan1 = new Date(0); jan1.setUTCFullYear(year, 0, 1);   // not Date.UTC, which reads years 0 to 99 as 1900 on
  const week = 1 + Math.floor((thursday - jan1) / WEEK_MS);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/* The period segment of a coordinator object key (<org>/<account>/<epoch>/<period>/<random>), or null. */
function periodOfKey(key) {
  const parts = typeof key === 'string' ? key.split('/') : [];
  return parts.length === 5 ? parts[3] : null;
}

/* Why a coordinator key cannot stand for a chunk of this context, or null: it must be <org>/<account>/<epoch>/<period>/<random>
   with the context's org and period (one under another period was named with another naming key: a manifest naming it
   would not restore). NOT the epoch segment: an index entry from an earlier run may sit under an earlier epoch and
   still restore with that epoch's key. The uploader checks that a NEW grant names ctx.epoch (#5744); which member key
   sealed an indexed chunk is the index entry's memberKeyId. */
function keyProblem(key, ctx) {
  const parts = typeof key === 'string' ? key.split('/') : [];
  // Plain segments only: the manifest budget charges a key at its byte length, which JSON keeps only for these.
  if (parts.length !== 5 || parts.some((x) => !/^[A-Za-z0-9._:-]+$/.test(x) || x === '.' || x === '..')) return 'not a coordinator object key';
  if (parts[0] !== ctx.org) return `under org ${parts[0]}, not ${ctx.org}`;
  if (parts[3] !== ctx.period) return `in period ${parts[3]}, not ${ctx.period}`;
  return null;
}

/* The deny-list, on the path AS RESTORE WILL WRITE IT: restore reads '\\' as a folder separator, so a Mac
   name like ".ssh\\id_rsa" comes back as .ssh/id_rsa; every rule anchors on '/', so the name as written would pass. */
const asRestored = (rel) => rel.replace(/\\/g, '/');
// And on restore's own equivalence of it: collisionKey drops invisible characters and folds case, so
// ".git<zero-width space>" is .git to restore. Denied if either reading is.
// (The second reading's `why` is a rule's name, never the folded path itself.)
const denied = (rel) => { const a = pathDecision(asRestored(rel)); return a.include ? pathDecision(collisionKey(rel)) : a; };
/* A well-formed key of this context in every way but its period: decided from the key, never from keyProblem's sentence. */
const onlyPeriodDiffers = (key, ctx) => periodOfKey(key) !== null && periodOfKey(key) !== ctx.period
  && keyProblem(key, Object.assign({}, ctx, { period: periodOfKey(key) })) === null;

/* A folder the deny-list refuses: every folder rule ends in '/', so a bare child name matches exactly those. A rule on a
   NAME only (".env", "credentials") is not a folder rule: a folder so named is walked, and each file in it is judged
   by name and content as usual. */
const folderDenied = (rel) => { const d = denied(`${rel}/x`); return d.include ? null : d.why; };

/* Gives the event loop a turn once YIELD_MS of synchronous work has passed (review 34: the board's process runs this, and
   a large walk would otherwise hold it for seconds). Real time, not the injected clock. */
const YIELD_MS = 20;
function yielder() {
  let last = Date.now();
  return async () => { if (Date.now() - last >= YIELD_MS) { await new Promise((r) => setImmediate(r)); last = Date.now(); } };
}

/** Every regular file under root (absolute) the deny-list allows, as sorted '/'-separated relative paths with the
    device and inode seen, and what was skipped (links, denied folders and files, anything not a file or folder, a
    folder that could not be read). Nothing is opened but folders. fs is injectable for tests. */
async function listFiles(root, fs = nodeFs, { maxFiles = MAX_FILES, maxSkipped = MAX_SKIPPED, exclude = [], only } = {}) {
  const pause = yielder();
  // only (#5686): the paths to keep, in a folder shared with others' files. Anything else, and every folder leading to
  // none of them, is passed over in silence: never counted against maxFiles, never named in skipped.
  // Exact paths, not restore's collision reading: in a folder shared with others, a name differing only in case would be
  // someone else's file.
  const keep = Array.isArray(only) ? new Set(only) : null;
  const toward = new Set();
  if (keep) for (const k of keep) { const segs = k.split('/'); for (let i = 1; i < segs.length; i++) toward.add(segs.slice(0, i).join('/')); }
  // Folders the caller leaves out (review 34: a large dependency tree could otherwise make every snapshot tooLarge),
  // as '/'-separated relative paths; each is recorded once as skipped.
  // Matched as restore compares names (collisionKey: case, invisible characters, '\\' as '/'), with a leading "./" and
  // trailing '/' dropped: "Deps" or "./deps" leaves out deps on a case-insensitive volume, as a person would expect.
  const excluded = new Set((Array.isArray(exclude) ? exclude : []).filter((x) => typeof x === 'string' && x)
    .map((x) => collisionKey(x.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, ''))));
  // Another volume mounted inside the work Kosmos (an external disk, a network share) is not crossed: what
  // is backed up is this computer's work Kosmos, and a mount can bring in anything. Recorded as skipped.
  let rootDev = null;
  try { rootDev = fs.lstatSync(root, { bigint: true }).dev; } catch { /* the walk reports the unreadable root */ }
  const files = [];
  const skipped = [];
  let skippedExtra = 0, over = false;
  // Bounded, whatever the tree holds: past maxFiles the walk stops, and skips past maxSkipped are only counted.
  const skip = (x) => { if (skipped.length < maxSkipped) skipped.push(x); else skippedExtra++; };
  const walk = async (rel, depth, seen) => {
    if (over) return;
    await pause();
    // A depth cap: recursion this deep is a pathological tree, skipped by name rather than a stack overflow.
    if (depth > MAX_DEPTH) { skip({ path: rel, why: `folders nested more than ${MAX_DEPTH} deep` }); return; }
    let names;
    try { names = fs.readdirSync(path.join(root, rel)); } catch { skip({ path: rel || '.', why: 'a folder that could not be read' }); return; }
    // The folder listed must be the one the walk saw: a folder swapped for a link after its lstat would be
    // listed through the link. Checked again after listing; its files are also each checked at the open.
    if (seen) {
      let again = null;
      try { again = fs.lstatSync(path.join(root, rel), { bigint: true }); } catch { /* gone */ }
      if (!again || !again.isDirectory() || again.dev !== seen.dev || again.ino !== seen.ino) { skip({ path: rel, why: 'replaced while the snapshot was taken' }); return; }
    }
    for (const name of names.sort()) {
      if (over) return;
      await pause();   // per entry: one flat folder can hold hundreds of thousands
      const r = rel ? `${rel}/${name}` : name;
      if (keep && !keep.has(r) && !toward.has(r)) continue;
      // Recorded under the masked name: the skipped list leaves the Mac too.
      const masked = nameMasked(name);
      // And a token split across folder boundaries: secretmask does not read a token across '/', so
      // each name is also checked joined to the 1 to 7 names above it (every window ending here; windows ending higher
      // were checked on the way down). '\\' inside a name is a boundary to restore, so its parts count as segments.
      // Measured on 8,146 real paths: 0 windows of up to 6 fire only joined. A hit is recorded with the whole window
      // masked. Residual: a token split over more than 8 segments.
      const segs = asRestored(r).split('/');
      let hit = 0;
      for (let w = 2; w <= Math.min(SPLIT_WINDOW, segs.length) && !hit; w++) if (nameMasked(segs.slice(-w).join('')) !== null) hit = w;
      // A window hit masks the whole window (it covers this name too); else a name that fired alone is masked by itself.
      if (hit) { skip({ path: segs.slice(0, -hit).concat(['\u2022\u2022\u2022\u2022']).join('/'), why: 'a path holding something shaped like a credential' }); continue; }
      if (masked !== null) { skip({ path: rel ? `${rel}/${masked}` : masked, why: 'a name holding something shaped like a credential' }); continue; }
      let st;
      // bigint: device and inode compared exactly (a Number loses precision above 2^53).
      try { st = fs.lstatSync(path.join(root, r), { bigint: true }); } catch { skip({ path: r, why: 'an entry that could not be read' }); continue; }
      if (st.isSymbolicLink()) { skip({ path: r, why: 'a link (links are not followed)' }); continue; }
      if (st.isDirectory()) {
        if (rootDev !== null && st.dev !== rootDev) { skip({ path: r, why: 'another volume mounted inside the work Kosmos (not crossed)' }); continue; }
        const why = folderDenied(r);
        if (excluded.has(collisionKey(r))) skip({ path: r, why: 'left out by the backup\'s settings' });
        else if (why) skip({ path: r, why }); else await walk(r, depth + 1, st);
        continue;
      }
      if (!st.isFile()) { skip({ path: r, why: 'not a regular file' }); continue; }
      // Hard links are skipped here too, so a hard-linked tree takes no part of the file count, the manifest reserve
      // or the allowance (it could otherwise refuse a whole snapshot as tooLarge); readListed checks again at the open.
      if (st.nlink > 1n) { skip({ path: r, why: 'stored under more than one name (a hard link; another name may be outside the work Kosmos)' }); continue; }
      const d = denied(r);
      if (!d.include) { skip({ path: r, why: d.why }); continue; }
      // A path restore would refuse (engine/backuprestore.js pathProblem) is not stored: it could never come back.
      const problem = pathProblem(r);
      if (problem) { skip({ path: r, why: `${problem}: restore cannot write it` }); continue; }
      // Number: exact up to 2^53 bytes, far past maxFile, so the cap test stays right.
      files.push({ path: r, dev: st.dev, ino: st.ino, size: Number(st.size) });
      if (files.length > maxFiles) over = true;
    }
  };
  await walk('', 0, null);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // Restore refuses every entry that collides (engine/backuprestore.js collidingPaths): the same key (case, invisible
  // characters, '\\' as '/'), or a file whose key is another entry's folder. Keep-first, in sorted order, on a trie of
  // key segments; the rest are skipped and named. The kept set is then checked with restore's own rule.
  const node = () => ({ kids: new Map(), file: null });
  const trie = node(), kept = [];
  for (const f of files) {
    await pause();
    let n = trie, clash = null;
    for (const seg of collisionKey(f.path).split('/')) {
      if (n.file) { clash = n.file; break; }
      if (!n.kids.has(seg)) n.kids.set(seg, node());
      n = n.kids.get(seg);
    }
    if (!clash && n.file) clash = n.file;
    if (!clash && n.kids.size) clash = 'a folder of the same name';
    if (clash) { skip({ path: f.path, why: `restore would refuse it beside ${clash} (names it treats as one)` }); continue; }
    n.file = f.path; kept.push(f);
  }
  // Restore's own rule has the last word: anything it would still refuse is skipped too (a throw here would
  // have refused the whole snapshot over one name).
  const refused = collidingPaths(kept);
  const out = refused.size ? kept.filter((f) => { if (!refused.has(f.path)) return true; skip({ path: f.path, why: 'restore would refuse it as colliding with another name' }); return false; }) : kept;
  return { files: out, skipped, skippedExtra, over };
}

/* #5686: a snapshot may cover several named roots, because a world's work is not under one folder: the default world
   keeps its data, its agents and its projects in three places, and an agent's own sessions live in its provider's
   folder. input.roots is [{ name, path, exclude?, optional?, only?, refused? }] (see takeSnapshot); each root is walked with every rule a single root gets, and its
   files are stored as `<name>/<path in the root>`, so restore puts each back under its name. input.root (one folder,
   paths stored as they are) still works, alone. Returns the roots, or why they cannot be used (a sentence). */
const ROOT_NAME = /^[a-z0-9][a-z0-9-]{0,31}(\/[a-z0-9][a-z0-9-]{0,31}){0,3}$/;
const MAX_ROOTS = 64;            // required roots (a world's own folders)
const MAX_OPTIONAL_ROOTS = 1024;  // optional roots (provider session folders: a few per agent)
const UNNAMED_ROOT = 'a session folder';   // how an optional root with an unusable name is recorded in skipped
/* Why a root name cannot be used, or null. Shared with engine/backupsessions.js, which builds names from agent ids.
   A name restore refuses (a Windows device name such as con or aux) would store files that can never come back; a name
   the deny-list refuses as a folder (secrets) would have every file read and then dropped; every stored path starts
   with the name, and every other name in a manifest is masked when it is secret-shaped. */
function rootNameProblem(name) {
  if (typeof name !== 'string' || !ROOT_NAME.test(name)) return 'each root needs a name of lowercase letters, digits and hyphens, up to four parts joined by /';
  if (pathProblem(`${name}/x`)) return `the root name ${name} is not one every system accepts`;
  if (!pathDecision(`${name}/x`).include) return `the root name ${name} is one the backup never stores`;
  if (nameMasked(name.replace(/\//g, ' ')) !== null) return `the root name ${name} looks like a secret`;
  return null;
}

function rootsOf(input) {
  if (input.roots === undefined) {
    if (typeof input.root !== 'string' || !path.isAbsolute(input.root)) return 'the work Kosmos folder must be an absolute path';
    return [{ name: '', path: input.root, exclude: input.exclude }];
  }
  if (input.root !== undefined || input.exclude !== undefined) return 'give roots (each with its own exclude), or one root, not both';
  if (!Array.isArray(input.roots) || !input.roots.length) return 'roots must be a list of folders';
  // Required roots are judged first and every problem with one fails the snapshot (a world's data is never silently
  // absent). Optional roots (a provider's session folders) are judged after them and NEVER fail it: one that cannot be
  // used becomes a refused root, recorded in skipped with its reason, under its name when the name itself is usable.
  const required = input.roots.filter((r) => !(r && r.optional === true)), optional = input.roots.filter((r) => r && r.optional === true);
  if (required.length > MAX_ROOTS) return `at most ${MAX_ROOTS} required roots`;
  const names = [], out = [];
  const problem = (r) => {
    if (typeof r.name !== 'string') return 'each root needs a name';
    const bad = rootNameProblem(r.name);
    if (bad) return bad;
    // refused: a root its caller could not take safely (engine/backupsessions.js), recorded in skipped with that reason.
    if (r.refused !== undefined && (typeof r.refused !== 'string' || !r.refused || r.optional !== true)) return `the root ${r.name} can be refused only as an optional root, with a reason`;
    if (r.refused === undefined && (typeof r.path !== 'string' || !path.isAbsolute(r.path))) return `the root ${r.name} must be an absolute path`;
    // One name inside another (`sessions` and `sessions/claude`) would let two roots write the same restored path.
    if (names.some((n) => n === r.name || n.startsWith(r.name + '/') || r.name.startsWith(n + '/'))) return `the root name ${r.name} repeats or contains another root's name`;
    if (r.only !== undefined && (!Array.isArray(r.only) || r.only.some((x) => typeof x !== 'string' || !x))) return `the root ${r.name}'s only must be a list of paths inside it`;
    // More named files than one snapshot can hold (an optional root is left out for this in listRoots).
    if (r.only !== undefined && new Set(r.only).size > MAX_FILES && !r.optional) return `the root ${r.name} names more than ${MAX_FILES} files, more than one snapshot can list`;
    return null;
  };
  const take = (r) => { names.push(r.name); out.push({ name: r.name, path: r.path, exclude: r.exclude, optional: r.optional === true, refused: r.refused, only: r.only === undefined ? undefined : [...new Set(r.only)] }); };
  for (const r of required) {
    if (!r) return 'each root needs a name';
    const p = problem(r);
    if (p) return p;
    take(r);
  }
  optional.forEach((r, k) => {
    const p = k >= MAX_OPTIONAL_ROOTS ? `more than ${MAX_OPTIONAL_ROOTS} session folders, more than one snapshot takes` : problem(r);
    if (!p) { take(r); return; }
    // Recorded under its name only if that name is usable and not already taken; else under a fixed label, so a bad
    // name never reaches the manifest.
    const usable = typeof r.name === 'string' && !rootNameProblem(r.name) && !names.some((n) => n === r.name || n.startsWith(r.name + '/') || r.name.startsWith(n + '/'));
    out.push({ name: usable ? r.name : UNNAMED_ROOT, refused: p.replace(/^the root name \S+ /, 'its name ').replace(/^the root \S+ /, ''), optional: true, label: !usable });
    if (usable) names.push(r.name);
  });
  // So the files (and the manifest) come out in one order, sorted by stored path, whatever order the caller lists them in.
  // Sorted by name + '/', which is the order of the stored paths they start (by name alone, `data-old` would follow
  // `data`, while `data-old/x` sorts before `data/x`).
  return out.sort((x, y) => { const a = x.name + '/', b = y.name + '/'; return a < b ? -1 : a > b ? 1 : 0; });
}

/* The last folders of a named root's real path, as a prefix ('Users/me/.claude/'): enough for every deny rule anchored
   on a parent folder (the deepest, .config/gh/, needs two). Three, so a rule never sees more of the path than it needs.
   A root deeper than that below a credential folder (.config/gh/a/b/c) is not judged by that folder's rule: choosing
   such a root is the caller's mistake, and the content scan still stands behind it. */
const NEAR_SEGMENTS = 3;
function nearOf(real) {
  const segs = real.split(path.sep).filter(Boolean);
  return segs.length ? segs.slice(-NEAR_SEGMENTS).join('/') + '/' : '';
}

/* Every root's listing, merged: each file carries its root's real path and its path inside it (rel), and its stored
   path is prefixed with the root's name. A root inside another (by folder identity) is refused: its files would be stored
   twice. The file and skipped limits count every root together. Returns the merged listing, or why not (a sentence). */
async function listRoots(roots, fs, budgets) {
  const gone = [];
  // An optional root (a provider's session folder, which the provider can remove, move or misplace at any time) is
  // recorded in skipped and left out whenever it cannot be taken safely; a required root that cannot fails the snapshot,
  // so a world's data is never silently absent. leave() decides which, for one root and a reason.
  const leave = (r, why) => { if (r.optional) { gone.push({ path: r.name, why }); return null; } return r.name ? `the root ${r.name} ${why}` : `the work Kosmos folder ${why}`; };
  let entries = [];
  for (const r of roots) {
    if (typeof r.refused === 'string') { const f = leave(r, r.refused); if (f) return f; continue; }
    if (r.only && r.only.length > MAX_FILES) { const f = leave(r, `names more than ${MAX_FILES} files, more than one snapshot can list`); if (f) return f; continue; }
    let real, st;
    try { real = fs.realpathSync(r.path); st = fs.statSync(real, { bigint: true }); } catch { real = null; }
    if (!real || !st.isDirectory()) { const f = leave(r, 'could not be read'); if (f) return f; continue; }
    // A root chosen file by file (`only`) was checked by its caller at its real path: if that path is not its real
    // path any more (a folder below it became a link), what was checked is not what would be walked.
    if (r.only && real !== path.resolve(r.path)) { const f = leave(r, 'changed after it was chosen (its path is no longer its real path)'); if (f) return f; continue; }
    entries.push({ r, real, id: `${st.dev}:${st.ino}` });
  }
  // A root inside another is found by the folders' identity, not their spelling: a real path keeps the case it was given
  // (on a case-insensitive volume /USERS/x and /Users/x are one folder). So every folder from each root up to the
  // volume's top is compared, by device and inode, with every other root. The same folder is allowed for roots that
  // each keep only named files (every agent's Codex rollouts share one sessions folder): each takes only its own.
  // A conflict leaves out every optional root in it; between required roots only, it fails the snapshot.
  const conflict = (x, y, why) => {
    if (!x.r.optional && !y.r.optional) return `the root ${x.r.name} ${why} the root ${y.r.name}`;
    for (const e of [x, y]) if (e.r.optional && !e.out) { e.out = true; gone.push({ path: e.r.name, why: `${why} the root ${(e === x ? y : x).r.name}` }); }
    return null;
  };
  const pauseNest = yielder();
  for (const e of entries) {
    await pauseNest();
    let at = e.real;
    for (;;) {
      let id;
      try { const st = fs.statSync(at, { bigint: true }); id = `${st.dev}:${st.ino}`; } catch { id = null; }
      for (const o of entries) {
        if (o === e || o.id !== id || o.out || e.out) continue;
        // The same folder (by identity, whatever its spelling) for two roots that each keep only named files.
        if (at === e.real && e.r.only && o.r.only) continue;
        const f = conflict(e, o, at === e.real ? 'is the same folder as' : 'is inside');
        if (f) return `${f}, so its files would be stored twice`;
      }
      const up = path.dirname(at);
      if (up === at) break;
      at = up;
    }
  }
  // Roots sharing one folder must not name the same file: it would be stored twice, under two agents.
  // Every claimant of each file is kept, not just the first: with three, the third would otherwise keep a file the first
  // two were left out over. A file named by two or more roots leaves out every optional one of them; two required
  // roots naming one file fail the snapshot.
  const claimants = new Map();
  for (const e of entries) {
    if (e.out) continue;
    for (const rel of e.r.only || []) {
      const key = `${e.id}\0${rel}`;
      if (!claimants.has(key)) claimants.set(key, []);
      claimants.get(key).push(e);
    }
  }
  for (const list of claimants.values()) {
    if (list.length < 2) continue;
    const required = list.filter((e) => !e.r.optional);
    if (required.length > 1) return `the root ${required[0].r.name} names a file also named by the root ${required[1].r.name}`;
    for (const e of list) {
      if (!e.r.optional || e.out) continue;
      e.out = true;
      gone.push({ path: e.r.name, why: `names a file also named by the root ${list.find((o) => o !== e).r.name}` });
    }
  }
  entries = entries.filter((e) => !e.out);
  roots = entries.map((e) => e.r);
  const reals = entries.map((e) => e.real);
  const out = { files: [], skipped: [], skippedExtra: 0, over: false };   // `gone` is added at the end
  const pre = (name, p) => (!name ? p : p === '.' ? name : `${name}/${p}`);
  // Required roots first, then optional ones, each optional root taken only if it still fits the file limit and fits()
  // beside everything taken so far; one that does not is left out and recorded (its own skips with it). Sorted by stored
  // path at the end, so the order does not depend on this.
  const totals = { chunks: 0, bytes: 0, manifest: 0 };   // what the roots taken so far cost (see budgets in snapshotInner)
  const pause = yielder();
  const order = roots.map((r, i) => i).sort((x, y) => (roots[x].optional === roots[y].optional ? x - y : roots[x].optional ? 1 : -1));
  for (const i of order) {
    if (out.over) break;
    const opt = roots[i].optional;
    const got = await listFiles(reals[i], fs, { exclude: roots[i].exclude, only: roots[i].only, maxFiles: MAX_FILES - out.files.length, maxSkipped: Math.max(0, MAX_SKIPPED - out.skipped.length) });
    const mine = [], mySkips = [];
    let myExtra = got.skippedExtra;
    for (const f of got.files) {
      const stored = pre(roots[i].name, f.path);
      // The walk judged the path inside the root; restore judges the stored one, which is longer by the name.
      const problem = roots[i].name ? pathProblem(stored) : null;
      if (problem) { mySkips.push({ path: stored, why: `restore would refuse it: ${problem}` }); continue; }
      // The deny-list judged the path inside the root, so a rule anchored on a parent folder (.claude/.credentials.json,
      // .gemini/oauth_creds.json, .ssh/) never fired when the root IS that folder. Judged again with the root's own last
      // folders in front, the way the file sits on disk; readListed does the same on the real path.
      // Named roots only: the single `root` (a work Kosmos folder) is judged as it always was.
      const near = roots[i].name ? nearOf(reals[i]) : '';
      const d = near ? pathDecision(near + f.path) : { include: true };
      if (!d.include) { mySkips.push({ path: stored, why: d.why }); continue; }
      mine.push(Object.assign({}, f, { rel: f.path, path: stored, rootReal: reals[i], near }));
    }
    for (const x of got.skipped) mySkips.push(Object.assign({}, x, { path: pre(roots[i].name, x.path) }));
    const c = budgets ? budgets.cost(mine, mySkips) : null;
    const goneBytes = gone.reduce((n, x) => n + entryBytes(x), 0) + 512;   // left-out records, and one more for this root
    const fitsHere = !c || budgets.fits({ chunks: totals.chunks + c.chunks, bytes: totals.bytes + c.bytes, manifest: totals.manifest + c.manifest + goneBytes });
    if (opt && (got.over || !fitsHere)) {
      gone.push({ path: roots[i].name, why: got.over ? `more files than one snapshot can list beside the other folders` : 'too large to fit this week\'s backup beside the other folders' });
      await pause();
      continue;
    }
    if (c) { totals.chunks += c.chunks; totals.bytes += c.bytes; totals.manifest += c.manifest; }
    await pause();
    out.files.push(...mine);
    for (const x of mySkips) { if (out.skipped.length < MAX_SKIPPED) out.skipped.push(x); else myExtra++; }
    out.skippedExtra += myExtra;
    out.over = got.over;
  }
  for (const x of gone.splice(0)) { if (out.skipped.length < MAX_SKIPPED) out.skipped.push(x); else out.skippedExtra++; }
  out.files.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  return out;
}

/* Read the file the walk found, or say why not: { buf } or { why }. One open, no final link followed, never blocking. */
function readListed(fs, rootReal, f, maxFile) {
  const abs = path.join(rootReal, f.rel);
  const c = fs.constants || nodeFs.constants;
  // O_NOCTTY: a terminal device swapped in is refused by the fstat check below, and must not become ours first.
  const flags = c.O_RDONLY | (c.O_NOFOLLOW || 0) | (c.O_NONBLOCK || 0) | (c.O_NOCTTY || 0);
  let fd;
  try { fd = fs.openSync(abs, flags); } catch { return { why: 'a file that could not be opened (gone, or replaced by a link)' }; }
  try {
    const st = fs.fstatSync(fd, { bigint: true });
    if (!st.isFile() || st.dev !== f.dev || st.ino !== f.ino) return { why: 'replaced while the snapshot was taken' };
    // A hard link has no real path of its own to check: another name for it may be outside the work Kosmos.
    if (st.nlink > 1n) return { why: 'stored under more than one name (a hard link; another name may be outside the work Kosmos)' };
    // The real path, which must name the very file opened (a folder swapped for a link during the walk, and
    // back again before this lookup, would otherwise let the path checked differ from the file read). With hard links
    // refused above, the same device and inode mean the same file.
    const real = fs.realpathSync(abs);
    if (!insideWorkKosmos(real, rootReal)) return { why: 'its real path is outside the work Kosmos' };
    const rs = fs.statSync(real, { bigint: true });
    if (rs.dev !== st.dev || rs.ino !== st.ino) return { why: 'replaced while the snapshot was taken' };
    const relReal = path.relative(rootReal, real).split(path.sep).join('/');
    const d = denied(relReal);
    if (!d.include) return { why: d.why };
    if (f.near) { const dn = pathDecision(f.near + relReal); if (!dn.include) return { why: dn.why }; }
    const size = Number(st.size);
    if (size > maxFile) return { why: `larger than ${Math.round(maxFile / 1024 / 1024)} MB, too large to scan` };
    // One byte more than allowed: filling it means the file grew past maxFile after the size check.
    const buf = Buffer.alloc(Math.min(size, maxFile) + 1);
    let n = 0;
    for (;;) {
      const got = fs.readSync(fd, buf, n, buf.length - n, null);
      if (got === 0) break;
      n += got;
      // The buffer holds one byte more than the file had: filling it means it grew during the read, or,
      // when it was already at the cap, that it passed the cap.
      if (n === buf.length) return { why: size >= maxFile ? `larger than ${Math.round(maxFile / 1024 / 1024)} MB, too large to scan` : 'it grew while the snapshot was taken' };
    }
    return { buf: buf.subarray(0, n) };
  } catch { return { why: 'a file that could not be read' }; } finally { try { fs.closeSync(fd); } catch { /* already closed */ } }
}

const isKey32 = (b) => Buffer.isBuffer(b) && b.length === 32;
// A manifest entry's JSON size, for the running budget (canonicalJson writes the same characters as JSON.stringify).
const entryBytes = (x) => Buffer.byteLength(JSON.stringify(x)) + 1;
/* An UPPER bound on what one listed file can add to the manifest, from its size alone. A file over maxFile is only ever
   a skip entry (counting its size made one big disk image fail every snapshot). Otherwise every chunk but a
   file's last is at least CDC.min, and the stored bytes may be at most twice the file's (redaction can lengthen text),
   so it has at most floor(2 * size / CDC.min) + 1 chunks; each adds a name to the file entry and one objects entry
   with the longest key accepted; plus the entry itself and a redaction record or a skip entry, within the fixed 1024
   (measured worst case: all 17 kinds secretmask can report, 8-digit counts, is 703 bytes past the path, and
   with the file entry 815; about 200 bytes to spare).
   So a snapshot is limited to about 20 GB of files under maxFile: past that this bound passes the manifest ceiling
   even where the real manifest would not (at 1 MiB average chunks and real key lengths it is about a tenth). */
const chunksMax = (f, maxFile) => (f.size > maxFile ? 0 : Math.floor((2 * f.size) / CDC.min) + 1);
function upperBound(f, maxFile) {
  const pathJson = Buffer.byteLength(JSON.stringify(f.path));
  if (f.size > maxFile) return 2 * pathJson + 1024;
  const n = chunksMax(f, maxFile);
  return 2 * pathJson + 1024 + n * (CHUNK_NAME_LEN + 3) + n * (CHUNK_NAME_LEN + 6 + MAX_KEY_LEN);
}

/**
 * Take one snapshot.
 *   input: { root | roots, memberPk, namingKey, namingKeyId, deviceKey, ctx, index?, bucket?, exclude? }
 *     exclude      folders to leave out, as '/'-separated paths relative to root (each named once in skipped)
 *     root         the work Kosmos folder (absolute)
 *     roots        instead of root (and exclude): [{ name, path, exclude?, optional?, only? }], several folders, each stored under its
 *                  name (lowercase letters, digits, hyphens; up to four parts joined by '/'; none inside another, by
 *                  name or by real path, except roots on one folder that each keep only named files). A REQUIRED
 *                  root that cannot be used fails the snapshot; an OPTIONAL one (at most 1024) never does: it is
 *                  left out and recorded in skipped (unreadable, conflicting, too large, a bad name). `only`: the paths
 *                  inside the root to keep; nothing else from it is stored or named. See rootsOf.
 *     memberPk     the member's backup public key (32 bytes), namingKey this period's naming key (32 bytes) and
 *                  namingKeyId its id (backupkeys namingKeyId), deviceKey the device's Ed25519 private KeyObject
 *     ctx          the manifest context { org, member, epoch, period, snapshot }; period must be periodOf(now)
 *     index        this period's chunks stored by earlier runs: Map name -> { key, lockedUntilMs, memberKeyId }, all under
 *                  bucket; memberKeyId binds each to the member key it was sealed to (an entry for another is stale)
 *   deps: { macRequest, fetch?, now?, sleep?, fs?, uploadChunks?, uploadManifest?, batchBytes?, maxFile?, maxManifestJson? }
 * Resolves { ok: true, manifestKey, files, skipped, uploaded, reused, added, bucket } or
 * { ok: false, because, retryLater?, newPeriod?, grantedPeriod?, staleIndex?, tooLarge?, overAllowance?, grantSpent?, unsure?, added, bucket }.
 *   overAllowance: the week's backup allowance would be passed (refused before anything is spent), or is used up
 *     (backup_quota, which can arrive after some batches were stored: they are in `added`): not this period.
 *   newPeriod: a period boundary passed (the context's, or a grant's): start again with the new period's context and
 *     naming key; this input can never succeed. grantedPeriod, when present, is the period the coordinator granted in:
 *     build the new context with THAT period (the coordinator's clock decides it; this Mac's may be up to an hour off).
 *   added (Map name -> { key, lockedUntilMs, memberKeyId }) is every chunk this run stored in ctx.period under `bucket`,
 *     failed or not; keep memberKeyId with each entry (an index entry without it is stale).
 *   staleIndex: the index cannot be used (another bucket or period, malformed, or chunks whose locks end too soon):
 *     drop it, keep `added` under `bucket`, and take the next snapshot from that.
 *   tooLarge: the manifest would pass its ceiling (too many files): not a retry.
 * Never throws. (If an injected uploader throws mid-batch, that batch's stored chunks cannot be known, so they are not in
 * `added`; the real uploaders never throw.)
 */
async function takeSnapshot(input, deps) {
  const added = new Map();
  const state = { bucket: null };
  const fail = (because, extra) => Object.assign({ ok: false, because, added, bucket: state.bucket }, extra || {});
  try {
    return await snapshotInner(input || {}, deps || {}, added, state, fail);
  } catch (err) {
    // A fixed sentence and the error's code, never its message: an fs error carries absolute paths.
    return fail(`the snapshot failed unexpectedly${err && err.code ? ` (${err.code})` : ''}`);
  }
}

async function snapshotInner(input, deps, added, state, fail) {
  const { memberPk, namingKey, namingKeyId, deviceKey, ctx } = input;
  const now = deps.now || Date.now;
  const fs = deps.fs || nodeFs;
  const putChunks = deps.uploadChunks || uploadChunks;
  const putManifest = deps.uploadManifest || uploadManifest;
  const pos = (n, dflt) => (Number.isSafeInteger(n) && n > 0 ? n : dflt);
  const batchBytes = pos(deps.batchBytes, BATCH_BYTES), maxFile = pos(deps.maxFile, MAX_FILE), maxText = pos(deps.maxText, MAX_TEXT);
  const budget = pos(deps.maxManifestJson, MANIFEST_JSON_BUDGET);
  const roots = rootsOf(input);
  if (typeof roots === 'string') return fail(roots);
  if (!isKey32(memberPk) || !isKey32(namingKey)) return fail('the member key and the naming key must be 32-byte Buffers');
  // The id the manifest records must be THIS naming key's: restore matches it against the naming key it
  // unwraps, so a stale id (last period's) would lock in a manifest that can never be opened.
  if (typeof namingKeyId !== 'string' || namingKeyId !== namingKeyIdOf(namingKey)) return fail('the naming key id is not this naming key\'s (backupkeys namingKeyId)');
  // The device key is used only to sign the manifest, after every chunk is uploaded: checked here, before anything is
  // spent, with sealManifest's own rule.
  if (!deviceKey || deviceKey.type !== 'private' || deviceKey.asymmetricKeyType !== 'ed25519') return fail('the device key must be an Ed25519 private key');
  try { checkBackupContext(ctx); } catch (err) { return fail(err.message); }
  const t = now();
  // A Date can hold only about 275,000 years either side of 1970: past that, periodOf reads "NaN-WNaN".
  // And within years -9999 to 9999, outside which the coordinator labels periods differently ("p<start>").
  const usable = (x) => Number.isFinite(x) && Number.isFinite(new Date(x).getTime()) && Math.abs(new Date(x).getUTCFullYear()) <= 9998;   // 9998: an ISO week year can run one past the calendar's
  if (!usable(t)) return fail('this computer\'s clock gave no usable time');
  const period = periodOf(t);
  // newPeriod, not retryLater: the same input fails again; the caller needs this period's context and naming key.
  // The context's period must be this clock's, or a neighbouring one within the tolerated skew (the coordinator's clock
  // decides which period a grant lands in; a wrong-period failure reports it as grantedPeriod, and a context built from
  // that must be accepted, or the retry loops).
  if (!periodsNear(t).has(ctx.period)) return fail(`the context names period ${ctx.period}, but this computer's clock is in ${period}`, { newPeriod: true });
  // The manifest lock for the CONTEXT's period, which may be a neighbour of this clock's (see periodsNear).
  const tCtx = [t, t - SKEW_MS, t + SKEW_MS].find((x) => periodOf(x) === ctx.period);
  const ctxManifestLock = manifestLockAt(tCtx);

  // The index: every entry this period's, with a lock end, under one named bucket. Checked before anything is read.
  const index = input.index instanceof Map ? input.index : new Map();
  const mkid = memberKeyIdOf(memberPk);
  if (index.size) {
    if (typeof input.bucket !== 'string' || !input.bucket) return fail('an index of earlier chunks needs the bucket they are stored under', { staleIndex: true });
    for (const [name, e] of index) {
      const why = typeof name !== 'string' || !/^[0-9a-f]{64}$/.test(name) || !e ? 'malformed'
        : keyProblem(e.key, ctx) || (Buffer.byteLength(e.key) > MAX_KEY_LEN ? `a key longer than ${MAX_KEY_LEN} characters` : null)
          || (e.memberKeyId !== mkid ? 'sealed to another member key' : null)
          || (!Number.isSafeInteger(e.lockedUntilMs) || e.lockedUntilMs < LOCK_FLOOR_MS || e.lockedUntilMs > t + LOCK_MAX_MS + 3600 * 1000 ? 'a lock end no grant could set' : null)
          // A lock that ends before any manifest granted now would (period end + 30 days + the window; at least now + 30
          // days + 15 min): uploadManifest would refuse it as outlasting it. Mirrors the coordinator's
          // RETAIN_AFTER_PERIOD_SECS (30 days) and GRANT_SECS (15 minutes) in backup.rs retain_until_for.
          || (e.lockedUntilMs < ctxManifestLock ? 'a lock that ends before this snapshot\'s manifest would' : null);
      if (why) return fail(`the index holds an entry this snapshot cannot name (${why})`, { staleIndex: true });
    }
    state.bucket = input.bucket;
  }
  // Every key this snapshot names, so none is ever named for two chunks (a repeat across batches, or of an
  // index key, would point two names at one object; on a versioned bucket restore could only open one of them).
  const usedKeys = new Set([...index.values()].map((e) => e.key));
  if (usedKeys.size !== index.size) return fail('the index names one key for two chunks', { staleIndex: true });
  // One <org>/<account> for every chunk the manifest names, as uploadManifest requires: the index's, or the
  // first grant's.
  const owners = new Set([...usedKeys].map(ownerOf));
  if (owners.size > 1) return fail('the index names chunks under more than one account', { staleIndex: true });
  let owner = owners.size ? [...owners][0] : null;

  // What a set of listed files and skips costs against this snapshot's three limits (the week's chunk and byte allowance,
  // the manifest's upper bound, skips included: each is charged as it is recorded), and whether running totals fit them,
  // with the same arithmetic as the checks after listing. listRoots keeps running totals and takes an optional root only
  // if the totals plus its own cost still fit, so session folders never cost the world its data.
  const cost = (fl, sk) => ({
    chunks: fl.reduce((n, f) => n + chunksMax(f, maxFile), 0),
    bytes: fl.reduce((n, f) => n + (f.size > maxFile ? 0 : sealedMax(2 * f.size) + chunksMax(f, maxFile) * 4148), 0),
    manifest: fl.reduce((n, f) => n + upperBound(f, maxFile), 0) + sk.reduce((n, x) => n + entryBytes(x), 0),
  });
  const fits = (t) => index.size + t.chunks <= CHUNK_ALLOWANCE && t.bytes + sealedMax(budget) <= BYTE_ALLOWANCE && 1024 + t.manifest <= budget;
  const listed = await listRoots(roots, fs, { cost, fits });
  if (typeof listed === 'string') return fail(listed);
  const pause = yielder();
  if (listed.over) return fail(`the work Kosmos holds more than ${MAX_FILES} files, more than one snapshot can list`, { tooLarge: true });
  // The manifest budget, kept so that NOTHING is uploaded unless the finished manifest is sure to fit:
  //   estimate  the exact JSON so far (entries, objects, skips), with keys not yet granted charged at MAX_KEY_LEN
  //   reserve   the upper bound of every listed file not yet finished (the current one included)
  // The check before the walk is the guard, and it is enough by construction: every file's exact charge (its entry, its
  // objects at their real key length, a redaction record or a skip) is at most its reserve, so the final manifest is at
  // most that sum. No check runs per batch (a mutant showed it redundant): mid-file it would count pending chunks twice,
  // once charged and once in the file's reserve, and could only trip spuriously, after earlier batches were stored.
  let estimate = 1024;
  const ub = (f) => upperBound(f, maxFile);
  let reserve = listed.files.reduce((n, f) => n + ub(f), 0);
  const listedBytes = listed.files.reduce((n, f) => n + (f.size > maxFile ? 0 : f.size), 0);
  const over = () => estimate + reserve > budget;

  const skipped = [];
  // Every skip is charged to the manifest estimate as it happens, so the last batch is never uploaded for a manifest
  // its skipped list would push over the ceiling.
  let skippedExtra = listed.skippedExtra;
  const skip = (s) => { if (skipped.length < MAX_SKIPPED) { estimate += entryBytes(s); skipped.push(s); } else skippedExtra++; };
  for (const s of listed.skipped) skip(s);
  // The allowance, before anything is spent. Chunks: this period's earlier ones (the index) plus this run's upper bound.
  // Bytes: this run's upper bound only: the index records no sizes, and charging each earlier chunk at the
  // largest size refused ordinary second runs. Bytes spent earlier in the period are caught by the coordinator's
  // backup_quota refusal, which ends the run as overAllowance below.
  const chunkBound = index.size + listed.files.reduce((n, f) => n + chunksMax(f, maxFile), 0);
  // The manifest counts too: the 64 GiB is chunks and manifests together.
  const byteBound = listed.files.reduce((n, f) => n + (f.size > maxFile ? 0 : sealedMax(2 * f.size) + chunksMax(f, maxFile) * 4148), 0) + sealedMax(budget);
  if (chunkBound > CHUNK_ALLOWANCE || byteBound > BYTE_ALLOWANCE) {
    return fail(`the work Kosmos is too large to back up in one week: ${listed.files.length} files, ${Math.round(listedBytes / 2 ** 20)} MB, could pass the weekly allowance (${CHUNK_ALLOWANCE} chunks, 64 GB; the allowance limit: about 25 GB of files fit, under a cautious estimate)`, { tooLarge: true, overAllowance: true });
  }
  const tooLargeWhy = () => `the work Kosmos is too large for one snapshot: ${listed.files.length} files, ${Math.round(listedBytes / 2 ** 20)} MB, could make a manifest past its size limit (the manifest limit: about 20 GB of files, a cautious estimate)`;
  if (over()) return fail(tooLargeWhy(), { tooLarge: true });
  const files = [], redacted = [];
  const objects = {};        // every referenced chunk: name -> key (filled as chunks are stored or reused)
  const pending = new Map(); // sealed this run, not yet uploaded: name -> object
  let pendingBytes = 0, uploaded = 0, reused = 0;

  // Upload what is pending; on any failure, stop. Keys must be this period's and under one bucket.
  const flush = async () => {
    if (!pending.size) return null;
    // No size check here: the one check before the walk already guarantees the finished manifest fits (see there).
    const batch = [...pending].map(([name, object]) => ({ name, object }));
    const r = await putChunks(deps, batch, { epoch: ctx.epoch });
    const stored = (r && r.keys instanceof Map) ? r.keys : new Map();
    const lockOf = (name) => (r && r.lockedUntil instanceof Map ? r.lockedUntil.get(name) : undefined);
    const spent = r && r.grantSpent !== undefined ? { grantSpent: r.grantSpent } : {};
    if (r && r.bucket && state.bucket && r.bucket !== state.bucket) {
      // Another bucket than the index's: the index cannot be used with these. `added` is reported under ONE bucket, so it
      // becomes what this batch stored under the NEW bucket; chunks earlier batches of this run stored under the old
      // bucket are dropped from it (stored, locked, and named by nothing until their lock ends), deliberately.
      added.clear(); state.bucket = r.bucket;
      for (const [name, key] of stored) {
        if (pending.has(name) && !usedKeys.has(key) && !keyProblem(key, ctx) && (!owner || ownerOf(key) === owner) && Buffer.byteLength(key) <= MAX_KEY_LEN && Number.isSafeInteger(lockOf(name)) && lockOf(name) >= ctxManifestLock) {
          added.set(name, { key, lockedUntilMs: lockOf(name), memberKeyId: mkid }); usedKeys.add(key);
        }
      }
      // staleIndex only when there was an index to drop; without one, the next run is a full snapshot anyway.
      return fail((index.size ? 'a grant named another bucket than the index\'s: drop the index and take a full snapshot' : 'two grants in one snapshot named different buckets: take a full snapshot') + '; chunks stored under the earlier bucket in this run are not kept', Object.assign(index.size ? { staleIndex: true } : {}, spent,
        // The same answer's own signals are kept (unsure keys, a spent allowance, a retry).
        r.unsure ? { unsure: r.unsure } : {}, r.code === 'backup_quota' ? { overAllowance: true } : {}, r.retryLater && r.code !== 'backup_quota' ? { retryLater: true } : {}));
    }
    if (r && r.bucket && !state.bucket) state.bucket = r.bucket;
    // Stored keys with no bucket named: whether or not an index set one, they cannot be checked
    // against it or filed. Not recorded; a malformed answer.
    if (stored.size && !(r && r.bucket)) return fail('the uploader answered stored chunks without naming their bucket', spent);
    // Every usable stored chunk is recorded before any failure is returned, so the caller's index keeps it.
    const wrongPeriod = [];
    let noLock = false, badKey = null, shortLock = false;
    for (const [name, key] of stored) {
      if (!pending.has(name)) { badKey = badKey || 'for a chunk this run did not ask to store'; continue; }
      if (usedKeys.has(key)) { badKey = badKey || 'repeats a key already named'; continue; }
      const kp = keyProblem(key, ctx) || (owner && ownerOf(key) !== owner ? `under account path ${ownerOf(key)}, not ${owner}` : null);
      if (kp && onlyPeriodDiffers(key, ctx) && (!owner || ownerOf(key) === owner)) { wrongPeriod.push(periodOfKey(key)); continue; }
      if (kp) { badKey = badKey || kp; continue; }
      if (!Number.isSafeInteger(lockOf(name))) { noLock = true; continue; }
      // A lock shorter than this snapshot's manifest will get: the manifest could never name it.
      if (lockOf(name) < ctxManifestLock) { shortLock = true; continue; }
      if (Buffer.byteLength(key) > MAX_KEY_LEN) { badKey = badKey || `longer than ${MAX_KEY_LEN} characters`; continue; }
      added.set(name, { key, lockedUntilMs: lockOf(name), memberKeyId: mkid });
      usedKeys.add(key);
      owner = owner || ownerOf(key);
      objects[name] = key;
      estimate += Buffer.byteLength(key) - MAX_KEY_LEN;   // charged at MAX_KEY_LEN when it was sealed (only pending names reach here)
    }
    if (badKey) return fail(`a granted key is not one this snapshot can name (${badKey})`, spent);
    if (noLock) return fail('a stored chunk came back without its lock end', spent);
    if (shortLock) return fail('a stored chunk came back locked for less time than this snapshot\'s manifest would be', spent);
    if (wrongPeriod.length) return fail(`a chunk was granted in period ${wrongPeriod[0]}, not ${ctx.period} (a period boundary passed); start again in the new period (chunks granted there are not kept: they stay stored, unnamed, until their lock ends)`, Object.assign({ newPeriod: true, grantedPeriod: wrongPeriod[0] }, spent));
    // backup_quota: this period's allowance is spent (by earlier runs, or anything signing as this computer): not a
    // retry this period.
    if (r && r.code === 'backup_quota') return fail(`the period's backup allowance is used up: ${r.because || 'backup_quota'}`, Object.assign({ overAllowance: true }, r.unsure ? { unsure: r.unsure } : {}, spent));
    if (!r || !r.ok) return fail(`chunks could not be uploaded: ${(r && r.because) || 'no answer'}`, Object.assign({}, r && r.retryLater ? { retryLater: true } : {}, r && r.unsure ? { unsure: r.unsure } : {}, spent));
    for (const name of pending.keys()) if (!objects[name]) return fail('the uploader reported success without a key for every chunk', spent);
    uploaded += pending.size;
    pending.clear(); pendingBytes = 0;
    return null;
  };

  for (const f of listed.files) {
    // Over the cap at walk time: its reserve is a skip entry only, so it is never read (one that shrank before
    // the read was stored past its reserve).
    if (f.size > maxFile) { skip({ path: f.path, why: `larger than ${Math.round(maxFile / 1024 / 1024)} MB, too large to scan` }); continue; }
    await pause();
    const got = readListed(fs, f.rootReal, f, maxFile);
    if (!got.buf) { skip({ path: f.path, why: got.why }); continue; }
    // Grown since the walk: its reserve was sized from the walk's size, and it is being written to.
    if (got.buf.length > f.size) { skip({ path: f.path, why: 'it grew while the snapshot was taken' }); continue; }
    if (got.buf.length > maxText && looksLikeText(got.buf)) { skip({ path: f.path, why: `text larger than ${Math.round(maxText / 1024 / 1024)} MB, too large to scan safely` }); continue; }
    const d = scanFile(f.path, got.buf);
    if (d.action !== 'store') { skip({ path: f.path, why: d.why || 'not stored' }); continue; }
    const data = d.data;
    // The reserve assumed at most twice the file's size; a copy past that would break the bound, so it is not stored.
    // (The +1 adds no chunk to upperBound's floor(2 * size / CDC.min) + 1: 2 * size + 1 is odd and CDC.min is even.)
    if (data.length > 2 * f.size + 1) { skip({ path: f.path, why: 'its redacted copy is over twice its size' }); continue; }
    if (d.redacted && d.redacted.length) { redacted.push({ path: f.path, kinds: d.redacted }); estimate += entryBytes(redacted[redacted.length - 1]); }
    const names = [];
    for (const piece of chunkBuffer(data)) {
      // Named first, sealed only if it will be uploaded (sealing every chunk re-encrypted the whole work
      // Kosmos on every run, to upload only what changed).
      await pause();
      const name = chunkName(namingKey, piece);
      names.push(name);
      if (objects[name] || pending.has(name)) continue;
      const known = index.get(name);
      // Every name this snapshot references gets one objects entry: its JSON is counted once, here.
      // A key is charged at its byte length, which is its JSON length only because keyProblem allows plain segments
      // ([A-Za-z0-9._:-]); widen that rule and this charge must escape (pinned by the "a key with a quote" test).
      estimate += CHUNK_NAME_LEN + 6 + (known ? Buffer.byteLength(known.key) : MAX_KEY_LEN);
      if (known) { objects[name] = known.key; reused++; continue; }
      const sealed = sealNamedChunk(memberPk, namingKey, piece);
      if (sealed.name !== name) return fail('a chunk was sealed under another name than it was given');   // cannot differ today
      const { object } = sealed;
      pending.set(name, object); pendingBytes += object.length;
      if (pendingBytes >= batchBytes) { const stop = await flush(); if (stop) return stop; }
    }
    const entry = { path: f.path, size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex'), chunks: names };
    estimate += entryBytes(entry);

    files.push(entry);
  }
  const stop = await flush();
  if (stop) return stop;
  // A backstop only: by construction (the check before the walk; reserve is read only there) it cannot fire.
  if (estimate > budget) return fail(tooLargeWhy(), { tooLarge: true });

  // Every chunk a file names, with its key and lock end, for the manifest uploader's checks.
  const chunks = [];
  for (const name of Object.keys(objects)) {
    const e = added.get(name) || index.get(name);
    if (!e) return fail('a chunk the manifest names has no stored key');
    chunks.push({ key: e.key, lockedUntilMs: e.lockedUntilMs });
  }
  if (!chunks.length) return fail('there is nothing to back up: no file with content (empty files alone make no snapshot, since a manifest must name at least one chunk)');
  const manifest = {
    format: FORMAT, takenAt: new Date(t).toISOString(), namingKeyId,   // t: the reading already checked
    files, objects, redacted, skipped, skippedNotListed: skippedExtra,
  };
  // A period boundary passed during the run: NO manifest grant is asked for. The manifest is sealed with
  // ctx.period, but the coordinator would file it under the period of the moment it is granted (its key and record), so a
  // restore looking it up by that period could not open it; and its lock would be the new period's, which earlier
  // chunks may not outlast. The run starts again in the new period, with its context and naming key.
  const tEnd = now();
  if (!usable(tEnd)) return fail('this computer\'s clock gave no usable time');   // fails closed, as at the start
  // This Mac's own clock saw a boundary pass during the run (it read ctx.period at the start, another now): no grant,
  // whatever the skew tolerance would allow (review 37). A context accepted as a neighbour at the start is judged by
  // the tolerance; the manifest key is checked after the grant either way.
  const crossed = periodOf(t) === ctx.period && periodOf(tEnd) !== ctx.period;
  if (crossed || !periodsNear(tEnd).has(ctx.period)) return fail(`a period boundary passed during the snapshot (now ${periodOf(tEnd)}): start again in the new period`, { newPeriod: true });
  // Cannot throw on this content: file and redacted paths passed pathProblem, skipped ones are walk paths, every other value is a fixed sentence, a number,
  // hex or a key of plain segments, and the context and keys were checked before anything was read. If it ever did,
  // takeSnapshot's catch returns `added` intact.
  const sealed = sealManifest(memberPk, deviceKey, ctx, manifest);
  const m = await putManifest(deps, sealed, { bucket: state.bucket, chunks, epoch: ctx.epoch });
  if (!m || !m.ok) {
    // outlastsChunks: the named chunks lock out too soon for this manifest. Every lock was checked against this period's
    // manifest lock, so in practice Monday passed since (a FRESH reading says so; the one above cannot). Else
    // it is the index's (staleIndex, only when there is one).
    const tNow = now();
    const passed = m && m.outlastsChunks && usable(tNow) && periodOf(tNow) !== periodOf(t);   // a boundary since the start
    // otherBucket: the coordinator now grants to another bucket. With an index, drop it; without one, this
    // run's chunks are in the abandoned bucket, so none is handed back to be kept as an index.
    // With or without an index, every chunk this run stored is in that bucket: none is handed back, and no bucket is named.
    if (m && m.otherBucket) { added.clear(); state.bucket = null; }
    return fail(`the manifest could not be uploaded: ${(m && m.because) || 'no answer'}`, Object.assign({},
      // backup_quota on the manifest grant is the period's allowance, as on chunks: not this period, never a retry.
      m && m.code === 'backup_quota' ? { overAllowance: true } : (m && m.retryLater ? { retryLater: true } : {}),
      m && m.unsure ? { unsure: m.unsure } : {},
      passed ? { newPeriod: true } : (m && m.outlastsChunks && index.size ? { staleIndex: true } : {}),
      m && m.otherBucket && index.size ? { staleIndex: true } : {}, m && m.grantSpent !== undefined ? { grantSpent: m.grantSpent } : {}));
  }
  // The manifest's key must be this context's: Monday 00:00 UTC can pass between the check above and the
  // coordinator signing the grant, and uploadManifest checks only the owner. A key in another period files the manifest
  // where a restore looking it up by period cannot open it; said, not hidden (it is stored and locked either way).
  const mk = keyProblem(m.key, ctx) || (owner && ownerOf(m.key) !== owner ? 'under another account path' : null);
  // newPeriod only when the period is what differs; another org or a malformed key is a plain failure.
  if (mk && onlyPeriodDiffers(m.key, ctx) && (!owner || ownerOf(m.key) === owner)) return fail(`the manifest was stored under a key ${mk} (a period boundary passed as it was granted): start again in the new period`, { newPeriod: true, grantSpent: true });
  if (mk) return fail(`the manifest was stored under a key that is not this snapshot's (${mk})`, { grantSpent: true });
  return { ok: true, manifestKey: m.key, files: files.length, skipped: skipped.length + skippedExtra, uploaded, reused, added, bucket: state.bucket };
}

module.exports = { periodOf, memberKeyIdOf, listFiles, takeSnapshot, rootNameProblem, MAX_FILE, BATCH_BYTES, MAX_FILES };

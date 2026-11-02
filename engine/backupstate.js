'use strict';
/**
 * kosmos#5535 E0.6 slice (c), first half: what one backup run keeps for the next, per (org, member).
 *
 * Design on #5535 (comment 6114619425). One owner-only file beside the member key's folder, holding:
 *   job     engine/backupjob.js's state: { lostEpoch?, waitUntilMs?, waits? }
 *   periods up to two periods' run state, most recently used first: [{ label, namingKey, bucket, index }]. Two,
 *           because near Monday 00:00 this clock's week and the coordinator's granted week can differ, and each must keep
 *           its own naming key and index rather than overwrite the other's every run (review 7).
 *     label      the ISO week (backupsnapshot periodOf), e.g. 2026-W41
 *     namingKey  the period's naming key (32 bytes). A SECRET, kept only here and inside the sealed, device-signed
 *                manifests: the next run in the same period reuses it so unchanged files deduplicate. A Mac never takes
 *                a naming key from storage (backupkeys.js); this file is this Mac's own, 0600 in a 0700 folder, as the
 *                member key is.
 *     bucket     the bucket path the period's chunks are under (takeSnapshot's `bucket`), or null before any chunk
 *     index      Map name -> { key, lockedUntilMs, memberKeyId }: the chunks stored this period (takeSnapshot's `index`)
 *
 * readState(org, member) -> { ok: true, state } | { ok: false, because }
 *   readStateAsync and writeStateAsync (kosmos#7746) give the same answers and the same errors (as rejections) as
 *   readState and writeState, giving the event loop a turn every 50,000 rows and between steps; JSON.parse and
 *   JSON.stringify of the whole file each stay one block. A run uses them; at the top plan the sync ones block for seconds.
 *   Async writes of one file run in the order asked; a sync writeState while one is in flight throws with no code (a
 *   caller mistake: it would land in the middle of it).
 *   A missing file is ok and empty ({ job: {}, periods: [] }). A file that is a link, malformed, or for another
 *   (org, member) is NOT ok, and is never overwritten in place; the way out is discardState. A file that could not be
 *   read for a passing reason (EBUSY, EAGAIN, EPERM, EACCES: a scanner, or a rename in progress on Windows) is NOT ok
 *   with `retry`: NEVER discard on a retry, the file may be good. EACCES and EPERM are usually lasting on macOS and Linux
 *   (a restored file with mode 000), so a caller bounds its retries and tells the person after a few.
 * org and member must be non-empty strings in every function (a number would hash to the same file and then read as
 *   another member's): a caller mistake throws.
 * discardState(org, member) -> { ok, because? }: renames the file aside (<file>.bad-<time>), never deleting it, so the
 *   next run starts a fresh period with a new naming key. Its chunks are not lost: the manifests that name them are
 *   stored; only deduplication against them is. The caller decides when (a refused read, said to the person once).
 * writeState(org, member, state): atomic (securewrite, owner-only). Throws on a state this module would not read back,
 *   and REFUSES to replace an existing file that is not plainly this module's for (org, member): a link, a foreign or
 *   corrupt start, or a file it cannot read (that throw carries `retry` when the reason is passing). So a caller that
 *   falls back to a fresh state after a refused read cannot overwrite the good or set-aside-worthy file: it must
 *   discardState first (after which there is no file) or wait out the retry. "Plainly ours" is readState's own test, the
 *   whole file (review 10: a head-only check let a body-corrupt file be overwritten, and refused a reformatted good one),
 *   so a write costs one read first, UNLESS the file is exactly the one this process last read or wrote as ours (kosmos#7746:
 *   the same device, inode, size, and mtime and ctime in ns, kept only when a read saw the same before and after it); then
 *   the write replaces it without re-reading. A program cannot set a ctime back, so a file replaced meanwhile is read in
 *   full (on a filesystem with nanosecond times, as APFS, ext4 and NTFS have, and short of changing the clock). The window between that read and the rename is covered by
 *   the one-run-at-a-time duty (the folder is 0700: only this user can put a file there meanwhile). A passing error
 *   from the write itself (Windows refusing the rename while a scanner holds the file) throws with retry too, and every
 *   error FROM THE WRITE ITSELF carries the underlying `code` and `cause` (a full disk, a read-only folder), so the
 *   caller can tell the person why. The refusal to replace a file not ours carries code 'refused' (and retry when the
 *   read was passing); a state that would not read back throws with no code (a caller mistake). EACCES and EPERM are retry on write as on read, and the same bounded-retry duty applies.
 * forPeriod(state, label, { memberKeyId, nowMs, newKey? }) -> period: the stored period whose label IS `label`, its index
 *   pruned of entries sealed to another member key (a #5744 rotation, which takeSnapshot would refuse as a stale index,
 *   costing a run) and, defensively, of locks already ended (uploadManifest's own floor is stricter: a chunk must
 *   outlast the new manifest's lock, now + 30 days + 15 minutes; within one period every kept row does); otherwise a
 *   fresh period with a new naming key and an empty index.
 *   Nothing else: which label to run is the CALLER's decision, since only it sees takeSnapshot's answers (this clock's
 *   periodOf(now), or the coordinator's grantedPeriod after a newPeriod answer). Five review rounds of keeping a stored
 *   neighbouring period here each failed one way or the other: a kept EARLIER period can never deduplicate after the
 *   COORDINATOR's Monday 00:00 (its chunks' locks end before any new manifest's would, so uploadManifest refuses it,
 *   measured by review 6), and a kept LATER one needs the coordinator's word, which only the caller has.
 *   What starting fresh costs: deduplication against the period left, never a restore (its naming key is inside every
 *   manifest stored in it). With both weeks kept (SLOTS), a run near Monday 00:00 that starts in its clock's week and is
 *   granted in the other resumes the other week's key and index, so what it costs is the first batch of each such run
 *   (uploaded under the wrong week, left out of both indexes) for the skew window, about an hour a week. ONE path costs
 *   more (review 8): the coordinator ahead and nothing changed. Every chunk deduplicates, so no chunk grant answers
 *   newPeriod; the manifest is granted in the next week and outlives this week's chunks, so takeSnapshot answers
 *   staleIndex (no grantedPeriod). The run takes no snapshot, spends one manifest grant, and withRun drops this week's
 *   index, so the next run's first batch is the whole tree (up to a batch). A caller that wants to avoid it can, on a
 *   staleIndex answer within an hour of its clock's Monday 00:00, run periodOf(now + 1 hour) once; that choice is the
 *   caller's, as every week choice is.
 *   Size: a slot of 200000 rows is about 35 MB (measured: 283 ms to write, 251 ms to read on this Mac). A full one at
 *   600000 rows, the top plan's, measured 162 MiB, 186 ms to stringify and 204 ms to parse, so two full slots are about
 *   324 MiB. The previous week's slot stays until a third week arrives,
 *   carried but unused after the coordinator's Monday; accepted (it is dropped by the next week's first run).
 * withPeriod(state, period) -> state: `period` in the first slot, replacing its label's slot; at most SLOTS kept, the
 *   least recently used dropped. For writing a fresh period before its snapshot.
 * withRun(state, period, result) -> state: withPeriod with the period after a takeSnapshot result, plus `leftOut` (how
 *   many `added` rows it did not keep: malformed, another period's, past the cap, or with no bucket; not persisted), so
 *   a caller bug shows. The index is dropped ONLY when the
 *   result says so: staleIndex, or chunks stored under a DIFFERENT non-null bucket. A null bucket is not "another
 *   bucket": takeSnapshot returns null on every failure before it reads the index (a bad root, the clock, a key), and
 *   that run touched nothing. `added` rows are checked as readState checks them; a malformed one is left out (it is
 *   stored, only not deduplicated against), and the index is capped at MAX_INDEX, so writeState never throws on it.
 *
 * DUTIES OF THE CALLER (the run, slice (c) second half), because this file is written once per run:
 *   - Write the state with a NEW period (withPeriod(state, forPeriod(...))) BEFORE the snapshot, so a run that dies keeps
 *     the key and the next run in the period deduplicates against it.
 *   - Write after the run. A run killed before that loses its `added` (those chunks are stored, locked, and named by no
 *     manifest; the next run uploads them again and spends allowance again).
 *   - One run at a time per (org, member): two runs reading and writing this file lose one run's `added`.
 *   - Run the period of this clock (periodOf(now)). On a newPeriod answer WITH grantedPeriod, run once more with that
 *     label (forPeriod resumes that week's slot if kept; the coordinator's clock decides); WITHOUT it, stop, and the
 *     next run uses its clock's period again. Never loop on newPeriod within a run.
 *   - Files discardState set aside (<file>.bad-<time>, 0600, each holding that period's naming key) are never removed
 *     here; they are kept for a person to look at.
 *
 * `because` is a fixed sentence, never a path or a byte of the file.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const backupkeys = require('./backupkeys');

// Weeks 01 to 53 only (what periodOf writes).
const PERIOD_RE = /^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$/;
const TRANSIENT = new Set(['EBUSY', 'EAGAIN', 'EPERM', 'EACCES']);
function ids(org, member) {
  if (typeof org !== 'string' || !org || typeof member !== 'string' || !member) throw new TypeError('backupstate: org and member must be non-empty strings');
  // A lone surrogate hashes (as UTF-8, U+FFFD) to another id's file; refused like any other caller mistake.
  if (!org.isWellFormed() || !member.isWellFormed()) throw new TypeError('backupstate: org and member must be well-formed text');
}
const NAME_RE = /^[0-9a-f]{64}$/;
const HEX32_RE = /^[0-9a-f]{32}$/;
const KEY_SEG_RE = /^[A-Za-z0-9._:-]+$/;
// Two periods kept: near Monday 00:00 this clock's week and the coordinator's granted week can differ, and each keeps
// its own naming key and index instead of overwriting the other's every run (review 7).
const SLOTS = 2;
const MAX_INDEX = 600000;   // the most objects a week can hold: the top plan's (backupsnapshot); withRun caps the index at it

function dir() { return path.join(store.ROOT, 'backupstate'); }
function fileFor(org, member) {
  ids(org, member);
  const h = crypto.createHash('sha256').update(String(org) + '\u0000' + String(member)).digest('hex').slice(0, 24);
  return path.join(dir(), h + '.json');
}
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => { try { const b = Buffer.from(String(s), 'base64url'); return b.length === 32 && b64(b) === String(s) ? b : null; } catch { return null; } };
const isEpoch = (e) => Number.isSafeInteger(e) && e >= 1;
const isPosInt = (n) => Number.isSafeInteger(n) && n > 0;
const goodKey = (k) => typeof k === 'string' && k.length <= 1024 && k.split('/').length === 5 && k.split('/').every((s) => KEY_SEG_RE.test(s) && s !== '.' && s !== '..');

function cleanJob(j) {
  const out = {};
  if (!j || typeof j !== 'object') return out;
  if (isEpoch(j.lostEpoch)) out.lostEpoch = j.lostEpoch;
  if (isPosInt(j.waitUntilMs)) out.waitUntilMs = j.waitUntilMs;
  if (isPosInt(j.waits)) out.waits = j.waits;
  return out;
}

/* Whether one index entry is one this module writes, for a period. */
const goodEntry = (name, e, label) => NAME_RE.test(name) && e && goodKey(e.key) && isPosInt(e.lockedUntilMs) && HEX32_RE.test(e.memberKeyId)
  && e.key.split('/')[3] === label;

/* kosmos#7746: the row check and the row building pause every ROWS_PER_PAUSE rows, so the async readState and writeState
   can give the event loop a turn. At the top plan (two slots of 600000) each was one block of about 900 ms (measured on
   #7746). The sync versions run the same steps straight through. */
const ROWS_PER_PAUSE = 50000;
const runSync = (gen) => { let r = gen.next(); while (!r.done) r = gen.next(); return r.value; };
const turn = () => new Promise((resolve) => setImmediate(resolve));
async function runAsync(gen) { let r = gen.next(); while (!r.done) { await turn(); r = gen.next(); } return r.value; }

/* A period as stored (null for a null input), or undefined when any part is not one this module writes. */
function* periodSteps(p) {
  if (p === null) return null;
  if (!p || typeof p !== 'object' || !PERIOD_RE.test(p.label)) return undefined;
  const namingKey = unb64(p.namingKey);
  if (!namingKey) return undefined;
  if (p.namingKeyId !== backupkeys.namingKeyId(namingKey)) return undefined;
  if (p.bucket !== null && (typeof p.bucket !== 'string' || !p.bucket || p.bucket.length > 1024)) return undefined;
  if (!Array.isArray(p.index) || p.index.length > MAX_INDEX) return undefined;
  const index = new Map();
  let n = 0;
  for (const row of p.index) {
    if (++n % ROWS_PER_PAUSE === 0) yield;
    if (!Array.isArray(row) || row.length !== 4) return undefined;
    const [name, key, lockedUntilMs, memberKeyId] = row;
    if (!NAME_RE.test(name) || !goodKey(key) || !isPosInt(lockedUntilMs) || !HEX32_RE.test(memberKeyId) || index.has(name)) return undefined;
    if (key.split('/')[3] !== p.label) return undefined;   // every chunk is filed under its period (backupsnapshot keyProblem)
    index.set(name, { key, lockedUntilMs, memberKeyId });
  }
  if (index.size && p.bucket === null) return undefined;
  return { label: p.label, namingKey, bucket: p.bucket, index };
}

/* kosmos#7746: the file this process last read or wrote as ours, per path: device, inode, size, and mtime and ctime (ns;
   no program can set a ctime back, as it can an mtime). mayReplaceSteps
   skips its full re-read when the file on disk still matches; any other file gets the whole check. */
const known = new Map();
function fingerprint(st) { return `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`; }
function remember(f) { try { known.set(f, fingerprint(fs.lstatSync(f, { bigint: true }))); } catch { known.delete(f); } }
function stillOurs(f) {
  const k = known.get(f);
  if (!k) return false;
  try { const st = fs.lstatSync(f, { bigint: true }); return st.isFile() && fingerprint(st) === k; } catch { return false; }
}

function readState(org, member) { return runSync(readSteps(org, member)); }
/* A read that does not answer ok forgets the file: only a read that found it ours may let a write skip its re-read. */
function* readSteps(org, member) {
  const f = fileFor(org, member), knownAtStart = known.get(f);
  const r = yield* readFileSteps(org, member);
  // A write that landed while this read was paused is newer than what this read found: left as it is.
  if (!r.ok && known.get(f) === knownAtStart) known.delete(f);
  return r;
}
/** readState with a turn for the event loop every ROWS_PER_PAUSE rows (kosmos#7746). The same answers. */
function readStateAsync(org, member) { return runAsync(readSteps(org, member)); }
function* readFileSteps(org, member) {
  ids(org, member);
  const f = fileFor(org, member);
  try { if (fs.lstatSync(f).isSymbolicLink()) return { ok: false, because: 'the backup state file is a link, so it was not read' }; } catch { /* missing: the read decides */ }
  let raw;
  // Fingerprinted before and after the read: kept only when both agree, so it describes the bytes read, never a file
  // swapped in meanwhile (then nothing is remembered and the next write checks in full).
  let before = null, loose = false;
  const knownAtStart = known.get(f);   // a write that lands while this read is paused is newer: never replaced below
  try {
    const st = fs.lstatSync(f, { bigint: true });
    before = fingerprint(st);
    // On Windows the mode bits stand only for the read-only attribute (the profile's ACLs protect the file), and every
    // file reads as other than 0600. There a file is loose only when it is read-only: the chmod clears that, or the next
    // write's rename would be refused. A writable file is not touched, so its fingerprint can still be kept.
    loose = process.platform === 'win32' ? (Number(st.mode) & 0o200) === 0 : (Number(st.mode) & 0o777) !== 0o600;
  } catch { /* missing: the read decides */ }
  try { raw = fs.readFileSync(f, 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, state: { job: {}, periods: [] } };
    return Object.assign({ ok: false, because: 'the backup state file could not be read' }, err && TRANSIENT.has(err.code) ? { retry: true } : {});
  }
  let after = null;
  try { after = fingerprint(fs.lstatSync(f, { bigint: true })); } catch { /* gone after the read: nothing remembered */ }
  yield;
  let got;
  try { got = JSON.parse(raw); } catch { return { ok: false, because: 'the backup state file is not one this computer wrote' }; }
  raw = null;
  if (!got || got.v !== 1 || got.org !== org || got.member !== member) return { ok: false, because: 'the backup state file is not one this computer wrote' };
  yield;
  const periods = [];
  if (Array.isArray(got.periods) && got.periods.length <= SLOTS) {
    for (const x of got.periods) { const one = yield* periodSteps(x); periods.push(one); if (!one) break; }
  } else periods.push(undefined);
  if (periods.some((x) => !x) || new Set(periods.map((x) => x.label)).size !== periods.length) return { ok: false, because: 'the backup state file is not one this computer wrote' };
  // A file left looser (a copy, a restore) is made owner-only once it has read as ours, best effort. (Its contents were
  // trusted first, as backupmemberkey does: the folder is 0700, so only this user could have loosened it.)
  // Only a loose file is changed, since a chmod moves the ctime the fingerprint holds: that file is then not
  // remembered, and the next write reads it in full once.
  if (loose) try { fs.chmodSync(f, 0o600); } catch { /* the read stands */ }
  if (known.get(f) === knownAtStart) { if (before && before === after && !loose) known.set(f, before); else known.delete(f); }
  return { ok: true, state: { job: cleanJob(got.job), periods } };
}

/* Throws unless the file for (org, member) is absent or reads as this module's (readState's own test), with err.retry
   when the read failed for a passing reason. */
function* mayReplaceSteps(org, member) {
  if (stillOurs(fileFor(org, member))) return;
  const r = yield* readSteps(org, member);
  if (r.ok) return;
  throw Object.assign(new Error(r.retry ? 'backupstate: the existing state file could not be read just now; try again'
    : 'backupstate: the existing state file is not one this computer wrote; discardState it first'), { code: 'refused', retry: r.retry === true });
}

/* kosmos#7746: an async write takes turns, so two writes of one file could interleave and the older body land last. Async
   writes of one file run one after another (`writing` holds the newest one's promise), and a sync write while one is in
   flight throws: it would land in the middle of it. */
const writing = new Map();
function writeState(org, member, state) {
  if (writing.has(fileFor(org, member))) throw new Error('backupstate: a write of this state file is still in progress');
  return runSync(writeSteps(org, member, state));
}
/** writeState with a turn for the event loop every ROWS_PER_PAUSE rows (kosmos#7746). The same result and throws. */
function writeStateAsync(org, member, state) {
  let f;
  try { f = fileFor(org, member); } catch (err) { return Promise.reject(err); }   // a bad id rejects, as readStateAsync does
  const prev = writing.get(f) || Promise.resolve();
  let tail;
  // The entry is cleared inside the chain, before `mine` settles, so a caller resuming from `await` finds no write in
  // flight (cleared afterwards, a sync write straight after the await would throw).
  const mine = prev.catch(() => {}).then(() => runAsync(writeSteps(org, member, state)))
    .finally(() => { if (writing.get(f) === tail) writing.delete(f); });
  tail = mine.catch(() => {});
  writing.set(f, tail);
  return mine;
}
function* writeSteps(org, member, state) {
  ids(org, member);
  const list = (state && state.periods) || [];
  const periods = [];
  for (const p of list) {
    const index = [];
    for (const [name, e] of p.index) {
      if (index.push([name, e.key, e.lockedUntilMs, e.memberKeyId]) % ROWS_PER_PAUSE === 0) yield;
    }
    periods.push({ label: p.label, namingKey: b64(p.namingKey), namingKeyId: backupkeys.namingKeyId(p.namingKey), bucket: p.bucket, index });
  }
  // Never write what would not read back: a file that read as "not ours" would stop every later run.
  let readsBack = periods.length <= SLOTS && new Set(periods.map((x) => x.label)).size === periods.length;
  for (const x of periods) if (readsBack && (yield* periodSteps(x)) === undefined) readsBack = false;
  if (!readsBack) throw new Error('backupstate: refusing to write a period that would not read back');
  yield;
  const body = JSON.stringify({ v: 1, org, member, job: cleanJob(state && state.job), periods });
  yield;
  yield* mayReplaceSteps(org, member);
  try {
    fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dir(), 0o700); } catch { /* the file itself is 0600 either way */ }
    require('./securewrite').writeSecret(fileFor(org, member), body, 0o600, { atomicOnly: true });
    // No turn for this process between the rename and this lstat, so it fingerprints the file just written (another
    // process writing in that instant is the one-run-at-a-time duty above).
    remember(fileFor(org, member));
  } catch (err) {
    const code = err && typeof err.code === 'string' ? err.code : undefined;
    throw Object.assign(new Error(`backupstate: the state file could not be written${code && /^[A-Z0-9_]{1,32}$/.test(code) ? ` (${code})` : ''}`),
      { code, cause: err, retry: TRANSIENT.has(code) || TRANSIENT.has(err && err.cause && err.cause.code) });
  }
}

function forPeriod(state, label, opts = {}) {
  if (!PERIOD_RE.test(label)) throw new Error('backupstate: a period label is an ISO week, such as 2026-W41');
  if (!HEX32_RE.test(opts.memberKeyId) || !Number.isSafeInteger(opts.nowMs)) throw new Error('backupstate: forPeriod needs the member key id and the time');
  const p = ((state && state.periods) || []).find((x) => x.label === label);
  if (p) {
    const index = new Map();
    for (const [name, e] of p.index) if (e.memberKeyId === opts.memberKeyId && e.lockedUntilMs > opts.nowMs) index.set(name, e);
    return { label, namingKey: p.namingKey, bucket: p.bucket, index };
  }
  const namingKey = opts.newKey ? opts.newKey() : backupkeys.newNamingKey();
  return { label, namingKey, bucket: null, index: new Map() };
}

function withRun(state, period, result) {
  const r = result || {};
  let index = period.index, bucket = period.bucket, leftOut = 0;
  if (r.staleIndex) index = new Map();
  if (typeof r.bucket === 'string' && r.bucket && r.bucket !== bucket) {
    // The run's chunks are under ANOTHER bucket: the old index named chunks this period can no longer use.
    index = new Map();
    bucket = r.bucket;
  }
  if (r.added instanceof Map && r.added.size && !bucket) leftOut += r.added.size;
  if (r.added instanceof Map && r.added.size && bucket) {
    index = new Map(index);
    for (const [name, e] of r.added) {
      if (index.size < MAX_INDEX && goodEntry(name, e, period.label)) index.set(name, { key: e.key, lockedUntilMs: e.lockedUntilMs, memberKeyId: e.memberKeyId });
      else leftOut++;
    }
  }
  return Object.assign(withPeriod(state, { label: period.label, namingKey: period.namingKey, bucket, index }), { leftOut });
}

/* The state with `period` in the first slot (replacing any slot of its label), the other slots after it, at most SLOTS
   kept (the least recently used dropped). For writing a fresh period BEFORE its snapshot, and used by withRun. */
function withPeriod(state, period) {
  const others = ((state && state.periods) || []).filter((x) => x.label !== period.label);
  return Object.assign({}, state, { periods: [period].concat(others).slice(0, SLOTS) });
}

function discardState(org, member) {
  ids(org, member);
  const f = fileFor(org, member);
  // kosmos#7746: an async write in flight would put the old state back after the discard.
  if (writing.has(f)) return { ok: false, because: 'the backup state is being written just now; try again' };
  known.delete(f);
  try { fs.renameSync(f, `${f}.bad-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`); return { ok: true }; } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true };
    return { ok: false, because: 'the backup state file could not be set aside' };
  }
}

module.exports = { readState, readStateAsync, writeState, writeStateAsync, forPeriod, withRun, withPeriod, discardState, fileFor };

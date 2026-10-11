'use strict';
/**
 * kosmos#5535 E0.6 slice (c), first half: what one backup run keeps for the next, per (org, member).
 *
 * Design on #5535 (comment 6114619425). One owner-only file beside the member key's folder, holding:
 *   job     engine/backupjob.js's state: { lostEpoch?, waitUntilMs?, waits? }
 *   period  this period's run state, or null: { label, namingKey, bucket, index }
 *     label      the ISO week (backupsnapshot periodOf), e.g. 2026-W41
 *     namingKey  the period's naming key (32 bytes). A SECRET, kept only here and inside the sealed, device-signed
 *                manifests: the next run in the same period reuses it so unchanged files deduplicate. A Mac never takes
 *                a naming key from storage (backupkeys.js); this file is this Mac's own, 0600 in a 0700 folder, as the
 *                member key is.
 *     bucket     the bucket path the period's chunks are under (takeSnapshot's `bucket`), or null before any chunk
 *     index      Map name -> { key, lockedUntilMs, memberKeyId }: the chunks stored this period (takeSnapshot's `index`)
 *
 * readState(org, member) -> { ok: true, state } | { ok: false, because }
 *   A missing file is ok and empty ({ job: {}, period: null }). A file that is a link, unreadable, malformed, or for
 *   another (org, member) is NOT ok, and is never overwritten in place. The way out is discardState.
 * discardState(org, member) -> { ok, because? }: renames the file aside (<file>.bad-<time>), never deleting it, so the
 *   next run starts a fresh period with a new naming key. Its chunks are not lost: the manifests that name them are
 *   stored; only deduplication against them is. The caller decides when (a refused read, said to the person once).
 * writeState(org, member, state): atomic (securewrite, owner-only). Throws on a state this module would not read back.
 * forPeriod(state, label, { memberKeyId, nowMs, newKey? }) -> period: the state's period when it is `label`, its index
 *   pruned of entries sealed to another member key (a #5744 rotation) or whose lock has ended (both of which
 *   takeSnapshot would refuse as a stale index, costing a run); else a fresh period with a new naming key and an empty
 *   index. A new period never inherits the old index or key.
 * withRun(state, period, result) -> state: the period after a takeSnapshot result. The index is dropped ONLY when the
 *   result says so: staleIndex, or chunks stored under a DIFFERENT non-null bucket. A null bucket is not "another
 *   bucket": takeSnapshot returns null on every failure before it reads the index (a bad root, the clock, a key), and
 *   that run touched nothing. `added` rows are checked as readState checks them; a malformed one is left out (it is
 *   stored, only not deduplicated against), and the index is capped at MAX_INDEX, so writeState never throws on it.
 *
 * DUTIES OF THE CALLER (the run, slice (c) second half), because this file is written once per run:
 *   - Write the state with a NEW period (forPeriod's fresh naming key) BEFORE the snapshot, so a run that dies keeps
 *     the key and the next run in the period deduplicates against it.
 *   - Write after the run. A run killed before that loses its `added` (those chunks are stored, locked, and named by no
 *     manifest; the next run uploads them again and spends allowance again).
 *   - One run at a time per (org, member): two runs reading and writing this file lose one run's `added`.
 *
 * `because` is a fixed sentence, never a path or a byte of the file.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const backupkeys = require('./backupkeys');

const PERIOD_RE = /^[0-9]{4}-W[0-9]{2}$/;
const NAME_RE = /^[0-9a-f]{64}$/;
const HEX32_RE = /^[0-9a-f]{32}$/;
const KEY_SEG_RE = /^[A-Za-z0-9._:-]+$/;
const MAX_INDEX = 200000;   // backupsnapshot's CHUNK_ALLOWANCE; withRun caps the index at it

function dir() { return path.join(store.ROOT, 'backupstate'); }
function fileFor(org, member) {
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

/* A period as stored, or null when any part is not one this module writes. */
function periodFrom(p) {
  if (p === null) return null;
  if (!p || typeof p !== 'object' || !PERIOD_RE.test(p.label)) return undefined;
  const namingKey = unb64(p.namingKey);
  if (!namingKey) return undefined;
  if (p.namingKeyId !== backupkeys.namingKeyId(namingKey)) return undefined;
  if (p.bucket !== null && (typeof p.bucket !== 'string' || !p.bucket || p.bucket.length > 1024)) return undefined;
  if (!Array.isArray(p.index) || p.index.length > MAX_INDEX) return undefined;
  const index = new Map();
  for (const row of p.index) {
    if (!Array.isArray(row) || row.length !== 4) return undefined;
    const [name, key, lockedUntilMs, memberKeyId] = row;
    if (!NAME_RE.test(name) || !goodKey(key) || !isPosInt(lockedUntilMs) || !HEX32_RE.test(memberKeyId) || index.has(name)) return undefined;
    if (key.split('/')[3] !== p.label) return undefined;   // every chunk is filed under its period (backupsnapshot keyProblem)
    index.set(name, { key, lockedUntilMs, memberKeyId });
  }
  if (index.size && p.bucket === null) return undefined;
  return { label: p.label, namingKey, bucket: p.bucket, index };
}

function readState(org, member) {
  const f = fileFor(org, member);
  try { if (fs.lstatSync(f).isSymbolicLink()) return { ok: false, because: 'the backup state file is a link, so it was not read' }; } catch { /* missing: the read decides */ }
  let raw;
  try { raw = fs.readFileSync(f, 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, state: { job: {}, period: null } };
    return { ok: false, because: 'the backup state file could not be read' };
  }
  let got;
  try { got = JSON.parse(raw); } catch { return { ok: false, because: 'the backup state file is not one this computer wrote' }; }
  if (!got || got.v !== 1 || got.org !== org || got.member !== member) return { ok: false, because: 'the backup state file is not one this computer wrote' };
  const period = periodFrom(got.period);
  if (period === undefined) return { ok: false, because: 'the backup state file is not one this computer wrote' };
  // A file left looser (a copy, a restore) is made owner-only once it has read as ours, best effort. (Its contents were
  // trusted first, as backupmemberkey does: the folder is 0700, so only this user could have loosened it.)
  try { fs.chmodSync(f, 0o600); } catch { /* the read stands */ }
  return { ok: true, state: { job: cleanJob(got.job), period } };
}

function writeState(org, member, state) {
  const p = state && state.period;
  const period = p ? {
    label: p.label, namingKey: b64(p.namingKey), namingKeyId: backupkeys.namingKeyId(p.namingKey), bucket: p.bucket,
    index: [...p.index].map(([name, e]) => [name, e.key, e.lockedUntilMs, e.memberKeyId]),
  } : null;
  // Never write what would not read back: a file that read as "not ours" would stop every later run.
  if (periodFrom(period) === undefined) throw new Error('backupstate: refusing to write a period that would not read back');
  const body = JSON.stringify({ v: 1, org, member, job: cleanJob(state && state.job), period });
  fs.mkdirSync(dir(), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir(), 0o700); } catch { /* the file itself is 0600 either way */ }
  require('./securewrite').writeSecret(fileFor(org, member), body, 0o600, { atomicOnly: true });
}

function forPeriod(state, label, opts = {}) {
  if (!PERIOD_RE.test(label)) throw new Error('backupstate: a period label is an ISO week, such as 2026-W41');
  if (!HEX32_RE.test(opts.memberKeyId) || !Number.isSafeInteger(opts.nowMs)) throw new Error('backupstate: forPeriod needs the member key id and the time');
  const p = state && state.period;
  if (p && p.label === label) {
    const index = new Map();
    for (const [name, e] of p.index) if (e.memberKeyId === opts.memberKeyId && e.lockedUntilMs > opts.nowMs) index.set(name, e);
    return { label, namingKey: p.namingKey, bucket: p.bucket, index };
  }
  const namingKey = opts.newKey ? opts.newKey() : backupkeys.newNamingKey();
  return { label, namingKey, bucket: null, index: new Map() };
}

function withRun(state, period, result) {
  const r = result || {};
  let index = period.index, bucket = period.bucket;
  if (r.staleIndex) index = new Map();
  if (typeof r.bucket === 'string' && r.bucket && r.bucket !== bucket) {
    // The run's chunks are under ANOTHER bucket: the old index named chunks this period can no longer use.
    index = new Map();
    bucket = r.bucket;
  }
  if (r.added instanceof Map && r.added.size && bucket) {
    index = new Map(index);
    for (const [name, e] of r.added) {
      if (index.size >= MAX_INDEX) break;
      if (goodEntry(name, e, period.label)) index.set(name, { key: e.key, lockedUntilMs: e.lockedUntilMs, memberKeyId: e.memberKeyId });
    }
  }
  return Object.assign({}, state, { period: { label: period.label, namingKey: period.namingKey, bucket, index } });
}

function discardState(org, member) {
  const f = fileFor(org, member);
  try { fs.renameSync(f, `${f}.bad-${Date.now()}`); return { ok: true }; } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true };
    return { ok: false, because: 'the backup state file could not be set aside' };
  }
}

module.exports = { readState, writeState, forPeriod, withRun, discardState, fileFor };

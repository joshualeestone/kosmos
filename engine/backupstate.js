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
 *     bucket     the bucket path the period's chunks are under (takeSnapshot's `bucket`), or null before any
 *     index      Map name -> { key, lockedUntilMs, memberKeyId }: the chunks stored this period (takeSnapshot's `index`)
 *
 * readState(org, member) -> { ok: true, state } | { ok: false, because }
 *   A missing file is ok and empty ({ job: {}, period: null }). A file that is a link, unreadable, malformed, or for
 *   another (org, member) is NOT ok, and nothing should overwrite it (as backupmemberkey's file): the caller stops.
 * writeState(org, member, state): atomic (securewrite, owner-only). Throws on a state this module would not read back.
 * forPeriod(state, label, newKey?) -> period: the state's period when it is `label`, else a fresh one with a new
 *   naming key (newKey, injectable for tests) and an empty index. A new period never inherits the old index or key.
 * withRun(state, period, result) -> state: the period after a takeSnapshot result: `added` merged into the index under
 *   `bucket`; a staleIndex result drops the old index first; an otherBucket-style null bucket drops it all.
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
const MAX_INDEX = 200000;   // backupsnapshot's CHUNK_ALLOWANCE: no period holds more

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
  // A file left looser (a copy, a restore) is made owner-only once it has read as ours, best effort.
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

function forPeriod(state, label, newKey) {
  if (!PERIOD_RE.test(label)) throw new Error('backupstate: a period label is an ISO week, such as 2026-W41');
  const p = state && state.period;
  if (p && p.label === label) return p;
  const namingKey = newKey ? newKey() : backupkeys.newNamingKey();
  return { label, namingKey, bucket: null, index: new Map() };
}

function withRun(state, period, result) {
  const r = result || {};
  let index = period.index, bucket = period.bucket;
  if (r.staleIndex) index = new Map();
  if (r.bucket !== undefined && r.bucket !== bucket) {
    // The run's chunks are under another bucket (or none): the old index named chunks this period can no longer use.
    index = new Map();
    bucket = r.bucket;
  }
  if (r.added instanceof Map && r.added.size && bucket) {
    index = new Map(index);
    for (const [name, e] of r.added) index.set(name, e);
  }
  return Object.assign({}, state, { period: { label: period.label, namingKey: period.namingKey, bucket, index } });
}

module.exports = { readState, writeState, forPeriod, withRun, fileFor };

'use strict';
/**
 * kosmos#5744 slice 3: the member-key duties of one backup run, between ensureMemberKey (engine/backupmemberkey.js)
 * and takeSnapshot (engine/backupsnapshot.js). Nothing schedules a run yet (production backup is off); a scheduler
 * calls runOnce and keeps the returned state between runs.
 *
 * The duties, each from slice 2b's review:
 *   - seal only under a key ensureMemberKey answered ok: runOnce never calls the snapshot otherwise;
 *   - pass the epoch: the snapshot gets the key's epoch as a context id ('1') beside its public key, and takeSnapshot
 *     passes it to both uploaders, which refuse a grant for another epoch;
 *   - compare epochs: a refused grant naming a LATER epoch than the key's (the snapshot's otherEpoch) means the member's
 *     key moved on without this computer (one computer per member, so its file is stale, e.g. a restored data root).
 *     The key's epoch is then kept as lostEpoch;
 *   - pass lostEpoch: every key step sends it until a key above it is answered. An EARLIER epoch is never a reason to
 *     move on (a coordinator answering one is a rollback): it is reported, nothing changes;
 *   - back off on waiting: Kosmos+ takes a new key at most once a day and its refusal carries no retry time, so the
 *     job waits 1 hour, doubling to 24, without asking Kosmos+ meanwhile (each early send is a round trip, and after the
 *     day each counts toward the registration cap, kosmos#5736).
 *
 * state (plain, the caller persists it): { lostEpoch?, waitUntilMs?, waits? }. Every function returns a NEW state.
 * waits counts the waiting answers since the last ok key, so a refusal in between (no answer, an unreadable file)
 * does not restart the backoff at an hour. A waitUntilMs more than the longest wait ahead of the clock (written under
 * a clock that was wrong, or a restored state) is read as over: it would otherwise hold the job for as long as the
 * error.
 *
 * Kept from ensureMemberKey's answer, for the scheduler: unreadableKeyFile (a person must move the file aside; not a
 * retry), refusal, pendingEpoch and lostEpochIgnored.
 *
 * An ok key that comes with pendingEpoch is NEVER sealed under. ensureMemberKey keeps an unregistered key above a
 * registered one only when a move off a lost key is waiting out the day, or Kosmos+ took the newer key and this computer
 * could not note it: either way the answered key is already behind Kosmos+ (a run under it would walk and seal the
 * whole tree to be refused at the grant). It is kept as lostEpoch instead, so the next call sends the pending key (a
 * repeat, if Kosmos+ already holds it). This also restores lostEpoch when the caller lost the job's state.
 *
 * Only waiting is backed off. Every other refusal is asked again on the next run, and some send a registration
 * (a refused one is re-sent): Kosmos+ caps registrations per member (30 an hour, kosmos#5736), so a scheduler must not
 * run this more often than that allows.
 */

const BACKOFF_MIN_MS = 60 * 60 * 1000;
const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;
const isEpoch = (e) => Number.isSafeInteger(e) && e >= 1;

function cleanState(state) {
  const s = state && typeof state === 'object' ? state : {};
  const out = {};
  if (isEpoch(s.lostEpoch)) out.lostEpoch = s.lostEpoch;
  if (Number.isSafeInteger(s.waitUntilMs) && s.waitUntilMs > 0) out.waitUntilMs = s.waitUntilMs;
  if (Number.isSafeInteger(s.waits) && s.waits > 0) out.waits = s.waits;
  return out;
}
function backoffMs(waits) {
  return Math.min(BACKOFF_MIN_MS * 2 ** Math.min(Math.max(waits - 1, 0), 10), BACKOFF_MAX_MS);
}

/* The key step. deps: { ensureMemberKey, now? }. Resolves { ok: true, key: { epoch, publicKey }, state, lostEpochIgnored? }
   or { ok: false, because, waiting?, pendingEpoch?, lostEpochIgnored?, unreadableKeyFile?, refusal?, state }. Never throws. */
async function memberKeyFor(state, deps) {
  const st = cleanState(state);
  const now = (deps && deps.now) || Date.now;
  const ensure = deps && deps.ensureMemberKey;
  if (typeof ensure !== 'function') return { ok: false, because: 'no member key step', state: st };
  if (st.waitUntilMs && now() < st.waitUntilMs && st.waitUntilMs - now() <= BACKOFF_MAX_MS) {
    return { ok: false, waiting: true, because: 'Kosmos+ takes a new backup key at most once a day; this computer tries again later', state: st };
  }
  let r;
  try { r = await ensure(st.lostEpoch ? { lostEpoch: st.lostEpoch } : {}); } catch { r = null; }
  if (r && r.ok && isEpoch(r.epoch) && Buffer.isBuffer(r.publicKey) && r.publicKey.length === 32) {
    // An answer below the lost epoch comes when ensureMemberKey ignored lostEpoch (it is not the file's newest
    // registered key): that key is older still, so it is the one to replace next run. Never sealed under. (Equal is
    // never answered when lostEpoch is honoured; refused too, defensively.)
    const waitsKept = st.waits ? { waits: st.waits } : {};
    if (st.lostEpoch && r.epoch <= st.lostEpoch) {
      return Object.assign({ ok: false, because: 'the backup key this computer holds is older than the member\'s current one; it registers a new one next time', state: Object.assign({ lostEpoch: r.epoch }, waitsKept) },
        r.lostEpochIgnored === true ? { lostEpochIgnored: true } : {});
    }
    if (isEpoch(r.pendingEpoch) && r.pendingEpoch > r.epoch) {
      return { ok: false, pendingEpoch: r.pendingEpoch, because: 'a newer backup key for this computer is not confirmed with Kosmos+ yet; it is sent next time', state: Object.assign({ lostEpoch: r.epoch }, waitsKept) };
    }
    return Object.assign({ ok: true, key: { epoch: r.epoch, publicKey: r.publicKey }, state: {} },
      r.lostEpochIgnored === true ? { lostEpochIgnored: true } : {});
  }
  const keep = Object.assign(st.lostEpoch ? { lostEpoch: st.lostEpoch } : {}, st.waits ? { waits: st.waits } : {});
  if (r && r.waiting) {
    const waits = (st.waits || 0) + 1;
    return Object.assign({ ok: false, waiting: true, because: r.because, state: Object.assign(keep, { waitUntilMs: now() + backoffMs(waits), waits }) },
      isEpoch(r.pendingEpoch) ? { pendingEpoch: r.pendingEpoch } : {});
  }
  return Object.assign({ ok: false, because: (r && typeof r.because === 'string' && r.because) || 'the backup key could not be set up on this computer', state: keep },
    r && r.unreadableKeyFile === true ? { unreadableKeyFile: true } : {}, r && r.refusal && typeof r.refusal === 'object' ? { refusal: r.refusal } : {});
}

/* The state after a snapshot taken under `key`. A refusal naming a later epoch marks the key lost; anything else
   leaves the state as it was. Never throws. */
function afterSnapshot(state, key, result) {
  const st = cleanState(state);
  const other = result && !result.ok ? result.otherEpoch : undefined;
  if (key && isEpoch(key.epoch) && isEpoch(other) && other > key.epoch) return Object.assign(st, { lostEpoch: key.epoch });
  return st;
}

/* One run: the key step, then (only under an ok key) deps.snapshot({ memberPk, epoch }), where epoch is the key's
   context id. deps: { ensureMemberKey, snapshot, now? }. Resolves { state, key?, result }: result is the key step's
   refusal when no snapshot was taken (its because and flags), else the snapshot's own
   result. key, when present, carries the key step's lostEpochIgnored. Never throws. */
async function runOnce(state, deps) {
  const k = await memberKeyFor(state, deps);
  if (!k.ok) {
    const { ok, state: kept, ...rest } = k;
    return { state: kept, result: Object.assign({ ok: false }, rest) };
  }
  if (!deps || typeof deps.snapshot !== 'function') return { state: k.state, key: k.key, result: { ok: false, because: 'no snapshot step' } };
  let result;
  try { result = await deps.snapshot({ memberPk: k.key.publicKey, epoch: String(k.key.epoch) }); } catch { result = null; }
  if (!result || typeof result !== 'object') result = { ok: false, because: 'the snapshot failed unexpectedly' };
  const key = Object.assign({}, k.key, k.lostEpochIgnored ? { lostEpochIgnored: true } : {});
  return { state: afterSnapshot(k.state, k.key, result), key, result };
}

module.exports = { BACKOFF_MIN_MS, BACKOFF_MAX_MS, backoffMs, memberKeyFor, afterSnapshot, runOnce };

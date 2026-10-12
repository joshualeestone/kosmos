'use strict';
/**
 * kosmos#5535 E0.6 slice (c), second half: ONE backup run, composed from the reviewed parts.
 *
 *   engine/backupjob.js        the member-key duties (runOnce: the key step, then a snapshot only under an ok key)
 *   engine/backupstate.js      what one run keeps for the next, per (org, member): the job's state and two periods
 *   engine/backupdevicekey.js  the key the manifest is signed with (the connector's mac_key)
 *   engine/backupsnapshot.js   the snapshot itself
 *
 * Nothing schedules this yet (slice (d), the hourly tick, and production backup is off at Kosmos+). The caller gives
 * the roots (backupsnapshot's `roots`); which folders those are is the tick's business, not the run's.
 *
 * The pair. The state file is per (org, member), and only Kosmos+'s backup-key answer names them. So this computer
 * keeps a pointer, `current.json` beside the state files: the pair the last answer named (not a secret). A run reads
 * that pair's state and passes the pair to backupjob, which sends a lost epoch only for it and refuses an answer for
 * another pair (otherPair). With no pointer (the first run, or a pointer that does not read), or on otherPair, the
 * pointer is set to the pair the answer named and the run starts again ONCE under it, before any snapshot: one more
 * backup-key request, never a snapshot under a pair whose state was not read. A second change inside one run stops it.
 *
 * The caller duties backupstate.js names, kept here:
 *   - the period's naming key is written BEFORE the snapshot (withPeriod, then writeState), so a run that dies keeps it;
 *   - the state is written after the snapshot (withRun), the job's state with it;
 *   - one run at a time: runs are chained in this process (one board process per data root, as backupmemberkey
 *     assumes);
 *   - this clock's week first (periodOf(now)); on newPeriod WITH grantedPeriod, once more in that week; never a loop.
 * A state file that does not read is NOT discarded here: the run stops and says so (refusedState), or (retry) asks the
 * caller to try later. Setting a file aside is a decision the caller makes, once, and says to the person.
 *
 * runBackup({ roots }, deps?) -> { ok, because?, ...flags }. Never throws. Flags:
 *   the snapshot's own (manifestKey, files, uploaded, reused, retryLater, newPeriod, staleIndex, overAllowance ...);
 *   the key step's (waiting, pendingEpoch, unreadableKeyFile, refusal ...) when no snapshot was taken;
 *   the device key's missing (remote access never set up on this computer: a person acts, not a retry) and retry;
 *   refusedState (the state file is not this computer's; the caller may discardState it), retry (a passing error),
 *   pairChanged (Kosmos+ named another pair twice in one run). leftOut: index rows withRun could not keep (a bug shows).
 *   stateNotKept, stateBecause, stateRetry: the state could not be written AFTER the run; the run's own answer and
 *   flags stand beside them (a snapshot taken is still taken; its chunks are uploaded again next run).
 * A first run (no pointer) whose key step refuses keeps that answer's job state in the named pair's file (when the file
 * holds none of its own) and stops; one whose key step names no pair keeps nothing (there is no file to keep it in).
 * deps (tests): ensureMemberKey, takeSnapshot, deviceKey, macRequest, now, snapshotId.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const backupkeys = require('./backupkeys');
const backupstate = require('./backupstate');
const job = require('./backupjob');

const ID = backupkeys.ID_RE;

function pointerFile() { return path.join(store.ROOT, 'backupstate', 'current.json'); }

/* The pair the last answer named, or null (missing, a link, or not this module's): a null pointer is learned again. */
function readPointer() {
  const f = pointerFile();
  try {
    if (fs.lstatSync(f).isSymbolicLink()) return null;
    const got = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (got && got.v === 1 && typeof got.org === 'string' && ID.test(got.org) && typeof got.member === 'string' && ID.test(got.member)) {
      return { org: got.org, member: got.member };
    }
  } catch { /* missing or malformed: learned again */ }
  return null;
}
function writePointer(pair) {
  fs.mkdirSync(path.dirname(pointerFile()), { recursive: true, mode: 0o700 });
  require('./securewrite').writeSecret(pointerFile(), JSON.stringify({ v: 1, org: pair.org, member: pair.member }), 0o600, { atomicOnly: true });
}

/* A snapshot id: the UTC time (sortable) and 4 random bytes, inside the manifest context's alphabet. */
function newSnapshotId(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z') + '-' + crypto.randomBytes(4).toString('hex');
}

const fixed = (err) => (err && typeof err.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(err.code) && err.code !== 'refused' ? ' (' + err.code + ')' : '');

let chain = Promise.resolve();
function runBackup(input, deps) {
  const run = chain.then(() => runNow(input || {}, deps || {}));
  chain = run.catch(() => {});
  return run;
}

async function runNow(input, deps) {
  try {
    const now = deps.now || Date.now;
    let pair = readPointer();
    for (let attempt = 0; attempt < 2; attempt++) {
      let state;
      if (pair) {
        const read = backupstate.readState(pair.org, pair.member);
        if (!read.ok) return Object.assign({ ok: false, because: read.because }, read.retry ? { retry: true } : { refusedState: true });
        state = read.state;
      } else {
        state = { job: {}, periods: [] };
      }
      const ref = { state, leftOut: 0, unwritable: false, took: false };
      const known = pair;
      const r = await job.runOnce(state.job, {
        ensureMemberKey: deps.ensureMemberKey || require('./backupmemberkey').ensureMemberKey,
        pair: known,
        now,
        // Under no known pair nothing is snapshotted: the pair is learned first and the run starts again under it.
        snapshot: (k) => (known ? snapshotStep(known, k, ref, input, deps, now) : { ok: false, learnPair: true, because: 'this computer learned its company and member; it starts again' }),
      });
      if (r.result && r.result.otherPair) {
        if (!keepPointer(r.result.otherPair)) return { ...POINTER_FAILED };
        pair = r.result.otherPair;
        continue;
      }
      if (!known && r.pair) {
        if (!keepPointer(r.pair)) return { ...POINTER_FAILED };
        // An ok key: start again under the pair, reading its state first (it may have one: a lost pointer).
        if (r.result && r.result.learnPair) { pair = r.pair; continue; }
        // The key step refused (a wait, a pending key, no answer...). Its answer is already this pair's, so it is kept
        // and the run stops: starting again would send the same request again, a registration inside a rotation wait
        // among them (review 1). The job state goes into the pair's file only when that file holds none of its own (a
        // lost pointer over a live file keeps the file's); a file that does not read is left for the next run to report.
        const read = backupstate.readState(r.pair.org, r.pair.member);
        if (read.ok && !Object.keys(read.state.job || {}).length && Object.keys(r.state || {}).length) {
          try { backupstate.writeState(r.pair.org, r.pair.member, Object.assign({}, read.state, { job: r.state })); } catch { /* kept next time */ }
        }
        return stripState(r.result);
      }
      // No pair named at all (no answer, an unreadable one): nothing to keep the job's state in, so it is not kept. An
      // ok key whose answer named no pair is said as that (review 2), never as the learn-and-restart it did not do.
      if (!known) {
        if (r.result && r.result.learnPair) return { ok: false, because: 'Kosmos+ did not name the company and member this computer backs up for' };
        return Object.assign({ ok: false }, stripState(r.result));
      }
      // The snapshot step could not write the state, so no snapshot was taken: its own answer says why, and writing
      // again would only fail again under a sentence claiming the backup ran.
      if (ref.unwritable) return stripState(r.result);
      ref.state = Object.assign({}, ref.state, { job: r.state });
      try { backupstate.writeState(known.org, known.member, ref.state); } catch (err) {
        // The run's own answer stands, flags and all; the write failure rides beside it (review 1). "Ran" only when a
        // snapshot was taken.
        return Object.assign(stripState(r.result), keyFlags(r), ref.leftOut ? { leftOut: ref.leftOut } : {}, { stateNotKept: true,
          stateBecause: (ref.took ? 'the backup ran, but this computer could not keep what it needs for the next one' : 'this computer could not keep the backup state') + fixed(err) },
          err && err.retry ? { stateRetry: true } : {}, err && err.code === 'refused' && !err.retry ? { refusedState: true } : {});
      }
      return Object.assign(stripState(r.result), keyFlags(r), ref.leftOut ? { leftOut: ref.leftOut } : {});
    }
    return { ok: false, pairChanged: true, because: 'Kosmos+ named another company or member twice in one run; this computer tries again next time' };
  } catch (err) {
    return { ok: false, because: 'the backup could not run on this computer' + fixed(err) };
  }
}

/* The result as the caller sees it: `added` (a Map of every chunk stored) is the state's business, already kept, and
   learnPair is this module's own signal. */
function stripState(result) {
  const { added, learnPair, ...rest } = result || {};
  return rest;
}
/* The key step's flag that rides on runOnce's `key` rather than its result (review 2). */
const keyFlags = (r) => (r.key && r.key.lostEpochIgnored ? { lostEpochIgnored: true } : {});
const POINTER_FAILED = Object.freeze({ ok: false, because: 'this computer could not note which company and member it backs up for; it tries again next time' });
function keepPointer(pair) {
  try { writePointer(pair); return true; } catch { return false; }
}

/* The snapshot under an ok key for `pair`: this clock's week, and once more in a granted week. ref.state is kept
   current, so the job's state is written over the latest periods. */
async function snapshotStep(pair, k, ref, input, deps, now) {
  const snapshotsMod = require('./backupsnapshot');
  const take = deps.takeSnapshot || snapshotsMod.takeSnapshot;
  const memberKeyId = snapshotsMod.memberKeyIdOf(k.memberPk);
  let label = snapshotsMod.periodOf(now());
  let result;
  for (let i = 0; i < 2; i++) {
    let p;
    try { p = backupstate.forPeriod(ref.state, label, { memberKeyId, nowMs: now() }); } catch {
      // Only the granted week can be malformed here (periodOf writes the first): the first run's answer stands.
      if (i > 0) break;
      throw new Error('backuprun: periodOf gave a period backupstate does not read');
    }
    ref.state = backupstate.withPeriod(ref.state, p);
    try { backupstate.writeState(pair.org, pair.member, ref.state); } catch (err) {
      ref.unwritable = true;
      return Object.assign({ ok: false, because: 'this computer could not keep the backup state, so no backup was taken' + fixed(err) }, err && err.retry ? { retry: true } : {}, err && err.code === 'refused' && !err.retry ? { refusedState: true } : {});
    }
    const dk = (deps.deviceKey || require('./backupdevicekey').deviceKey)();
    // missing: remote access was never set up here, which a person must act on; never a retry (review 3).
    if (!dk || !dk.ok) return Object.assign({ ok: false, because: (dk && dk.because) || 'the device key could not be read' }, dk && dk.retry ? { retry: true } : {}, dk && dk.missing ? { missing: true } : {});
    ref.took = true;
    result = await take({
      roots: input.roots, memberPk: k.memberPk, namingKey: p.namingKey, namingKeyId: backupkeys.namingKeyId(p.namingKey),
      deviceKey: dk.privateKey, index: p.index, bucket: p.bucket,
      ctx: { org: pair.org, member: pair.member, epoch: k.epoch, period: label, snapshot: (deps.snapshotId || newSnapshotId)(now()) },
    }, deps.macRequest ? { macRequest: deps.macRequest } : { macRequest: (m, r, b) => require('./remote').macRequest(m, r, b) });
    if (!result || typeof result !== 'object') result = { ok: false, because: 'the snapshot failed unexpectedly' };
    const after = backupstate.withRun(ref.state, p, result);
    ref.leftOut += after.leftOut || 0;
    const { leftOut, ...kept } = after;
    ref.state = kept;
    if (i === 0 && result.newPeriod && typeof result.grantedPeriod === 'string' && result.grantedPeriod !== label) {
      label = result.grantedPeriod;
      continue;
    }
    break;
  }
  return result;
}

module.exports = { runBackup, readPointer, newSnapshotId };

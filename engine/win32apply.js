'use strict';
/**
 * The Windows in-app updater, slice S3: SWAP a staged build in, and put the old one back when it
 * does not take. engine/win32update.js's prepare() (S2) staged it; its begin() (B5) writes the
 * journal and starts the helper this module is. Nothing in the product calls begin() yet: only the
 * live-check CLI does, and SELF_INSTALL is still darwin-only.
 *
 * 🔑 THE UPDATE MOVES ONLY THE BUILD'S OWN TOP-LEVEL ENTRIES. ROOT is the unpacked Kosmos folder
 * the board runs from; a person keeps `Projects` (and anything else) beside the entries, and none of
 * that is ever touched. Every move is a rename on one volume, between three places:
 *     ROOT\<entry>                                the running build
 *     ROOT\.kosmos-update\previous-<from>\<entry> the old build, kept after a success
 *     ROOT\.kosmos-update\staged\<entry>          the new build, until it moves in
 * Every write goes through ONE guard (writeGuard): inside ROOT's entries, inside WORK, or the
 * anchor's journal, status, pointer and node.exe (with their temp and side files).
 *
 * 🔑 THE JOURNAL MAKES A CRASH AT ANY INSTANT RECOVERABLE. It is replaced atomically before every
 * phase and around every rename, and a rename is atomic, so each entry is always in exactly one
 * knowable place. The rollback is driven by what is on disk, with the journal as the plan, and is
 * idempotent: a second run after a crash does the rest.
 *
 * WHO RESUMES AN UPDATE THAT STOPPED (each takes the update lock first, which a live helper holds):
 *   - the board's logon shim, before it loads the board (win32board.BOOT_JS -> recoverAtBoot), at
 *     every task start. It loads THIS file from the OLD build, which is always whole in one of two
 *     places (journal.recoverFrom), because a crash can leave ROOT without `app`;
 *   - the next begin() (resumeJournal, in a helper), for a helper that died while a board kept
 *     running and no logon comes;
 *   - the helper itself (H8).
 *
 * THE HELPER, `<anchored node.exe> ROOT\app\engine\win32update.js --kosmos-update-apply <journal>`:
 *   H1  every dependency loads with this module, before any step; nothing after it requires
 *   H2  stop the board: end it, wait for its pid and its port, settle
 *   H3  move each entry ROOT has into previous-<from>
 *   H4  move each staged entry into ROOT, `app` last
 *   H5  only when the runtime changed: replace the anchored node.exe (a verified copy first)
 *   H6  write engine-path atomically
 *   H7  start the board and confirm it by its identity header, never by task status
 *   H8  on any failure, reverse the journal exactly, start the old board, confirm the old identity
 *   H9  on success: the status, then the staged tree and the download go; previous-<from> stays
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

/* H1. Every module the helper and the resumers call is required here, at load, before any step
   runs: after H3 the `app` these came from has moved, and a lazy require would read the wrong
   build or nothing. engine/win32apply.test.js instruments Module._load to pin it. */
const liveExec = require('./live-execution');
const update = require('./update');
const win32anchor = require('./win32anchor');
const win32board = require('./win32board');
const win32handoff = require('./win32handoff');
const win32orphan = require('./win32orphan');
const win32swap = require('./win32swap');
const win32update = require('./win32update');

const JOURNAL_FORMAT = 1;
/** This file's own name, which the journal's recoverFrom points at in the old build. */
const MODULE_FILE_NAME = path.basename(__filename);
/** The old build's folder inside WORK, named by its version so a later slice can roll back to it. */
const PREVIOUS_PREFIX = 'previous-';
/** H5's verified copy of the anchored node.exe, inside previous-<from>: the rollback's source, so a
    restore is byte-identical whatever the anchoring sweep does to the retired file meanwhile. */
const ANCHORED_NODE_COPY_NAME = 'anchored-node.exe';
/** The helper's transcript. Its stdio is ignored (a detached child has nowhere else to speak). */
const APPLY_LOG_NAME = 'update-apply.log';

const PHASES = Object.freeze([
  'staged', 'stopping', 'moving-out', 'moving-in', 'interpreter', 'pointer', 'starting',
  'confirmed', 'rolling-back', 'stuck',
]);
/** The phases in which nothing in ROOT or the anchor has changed yet. */
const UNCHANGED_PHASES = Object.freeze(['staged', 'stopping']);

/**
 * How long a journal at `staged` belongs to the helper begin() has just started for it. The helper is
 * the anchored node.exe loading this module and taking the lock, well under a second on the box and
 * a few seconds when a scanner inspects the interpreter's start. Until this passes, the resume helper
 * and a second begin() leave a staged journal alone, so a second request for an update can never
 * cancel a healthy one. Two minutes is far beyond any real start, and a staged journal older than
 * that has no helper coming (its spawn failed after returning). The logon shim does not wait: no
 * helper survives a restart.
 */
const STAGED_HELPER_STARTUP_GRACE_MS = 2 * 60 * 1000;

const DEFAULT_APPLY_LIMITS = Object.freeze({
  /** H2: how long the old board gets to be gone after /End. win32board.restartHelperMain's figure. */
  stopWaitMs: 30 * 1000,
  stopPollMs: 200,
  /** H2: the port outlived /End by about a second, measured (win32board.restart). */
  settleMs: 1000,
  /** H7: /Run is issued up to this many times; each run waits this long for the identity. 3 x 20 s is
      the design's ~60 s. A board boots in about 2 s on the box, so a run that shows nothing in 20 s
      did not start one (/Run reports success even when IgnoreNew started nothing). */
  confirmRuns: 3,
  confirmWaitPerRunMs: 20 * 1000,
  confirmPollMs: 500,
  /** H8: whole reversal passes, and the wait between them, on top of each rename's own ~1 s of
      retries (win32swap.renameWithRetry). A scanner lets go within seconds; a window a person left
      open does not, and that is the stuck case. */
  rollbackPasses: 3,
  rollbackPassWaitMs: 2000,
});

/**
 * The held-read budget of the helper, the resumers and the logon shim: how long they keep asking about
 * a lock, journal, file or folder another process holds (win32update.HELD_FILE_CODES) before they call
 * it unknown. It is the wait a whole rollback already gives a scanner or backup tool to let go
 * (rollbackPasses x rollbackPassWaitMs, 6 s), in reads stopPollMs apart (200 ms, H2's poll): 31 reads.
 * B0 and begin() answer a person and keep win32update.QUICK_HELD_READ_BUDGET (60 ms). Waiting is safe:
 * a live owner's lock cannot be taken meanwhile, and nothing is written during the wait.
 * win32board.BOOT_JS carries the same numbers for its journal read, pinned by a test.
 */
const OWNER_READ_BUDGET = Object.freeze({
  tries: 1 + Math.ceil((DEFAULT_APPLY_LIMITS.rollbackPasses * DEFAULT_APPLY_LIMITS.rollbackPassWaitMs) / DEFAULT_APPLY_LIMITS.stopPollMs),
  waitMs: DEFAULT_APPLY_LIMITS.stopPollMs,
});

/**
 * After H7 confirmed the new board, how long the helper keeps trying to record `confirmed` while it
 * cannot tell whether the update is still its own: as long again as H7 gave that board to answer
 * (confirmRuns x confirmWaitPerRunMs, 60 s). Its lock stays held all that time, so no resumer can take
 * the update and roll the confirmed board back. After it, the helper stops writing and still reports
 * `updated`; the journal stays at `starting`, and the next begin()'s resumer finishes it forward once
 * the new board answers (resumeJournal).
 */
const CONFIRMED_RECORD_PATIENCE_MS = DEFAULT_APPLY_LIMITS.confirmRuns * DEFAULT_APPLY_LIMITS.confirmWaitPerRunMs;

const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) { Atomics.wait(SLEEP_CELL, 0, 0, ms); }

class StepFailure extends Error {
  constructor(because) { super(because); this.name = 'StepFailure'; }
}

/** This context no longer owns the update, proved (see assertStillOwner). Never caught as a step
    failure: the step and rollback catches rethrow it, the cleanup after a finished journal stops at
    it and keeps the outcome already recorded, and each entry point turns it into `taken-over`. */
class LostOwnership extends Error {
  constructor(because) { super(because); this.name = 'LostOwnership'; }
}

/** This context cannot tell whether it still owns the update: its lock or journal is there but cannot
    be read (see assertStillOwner). Thrown only outside the forward steps, where it travels like
    LostOwnership, and each entry point turns it into `held`: the journal stays unfinished for the next
    resumer. Inside the forward steps the same finding is a StepFailure, and the rollback runs. */
class OwnershipUnknown extends Error {
  constructor(because) { super(because); this.name = 'OwnershipUnknown'; }
}

/** Does this error mean the context must write nothing more? */
function stopsWriting(e) { return e instanceof LostOwnership || e instanceof OwnershipUnknown; }

function firstLine(e) { return String((e && e.message) || e).split('\n')[0]; }
function codeOf(e) { return (e && e.code) || 'unknown'; }
/** An error for a log line: its code, or its name when it has none, and its first line. */
function describeError(e) { return `${(e && (e.code || e.name)) || 'error'}: ${firstLine(e)}`; }
/** Is there anything at this name? A link counts, whatever it points at. */
function exists(target) {
  try { fs.lstatSync(target); return true; } catch { return false; }
}
/**
 * 🛑 A HELD OR UNREADABLE ANSWER IS NEVER PROOF OF ANYTHING. What lstat proves about `target`:
 * `{ state: 'there' }`, `{ state: 'gone', code }` (ENOENT or ENOTDIR, and nothing else), or
 * `{ state: 'unknown', code }`. A held code is asked again within `reading`'s budget
 * (win32update.tryRetryingHolds; `reading` is `{ waitSync, budget }`, the quick budget when absent),
 * and what is still unknown after it stays unknown: held or unreachable, never gone, moved, abandoned
 * or a reason to roll back. Every existence check that decides anything goes through this.
 */
function presenceOf(target, reading) {
  const r = reading || {};
  const looked = win32update.tryRetryingHolds(() => fs.lstatSync(target), r.waitSync, r.budget);
  if (looked.missing) return { state: 'gone', code: looked.code };
  if (looked.code) return { state: 'unknown', code: looked.code };
  return { state: 'there' };
}

/** presenceOf for a decision a step or a rollback pass acts on: true or false, or a StepFailure when it
    stays unknown, so the step fails (and a rollback pass is tried again) instead of acting on a guess.
    The failure names the entry, not the whole path. */
function isThere(target, reading) {
  const p = presenceOf(target, reading);
  if (p.state === 'unknown') throw new StepFailure(`${path.basename(target)} cannot be checked right now (code=${p.code})`);
  return p.state === 'there';
}

/** A file's text for a decision: the text, null when it is gone, or a StepFailure when it stays
    unreadable (win32update.readFileRetryingHolds within `reading`'s budget). */
function readTextKnown(file, reading) {
  const r = reading || {};
  const read = win32update.readFileRetryingHolds(file, r.waitSync, r.budget);
  if (read.missing) return null;
  if (read.code) throw new StepFailure(`${path.basename(file)} cannot be read right now (code=${read.code})`);
  return read.text;
}

/** readTextKnown, parsed: the value, null when it is gone or is not JSON, or a StepFailure. */
function readJsonKnown(file, reading) {
  const text = readTextKnown(file, reading);
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return null; }
}
function samePath(a, b) {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}
const isVersion = (v) => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);

/**
 * The order entries move in: `runtime`, `bin`, the top-level files, and `app` LAST, both out (H3)
 * and in (H4). `app` last in H3 keeps the old board bootable for as long as possible, and last in H4
 * means a board can only start once everything it needs is in place.
 */
function moveOrder() {
  const first = ['runtime', 'bin'];
  const last = 'app';
  return [...first, ...win32update.ENTRIES.filter((e) => !first.includes(e) && e !== last), last];
}

/* ─── the journal ────────────────────────────────────────────────────────────────────────── */

function journalPathFor(anchorDir) { return path.join(anchorDir, win32anchor.UPDATE_JOURNAL_NAME); }
function statusPathFor(anchorDir) { return path.join(anchorDir, win32anchor.UPDATE_STATUS_NAME); }

/**
 * What is wrong with a journal, as the end of a sentence, or null. Every path in it must be the one
 * this module derives from its root, anchor and versions, so a damaged or edited journal can never
 * steer a rename anywhere else.
 */
function journalProblem(j, journalAt) {
  if (!j || typeof j !== 'object' || j.format !== JOURNAL_FORMAT) return 'is not an update journal this Kosmos can read';
  for (const key of ['root', 'work', 'staged', 'previous', 'anchor']) {
    if (typeof j[key] !== 'string' || !path.isAbsolute(j[key])) return `names no folder for ${key}`;
  }
  if (!j.from || !isVersion(j.from.version) || typeof j.from.identity !== 'string') return 'names no version it updates from';
  if (!j.to || !isVersion(j.to.version) || typeof j.to.identity !== 'string') return 'names no version it updates to';
  if (!samePath(j.anchor, path.dirname(journalAt))) return 'belongs to another folder';
  if (!samePath(j.work, path.join(j.root, win32update.WORK_DIRNAME))
    || !samePath(j.staged, path.join(j.work, win32update.STAGED_DIRNAME))
    || !samePath(j.previous, path.join(j.work, PREVIOUS_PREFIX + j.from.version))) return 'names folders the updater does not use';
  if (!PHASES.includes(j.phase)) return `is at a step this Kosmos does not know (${JSON.stringify(j.phase)})`;
  const order = moveOrder();
  if (!Array.isArray(j.order) || j.order.join('\n') !== order.join('\n')) return 'moves entries in an order this Kosmos does not use';
  for (const key of ['presentBefore', 'stagedEntries']) {
    if (!Array.isArray(j[key]) || !j[key].every((e) => order.includes(e))) return `lists entries this Kosmos does not move (${key})`;
  }
  if (!j.board || !Number.isInteger(j.board.port) || !(j.board.pid === null || Number.isInteger(j.board.pid))) return 'names no board port';
  if (!j.pointer || !samePath(j.pointer.at, path.join(j.anchor, win32anchor.POINTER_NAME))
    || typeof j.pointer.before !== 'string' || typeof j.pointer.after !== 'string') return 'names no engine pointer';
  if (j.interpreter !== null && (typeof j.interpreter !== 'object'
    || !samePath(j.interpreter.at, path.join(j.anchor, win32anchor.NODE_NAME))
    || !samePath(j.interpreter.copy, path.join(j.previous, ANCHORED_NODE_COPY_NAME))
    || !samePath(j.interpreter.source, path.join(j.root, 'runtime', win32anchor.NODE_NAME)))) return 'names an interpreter the updater does not replace';
  if (!Array.isArray(j.recoverFrom) || j.recoverFrom.join('\n') !== recoverFromFor(j.root, j.previous).join('\n')) return 'names recovery code outside the Kosmos folder';
  if (!Array.isArray(j.steps)) return 'has no steps';
  return null;
}

/** Where the OLD build's copy of this file is, in the order to look: after H3 moved `app` it is in
    previous-<from>; before that it is still in ROOT. The first that exists is the old build's, with
    one exception: when previous-<from> was deleted after H4, the second is ROOT's, which is the NEW
    build's. Loading that is safe: it reads journal format 1 or refuses the journal as unreadable, its
    paths come from the journal's own root, and treeProblem and reversePass never call a new app the
    old tree or move it out of ROOT, so the result is a stuck status. */
function recoverFromFor(root, previous) {
  return [
    path.join(previous, 'app', 'engine', MODULE_FILE_NAME),
    path.join(root, 'app', 'engine', MODULE_FILE_NAME),
  ];
}

/**
 * `{ state: 'none' }`, `{ state: 'unreadable', why, code? }` (`code` only when the file could not be
 * read at all), or `{ state: 'finished' | 'unfinished', journal }`. A writer replacing the journal
 * holds it for a moment, so the read goes through win32update.readFileRetryingHolds within `reading`'s
 * budget (`{ waitSync, budget }`; the quick budget when absent, as B0 reads it). Never throws.
 */
function readJournal(journalAt, reading) {
  const r = reading || {};
  const read = win32update.readFileRetryingHolds(journalAt, r.waitSync, r.budget);
  if (read.missing) return { state: 'none' };
  if (read.code) return { state: 'unreadable', why: `cannot be read (code=${read.code})`, code: read.code };
  const text = read.text;
  let j = null;
  try { j = JSON.parse(text); } catch { return { state: 'unreadable', why: 'is not valid JSON' }; }
  const problem = journalProblem(j, journalAt);
  if (problem) return { state: 'unreadable', why: problem };
  return { state: j.finished ? 'finished' : 'unfinished', journal: j };
}

/** The sentence for a journal readJournal could not use. One it could not read at all (a code: a
    scanner or backup holding it, most often) is busy, and nothing is to be removed; only a journal that
    read and is not a valid one is named for removal by hand. */
function unreadableSentence(journalAt, read) {
  if (read.code) return `the record of an earlier update (${journalAt}) is busy right now (code=${read.code}), so the updater cannot read it yet. Try again in a minute`;
  return `the record of an earlier update (${journalAt}) ${read.why}, so the updater cannot tell whether that update finished. Remove that file by hand once Kosmos is working normally, then try again`;
}

/** B0's journal precondition, as a sentence, or null. */
function unfinishedUpdateRefusal(anchorDir) {
  const journalAt = journalPathFor(anchorDir);
  const read = readJournal(journalAt);
  if (read.state === 'unreadable') return unreadableSentence(journalAt, read);
  if (read.state !== 'unfinished') return null;
  const j = read.journal;
  const found = unrecoverableCase(j);
  if (found && found.kind === 'unreachable') {
    return `an earlier update to ${j.to.version} cannot be finished right now, because ${found.because}. Reconnect that drive, or close any program using the Kosmos folder, then restart your computer and try again. If that does not help, ${freshCopyWayOut(j.root)}`;
  }
  if (found) return `an earlier update to ${j.to.version} can never finish, because ${found.because}. Asking Kosmos to update again clears that record`;
  /* H7 proved the new board: the update worked, and only its record is still being finished. */
  if (j.phase === 'confirmed') return `Kosmos has updated to ${j.to.version} and is finishing up. Try again in a minute`;
  return `an earlier update to ${j.to.version} has not finished yet. Kosmos finishes it, or puts ${j.from.version} back, the next time its board starts; try again after that`;
}

/**
 * The journal B5 writes, while prepare() still holds the update lock. `spec`: root, anchor,
 * prepared (prepare()'s result), fromVersion, fromIdentity, board ({pid, port}), now.
 */
function stagedJournal(spec) {
  const root = path.resolve(spec.root);
  const anchor = path.resolve(spec.anchor);
  const work = path.join(root, win32update.WORK_DIRNAME);
  const staged = path.join(work, win32update.STAGED_DIRNAME);
  const previous = path.join(work, PREVIOUS_PREFIX + spec.fromVersion);
  const pointerAt = path.join(anchor, win32anchor.POINTER_NAME);
  const at = new Date(spec.now).toISOString();
  const order = moveOrder();
  return {
    format: JOURNAL_FORMAT,
    token: crypto.randomBytes(8).toString('hex'),
    phase: 'staged',
    finished: false,
    outcome: null,
    root, work, staged, previous, anchor,
    order,
    /* Held answers are asked again, and one still unknown refuses the journal (isThere throws): an
       entry recorded absent would never be moved out, or would be moved onto one still there. */
    presentBefore: order.filter((e) => isThere(path.join(root, e))),
    stagedEntries: order.filter((e) => isThere(path.join(staged, e))),
    from: { version: spec.fromVersion, identity: spec.fromIdentity },
    to: { version: spec.prepared.version, identity: spec.prepared.expectedIdentity, sha256: spec.prepared.sha256 },
    runtimeChanged: Boolean(spec.prepared.runtimeChanged),
    board: { pid: Number.isInteger(spec.board.pid) ? spec.board.pid : null, port: spec.board.port },
    pointer: { at: pointerAt, before: readTextKnown(pointerAt), after: path.join(root, 'app', 'engine') },
    interpreter: null,
    recoverFrom: recoverFromFor(root, previous),
    helper: null,
    steps: [],
    because: null,
    createdAt: at,
    updatedAt: at,
  };
}

function writeStagedJournal(journalAt, spec) {
  const j = stagedJournal(spec);
  const problem = journalProblem(j, journalAt);
  if (problem) throw new Error(`the update journal ${problem}`);
  if (!samePath(path.join(j.staged), spec.prepared.stagedDir)) throw new Error('the staged update is not where the journal expects it');
  win32swap.writeFileAtomic(journalAt, JSON.stringify(j, null, 2) + '\n');
  return j;
}

/* ─── one context, one guard ─────────────────────────────────────────────────────────────── */

function insideStrictly(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== '' && !(rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel));
}

/**
 * The one guard every write of an apply or a rollback goes through. Allowed: ROOT's entries (the
 * entry itself or inside it), anything strictly inside WORK, and in the anchor folder only the
 * journal, the status, the pointer and node.exe, with the temp and side files their writers make
 * beside them (`<name>.writing-*`, `node.exe.staged-*`, `node.exe.retired-*`).
 */
function writeGuard(j, journalAt) {
  const anchorFiles = [
    journalAt,
    statusPathFor(j.anchor),
    path.join(j.anchor, win32anchor.POINTER_NAME),
    path.join(j.anchor, win32anchor.NODE_NAME),
  ];
  return (target) => {
    const t = path.resolve(target);
    if (insideStrictly(t, j.work)) return t;
    for (const entry of win32update.ENTRIES) {
      const e = path.join(j.root, entry);
      if (samePath(t, e) || insideStrictly(t, e)) return t;
    }
    for (const file of anchorFiles) {
      if (samePath(t, file)) return t;
      if (samePath(path.dirname(t), path.dirname(file)) && path.basename(t).startsWith(path.basename(file) + '.')) return t;
    }
    throw new Error(`refusing to write ${t}, which an update does not own`);
  };
}

/** The seams, each with its production default. A suite passes a scheduler (win32board.setRunner),
    a prober and a clock; nothing here reads a real board unless it runs for real. */
function depsFrom(over, budget) {
  const o = over || {};
  const deps = {
    board: o.board || win32board,
    probe: o.probe || win32handoff.probeBoard,
    portFree: o.portFree || portFree,
    pidGone: o.pidGone || ((pid) => !win32orphan.pidAlive(pid)),
    sleep: o.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    sleepSync: o.sleepSync || sleepSync,
    now: o.now || Date.now,
    log: typeof o.log === 'function' ? o.log : null,
    limits: { ...DEFAULT_APPLY_LIMITS, recordPatienceMs: CONFIRMED_RECORD_PATIENCE_MS, ...(o.limits || {}) },
    hooks: { afterDependencies() {}, before() {}, after() {}, ...(o.hooks || {}) },
    lockHooks: o.lockHooks,
  };
  /* How this process asks about anything another process may hold, waiting through the sleepSync seam:
     the budget its caller chose. The helper and the resumers take OWNER_READ_BUDGET (the default);
     begin()'s entry points, in the board's own process, pass win32update.QUICK_HELD_READ_BUDGET. */
  deps.reading = { waitSync: deps.sleepSync, budget: budget || OWNER_READ_BUDGET };
  return deps;
}

/** Convention 3: a test process that reaches the helper or a resumer with no seams would stop and
    start the real board. It throws there; production, where the flag or the shim is the opt-in,
    goes on. */
function refuseInTestWithoutSeams(over, what, journalAt) {
  if (!over && liveExec.inTestProcess()) liveExec.refuseOrWarn('engine/win32apply.js', what, [journalAt]);
}

/**
 * One apply's or one resumer's state. `forward` is true only during the helper's forward steps (H2 to
 * H7). `writesStopped` is true while the log must go to stderr only, because the log file is in WORK,
 * which may be a resumer's by now: assertStillOwner sets it whenever it finds the update lost (for
 * good) or cannot tell (in the forward steps too), and clears it only when a later check proves the
 * update is still this context's.
 */
function contextFor(journalAt, journal, deps, mode) {
  const j = journal;
  const inWork = win32update.workGuard(j.work);
  const logFile = path.join(j.work, APPLY_LOG_NAME);
  const ctx = { journalAt, j, deps, mode, inWork, guard: writeGuard(j, journalAt), forward: false, writesStopped: false };
  ctx.log = (line) => {
    if (deps.log) { deps.log(line); return; }
    if (!ctx.writesStopped) {
      const stamped = `${new Date(deps.now()).toISOString()} [${mode} ${process.pid}] ${line}`;
      try { fs.appendFileSync(inWork(logFile), stamped + '\n'); } catch { /* the update matters more than its log */ }
    }
    try { process.stderr.write('[win32apply] ' + line + '\n'); } catch { /* stderr gone */ }
  };
  return ctx;
}

/**
 * 🛑 NOTHING IS WRITTEN FOR AN UPDATE THIS CONTEXT NO LONGER OWNS. Checked before every journal and
 * status write:
 *   - the lock this context took still holds exactly its text. The lock FILE lives in WORK, so
 *     deleting WORK deletes it, and a resumer may then make WORK again and take a fresh lock at the
 *     same name: holding the lock longer cannot prevent that, so its presence is checked instead
 *     (skipped only for a ROOT-gone settlement, which takes no lock);
 *   - the journal on disk is still this update's (same token), and unfinished unless this context
 *     finished it itself.
 * 🛑 LOSS IS ONLY EVER PROVED, never inferred from a read that failed. Proof is: the lock file is gone
 * (ENOENT), or it reads, and its bytes are not this context's; the journal file is gone, or it reads
 * and is another update's, or it is finished by someone else (or it reads as no journal at all).
 * Proof throws LostOwnership: the owner of this context stops at once. Without it, a helper whose WORK
 * vanished would resurrect a journal a resumer had already settled, and move the only surviving build
 * into a WORK the resumer made again.
 *
 * A read that fails for any other reason (a scanner or backup tool holding the file: EBUSY, EPERM,
 * EACCES, EIO) is read again for OWNER_READ_BUDGET (win32update.readFileRetryingHolds) and, if it still
 * fails, proves nothing either way. In the forward steps that is a StepFailure, and the rollback puts the old build back
 * (checking again as it goes). Anywhere else, a rollback included, it is OwnershipUnknown: stop, write
 * nothing further, and leave the unfinished journal to the next resumer. The gap between this check
 * and the write is the residual.
 */
function assertStillOwner(ctx) {
  const lost = (because) => {
    ctx.writesStopped = true;
    throw new LostOwnership(because);
  };
  const cannotTell = (because) => {
    ctx.writesStopped = true;
    if (ctx.forward) throw new StepFailure(`the updater could not check that this update is still its own, because ${because}`);
    throw new OwnershipUnknown(because);
  };
  const reading = ctx.deps.reading;
  if (ctx.lock && ctx.lock.text) {
    const lock = win32update.readFileRetryingHolds(path.join(ctx.j.work, win32update.LOCK_NAME), reading.waitSync, reading.budget);
    if (lock.missing || (!lock.code && lock.text !== ctx.lock.text)) lost('its update lock is gone or belongs to someone else now');
    if (lock.code) cannotTell(`its update lock cannot be read (code=${lock.code})`);
  }
  const read = readJournal(ctx.journalAt, reading);
  if (read.code) cannotTell(`its journal cannot be read (code=${read.code})`);
  if (!read.journal || read.journal.token !== ctx.j.token || (read.state === 'finished' && !ctx.wroteFinish)) {
    lost('its journal was finished, replaced or removed by someone else');
  }
  /* Proved still this context's: one that could not tell before logs to WORK again. */
  ctx.writesStopped = false;
}

/** A result for an update this context stopped owning: nothing more was written. */
function takenOver(ctx, e) {
  ctx.log(`stopped without writing: ${e.message}`);
  return { ok: false, outcome: 'taken-over', action: 'taken-over', because: `the update stopped here: ${e.message}, so nothing more was written` };
}

/** A result for an update this context could not tell it still owned: nothing more was written, and
    the unfinished journal waits for the next resumer. */
function heldUnknown(ctx, e) {
  ctx.log(`stopped without writing, and left the update for the next resumer: ${e.message}`);
  return { ok: false, outcome: 'held', action: 'held', because: `the update stopped here: ${e.message}, so nothing more was written, and the next start of the board finishes it` };
}

/** The entry points' one reading of an error that stopped the writing, or null for any other error. */
function stoppedWriting(ctx, e) {
  if (e instanceof LostOwnership) return takenOver(ctx, e);
  if (e instanceof OwnershipUnknown) return heldUnknown(ctx, e);
  return null;
}

function save(ctx) {
  assertStillOwner(ctx);
  ctx.j.updatedAt = new Date(ctx.deps.now()).toISOString();
  win32swap.writeFileAtomic(ctx.guard(ctx.journalAt), JSON.stringify(ctx.j, null, 2) + '\n');
  if (ctx.j.finished) ctx.wroteFinish = true;
}
function record(ctx, step) {
  ctx.j.steps.push({ at: new Date(ctx.deps.now()).toISOString(), ...step });
  save(ctx);
}
function setPhase(ctx, phase) {
  ctx.j.phase = phase;
  record(ctx, { step: 'phase', phase });
  ctx.log(`phase ${phase}`);
}
function intended(j, step, entry) {
  return j.steps.some((s) => s.step === step && s.entry === entry && s.state === 'intent');
}

/** A rename, journaled: its intent before, `done` after, `failed` with only the error code (the raw
    error names internal paths). */
function moveRecorded(ctx, step, entry, from, to) {
  record(ctx, { step, entry, from, to, state: 'intent' });
  ctx.deps.hooks.before(step, { entry, from, to });
  assertStillOwner(ctx);
  try {
    win32swap.renameWithRetry(ctx.guard(from), ctx.guard(to));
  } catch (e) {
    record(ctx, { step, entry, state: 'failed', code: codeOf(e) });
    throw new StepFailure(`${entry} could not be moved (code=${codeOf(e)}); something may have a file in it open`);
  }
  ctx.deps.hooks.after(step, { entry, from, to });
  record(ctx, { step, entry, state: 'done' });
}

/* ─── the status ─────────────────────────────────────────────────────────────────────────── */

/** Where a person finds a Kosmos.exe to double-click: ROOT, or the old build's folder when a stuck
    rollback has not moved it back yet (that Kosmos.exe starts the old build from there, and the
    logon shim then finishes putting it back). */
/** The way out when Kosmos cannot finish or undo an update by itself, in one wording wherever it is
    offered (the unrecoverable status, B0's unreachable sentence). It names no website: whether
    installkosmos.com serves the Windows download is still an open decision (engine/machine.js). */
function freshCopyWayOut(root) {
  return `download a fresh copy of Kosmos, unpack it over your Kosmos folder, then double-click Kosmos.exe in ${root}`;
}

function launcherFolder(j) {
  if (exists(path.join(j.root, 'Kosmos.exe'))) return j.root;
  if (exists(path.join(j.previous, 'Kosmos.exe'))) return j.previous;
  return j.root;
}

/**
 * The sentence a person reads. Every sentence that is not a success names Kosmos.exe in the Kosmos
 * folder: it is the way back when Kosmos shows nothing at logon, because the launcher starts the
 * build in its own folder on that folder's runtime and re-anchors the fleet to it (including the one
 * case no resumer can reach, a power loss between replaceInterpreter's two renames, which leaves no
 * anchored node.exe for any logon task to start). `kind: 'unrecoverable'` is a stuck update whose
 * working folder or recovery code is gone.
 */
function statusFor(j, outcome, because, at, kind) {
  let sentence;
  if (outcome === 'updated') sentence = `Kosmos is now on ${j.to.version}.`;
  else if (outcome === 'abandoned') sentence = `The update to ${j.to.version} was stopped: the Kosmos folder that update was changing (${j.root}) no longer exists.`;
  else if (outcome === 'stuck' && kind === 'unrecoverable') {
    sentence = `The update to ${j.to.version} did not finish, and Kosmos cannot finish or undo it by itself (${because}). `
      + `${freshCopyWayOut(j.root).replace(/^d/, 'D')}.`;
  } else if (outcome === 'stuck') {
    sentence = `The update did not take, and Kosmos could not put ${j.from.version} back by itself (${because}). `
      + `Close any window or program that is using the Kosmos folder, then restart your computer, or double-click Kosmos.exe in ${launcherFolder(j)} to start it again.`;
  } else sentence = `The update did not take. Kosmos is still on ${j.from.version}. If Kosmos does not come back by itself, double-click Kosmos.exe in ${j.root}.`;
  return {
    outcome,
    version: outcome === 'updated' ? j.to.version : outcome === 'stuck' || outcome === 'abandoned' ? null : j.from.version,
    from: j.from.version,
    to: j.to.version,
    sentence,
    because: because || null,
    journal: j.token,
    at,
  };
}

function writeStatus(ctx, outcome, because, kind) {
  assertStillOwner(ctx);
  const status = statusFor(ctx.j, outcome, because, new Date(ctx.deps.now()).toISOString(), kind);
  win32swap.writeFileAtomic(ctx.guard(statusPathFor(ctx.j.anchor)), JSON.stringify(status, null, 2) + '\n');
  ctx.log(`status ${outcome}: ${status.sentence}${because && outcome !== 'stuck' ? ` (${because})` : ''}`);
  return status;
}

/* ─── the board ──────────────────────────────────────────────────────────────────────────── */

/** Can this port be bound on the address the board binds (server.js bindHost's default)? The board
    process going is not the same instant as its socket closing, measured. */
function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => server.close(() => resolve(true)));
  });
}

/** H2: end the board, then wait for its pid (when known) to be gone AND the port to be free. */
async function stopBoard(ctx) {
  const { j, deps, log } = ctx;
  const L = deps.limits;
  /* 🛑 A process that no longer owns the update never touches the board: it cannot know which build
     is in ROOT or what the resumer that took over decided, and that resumer (the logon shim of the
     board that just booted) owns the recovery now. */
  assertStillOwner(ctx);
  const ended = deps.board.end();
  log(`end the board: ${ended.ok ? 'ok' : ended.because}`);
  if (!ended.ok) return { ok: false, because: ended.because };
  const until = deps.now() + L.stopWaitMs;
  for (;;) {
    const pidGone = j.board.pid ? deps.pidGone(j.board.pid) : true;
    const answer = await deps.probe(j.board.port);
    const free = !answer.answering && await deps.portFree(j.board.port);
    if (pidGone && free) break;
    if (deps.now() >= until) {
      const still = [!pidGone && `process ${j.board.pid} is still running`, answer.answering && `port ${j.board.port} still answers`,
        !answer.answering && !free && `port ${j.board.port} is still taken`].filter(Boolean).join(', ');
      return { ok: false, because: `the board did not stop within ${Math.round(L.stopWaitMs / 1000)} seconds (${still})` };
    }
    await deps.sleep(L.stopPollMs);
  }
  await deps.sleep(L.settleMs);
  log('the board is stopped');
  return { ok: true };
}

/**
 * H7 (and H8's restart): `/Run`, then the identity header. ONLY a board answering with exactly
 * `identity` counts: `/Run` reports success when IgnoreNew started nothing (measured,
 * win32board.taskXml), and the task's Running status says nothing about which build is serving.
 */
/** H7's one test of a board: it answers, with exactly `identity`. The resume helper at `starting` and
    `--apply --wait` ask the same (convention 5). It deliberately does not ask who started the board: a
    board the launcher serves itself after a hand-off fallback (win32handoff, started-by-task header 0)
    is the new build too, and requiring the header rolled such a working update back (round 7).
    Accepted residual: a board serving the same release from another folder can confirm ROOT's update;
    harmless, because the identity matches, and the installer's anchorBundle re-points the fleet. */
function answersAs(answer, identity) {
  return Boolean(answer && answer.answering && answer.identity === identity);
}

async function startAndConfirm(ctx, identity, step) {
  const { j, deps, log } = ctx;
  const L = deps.limits;
  let last = 'no board answered';
  for (let run = 1; run <= L.confirmRuns; run += 1) {
    deps.hooks.before(step + '-run', { run });
    assertStillOwner(ctx);
    const r = deps.board.runNow();
    record(ctx, { step, run, state: r.ok ? 'issued' : 'failed', because: r.ok ? undefined : r.because });
    log(`${step} run ${run}: ${r.ok ? 'issued' : r.because}`);
    const until = deps.now() + L.confirmWaitPerRunMs;
    for (;;) {
      const answer = await deps.probe(j.board.port);
      if (answersAs(answer, identity)) {
        log(`${step}: the board answers as ${identity}`);
        return { ok: true, run };
      }
      if (answer.answering) last = `a board answered as ${answer.identity || 'something with no Kosmos identity'}`;
      if (deps.now() >= until) break;
      await deps.sleep(L.confirmPollMs);
    }
  }
  return { ok: false, because: `${last}, not ${identity}` };
}

/* ─── H5 and H6 ──────────────────────────────────────────────────────────────────────────── */

function swapInterpreter(ctx) {
  const { j, deps } = ctx;
  const at = path.join(j.anchor, win32anchor.NODE_NAME);
  /* A node.exe a scanner holds is still there: read as absent, the rollback would move H5's aside and
     leave no anchored interpreter at all. */
  const hadOne = isThere(at, deps.reading);
  j.interpreter = {
    at,
    source: path.join(j.root, 'runtime', win32anchor.NODE_NAME),
    copy: path.join(j.previous, ANCHORED_NODE_COPY_NAME),
    beforeSha256: hadOne ? win32update.sha256OfFile(at) : null,
    stamp: null,
    pid: process.pid,
    restoredFrom: null,
    restoredSha256: null,
  };
  save(ctx);
  if (hadOne) {
    deps.hooks.before('H5-copy', {});
    assertStillOwner(ctx);
    fs.copyFileSync(at, ctx.guard(j.interpreter.copy));
    if (win32update.sha256OfFile(j.interpreter.copy) !== j.interpreter.beforeSha256) {
      throw new StepFailure("the safety copy of Kosmos's node.exe did not match the original");
    }
  }
  /* One stamp for both side names replaceInterpreter makes, recorded before it runs, so a resumer
     knows this helper's exact `node.exe.staged-<stamp>-<pid>` and `node.exe.retired-<stamp>-<pid>`. */
  j.interpreter.stamp = deps.now();
  record(ctx, { step: 'H5', state: 'intent' });
  deps.hooks.before('H5-swap', {});
  assertStillOwner(ctx);
  win32swap.replaceInterpreter(j.interpreter.source, ctx.guard(at), () => j.interpreter.stamp);
  deps.hooks.after('H5-swap', {});
  record(ctx, { step: 'H5', state: 'done' });
}

function writePointer(ctx) {
  const { j, deps } = ctx;
  record(ctx, { step: 'H6', state: 'intent' });
  deps.hooks.before('H6-write', {});
  assertStillOwner(ctx);
  win32swap.writeFileAtomic(ctx.guard(j.pointer.at), j.pointer.after);
  deps.hooks.after('H6-write', {});
  record(ctx, { step: 'H6', state: 'done' });
}

/* ─── H8: the rollback ───────────────────────────────────────────────────────────────────── */

/** Put the anchored node.exe back to the bytes it had before H5 (H5 reversed). */
function restoreInterpreter(ctx) {
  const { j, deps, log } = ctx;
  const it = j.interpreter;
  const at = it.at;
  const nodeName = win32anchor.NODE_NAME;
  if (it.stamp !== null) {
    const mySide = at + win32swap.STAGED_INFIX + it.stamp + '-' + it.pid;
    if (exists(mySide)) assertStillOwner(ctx);
    if (exists(mySide)) { try { fs.unlinkSync(ctx.guard(mySide)); } catch (e) { log(`left a staged node.exe copy for the sweep (code=${codeOf(e)})`); } }
  }
  const asideClock = () => Math.max(deps.now(), (it.stamp || 0) + 1);
  if (it.beforeSha256 === null) {
    /* There was no anchored interpreter before H5: any H5 put there moves aside, for the sweep. */
    if (it.stamp !== null && isThere(at, deps.reading)) {
      deps.hooks.before('H8-H5', {});
      assertStillOwner(ctx);
      win32swap.renameWithRetry(ctx.guard(at), ctx.guard(at + win32swap.RETIRED_INFIX + asideClock() + '-' + process.pid));
      record(ctx, { step: 'H8-H5', state: 'done' });
    }
    return;
  }
  if (isThere(at, deps.reading)) {
    const now = win32update.sha256OfFile(at);
    if (now === it.beforeSha256 || (it.restoredSha256 && now === it.restoredSha256)) return;
  }
  const retired = it.stamp !== null ? at + win32swap.RETIRED_INFIX + it.stamp + '-' + it.pid : null;
  const oldRuntimes = [path.join(j.previous, 'runtime', nodeName), path.join(j.root, 'runtime', nodeName)];
  /* An exact copy that cannot be checked right now fails this pass (isThere), rather than falling
     back to the old runtime as if no exact copy survived. */
  let source = [it.copy, retired, ...oldRuntimes].find((c) => c && isThere(c, deps.reading) && win32update.sha256OfFile(c) === it.beforeSha256);
  if (!source) {
    /* Neither the copy nor the retired original survived (a crash before the copy was verified,
       then the sweep): the old build's own node.exe is the next best, and the status says so.
       The old runtime is in previous-<from>, or back in ROOT once the new one is back in staged. */
    const oldRuntime = isThere(oldRuntimes[0], deps.reading) ? oldRuntimes[0]
      : isThere(path.join(j.staged, 'runtime'), deps.reading) && isThere(oldRuntimes[1], deps.reading) ? oldRuntimes[1] : null;
    if (!oldRuntime) throw new StepFailure("the node.exe Kosmos ran on before the update could not be found");
    it.restoredFrom = oldRuntime;
    it.restoredSha256 = win32update.sha256OfFile(oldRuntime);
    save(ctx);
    log("restoring node.exe from the old build's runtime, because no exact copy of the original survived");
    source = oldRuntime;
  }
  record(ctx, { step: 'H8-H5', state: 'intent' });
  deps.hooks.before('H8-H5', {});
  assertStillOwner(ctx);
  win32swap.replaceInterpreter(source, ctx.guard(at), asideClock);
  record(ctx, { step: 'H8-H5', state: 'done' });
}

/** One pass of the reversal, in exact reverse order (H6, H5, H4, H3). Stops at the first rename that
    fails, so ROOT is never mixed further than the failure; the next pass starts over and skips what
    is already back. */
function reversePass(ctx) {
  const { j, deps } = ctx;
  /* Every pass after the first starts after a wait, during which a resumer can have taken over. */
  assertStillOwner(ctx);
  /* A pointer that cannot be read is written back all the same: the write is the old bytes again. */
  const pointerNow = win32update.readFileRetryingHolds(j.pointer.at, deps.reading.waitSync, deps.reading.budget);
  if (pointerNow.text !== j.pointer.before) {
    deps.hooks.before('H8-H6', {});
    assertStillOwner(ctx);
    win32swap.writeFileAtomic(ctx.guard(j.pointer.at), j.pointer.before);
    record(ctx, { step: 'H8-H6', state: 'done' });
  }
  if (j.interpreter) restoreInterpreter(ctx);
  const reversed = [...j.order].reverse();
  for (const entry of reversed) {
    if (!j.stagedEntries.includes(entry) || !intended(j, 'H4', entry)) continue;
    const inRoot = path.join(j.root, entry);
    const back = path.join(j.staged, entry);
    if (isThere(inRoot, deps.reading) && !isThere(back, deps.reading)) {
      /* 🛑 NAMES ARE NOT BUILDS. An entry the old tree had is moved out of ROOT only while the old
         build's copy of it is in previous-<from> to take its place. Without that copy, what is in
         ROOT may be the only build left, and moving it away would leave the folder empty. */
      if (j.presentBefore.includes(entry) && !isThere(path.join(j.previous, entry), deps.reading)) {
        ctx.log(`${entry} stays in the Kosmos folder: the old build's copy of it is gone, so it may be the only build left`);
        continue;
      }
      if (!isThere(j.staged, deps.reading)) {
        assertStillOwner(ctx);
        fs.mkdirSync(ctx.guard(j.staged));
      }
      moveRecorded(ctx, 'H8-H4', entry, inRoot, back);
    }
  }
  for (const entry of reversed) {
    if (!j.presentBefore.includes(entry) || !intended(j, 'H3', entry)) continue;
    const away = path.join(j.previous, entry);
    const home = path.join(j.root, entry);
    if (isThere(away, deps.reading) && !isThere(home, deps.reading)) moveRecorded(ctx, 'H8-H3', entry, away, home);
  }
}

/** Is the old tree whole again? A sentence naming the first thing that is not, or null. */
function treeProblem(ctx) {
  const { j } = ctx;
  const reading = ctx.deps.reading;
  try {
    for (const entry of j.order) {
      const inRoot = isThere(path.join(j.root, entry), reading);
      if (j.presentBefore.includes(entry)) {
        if (!inRoot) return `${entry} is not back in the Kosmos folder`;
        if (isThere(path.join(j.previous, entry), reading)) return `${entry} is not back in the Kosmos folder`;
      } else if (inRoot && intended(j, 'H4', entry)) {
        return `${entry}, which the update brought, is still in the Kosmos folder`;
      }
    }
    /* The right names in ROOT are not enough: the app that is back must BE the old build. */
    if (j.presentBefore.includes('app')) {
      const rootVersion = (readJsonKnown(path.join(j.root, 'app', 'package.json'), reading) || {}).version;
      if (rootVersion !== j.from.version) return `the app in the Kosmos folder is ${rootVersion || 'of no known version'}, not ${j.from.version}`;
    }
    if (readTextKnown(j.pointer.at, reading) !== j.pointer.before) return 'the engine pointer is not back';
    const it = j.interpreter;
    if (it && it.beforeSha256 !== null) {
      const now = isThere(it.at, reading) ? win32update.sha256OfFile(it.at) : null;
      if (now !== it.beforeSha256 && !(it.restoredSha256 && now === it.restoredSha256)) return "Kosmos's node.exe is not back";
    }
    return null;
  } catch (e) {
    /* 🛑 A CHECK THAT CANNOT BE MADE IS NEVER "WHOLE": it is the problem this pass reports. */
    return e instanceof StepFailure ? e.message : `the old tree could not be checked (${describeError(e)})`;
  }
}

/**
 * Reverse the journal until the old tree is whole, in passes. Synchronous, so the logon shim can run
 * it before it boots. Returns `{ whole }` or `{ whole: false, problem }`, and leaves the journal at
 * `stuck` (NOT finished) when it cannot, so the next resumer tries again.
 */
function rollBackTree(ctx, because) {
  const { j, deps, log } = ctx;
  if (j.phase !== 'rolling-back' && j.phase !== 'stuck') j.rolledBackFrom = j.phase;
  j.because = j.because || because || null;
  setPhase(ctx, 'rolling-back');
  deps.hooks.before('H8', {});
  let problem = null;
  for (let pass = 1; pass <= deps.limits.rollbackPasses; pass += 1) {
    let failure = null;
    try { reversePass(ctx); } catch (e) {
      if (stopsWriting(e)) throw e;
      failure = e instanceof StepFailure ? e.message : `${firstLine(e)} (code=${codeOf(e)})`;
      log(`rollback pass ${pass}: ${failure}`);
    }
    const left = treeProblem(ctx);
    if (!left) { log(`the old tree is whole after pass ${pass}`); return { whole: true }; }
    problem = failure || left;
    if (pass < deps.limits.rollbackPasses) deps.sleepSync(deps.limits.rollbackPassWaitMs);
  }
  j.stuckBecause = problem;
  setPhase(ctx, 'stuck');
  return { whole: false, problem };
}

/**
 * The best-effort removals once a journal is finished, each checked first (assertStillOwner). A
 * removal that fails is logged by its code (or name) and message, and the next one goes on. One that
 * finds the update lost or unknowable rethrows, which stops every removal after it; this catches that
 * here, because the outcome is already recorded and stands. `removals`: [what, remove] pairs.
 */
function cleanUpAfterFinish(ctx, removals) {
  const tidy = (what, remove) => {
    try { assertStillOwner(ctx); remove(); } catch (e) {
      if (stopsWriting(e)) throw e;
      ctx.log(`left ${what} for later (${describeError(e)})`);
    }
  };
  try {
    for (const [what, remove] of removals) tidy(what, remove);
  } catch (e) {
    if (!stopsWriting(e)) throw e;
    ctx.log(`stopped cleaning up, and the finished record stands: ${e.message}`);
  }
}

/** What a rollback that left the tree whole leaves behind: nothing of the new build. Best effort. */
function cleanupAfterRollback(ctx) {
  const { j } = ctx;
  cleanUpAfterFinish(ctx, [
    ['the safety copy of node.exe', () => fs.rmSync(ctx.guard(path.join(j.previous, ANCHORED_NODE_COPY_NAME)), { force: true })],
    ['the empty previous folder', () => { if (exists(j.previous)) fs.rmdirSync(ctx.guard(j.previous)); }],
    ['the staged update', () => fs.rmSync(ctx.guard(j.staged), { recursive: true, force: true })],
  ]);
}

function concludeRollback(ctx, boardBecause) {
  const { j } = ctx;
  const outcome = UNCHANGED_PHASES.includes(j.rolledBackFrom) ? 'not-started' : 'rolled-back';
  if (boardBecause) writeStatus(ctx, 'stuck', `its board did not start again: ${boardBecause}`);
  else writeStatus(ctx, outcome, j.because);
  ctx.deps.hooks.before('H8-finish', {});
  j.finished = true;
  j.outcome = outcome;
  save(ctx);
  ctx.deps.hooks.before('H8-cleanup', {});
  cleanupAfterRollback(ctx);
  return { ok: false, outcome: boardBecause ? 'stuck' : outcome, because: j.because, boardBack: !boardBecause };
}

/** H8 in a helper: stop whatever board is running, reverse, start the old board, confirm it. */
async function rollBack(ctx, because) {
  const { j, log } = ctx;
  /* First: a rollback whose working folder or recovery code is gone cannot be done by moving names
     around. It is settled in words ("download a fresh copy"), as a resumer would. */
  const found = unrecoverableCase(j, ctx.deps.reading);
  /* A Kosmos folder on a drive that is not connected: nothing is stopped, moved or written. */
  if (found && found.kind === 'unreachable') {
    log(`the rollback waits: ${found.because}`);
    return { ok: false, outcome: 'held', because: found.because };
  }
  if (found) {
    const settled = settleUnrecoverable(ctx, found);
    return { ok: false, outcome: settled.action, because: settled.because };
  }
  const from = j.phase === 'rolling-back' || j.phase === 'stuck' ? (j.rolledBackFrom || j.phase) : j.phase;
  if (!UNCHANGED_PHASES.includes(from)) {
    const stopped = await stopBoard(ctx);
    if (!stopped.ok) log(`going on with the rollback although ${stopped.because}`);
  }
  const tree = rollBackTree(ctx, because);
  if (!tree.whole) {
    writeStatus(ctx, 'stuck', tree.problem);
    return { ok: false, outcome: 'stuck', because: tree.problem };
  }
  const back = await startAndConfirm(ctx, j.from.identity, 'H8');
  return concludeRollback(ctx, back.ok ? null : back.because);
}

/* ─── H9 ─────────────────────────────────────────────────────────────────────────────────── */

/** H9: the status, the journal finished, then the new build's leftovers go. previous-<from> stays
    (only the newest previous-* is kept); the interpreter's retired file is the anchoring sweep's. */
function finishUpdated(ctx) {
  const { j, log } = ctx;
  try { writeStatus(ctx, 'updated', null); } catch (e) {
    if (stopsWriting(e)) throw e;
    log(`could not record the outcome (${describeError(e)})`);
  }
  ctx.deps.hooks.before('H9-finish', {});
  j.finished = true;
  j.outcome = 'updated';
  save(ctx);
  ctx.deps.hooks.before('H9-cleanup', {});
  const removals = [
    ['the staged folder', () => fs.rmSync(ctx.guard(j.staged), { recursive: true, force: true })],
    ['the download', () => fs.rmSync(ctx.guard(path.join(j.work, win32update.DOWNLOAD_PART_NAME)), { force: true })],
    ['the safety copy of node.exe', () => fs.rmSync(ctx.guard(path.join(j.previous, ANCHORED_NODE_COPY_NAME)), { force: true })],
  ];
  let names = [];
  try { names = fs.readdirSync(j.work); } catch { names = []; }
  for (const name of names) {
    const dir = path.join(j.work, name);
    if (!name.startsWith(PREVIOUS_PREFIX) || samePath(dir, j.previous)) continue;
    removals.push([`an older build (${name})`, () => fs.rmSync(ctx.guard(dir), { recursive: true, force: true })]);
  }
  cleanUpAfterFinish(ctx, removals);
  return { ok: true, outcome: 'updated', version: j.to.version };
}

/** A journal that never changed anything is finished as not-started, with its reason. */
function finishWithoutChange(ctx, because) {
  const { j } = ctx;
  j.because = because;
  j.rolledBackFrom = j.phase;
  writeStatus(ctx, 'not-started', because);
  j.finished = true;
  j.outcome = 'not-started';
  save(ctx);
  return { ok: false, outcome: 'not-started', because };
}

/* ─── the helper ─────────────────────────────────────────────────────────────────────────── */

/** Why the staged journal must not be applied, checked once the lock is held, or null. */
function applyRefusal(ctx) {
  const { j } = ctx;
  const reading = ctx.deps.reading;
  /* Every read and look here goes through the held-read rule: one that stays unknown throws a
     StepFailure (applyJournal holds), never a refusal that settles the update as not-started. */
  const installed = (readJsonKnown(path.join(j.root, 'app', 'package.json'), reading) || {}).version;
  if (installed !== j.from.version) return `the Kosmos folder is now ${installed || 'of an unknown version'}, not the ${j.from.version} this update was prepared for`;
  if (!update.newer(j.to.version, installed)) return `${j.to.version} is not newer than ${installed}, and Kosmos never installs an older or equal version`;
  const stagedVersion = (readJsonKnown(path.join(j.staged, 'app', 'package.json'), reading) || {}).version;
  if (stagedVersion !== j.to.version) return `the staged update is ${stagedVersion || 'of an unknown version'}, not the ${j.to.version} this update was prepared for`;
  for (const entry of j.order) {
    if (isThere(path.join(j.root, entry), reading) !== j.presentBefore.includes(entry)) return `the Kosmos folder changed after the update was prepared (${entry})`;
  }
  for (const entry of j.stagedEntries) {
    if (!isThere(path.join(j.staged, entry), reading)) return `the staged update is missing ${entry}`;
  }
  if (isThere(j.previous, reading)) return `${j.previous} is already there`;
  return null;
}

async function runSteps(ctx) {
  const { j, deps, log } = ctx;
  try {
    /* The forward steps: a lock or journal that cannot be read here is a step failure (assertStillOwner). */
    ctx.forward = true;
    setPhase(ctx, 'stopping');
    deps.hooks.before('H2', {});
    const stopped = await stopBoard(ctx);
    if (!stopped.ok) throw new StepFailure(`Kosmos could not stop its board (${stopped.because})`);

    setPhase(ctx, 'moving-out');
    deps.hooks.before('H3', {});
    assertStillOwner(ctx);
    fs.mkdirSync(ctx.guard(j.previous));
    for (const entry of j.order) {
      if (j.presentBefore.includes(entry)) moveRecorded(ctx, 'H3', entry, path.join(j.root, entry), path.join(j.previous, entry));
    }

    setPhase(ctx, 'moving-in');
    deps.hooks.before('H4', {});
    for (const entry of j.order) {
      if (j.stagedEntries.includes(entry)) moveRecorded(ctx, 'H4', entry, path.join(j.staged, entry), path.join(j.root, entry));
    }

    if (j.runtimeChanged) {
      setPhase(ctx, 'interpreter');
      deps.hooks.before('H5', {});
      swapInterpreter(ctx);
    }

    setPhase(ctx, 'pointer');
    deps.hooks.before('H6', {});
    writePointer(ctx);

    setPhase(ctx, 'starting');
    deps.hooks.before('H7', {});
    const up = await startAndConfirm(ctx, j.to.identity, 'H7');
    if (!up.ok) throw new StepFailure(`the new board did not answer as ${j.to.identity} (${up.because})`);
  } catch (e) {
    ctx.forward = false;
    if (stopsWriting(e)) throw e;
    const because = e instanceof StepFailure ? e.message : `${firstLine(e)} (code=${codeOf(e)})`;
    log(`the update failed during ${j.phase}: ${because}`);
    return rollBack(ctx, because);
  }
  /* 🛑 H7 CONFIRMED THE NEW BOARD: FROM HERE NOTHING ROLLS IT BACK. Everything below is outside the
     forward try, the `confirmed` record included. What cannot be recorded is left for a resumer to
     finish forward: at `confirmed` any resumer does; at `starting`, the resume helper does once the new
     board answers (resumeJournal). */
  ctx.forward = false;
  if (!recordConfirmed(ctx)) return { ok: true, outcome: 'updated', version: j.to.version };
  deps.hooks.before('H9', {});
  try { return finishUpdated(ctx); } catch (e) {
    if (e instanceof LostOwnership) throw e;
    log(`the update is in, but its record could not be finished (${describeError(e)})`);
    return { ok: true, outcome: 'updated', version: j.to.version };
  }
}

/**
 * Record `confirmed` after H7. While the update cannot be told to be still this helper's
 * (OwnershipUnknown), it tries again every stopPollMs for limits.recordPatienceMs
 * (CONFIRMED_RECORD_PATIENCE_MS), holding its lock all the while. True once recorded; false when it
 * gave up (still unknown past the patience, or any other failure), with the journal left at `starting`
 * and nothing more written. A proved loss (LostOwnership) rethrows.
 */
function recordConfirmed(ctx) {
  const { j, deps, log } = ctx;
  const until = deps.now() + deps.limits.recordPatienceMs;
  const stepsBefore = j.steps.length;
  for (;;) {
    try {
      setPhase(ctx, 'confirmed');
      return true;
    } catch (e) {
      if (e instanceof LostOwnership) throw e;
      j.phase = 'starting';
      j.steps.length = stepsBefore;
      /* One rule for waiting: an ownership that cannot be told, or a journal write another process holds
         (win32update.HELD_FILE_CODES), is tried again within the patience; anything else gives up at once. */
      const held = e instanceof OwnershipUnknown || win32update.HELD_FILE_CODES.includes(e && e.code);
      if (!held || deps.now() >= until) {
        log(`the board answers as ${j.to.identity}, but that could not be recorded (${describeError(e)}); the update stays in, and a resumer that sees this board finishes it`);
        return false;
      }
      deps.sleepSync(deps.limits.stopPollMs);
    }
  }
}

/**
 * Take the update lock (S2's, in WORK). Returns `{ text }`, or `{ because }` when it is held or cannot
 * be taken. A lock that was taken is never leaked: when the holder's sweep beside it throws, the lock
 * is released before the refusal.
 */
function takeUpdateLock(ctx) {
  const lockPath = ctx.inWork(path.join(ctx.j.work, win32update.LOCK_NAME));
  let text;
  try {
    text = win32update.takeLock(lockPath, ctx.log, ctx.deps.lockHooks);
  } catch (e) {
    ctx.log(`the update lock is held or cannot be taken: ${firstLine(e)}`);
    return { because: firstLine(e) };
  }
  try {
    win32update.sweepLockLeftovers(ctx.j.work, ctx.inWork, ctx.log);
  } catch (e) {
    ctx.log(`could not tidy beside the update lock (code=${codeOf(e)}); letting the lock go`);
    releaseUpdateLock(ctx, { text });
    return { because: `the update lock could not be tidied (code=${codeOf(e)})` };
  }
  return { text };
}
function releaseUpdateLock(ctx, lock) {
  if (!lock || !lock.text) return;
  try { win32update.releaseLock(ctx.inWork(path.join(ctx.j.work, win32update.LOCK_NAME)), lock.text, ctx.log, ctx.deps.reading); } catch (e) {
    ctx.log(`could not release the update lock (code=${codeOf(e)})`);
  }
}

/**
 * The journal at `journalAt` read again under the lock: `{ journal }`, still unfinished and still
 * `token`'s; `{ journal: null }` when it proved finished, replaced or gone; or `{ journal: null, code }`
 * when it could not be read (held, or unreadable), which every caller reports as held, never as
 * "nothing" and never as "finished or replaced".
 */
function sameUnfinishedJournal(journalAt, token, reading) {
  const read = readJournal(journalAt, reading);
  if (read.code) return { journal: null, code: read.code };
  return { journal: read.state === 'unfinished' && read.journal.token === token ? read.journal : null };
}

/** Why a journal read again under the lock gave nothing to act on. */
function heldRereadBecause(reread) {
  return `its journal cannot be read right now (code=${reread.code})`;
}

/**
 * Is this staged journal still inside STAGED_HELPER_STARTUP_GRACE_MS of being written, at `now`? The
 * one reading of the grace rule, which begin() asks too. Young means 0 <= age < the grace: an age
 * below zero (a clock stepped back, or a createdAt in the future) is not young, or it would stay
 * young forever and block every resumer.
 */
function stagedIsYoung(j, now) {
  const written = Date.parse(j.createdAt);
  if (j.phase !== 'staged' || !Number.isFinite(written)) return false;
  const age = now - written;
  return age >= 0 && age < STAGED_HELPER_STARTUP_GRACE_MS;
}

/**
 * An unfinished journal no resumer can ever finish, or null. Checked before anything else by every
 * resumer, so such a journal is settled with a true sentence instead of blocking updates forever:
 *   - `root-gone`: the Kosmos folder it was changing no longer exists. There is nothing to put back;
 *   - under an existing ROOT, its working folder is gone, or no copy of the updater that could put
 *     it back exists; then by what the phase says had happened:
 *     `nothing-moved` (staged, stopping), `confirmed` (the new build was proven), or `moved`.
 */
function unrecoverableCase(j, reading) {
  /* 🛑 A FOLDER ON A DRIVE THAT IS NOT CONNECTED IS NOT GONE. When the volume root itself (a drive
     letter, or a UNC or mapped share's root) cannot be reached, the tree may be whole and waiting on
     a USB drive, a late BitLocker unlock or an offline share: `unreachable`, held, never settled. */
  const volume = path.parse(path.resolve(j.root)).root;
  if (volume && !exists(volume)) return { kind: 'unreachable', because: `the drive Kosmos is on (${volume}) is not connected` };
  /* 🛑 ONLY ENOENT OR ENOTDIR PROVES A FOLDER GONE (presenceOf). ROOT or WORK answering anything else
     (busy, access denied) is `unreachable` as well: held, never settled in words. */
  const root = presenceOf(j.root, reading);
  if (root.state === 'unknown') return { kind: 'unreachable', because: `the Kosmos folder (${j.root}) cannot be reached right now (code=${root.code})` };
  if (root.state === 'gone') return { kind: 'root-gone', because: `the Kosmos folder that update was changing (${j.root}) no longer exists` };
  const work = presenceOf(j.work, reading);
  if (work.state === 'unknown') return { kind: 'unreachable', because: `its working folder ${j.work} cannot be reached right now (code=${work.code})` };
  let missing = null;
  if (work.state === 'gone') missing = `its working folder ${j.work} is gone`;
  else {
    /* The recovery code is gone only when EVERY copy answers ENOENT or ENOTDIR; a copy that stays
       unknown (a scanner, an access denied) makes the update unreachable, not lost. */
    const copies = j.recoverFrom.map((f) => presenceOf(f, reading));
    if (!copies.some((c) => c.state === 'there')) {
      const unknown = copies.find((c) => c.state === 'unknown');
      if (unknown) return { kind: 'unreachable', because: `no copy of the updater that could put it back can be read right now (code=${unknown.code})` };
      missing = 'no copy of the updater that could put it back is left';
    }
  }
  if (!missing) return null;
  if (UNCHANGED_PHASES.includes(j.phase)) return { kind: 'nothing-moved', because: missing };
  if (j.phase === 'confirmed') return { kind: 'confirmed', because: missing };
  return { kind: 'moved', because: missing };
}

/**
 * The lock a resumer needs, given what unrecoverableCase's look before the lock found.
 *   - WORK there: the one update lock is taken, WHATEVER THE LOOK SAID. A live helper holds that
 *     lock, and a look is not proof: ROOT can answer one lstat with ENOENT or EBUSY while the tree
 *     and its helper are fine.
 *   - WORK unknown (presenceOf): held, with the code.
 *   - WORK and ROOT gone: no lock. There is nothing left a lock protects (no tree, no WORK to hold one
 *     in), and every writer of this settlement writes the same finished record, atomically.
 *   - ROOT there, WORK gone: WORK is created again (empty, as prepare() creates it), and the lock is
 *     taken in it as always. Without this, taking the lock fails with ENOENT on every try, the
 *     resumer reads that as held, and the journal blocks updates forever. A helper whose WORK vanished
 *     under it has lost its lock file too, so nothing is excluded that was not already.
 * Returns `{ text, madeWork? }`, `{ none: true }` or `{ because }`.
 */
function lockForResume(ctx, found) {
  const work = presenceOf(ctx.j.work, ctx.deps.reading);
  if (work.state === 'there') return takeUpdateLock(ctx);
  if (work.state === 'unknown') return { because: `the working folder cannot be reached right now (code=${work.code})` };
  if (found && found.kind === 'root-gone') return { none: true };
  try {
    /* WORK itself, directly under an existing ROOT: the one write outside writeGuard, which admits
       only paths strictly inside WORK. */
    if (!samePath(path.dirname(ctx.j.work), ctx.j.root)) throw new Error('the working folder is not inside the Kosmos folder');
    fs.mkdirSync(ctx.j.work);
  } catch (e) {
    return { because: `the working folder could not be made again (code=${codeOf(e)})` };
  }
  const lock = takeUpdateLock(ctx);
  return lock.text ? { ...lock, madeWork: true } : lock;
}

/**
 * unrecoverableCase for the journal read again under the lock. The look before the lock can be stale,
 * or wrong (ROOT answered once as gone while WORK was there), so it is asked again, except when the
 * resumer made WORK again itself (its look saw WORK gone, which is exactly what it must settle) or
 * took no lock (ROOT and WORK both gone: there is nothing more to look at).
 */
function judgedUnderLock(j, look, lock, reading) {
  if (lock.none || lock.madeWork) return look;
  return unrecoverableCase(j, reading);
}

/** Does a look that found the update unreachable end a resumer before the lock? Only when WORK cannot
    be read either (a drive that is not connected). With WORK readable the lock is taken as always and
    the case judged again under it, so one bad lstat of ROOT never walks past a live helper's lock. */
function unreachableBeforeLock(j, found, reading) {
  return Boolean(found && found.kind === 'unreachable' && presenceOf(j.work, reading).state !== 'there');
}

/** Settle an unfinished journal unrecoverableCase found. Returns `{ action, because? }`. */
function settleUnrecoverable(ctx, found) {
  const { j, log } = ctx;
  log(`settling an update no resumer can finish (${found.kind}): ${found.because}`);
  if (found.kind === 'nothing-moved') { finishWithoutChange(ctx, found.because); return { action: 'not-started', because: found.because }; }
  if (found.kind === 'confirmed') { finishUpdated(ctx); return { action: 'updated' }; }
  j.because = j.because || found.because;
  if (found.kind === 'root-gone') writeStatus(ctx, 'abandoned', found.because);
  else writeStatus(ctx, 'stuck', found.because, 'unrecoverable');
  j.finished = true;
  j.outcome = 'abandoned';
  save(ctx);
  return { action: 'abandoned', because: found.because };
}

/**
 * begin()'s settlement of a journal no resumer can finish, in the board's own process (there is no
 * build left to start a resume helper from, or nothing left to resume). Returns `{ action }`:
 * `recoverable` (nothing done: a resumer can finish it), `held`, or what settleUnrecoverable did.
 */
function settleUnrecoverableJournal(journalAt, overrides) {
  const read = readJournal(journalAt);
  if (read.state !== 'unfinished') return { action: 'nothing' };
  const found = unrecoverableCase(read.journal);
  if (!found) return { action: 'recoverable' };
  if (unreachableBeforeLock(read.journal, found)) return { action: 'unreachable', because: found.because };
  refuseInTestWithoutSeams(overrides, 'settle', journalAt);
  const deps = depsFrom(overrides, win32update.QUICK_HELD_READ_BUDGET);
  const ctx = contextFor(journalAt, read.journal, deps, 'settle');
  const lock = lockForResume(ctx, found);
  if (lock.because) return { action: 'held', because: lock.because };
  ctx.lock = lock;
  try {
    const reread = lock.none ? { journal: read.journal } : sameUnfinishedJournal(journalAt, read.journal.token, deps.reading);
    if (reread.code) return { action: 'held', because: heldRereadBecause(reread) };
    const again = reread.journal;
    if (!again) return { action: 'nothing' };
    ctx.j = again;
    const judged = judgedUnderLock(again, found, lock, deps.reading);
    if (!judged) return { action: 'recoverable' };
    if (judged.kind === 'unreachable') return { action: 'unreachable', because: judged.because };
    return settleUnrecoverable(ctx, judged);
  } catch (e) {
    const stopped = stoppedWriting(ctx, e);
    if (stopped) return stopped;
    throw e;
  } finally {
    releaseUpdateLock(ctx, lock);
  }
}

/**
 * When a boot recovery is left stuck, the build the logon shim should start instead of the app in
 * ROOT: `previous-<from>\app\server.js`, when that app is whole and is the old version; the new app in
 * ROOT was never confirmed. H5's reversal has put the old interpreter's bytes back in the anchor, but
 * the shim process running this was started on whatever node.exe its task found: after a crash past
 * H5 that is the NEW one (a restore replaces the file, not a running image). So until the next task
 * start this is the old app on the new interpreter; every later start is old on old.
 * `{ server }` or `{ server: null, whyNot }`.
 */
function previousAppToBoot(j, reading) {
  const app = path.join(j.previous, 'app');
  const whyNot = wholeAppProblem(app, j.from.version, reading);
  return whyNot ? { server: null, whyNot } : { server: path.join(app, 'server.js'), whyNot: null };
}

/** Why the app folder `app` is not the whole `version` app (a required file missing or unreadable, or
    another version), or null. Held answers are asked again; one still unknown is a reason too. */
function wholeAppProblem(app, version, reading) {
  for (const entry of win32update.REQUIRED_ENTRIES.filter((e) => e.startsWith('app/'))) {
    const file = path.join(app, ...entry.split('/').slice(1));
    const p = presenceOf(file, reading);
    if (p.state === 'unknown') return `${file} cannot be checked right now (code=${p.code})`;
    if (p.state === 'gone') return `${file} is missing`;
  }
  const read = win32update.readFileRetryingHolds(path.join(app, 'package.json'), reading && reading.waitSync, reading && reading.budget);
  if (read.code) return `${app} cannot be read right now (code=${read.code})`;
  let found = null;
  try { found = JSON.parse(read.text).version; } catch { found = null; }
  if (found !== version) return `${app} is ${found || 'of no known version'}, not ${version}`;
  return null;
}

/** May a held boot start the previous app instead of the pointer's? Only before H7 confirmed the new
    build (a phase before `confirmed`), or once a rollback of it has begun (`rolling-back`, `stuck`, or
    `rolledBackFrom` recorded). */
function previousAppMayBoot(j) {
  if (j.phase === 'rolling-back' || j.phase === 'stuck' || j.rolledBackFrom) return true;
  return PHASES.indexOf(j.phase) < PHASES.indexOf('confirmed');
}

/**
 * The app the logon shim starts when its recovery stopped part-way because it could not tell the
 * update was still its own (held): nothing to add when the Kosmos folder's own app is the whole old
 * one (the pointer starts it); otherwise the whole old app in previous-<from> (bootFrom), or why
 * neither can start (bootFromWhyNot), which the shim reports before it goes on as before.
 */
function bootChoiceWhenHeld(j, reading) {
  /* 🛑 NEVER THE OLD APP FOR A CONFIRMED UPDATE: its new build is what the pointer starts. */
  if (!previousAppMayBoot(j)) return {};
  const own = wholeAppProblem(path.join(j.root, 'app'), j.from.version, reading);
  if (!own) return {};
  const old = previousAppToBoot(j, reading);
  return old.server ? { bootFrom: old.server } : { bootFrom: null, bootFromWhyNot: `${own}, and ${old.whyNot}` };
}

/**
 * The helper: apply the staged journal at `journalAt`. Resolves to `{ ok, outcome, because? }`.
 * `overrides` are the seams (depsFrom); a test process must pass them.
 */
async function applyJournal(journalAt, overrides) {
  refuseInTestWithoutSeams(overrides, 'apply', journalAt);
  const deps = depsFrom(overrides);
  deps.hooks.afterDependencies();
  const read = readJournal(journalAt, deps.reading);
  if (read.state === 'unreadable') return { ok: false, because: unreadableSentence(journalAt, read) };
  if (read.state !== 'unfinished') return { ok: false, because: 'there is no update waiting to be applied' };
  const ctx = contextFor(journalAt, read.journal, deps, 'apply');
  const first = read.journal;
  if (first.phase !== 'staged') return { ok: false, because: `the update is already past being staged (${first.phase}), so it is not waiting to be applied` };
  const lock = takeUpdateLock(ctx);
  if (!lock.text) return { ok: false, because: `another update is already running (${lock.because})` };
  ctx.lock = lock;
  try {
    /* The journal read above is only a look. Between it and the lock, a resumer can have finished
       this journal, or begin() written another: only the same journal, still unfinished and still
       staged, READ AGAIN UNDER THE LOCK, is applied. */
    const reread = sameUnfinishedJournal(journalAt, first.token, deps.reading);
    if (reread.code) {
      ctx.log(`the update was not started, and nothing was written: ${heldRereadBecause(reread)}`);
      return { ok: false, outcome: 'held', action: 'held', because: `the update was not started, because ${heldRereadBecause(reread)}` };
    }
    const again = reread.journal;
    if (!again || again.phase !== 'staged') {
      ctx.log('the journal was finished or replaced before this helper held the lock; nothing applied');
      return { ok: false, because: 'the update was finished or replaced before this helper could start it, so it was not applied' };
    }
    ctx.j = again;
    ctx.j.helper = { pid: process.pid, mode: 'apply' };
    let refusal;
    try { refusal = applyRefusal(ctx); } catch (e) {
      if (!(e instanceof StepFailure)) throw e;
      /* A folder that cannot be checked is not a folder that changed: nothing is written, and the
         staged journal waits for its resumer. */
      ctx.log(`the update was not started, and nothing was written: ${e.message}`);
      return { ok: false, outcome: 'held', action: 'held', because: `the update was not started, because ${e.message}` };
    }
    if (refusal) return finishWithoutChange(ctx, refusal);
    return await runSteps(ctx);
  } catch (e) {
    const stopped = stoppedWriting(ctx, e);
    if (stopped) return stopped;
    throw e;
  } finally {
    releaseUpdateLock(ctx, lock);
  }
}

/* ─── the resumers ───────────────────────────────────────────────────────────────────────── */

function stoppedBecause(j) {
  return j.because || `the update stopped during ${j.phase} and did not finish`;
}

/**
 * The next begin()'s resumer, in a detached helper (`--kosmos-update-recover <journal>`): the same
 * rules as recoverAtBoot, but it stops the board before a rollback, and starts and confirms the old
 * board after.
 */
async function resumeJournal(journalAt, overrides) {
  refuseInTestWithoutSeams(overrides, 'resume', journalAt);
  const deps = depsFrom(overrides);
  deps.hooks.afterDependencies();
  const read = readJournal(journalAt, deps.reading);
  if (read.state === 'unreadable') return { ok: false, because: unreadableSentence(journalAt, read) };
  if (read.state !== 'unfinished') return { ok: true, action: 'nothing' };
  /* A staged journal this young belongs to the helper begin() has just started: leave it, and do not
     even take the lock that helper is about to need. */
  if (stagedIsYoung(read.journal, deps.now())) return { ok: true, action: 'starting' };
  const ctx = contextFor(journalAt, read.journal, deps, 'resume');
  const found = unrecoverableCase(read.journal, deps.reading);
  if (unreachableBeforeLock(read.journal, found, deps.reading)) return { ok: true, action: 'unreachable', because: found.because };
  const lock = lockForResume(ctx, found);
  if (lock.because) return { ok: true, action: 'held', because: lock.because };
  ctx.lock = lock;
  try {
    /* Read again under the lock: the holder it waited for may have finished it or replaced it. */
    const reread = lock.none ? { journal: read.journal } : sameUnfinishedJournal(journalAt, read.journal.token, deps.reading);
    if (reread.code) return { ok: true, action: 'held', because: heldRereadBecause(reread) };
    const again = reread.journal;
    if (!again) return { ok: true, action: 'nothing' };
    ctx.j = again;
    if (stagedIsYoung(ctx.j, deps.now())) return { ok: true, action: 'starting' };
    const judged = judgedUnderLock(again, found, lock, deps.reading);
    if (judged && judged.kind === 'unreachable') return { ok: true, action: 'unreachable', because: judged.because };
    if (judged) return { ok: false, ...settleUnrecoverable(ctx, judged) };
    ctx.j.helper = { pid: process.pid, mode: 'resume' };
    if (UNCHANGED_PHASES.includes(ctx.j.phase)) {
      if (ctx.j.phase === 'stopping') {
        const back = await startAndConfirm(ctx, ctx.j.from.identity, 'resume');
        if (!back.ok) {
          const r = finishWithoutChange(ctx, stoppedBecause(ctx.j));
          writeStatus(ctx, 'stuck', `its board did not start again: ${back.because}`);
          return { ...r, outcome: 'stuck' };
        }
      }
      return finishWithoutChange(ctx, stoppedBecause(ctx.j));
    }
    if (ctx.j.phase === 'confirmed') return finishUpdated(ctx);
    /* 🛑 A BOARD H7 CONFIRMED IS NEVER ROLLED BACK. A journal left at `starting` can be one whose
       helper saw the new board answer and could not record it (CONFIRMED_RECORD_PATIENCE_MS ran out):
       H7's own test, asked again here, finishes it forward. */
    if (ctx.j.phase === 'starting' && answersAs(await deps.probe(ctx.j.board.port), ctx.j.to.identity)) {
      ctx.log(`the board answers as ${ctx.j.to.identity}, as H7 requires: finishing the update forward`);
      setPhase(ctx, 'confirmed');
      return finishUpdated(ctx);
    }
    return await rollBack(ctx, stoppedBecause(ctx.j));
  } catch (e) {
    const stopped = stoppedWriting(ctx, e);
    if (stopped) return stopped;
    throw e;
  } finally {
    releaseUpdateLock(ctx, lock);
  }
}

/**
 * The logon shim's resumer, run by win32board.BOOT_JS before it reads the pointer, from the OLD
 * build's copy of this file. Synchronous, and it never stops or starts a board: this process is the
 * board about to boot. Returns `{ action }`: nothing | held | not-started | updated | rolled-back |
 * stuck | abandoned | unreadable. A `stuck` result also carries `bootFrom` (the whole old app to
 * start instead of ROOT's, previousAppToBoot) or `bootFromWhyNot`.
 *
 * 🛑 NO OVERALL DEADLINE. Every read here gets OWNER_READ_BUDGET's retries, so a recovery that meets
 * held answers can delay the board's `listen`, and a launcher hand-off may then end this process
 * part-way. That is a crash at some hook point, which the next start recovers from like any other:
 * the tests "a crash at every point of a rollback: the next board start finishes putting the old build
 * back" and "a boot resumer killed mid-rollback is finished by the next boot" prove it. A deadline
 * (round 6) cut the clock under read-only decisions and the lock's release instead: a boot choice with
 * no retries named no app, a slow healthy rollback never finished, and a release with no retries left
 * the lock naming the live board (round 7).
 */
function recoverAtBoot(journalAt, overrides) {
  refuseInTestWithoutSeams(overrides, 'recover', journalAt);
  const deps = depsFrom(overrides);
  deps.hooks.afterDependencies();
  const read = readJournal(journalAt, deps.reading);
  if (read.state === 'unreadable') {
    try { process.stderr.write('kosmos: ' + unreadableSentence(journalAt, read) + '\n'); } catch { /* stderr gone */ }
    return { action: 'unreadable', because: read.why };
  }
  if (read.state !== 'unfinished') return { action: 'nothing' };
  const ctx = contextFor(journalAt, read.journal, deps, 'boot');
  const found = unrecoverableCase(read.journal, deps.reading);
  if (unreachableBeforeLock(read.journal, found, deps.reading)) return { action: 'unreachable', because: found.because };
  const lock = lockForResume(ctx, found);
  if (lock.because) return { action: 'held', because: lock.because };
  ctx.lock = lock;
  try {
    const reread = lock.none ? { journal: read.journal } : sameUnfinishedJournal(journalAt, read.journal.token, deps.reading);
    /* A re-read that cannot be made is held, never "nothing": the boot choice comes from the first read. */
    if (reread.code) return { action: 'held', because: heldRereadBecause(reread), ...bootChoiceWhenHeld(read.journal, deps.reading) };
    const again = reread.journal;
    if (!again) return { action: 'nothing' };
    ctx.j = again;
    const judged = judgedUnderLock(again, found, lock, deps.reading);
    if (judged && judged.kind === 'unreachable') return { action: 'unreachable', because: judged.because };
    if (judged) return settleUnrecoverable(ctx, judged);
    if (UNCHANGED_PHASES.includes(ctx.j.phase)) { finishWithoutChange(ctx, stoppedBecause(ctx.j)); return { action: 'not-started' }; }
    if (ctx.j.phase === 'confirmed') { finishUpdated(ctx); return { action: 'updated' }; }
    const tree = rollBackTree(ctx, stoppedBecause(ctx.j));
    if (!tree.whole) {
      writeStatus(ctx, 'stuck', tree.problem);
      const old = previousAppToBoot(ctx.j, deps.reading);
      ctx.log(old.server ? `the previous version is whole in ${path.dirname(old.server)}` : `the previous version cannot be started instead: ${old.whyNot}`);
      return { action: 'stuck', because: tree.problem, bootFrom: old.server, bootFromWhyNot: old.whyNot };
    }
    const r = concludeRollback(ctx, null);
    return { action: r.outcome };
  } catch (e) {
    const stopped = stoppedWriting(ctx, e);
    /* A recovery that stopped part-way (held) can leave the Kosmos folder with no whole app: the shim
       then starts the whole old one instead, exactly as for a stuck one. */
    if (stopped && e instanceof OwnershipUnknown) return { ...stopped, ...bootChoiceWhenHeld(ctx.j, deps.reading) };
    if (stopped) return stopped;
    throw e;
  } finally {
    releaseUpdateLock(ctx, lock);
  }
}

/**
 * B5's way out when the helper could not even be started: a journal still at `staged` is finished as
 * not-started, with the reason, under the update lock. Nothing has moved, so nothing is reversed.
 */
function abandonStagedJournal(journalAt, because, overrides) {
  refuseInTestWithoutSeams(overrides, 'abandon', journalAt);
  const deps = depsFrom(overrides, win32update.QUICK_HELD_READ_BUDGET);
  const read = readJournal(journalAt);
  if (read.state !== 'unfinished' || read.journal.phase !== 'staged') return { action: 'nothing' };
  const ctx = contextFor(journalAt, read.journal, deps, 'begin');
  const lock = takeUpdateLock(ctx);
  if (!lock.text) return { action: 'held', because: lock.because };
  ctx.lock = lock;
  try {
    const reread = sameUnfinishedJournal(journalAt, read.journal.token, deps.reading);
    if (reread.code) return { action: 'held', because: heldRereadBecause(reread) };
    const again = reread.journal;
    if (!again || again.phase !== 'staged') return { action: 'nothing' };
    ctx.j = again;
    finishWithoutChange(ctx, because);
    return { action: 'not-started' };
  } catch (e) {
    const stopped = stoppedWriting(ctx, e);
    if (stopped) return stopped;
    throw e;
  } finally {
    releaseUpdateLock(ctx, lock);
  }
}

module.exports = {
  applyJournal, resumeJournal, recoverAtBoot, abandonStagedJournal, settleUnrecoverableJournal, readJournal, writeStagedJournal,
  unfinishedUpdateRefusal, journalPathFor, statusPathFor, moveOrder, writeGuard,
  stagedIsYoung, presenceOf, answersAs, previousAppMayBoot,
  MODULE_FILE_NAME, PREVIOUS_PREFIX, ANCHORED_NODE_COPY_NAME, APPLY_LOG_NAME, DEFAULT_APPLY_LIMITS, PHASES, STAGED_HELPER_STARTUP_GRACE_MS,
  OWNER_READ_BUDGET, CONFIRMED_RECORD_PATIENCE_MS,
};

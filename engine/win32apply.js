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

const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));
function sleepSync(ms) { Atomics.wait(SLEEP_CELL, 0, 0, ms); }

class StepFailure extends Error {
  constructor(because) { super(because); this.name = 'StepFailure'; }
}

/** This context no longer owns the update (see assertStillOwner). Never caught as a step failure:
    every catch rethrows it, and each entry point turns it into a `taken-over` result. */
class LostOwnership extends Error {
  constructor(because) { super(because); this.name = 'LostOwnership'; }
}

function firstLine(e) { return String((e && e.message) || e).split('\n')[0]; }
function codeOf(e) { return (e && e.code) || 'unknown'; }
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}
/** Is there anything at this name? A link counts, whatever it points at. */
function exists(target) {
  try { fs.lstatSync(target); return true; } catch { return false; }
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

/** Tries at reading a journal a writer is replacing: Windows answers EPERM for a moment. */
const JOURNAL_READ_TRIES = 3;
const JOURNAL_READ_WAIT_MS = 20;

/**
 * `{ state: 'none' }`, `{ state: 'unreadable', why }`, or `{ state: 'finished' | 'unfinished',
 * journal }`. Never throws.
 */
function readJournal(journalAt) {
  let text = null;
  for (let tries = 1; ; tries += 1) {
    try { text = fs.readFileSync(journalAt, 'utf8'); break; } catch (e) {
      if (e && e.code === 'ENOENT') return { state: 'none' };
      if (tries >= JOURNAL_READ_TRIES) return { state: 'unreadable', why: `cannot be read (code=${codeOf(e)})` };
      sleepSync(JOURNAL_READ_WAIT_MS);
    }
  }
  let j = null;
  try { j = JSON.parse(text); } catch { return { state: 'unreadable', why: 'is not valid JSON' }; }
  const problem = journalProblem(j, journalAt);
  if (problem) return { state: 'unreadable', why: problem };
  return { state: j.finished ? 'finished' : 'unfinished', journal: j };
}

function unreadableSentence(journalAt, why) {
  return `the record of an earlier update (${journalAt}) ${why}, so the updater cannot tell whether that update finished. Remove that file by hand once Kosmos is working normally, then try again`;
}

/** B0's journal precondition, as a sentence, or null. */
function unfinishedUpdateRefusal(anchorDir) {
  const journalAt = journalPathFor(anchorDir);
  const read = readJournal(journalAt);
  if (read.state === 'unreadable') return unreadableSentence(journalAt, read.why);
  if (read.state !== 'unfinished') return null;
  const j = read.journal;
  const found = unrecoverableCase(j);
  if (found && found.kind === 'unreachable') return `an earlier update to ${j.to.version} cannot be finished right now, because ${found.because}. Connect it and restart your computer, then try again`;
  if (found) return `an earlier update to ${j.to.version} can never finish, because ${found.because}. Asking Kosmos to update again clears that record`;
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
    presentBefore: order.filter((e) => exists(path.join(root, e))),
    stagedEntries: order.filter((e) => exists(path.join(staged, e))),
    from: { version: spec.fromVersion, identity: spec.fromIdentity },
    to: { version: spec.prepared.version, identity: spec.prepared.expectedIdentity, sha256: spec.prepared.sha256 },
    runtimeChanged: Boolean(spec.prepared.runtimeChanged),
    board: { pid: Number.isInteger(spec.board.pid) ? spec.board.pid : null, port: spec.board.port },
    pointer: { at: pointerAt, before: readText(pointerAt), after: path.join(root, 'app', 'engine') },
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
function depsFrom(over) {
  const o = over || {};
  return {
    board: o.board || win32board,
    probe: o.probe || win32handoff.probeBoard,
    portFree: o.portFree || portFree,
    pidGone: o.pidGone || ((pid) => !win32orphan.pidAlive(pid)),
    sleep: o.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    sleepSync: o.sleepSync || sleepSync,
    now: o.now || Date.now,
    log: typeof o.log === 'function' ? o.log : null,
    limits: { ...DEFAULT_APPLY_LIMITS, ...(o.limits || {}) },
    hooks: { afterDependencies() {}, before() {}, after() {}, ...(o.hooks || {}) },
    lockHooks: o.lockHooks,
  };
}

/** Convention 3: a test process that reaches the helper or a resumer with no seams would stop and
    start the real board. It throws there; production, where the flag or the shim is the opt-in,
    goes on. */
function refuseInTestWithoutSeams(over, what, journalAt) {
  if (!over && liveExec.inTestProcess()) liveExec.refuseOrWarn('engine/win32apply.js', what, [journalAt]);
}

function contextFor(journalAt, journal, deps, mode) {
  const j = journal;
  const inWork = win32update.workGuard(j.work);
  const logFile = path.join(j.work, APPLY_LOG_NAME);
  const log = (line) => {
    const stamped = `${new Date(deps.now()).toISOString()} [${mode} ${process.pid}] ${line}`;
    if (deps.log) { deps.log(line); return; }
    try { fs.appendFileSync(inWork(logFile), stamped + '\n'); } catch { /* the update matters more than its log */ }
    try { process.stderr.write('[win32apply] ' + line + '\n'); } catch { /* stderr gone */ }
  };
  return { journalAt, j, deps, mode, log, inWork, guard: writeGuard(j, journalAt) };
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
 * Either failing throws LostOwnership: the owner of this context stops at once. Without it, a helper
 * whose WORK vanished would resurrect a journal a resumer had already settled, and move the only
 * surviving build into a WORK the resumer made again. The gap between this check and the write is
 * the residual.
 */
function assertStillOwner(ctx) {
  if (ctx.lock && ctx.lock.text && readText(path.join(ctx.j.work, win32update.LOCK_NAME)) !== ctx.lock.text) {
    throw new LostOwnership('its update lock is gone or belongs to someone else now');
  }
  const read = readJournal(ctx.journalAt);
  if (!read.journal || read.journal.token !== ctx.j.token || (read.state === 'finished' && !ctx.wroteFinish)) {
    throw new LostOwnership('its journal was finished, replaced or removed by someone else');
  }
}

/** A result for an update this context stopped owning: nothing more was written. */
function takenOver(ctx, e) {
  ctx.log(`stopped without writing: ${e.message}`);
  return { ok: false, outcome: 'taken-over', action: 'taken-over', because: `the update stopped here: ${e.message}, so nothing more was written` };
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
      + `Download a fresh copy of Kosmos, unpack it over your Kosmos folder, then double-click Kosmos.exe in ${j.root}.`;
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
async function startAndConfirm(ctx, identity, step) {
  const { j, deps, log } = ctx;
  const L = deps.limits;
  let last = 'no board answered';
  for (let run = 1; run <= L.confirmRuns; run += 1) {
    deps.hooks.before(step + '-run', { run });
    const r = deps.board.runNow();
    record(ctx, { step, run, state: r.ok ? 'issued' : 'failed', because: r.ok ? undefined : r.because });
    log(`${step} run ${run}: ${r.ok ? 'issued' : r.because}`);
    const until = deps.now() + L.confirmWaitPerRunMs;
    for (;;) {
      const answer = await deps.probe(j.board.port);
      if (answer.answering && answer.identity === identity) {
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
  const hadOne = exists(at);
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
  win32swap.replaceInterpreter(j.interpreter.source, ctx.guard(at), () => j.interpreter.stamp);
  deps.hooks.after('H5-swap', {});
  record(ctx, { step: 'H5', state: 'done' });
}

function writePointer(ctx) {
  const { j, deps } = ctx;
  record(ctx, { step: 'H6', state: 'intent' });
  deps.hooks.before('H6-write', {});
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
    if (exists(mySide)) { try { fs.unlinkSync(ctx.guard(mySide)); } catch (e) { log(`left a staged node.exe copy for the sweep (code=${codeOf(e)})`); } }
  }
  const asideClock = () => Math.max(deps.now(), (it.stamp || 0) + 1);
  if (it.beforeSha256 === null) {
    /* There was no anchored interpreter before H5: any H5 put there moves aside, for the sweep. */
    if (it.stamp !== null && exists(at)) {
      deps.hooks.before('H8-H5', {});
      win32swap.renameWithRetry(ctx.guard(at), ctx.guard(at + win32swap.RETIRED_INFIX + asideClock() + '-' + process.pid));
      record(ctx, { step: 'H8-H5', state: 'done' });
    }
    return;
  }
  if (exists(at)) {
    const now = win32update.sha256OfFile(at);
    if (now === it.beforeSha256 || (it.restoredSha256 && now === it.restoredSha256)) return;
  }
  const retired = it.stamp !== null ? at + win32swap.RETIRED_INFIX + it.stamp + '-' + it.pid : null;
  const oldRuntimes = [path.join(j.previous, 'runtime', nodeName), path.join(j.root, 'runtime', nodeName)];
  let source = [it.copy, retired, ...oldRuntimes].find((c) => c && exists(c) && win32update.sha256OfFile(c) === it.beforeSha256);
  if (!source) {
    /* Neither the copy nor the retired original survived (a crash before the copy was verified,
       then the sweep): the old build's own node.exe is the next best, and the status says so.
       The old runtime is in previous-<from>, or back in ROOT once the new one is back in staged. */
    const oldRuntime = exists(oldRuntimes[0]) ? oldRuntimes[0]
      : exists(path.join(j.staged, 'runtime')) && exists(oldRuntimes[1]) ? oldRuntimes[1] : null;
    if (!oldRuntime) throw new StepFailure("the node.exe Kosmos ran on before the update could not be found");
    it.restoredFrom = oldRuntime;
    it.restoredSha256 = win32update.sha256OfFile(oldRuntime);
    save(ctx);
    log("restoring node.exe from the old build's runtime, because no exact copy of the original survived");
    source = oldRuntime;
  }
  record(ctx, { step: 'H8-H5', state: 'intent' });
  deps.hooks.before('H8-H5', {});
  win32swap.replaceInterpreter(source, ctx.guard(at), asideClock);
  record(ctx, { step: 'H8-H5', state: 'done' });
}

/** One pass of the reversal, in exact reverse order (H6, H5, H4, H3). Stops at the first rename that
    fails, so ROOT is never mixed further than the failure; the next pass starts over and skips what
    is already back. */
function reversePass(ctx) {
  const { j, deps } = ctx;
  if (readText(j.pointer.at) !== j.pointer.before) {
    deps.hooks.before('H8-H6', {});
    win32swap.writeFileAtomic(ctx.guard(j.pointer.at), j.pointer.before);
    record(ctx, { step: 'H8-H6', state: 'done' });
  }
  if (j.interpreter) restoreInterpreter(ctx);
  const reversed = [...j.order].reverse();
  for (const entry of reversed) {
    if (!j.stagedEntries.includes(entry) || !intended(j, 'H4', entry)) continue;
    const inRoot = path.join(j.root, entry);
    const back = path.join(j.staged, entry);
    if (exists(inRoot) && !exists(back)) {
      /* 🛑 NAMES ARE NOT BUILDS. An entry the old tree had is moved out of ROOT only while the old
         build's copy of it is in previous-<from> to take its place. Without that copy, what is in
         ROOT may be the only build left, and moving it away would leave the folder empty. */
      if (j.presentBefore.includes(entry) && !exists(path.join(j.previous, entry))) {
        ctx.log(`${entry} stays in the Kosmos folder: the old build's copy of it is gone, so it may be the only build left`);
        continue;
      }
      if (!exists(j.staged)) fs.mkdirSync(ctx.guard(j.staged));
      moveRecorded(ctx, 'H8-H4', entry, inRoot, back);
    }
  }
  for (const entry of reversed) {
    if (!j.presentBefore.includes(entry) || !intended(j, 'H3', entry)) continue;
    const away = path.join(j.previous, entry);
    const home = path.join(j.root, entry);
    if (exists(away) && !exists(home)) moveRecorded(ctx, 'H8-H3', entry, away, home);
  }
}

/** Is the old tree whole again? A sentence naming the first thing that is not, or null. */
function treeProblem(ctx) {
  const { j } = ctx;
  for (const entry of j.order) {
    const inRoot = exists(path.join(j.root, entry));
    if (j.presentBefore.includes(entry)) {
      if (!inRoot) return `${entry} is not back in the Kosmos folder`;
      if (exists(path.join(j.previous, entry))) return `${entry} is not back in the Kosmos folder`;
    } else if (inRoot && intended(j, 'H4', entry)) {
      return `${entry}, which the update brought, is still in the Kosmos folder`;
    }
  }
  /* The right names in ROOT are not enough: the app that is back must BE the old build. */
  if (j.presentBefore.includes('app')) {
    const rootVersion = (readJson(path.join(j.root, 'app', 'package.json')) || {}).version;
    if (rootVersion !== j.from.version) return `the app in the Kosmos folder is ${rootVersion || 'of no known version'}, not ${j.from.version}`;
  }
  if (readText(j.pointer.at) !== j.pointer.before) return 'the engine pointer is not back';
  const it = j.interpreter;
  if (it && it.beforeSha256 !== null) {
    const now = exists(it.at) ? win32update.sha256OfFile(it.at) : null;
    if (now !== it.beforeSha256 && !(it.restoredSha256 && now === it.restoredSha256)) return "Kosmos's node.exe is not back";
  }
  return null;
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
      if (e instanceof LostOwnership) throw e;
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

/** What a rollback that left the tree whole leaves behind: nothing of the new build. Best effort. */
function cleanupAfterRollback(ctx) {
  const { j, log } = ctx;
  const tidy = (what, fn) => { try { fn(); } catch (e) { log(`left ${what} for later (code=${codeOf(e)})`); } };
  tidy('the safety copy of node.exe', () => fs.rmSync(ctx.guard(path.join(j.previous, ANCHORED_NODE_COPY_NAME)), { force: true }));
  tidy('the empty previous folder', () => { if (exists(j.previous)) fs.rmdirSync(ctx.guard(j.previous)); });
  tidy('the staged update', () => fs.rmSync(ctx.guard(j.staged), { recursive: true, force: true }));
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
  const found = unrecoverableCase(j);
  if (found && found.kind !== 'unreachable') {
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
    if (e instanceof LostOwnership) throw e;
    log(`could not record the outcome (code=${codeOf(e)})`);
  }
  ctx.deps.hooks.before('H9-finish', {});
  j.finished = true;
  j.outcome = 'updated';
  save(ctx);
  ctx.deps.hooks.before('H9-cleanup', {});
  const tidy = (what, fn) => { try { fn(); } catch (e) { log(`left ${what} for later (code=${codeOf(e)})`); } };
  tidy('the staged folder', () => fs.rmSync(ctx.guard(j.staged), { recursive: true, force: true }));
  tidy('the download', () => fs.rmSync(ctx.guard(path.join(j.work, win32update.DOWNLOAD_PART_NAME)), { force: true }));
  tidy('the safety copy of node.exe', () => fs.rmSync(ctx.guard(path.join(j.previous, ANCHORED_NODE_COPY_NAME)), { force: true }));
  let names = [];
  try { names = fs.readdirSync(j.work); } catch { names = []; }
  for (const name of names) {
    const dir = path.join(j.work, name);
    if (!name.startsWith(PREVIOUS_PREFIX) || samePath(dir, j.previous)) continue;
    tidy(`an older build (${name})`, () => fs.rmSync(ctx.guard(dir), { recursive: true, force: true }));
  }
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
  const installed = (readJson(path.join(j.root, 'app', 'package.json')) || {}).version;
  if (installed !== j.from.version) return `the Kosmos folder is now ${installed || 'of an unknown version'}, not the ${j.from.version} this update was prepared for`;
  if (!update.newer(j.to.version, installed)) return `${j.to.version} is not newer than ${installed}, and Kosmos never installs an older or equal version`;
  const stagedVersion = (readJson(path.join(j.staged, 'app', 'package.json')) || {}).version;
  if (stagedVersion !== j.to.version) return `the staged update is ${stagedVersion || 'of an unknown version'}, not the ${j.to.version} this update was prepared for`;
  for (const entry of j.order) {
    if (exists(path.join(j.root, entry)) !== j.presentBefore.includes(entry)) return `the Kosmos folder changed after the update was prepared (${entry})`;
  }
  for (const entry of j.stagedEntries) {
    if (!exists(path.join(j.staged, entry))) return `the staged update is missing ${entry}`;
  }
  if (exists(j.previous)) return `${j.previous} is already there`;
  return null;
}

async function runSteps(ctx) {
  const { j, deps, log } = ctx;
  try {
    setPhase(ctx, 'stopping');
    deps.hooks.before('H2', {});
    const stopped = await stopBoard(ctx);
    if (!stopped.ok) throw new StepFailure(`Kosmos could not stop its board (${stopped.because})`);

    setPhase(ctx, 'moving-out');
    deps.hooks.before('H3', {});
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
    setPhase(ctx, 'confirmed');
  } catch (e) {
    if (e instanceof LostOwnership) throw e;
    const because = e instanceof StepFailure ? e.message : `${firstLine(e)} (code=${codeOf(e)})`;
    log(`the update failed during ${j.phase}: ${because}`);
    return rollBack(ctx, because);
  }
  /* Outside the try: nothing that goes wrong once the new board is confirmed may undo it. A journal
     left at `confirmed` is finished forward by the next resumer. */
  deps.hooks.before('H9', {});
  try { return finishUpdated(ctx); } catch (e) {
    if (e instanceof LostOwnership) throw e;
    log(`the update is in, but its record could not be finished (code=${codeOf(e)})`);
    return { ok: true, outcome: 'updated', version: j.to.version };
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
  try { win32update.releaseLock(ctx.inWork(path.join(ctx.j.work, win32update.LOCK_NAME)), lock.text, ctx.log); } catch (e) {
    ctx.log(`could not release the update lock (code=${codeOf(e)})`);
  }
}

/** The journal at `journalAt`, still unfinished and still the one with `token`, or null. */
function sameUnfinishedJournal(journalAt, token) {
  const read = readJournal(journalAt);
  return read.state === 'unfinished' && read.journal.token === token ? read.journal : null;
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
function unrecoverableCase(j) {
  /* 🛑 A FOLDER ON A DRIVE THAT IS NOT CONNECTED IS NOT GONE. When the volume root itself (a drive
     letter, or a UNC or mapped share's root) cannot be reached, the tree may be whole and waiting on
     a USB drive, a late BitLocker unlock or an offline share: `unreachable`, held, never settled. */
  const volume = path.parse(path.resolve(j.root)).root;
  if (volume && !exists(volume)) return { kind: 'unreachable', because: `the drive Kosmos is on (${volume}) is not connected` };
  if (!exists(j.root)) return { kind: 'root-gone', because: `the Kosmos folder that update was changing (${j.root}) no longer exists` };
  let missing = null;
  if (!exists(j.work)) missing = `its working folder ${j.work} is gone`;
  else if (!j.recoverFrom.some((f) => exists(f))) missing = 'no copy of the updater that could put it back is left';
  if (!missing) return null;
  if (UNCHANGED_PHASES.includes(j.phase)) return { kind: 'nothing-moved', because: missing };
  if (j.phase === 'confirmed') return { kind: 'confirmed', because: missing };
  return { kind: 'moved', because: missing };
}

/**
 * The lock a resumer needs, given what unrecoverableCase found.
 *   - ROOT gone: no lock. There is nothing left a lock protects (no tree, no WORK to hold one in),
 *     and every writer of this settlement writes the same finished record, atomically.
 *   - ROOT there, WORK gone: WORK is created again (empty, as prepare() creates it), and the one
 *     update lock is taken in it as always. Without this, taking the lock fails with ENOENT on every
 *     try, the resumer reads that as held, and the journal blocks updates forever. A helper whose
 *     WORK vanished under it has lost its lock file too, so nothing is excluded that was not already.
 * Returns `{ text }`, `{ none: true }` or `{ because }`.
 */
function lockForResume(ctx, found) {
  if (found && found.kind === 'root-gone') return { none: true };
  if (!exists(ctx.j.work)) {
    try {
      /* WORK itself, directly under an existing ROOT: the one write outside writeGuard, which admits
         only paths strictly inside WORK. */
      if (!samePath(path.dirname(ctx.j.work), ctx.j.root)) throw new Error('the working folder is not inside the Kosmos folder');
      fs.mkdirSync(ctx.j.work);
    } catch (e) {
      return { because: `the working folder could not be made again (code=${codeOf(e)})` };
    }
  }
  return takeUpdateLock(ctx);
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
  if (found.kind === 'unreachable') return { action: 'unreachable', because: found.because };
  refuseInTestWithoutSeams(overrides, 'settle', journalAt);
  const deps = depsFrom(overrides);
  const ctx = contextFor(journalAt, read.journal, deps, 'settle');
  const lock = lockForResume(ctx, found);
  if (lock.because) return { action: 'held', because: lock.because };
  ctx.lock = lock;
  try {
    const again = lock.none ? read.journal : sameUnfinishedJournal(journalAt, read.journal.token);
    if (!again) return { action: 'nothing' };
    ctx.j = again;
    return settleUnrecoverable(ctx, found);
  } catch (e) {
    if (e instanceof LostOwnership) return takenOver(ctx, e);
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
function previousAppToBoot(j) {
  for (const entry of win32update.REQUIRED_ENTRIES.filter((e) => e.startsWith('app/'))) {
    const file = path.join(j.previous, ...entry.split('/'));
    if (!exists(file)) return { server: null, whyNot: `${file} is missing` };
  }
  const app = path.join(j.previous, 'app');
  const version = (readJson(path.join(app, 'package.json')) || {}).version;
  if (version !== j.from.version) return { server: null, whyNot: `${app} is ${version || 'of no known version'}, not ${j.from.version}` };
  return { server: path.join(app, 'server.js'), whyNot: null };
}

/**
 * The helper: apply the staged journal at `journalAt`. Resolves to `{ ok, outcome, because? }`.
 * `overrides` are the seams (depsFrom); a test process must pass them.
 */
async function applyJournal(journalAt, overrides) {
  refuseInTestWithoutSeams(overrides, 'apply', journalAt);
  const deps = depsFrom(overrides);
  deps.hooks.afterDependencies();
  const read = readJournal(journalAt);
  if (read.state === 'unreadable') return { ok: false, because: unreadableSentence(journalAt, read.why) };
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
    const again = sameUnfinishedJournal(journalAt, first.token);
    if (!again || again.phase !== 'staged') {
      ctx.log('the journal was finished or replaced before this helper held the lock; nothing applied');
      return { ok: false, because: 'the update was finished or replaced before this helper could start it, so it was not applied' };
    }
    ctx.j = again;
    ctx.j.helper = { pid: process.pid, mode: 'apply' };
    const refusal = applyRefusal(ctx);
    if (refusal) return finishWithoutChange(ctx, refusal);
    return await runSteps(ctx);
  } catch (e) {
    if (e instanceof LostOwnership) return takenOver(ctx, e);
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
  const read = readJournal(journalAt);
  if (read.state === 'unreadable') return { ok: false, because: unreadableSentence(journalAt, read.why) };
  if (read.state !== 'unfinished') return { ok: true, action: 'nothing' };
  /* A staged journal this young belongs to the helper begin() has just started: leave it, and do not
     even take the lock that helper is about to need. */
  if (stagedIsYoung(read.journal, deps.now())) return { ok: true, action: 'starting' };
  const ctx = contextFor(journalAt, read.journal, deps, 'resume');
  const found = unrecoverableCase(read.journal);
  if (found && found.kind === 'unreachable') return { ok: true, action: 'unreachable', because: found.because };
  const lock = lockForResume(ctx, found);
  if (lock.because) return { ok: true, action: 'held', because: lock.because };
  ctx.lock = lock;
  try {
    /* Read again under the lock: the holder it waited for may have finished it or replaced it. */
    const again = lock.none ? read.journal : sameUnfinishedJournal(journalAt, read.journal.token);
    if (!again) return { ok: true, action: 'nothing' };
    ctx.j = again;
    if (stagedIsYoung(ctx.j, deps.now())) return { ok: true, action: 'starting' };
    if (found) return { ok: false, ...settleUnrecoverable(ctx, found) };
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
    return await rollBack(ctx, stoppedBecause(ctx.j));
  } catch (e) {
    if (e instanceof LostOwnership) return takenOver(ctx, e);
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
 */
function recoverAtBoot(journalAt, overrides) {
  refuseInTestWithoutSeams(overrides, 'recover', journalAt);
  const deps = depsFrom(overrides);
  deps.hooks.afterDependencies();
  const read = readJournal(journalAt);
  if (read.state === 'unreadable') {
    try { process.stderr.write('kosmos: ' + unreadableSentence(journalAt, read.why) + '\n'); } catch { /* stderr gone */ }
    return { action: 'unreadable', because: read.why };
  }
  if (read.state !== 'unfinished') return { action: 'nothing' };
  const ctx = contextFor(journalAt, read.journal, deps, 'boot');
  const found = unrecoverableCase(read.journal);
  if (found && found.kind === 'unreachable') return { action: 'unreachable', because: found.because };
  const lock = lockForResume(ctx, found);
  if (lock.because) return { action: 'held', because: lock.because };
  ctx.lock = lock;
  try {
    const again = lock.none ? read.journal : sameUnfinishedJournal(journalAt, read.journal.token);
    if (!again) return { action: 'nothing' };
    ctx.j = again;
    if (found) return settleUnrecoverable(ctx, found);
    if (UNCHANGED_PHASES.includes(ctx.j.phase)) { finishWithoutChange(ctx, stoppedBecause(ctx.j)); return { action: 'not-started' }; }
    if (ctx.j.phase === 'confirmed') { finishUpdated(ctx); return { action: 'updated' }; }
    const tree = rollBackTree(ctx, stoppedBecause(ctx.j));
    if (!tree.whole) {
      writeStatus(ctx, 'stuck', tree.problem);
      const old = previousAppToBoot(ctx.j);
      ctx.log(old.server ? `the previous version is whole in ${path.dirname(old.server)}` : `the previous version cannot be started instead: ${old.whyNot}`);
      return { action: 'stuck', because: tree.problem, bootFrom: old.server, bootFromWhyNot: old.whyNot };
    }
    const r = concludeRollback(ctx, null);
    return { action: r.outcome };
  } catch (e) {
    if (e instanceof LostOwnership) return takenOver(ctx, e);
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
  const deps = depsFrom(overrides);
  const read = readJournal(journalAt);
  if (read.state !== 'unfinished' || read.journal.phase !== 'staged') return { action: 'nothing' };
  const ctx = contextFor(journalAt, read.journal, deps, 'begin');
  const lock = takeUpdateLock(ctx);
  if (!lock.text) return { action: 'held', because: lock.because };
  ctx.lock = lock;
  try {
    const again = sameUnfinishedJournal(journalAt, read.journal.token);
    if (!again || again.phase !== 'staged') return { action: 'nothing' };
    ctx.j = again;
    finishWithoutChange(ctx, because);
    return { action: 'not-started' };
  } catch (e) {
    if (e instanceof LostOwnership) return takenOver(ctx, e);
    throw e;
  } finally {
    releaseUpdateLock(ctx, lock);
  }
}

module.exports = {
  applyJournal, resumeJournal, recoverAtBoot, abandonStagedJournal, settleUnrecoverableJournal, readJournal, writeStagedJournal,
  unfinishedUpdateRefusal, journalPathFor, statusPathFor, moveOrder, writeGuard,
  stagedIsYoung,
  MODULE_FILE_NAME, PREVIOUS_PREFIX, ANCHORED_NODE_COPY_NAME, APPLY_LOG_NAME, DEFAULT_APPLY_LIMITS, PHASES, STAGED_HELPER_STARTUP_GRACE_MS,
};

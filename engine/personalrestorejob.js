'use strict';
/**
 * kosmos#7404: the board's side of a personal-backup restore. Each list and each restore runs in a child process
 * (engine/personalrestore-child.js), so a restore that writes for hours never holds the board's event loop.
 *
 *   list()        the person's backups, newest first (personalrestore.listBackups, in a child). One at a time:
 *                 an ask while one runs shares its answer.
 *   start(key)    restore one backup into a new Kosmos (personalrestore.restoreFiles, in a child). One at a time on
 *                 this board; answers at once with { ok: true }, and status() says the rest (a child that
 *                 could not start shows there too).
 *   status()      { running, startedAt, last }: last is the most recent FINISHED restore's answer, by named fields
 *                 (while one runs, it is the one before). With
 *                 { namesHidden }, the counts of moved, kept, held back and failed files and not their names.
 *   stop()        ends the restore that is running; what it had already written stays in its new Kosmos.
 *   untilIdle(ms) resolves true once no restore runs, or false after ms.
 *   forget()      personal backup was turned off: stops a running restore, drops the last answer (and that of
 *                 one still ending) and ends any list. offStarting()/offDone() bracket Off, and start() refuses
 *                 between them.
 * A child also exits by itself when the board goes, because its IPC channel closes.
 *
 * Known limits, on #7404 for the screen slice:
 * - a restore has no time limit, only stop();
 * - stop() ends the child wherever it is, the move into the new Kosmos included, and nothing tidies what that leaves;
 * - the slot and the last answer live in this process, so after a restart nothing says a restore was cut off;
 * - an old board's child may still be finishing a write when a new board starts another restore (each makes its own
 *   new Kosmos, and restoreworld's list has its own lock);
 * - the child reads the member keys outside personalbackupkey's serial() queue, which is this process's (a read only,
 *   of files written whole);
 * - a list while a restore runs spends the same hourly Kosmos+ allowance;
 * - a request the board was already signing when stop() came still goes to Kosmos+ (no new one is signed after).
 *
 * The child signs nothing. Its Kosmos+ requests come back here and only ROUTES are signed, through remote.macRequest,
 * so the busy() guard around a register or a Forget holds for a restore as for anything else. Any other route is
 * answered as a refusal that was never sent.
 *
 * Never throws: { ok: true, ... } or { ok: false, because, code? }.
 */
const path = require('node:path');
const childProcess = require('node:child_process');

const CHILD = path.join(__dirname, 'personalrestore-child.js');
// The only requests a restore makes (personalbackupkey MINE_ROUTE, personalrestore MANIFESTS_ROUTE and READ_ROUTE).
const ROUTES = new Set([
  'POST /v1/org/backup/member-key/mine',
  'POST /v1/org/backup/mine/manifests',
  'POST /v1/org/backup/mine/read',
]);
// A list is a few signed rounds; past this something is stuck. A restore has no such bound: it can run for hours.
const LIST_TIMEOUT_MS = 5 * 60 * 1000;
const STDERR_KEPT = 4096;

const refused = (because, code) => (code ? { ok: false, because, code } : { ok: false, because });
const LIST_FAILED = 'Your backups could not be listed on this computer just now. Try again.';

const children = new Set();
let listing = null;     // the list in flight, shared
let restoring = null;   // { startedAt } while a restore runs
let last = null;        // the most recent restore's shaped answer, { finishedAt, ...fields }

/* Only named fields leave: what the screen may show. */
function shapeList(r) {
  if (!r || typeof r !== 'object' || r.ok !== true) {
    const out = refused(r && typeof r.because === 'string' ? r.because : LIST_FAILED);
    if (r && typeof r.code === 'string') out.code = r.code;
    return out;
  }
  const backups = (Array.isArray(r.backups) ? r.backups : []).filter((b) => b && typeof b.key === 'string').map((b) => ({
    key: b.key, epoch: Number.isSafeInteger(b.epoch) ? b.epoch : null, takenAt: Number.isFinite(b.takenAt) ? b.takenAt : null, problem: typeof b.problem === 'string' ? b.problem : null,
  }));
  return { ok: true, more: r.more === true, keyMissing: r.keyMissing === true, backups };
}

const names = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
// A list of reasons for the screen: at most 20, each cut to 300 characters, as restoreworld's own fetchProblems.
const REASONS_KEPT = 20;
const REASON_CHARS = 300;
const reasons = (a) => {
  const all = names(a);
  const kept = all.slice(0, REASONS_KEPT).map((x) => x.slice(0, REASON_CHARS));
  if (all.length > REASONS_KEPT) kept.push('(more not listed)');
  return kept;
};
const FAILED_KEPT = 200;   // as personalrestore's FILES_NAMED
const PATH_CHARS = 1024;
function shapeRestore(r) {
  const out = { ok: !!(r && r.ok === true) };
  if (!r || typeof r !== 'object') return Object.assign(out, { because: 'the restore failed on this computer' });
  if (typeof r.because === 'string') out.because = r.because;
  if (typeof r.code === 'string') out.code = r.code;
  if (r.partial === true) out.partial = true;
  if (r.world && typeof r.world.id === 'string') out.world = { id: r.world.id, name: typeof r.world.name === 'string' ? r.world.name : r.world.id };
  if (Number.isSafeInteger(r.restored)) out.restored = r.restored;
  if (Number.isSafeInteger(r.failed)) out.failed = r.failed;
  for (const k of ['moved', 'kept', 'heldBack']) if (k in r) out[k] = names(r[k]).slice(0, FAILED_KEPT).map((x) => x.slice(0, PATH_CHARS));
  if ('fetchProblems' in r) out.fetchProblems = reasons(r.fetchProblems);
  const d = r.details;
  if (d && typeof d === 'object') {
    out.details = {
      failed: (Array.isArray(d.failed) ? d.failed : []).filter((f) => f && typeof f.path === 'string').slice(0, FAILED_KEPT)
        .map((f) => ({ path: f.path.slice(0, PATH_CHARS), why: typeof f.why === 'string' ? f.why.slice(0, REASON_CHARS) : '' })),
      leftOutAtBackup: Number.isSafeInteger(d.leftOutAtBackup) ? d.leftOutAtBackup : 0,
      fetchProblems: reasons(d.fetchProblems),
    };
  }
  if (!out.ok && !out.because) out.because = 'the restore failed on this computer';
  return out;
}

/* One child, one ask, one answer. deps: { fork, macRequest, timeoutMs } (tests). */
function runChild(ask, deps = {}) {
  const fork = deps.fork || childProcess.fork;
  const macRequest = deps.macRequest || ((m, r, b) => require('./remote').macRequest(m, r, b));
  return new Promise((resolve) => {
    let child = null, settled = false, timer = null;
    const done = (answer) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (child) { children.delete(child); try { child.kill(); } catch { /* gone */ } }
      resolve(answer);
    };
    try {
      child = fork(CHILD, [], { execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'json', windowsHide: true });
    } catch { done(null); return; }
    // The end of the child's stderr, for the board's log when it ends without an answer (a crash leaves nothing else).
    let errTail = '';
    if (child.stderr) child.stderr.on('data', (b) => { errTail = (errTail + String(b)).slice(-STDERR_KEPT); });
    children.add(child);
    if (deps.onChild) deps.onChild(child);
    if (deps.timeoutMs) { timer = setTimeout(() => done(null), deps.timeoutMs); if (timer.unref) timer.unref(); }
    child.on('error', () => done(null));
    // A child gone without its answer. On close, not exit: close comes after the channel is read to its end, so an
    // answer sent just before the child exited is always read first.
    child.on('close', (code, signal) => {
      if (!settled && errTail.trim()) { try { console.warn('personal restore: the child ended without an answer; its last words: ' + errTail.trim()); } catch { /* no console */ } }
      done({ gone: true, code, signal });
    });
    child.on('message', (m) => {
      if (settled || !m || typeof m !== 'object') return;
      if ('done' in m) { done(m.done); return; }
      const q = m.mac;
      if (!q || !Number.isSafeInteger(q.id)) return;
      const answer = (got) => { if (!settled) { try { child.send({ macAnswer: { id: q.id, got } }); } catch { /* the child is gone */ } } };
      if (typeof q.method !== 'string' || typeof q.route !== 'string' || !ROUTES.has(`${q.method} ${q.route}`)
        || !q.body || typeof q.body !== 'object' || Array.isArray(q.body)) {
        answer({ ok: false, notSent: true, because: 'this Kosmos signs only the requests a restore makes' });
        return;
      }
      Promise.resolve().then(() => macRequest(q.method, q.route, q.body))
        .then((got) => answer(got && typeof got === 'object' ? got : { ok: false, because: 'Kosmos+ could not be reached' }),
          () => answer({ ok: false, because: 'Kosmos+ could not be reached' }));
    });
    try { child.send({ run: ask }); } catch { done(null); }
  });
}

/* An ask while a list runs gets that list's answer (its deps too: tests ask one at a time). */
function list(deps = {}) {
  if (listing) return listing;
  const p = runChild({ op: 'list' }, Object.assign({ timeoutMs: LIST_TIMEOUT_MS }, deps)).then(shapeList, () => shapeList(null));
  listing = p;
  p.then(() => { if (listing === p) listing = null; });
  return p;
}

/* As personalrestore's own baseOf, but from the board, where bootedBaseDir is known. */
function baseOfBoard() {
  const worlds = require('./worlds');
  return require('./worldenv').bootedBaseDir() || worlds.baseRoot(worlds.preWorldEnv(process.env));
}

function start(key, deps = {}) {
  if (typeof key !== 'string' || !key || key.length > 1024) return refused('That backup is not on Kosmos+ any more.', 'no_such_backup');
  if (restoring) return refused('A restore is already running on this computer.', 'restore_running');
  if (turningOff) return refused('Personal backup is being turned off, so nothing was restored.', 'not_on');
  const mine = { startedAt: Date.now(), stopped: false, child: null };
  restoring = mine;
  /* The worlds' base is the board's, read here: the child cannot see which world this board booted into
     (worldenv.bootedBaseDir is this process's own), and a world made under another base never reaches the switcher. */
  let base = null;
  try { base = deps.base || baseOfBoard(); } catch { base = null; }
  if (typeof base !== 'string' || !path.isAbsolute(base)) { restoring = null; return refused('this Kosmos could not tell where to put the restore, so nothing was restored'); }
  runChild({ op: 'restore', key, base }, Object.assign({}, deps, { onChild: (c) => { mine.child = c; } })).then((r) => r, () => null).then((r) => {
    // r: the child's answer; { gone, code, signal } when it ended without one; null when it never started.
    const how = r && r.gone ? (r.signal ? ` (it was ended by ${r.signal})` : Number.isSafeInteger(r.code) ? ` (it exited with code ${r.code})` : '') : '';
    const cut = !r ? { ok: false, because: 'the restore could not start on this computer' }
      : mine.stopped ? { ok: false, code: 'stopped', because: 'You stopped this restore. The files it had already restored stay in its new Kosmos.' }
        : { ok: false, because: 'the restore stopped on this computer before it finished' + how };
    if (mine.forgotten) {
      // Personal backup was turned off while this ended: its answer, names and all, is not kept.
      last = { finishedAt: Date.now(), ok: false, code: 'stopped', because: 'Personal backup was turned off, so this restore was stopped.', stoppedByPerson: true };
    } else {
      last = Object.assign({ finishedAt: Date.now() }, shapeRestore(r && !r.gone ? r : cut));
      if (mine.stopped && r && r.gone) last.stoppedByPerson = true;   // set here only, never from the child's answer
    }
    if (restoring === mine) restoring = null;
  });
  return { ok: true, startedAt: mine.startedAt };
}

const REMOTE_BECAUSE = 'This restore did not finish. Open Kosmos on this computer to see why.';
const counted = (a) => (Array.isArray(a) ? a.length : 0);
function status(opts = {}) {
  let shown = last;
  if (last && opts.namesHidden) {
    shown = {};
    for (const k of ['finishedAt', 'ok', 'code', 'partial', 'restored', 'failed', 'stoppedByPerson']) if (k in last) shown[k] = last[k];
    // A reason can quote a path from the backup (restorerun names what failed), so a remote session gets one fixed line.
    if ('because' in last) shown.because = last.stoppedByPerson === true ? last.because : REMOTE_BECAUSE;
    if (last.world) shown.world = last.world;   // the new Kosmos's name, not a file's
    for (const k of ['moved', 'kept', 'heldBack']) if (k in last) shown[k + 'Count'] = counted(last[k]);
    if (last.details) shown.details = { failedCount: counted(last.details.failed), leftOutAtBackup: last.details.leftOutAtBackup };
  }
  return { running: !!restoring, startedAt: restoring ? restoring.startedAt : null, last: shown };
}

/* The person's Stop. The answer arrives through start's own settle, so the slot frees there, as on any end. */
function stop() {
  if (!restoring) return refused('No restore is running on this computer.', 'not_running');
  restoring.stopped = true;
  if (restoring.child) { try { restoring.child.kill(); } catch { /* gone */ } }
  return { ok: true };
}

function endChildren() {
  for (const c of children) { try { c.kill(); } catch { /* gone */ } }
}

function untilIdle(ms) {
  if (!restoring) return Promise.resolve(true);
  const end = Date.now() + ms;
  return new Promise((resolve) => {
    const look = () => { if (!restoring) resolve(true); else if (Date.now() >= end) resolve(false); else { const t = setTimeout(look, 25); if (t.unref) t.unref(); } };
    look();
  });
}

/* Drops the last answer, and the answer of a restore still ending, so neither comes back after Off. Ends any list too. */
function forget() {
  last = null;
  if (restoring) { restoring.forgotten = true; stop(); }
  for (const c of children) { try { c.kill(); } catch { /* gone */ } }
}

/* While Off runs, no restore may start: Off's stop and forget would not cover it. offDone() lets them start again. */
let turningOff = false;
function offStarting() { turningOff = true; }
function offDone() { turningOff = false; }

/* Tests: forget the last answer and anything in flight. */
function resetForTests() { endChildren(); children.clear(); listing = null; restoring = null; last = null; turningOff = false; }

module.exports = { list, start, status, stop, untilIdle, forget, offStarting, offDone, ROUTES, shapeList, shapeRestore, _resetForTests: resetForTests };

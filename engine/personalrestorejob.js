'use strict';
/**
 * kosmos#7404: the board's side of a personal-backup restore. Each list and each restore runs in a child process
 * (engine/personalrestore-child.js), so a restore that writes for hours never holds the board's event loop.
 *
 *   list()        the person's backups, newest first (personalrestore.listBackups, in a child). One at a time:
 *                 an ask while one runs shares its answer.
 *   start(key)    restore one backup into a new Kosmos (personalrestore.restoreFiles, in a child). One at a time on
 *                 this board; answers at once, { ok: true } once the child is started, and status() says the rest.
 *   status()      { running, startedAt, last }: last is the most recent restore's answer, by named fields.
 *   (no stop: a child exits by itself when the board goes, because its IPC channel closes.)
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
    key: b.key, epoch: b.epoch, takenAt: Number.isFinite(b.takenAt) ? b.takenAt : null, problem: typeof b.problem === 'string' ? b.problem : null,
  }));
  return { ok: true, more: r.more === true, keyMissing: r.keyMissing === true, backups };
}

const names = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
function shapeRestore(r) {
  const out = { ok: !!(r && r.ok === true) };
  if (!r || typeof r !== 'object') return Object.assign(out, { because: 'the restore failed on this computer' });
  if (typeof r.because === 'string') out.because = r.because;
  if (typeof r.code === 'string') out.code = r.code;
  if (r.partial === true) out.partial = true;
  if (r.world && typeof r.world.id === 'string') out.world = { id: r.world.id, name: typeof r.world.name === 'string' ? r.world.name : r.world.id };
  if (Number.isSafeInteger(r.restored)) out.restored = r.restored;
  if (Number.isSafeInteger(r.failed)) out.failed = r.failed;
  for (const k of ['moved', 'kept', 'heldBack']) if (k in r) out[k] = names(r[k]);
  const d = r.details;
  if (d && typeof d === 'object') {
    out.details = {
      failed: (Array.isArray(d.failed) ? d.failed : []).filter((f) => f && typeof f.path === 'string')
        .map((f) => ({ path: f.path, why: typeof f.why === 'string' ? f.why : '' })),
      leftOutAtBackup: Number.isSafeInteger(d.leftOutAtBackup) ? d.leftOutAtBackup : 0,
      fetchProblems: names(d.fetchProblems),
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
      child = fork(CHILD, [], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json', windowsHide: true });
    } catch { done(null); return; }
    children.add(child);
    if (deps.timeoutMs) { timer = setTimeout(() => done(null), deps.timeoutMs); if (timer.unref) timer.unref(); }
    child.on('error', () => done(null));
    child.on('exit', () => done(null));   // a child that exits without its answer: settled is set first when it answered
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

function list(deps = {}) {
  if (listing) return listing;
  const p = runChild({ op: 'list' }, Object.assign({ timeoutMs: LIST_TIMEOUT_MS }, deps)).then(shapeList, () => shapeList(null));
  listing = p;
  p.then(() => { if (listing === p) listing = null; });
  return p;
}

function start(key, deps = {}) {
  if (typeof key !== 'string' || !key || key.length > 1024) return refused('That backup is not on Kosmos+ any more.', 'no_such_backup');
  if (restoring) return refused('A restore is already running on this computer.', 'restore_running');
  const mine = { startedAt: Date.now() };
  restoring = mine;
  runChild({ op: 'restore', key }, deps).then((r) => r, () => null).then((r) => {
    last = Object.assign({ finishedAt: Date.now() }, shapeRestore(r || { ok: false, because: 'the restore stopped on this computer before it finished' }));
    if (restoring === mine) restoring = null;
  });
  return { ok: true, startedAt: mine.startedAt };
}

function status() {
  return { running: !!restoring, startedAt: restoring ? restoring.startedAt : null, last };
}

function endChildren() {
  for (const c of children) { try { c.kill(); } catch { /* gone */ } }
}

/* Tests: forget the last answer and anything in flight. */
function resetForTests() { endChildren(); children.clear(); listing = null; restoring = null; last = null; }

module.exports = { list, start, status, ROUTES, shapeList, shapeRestore, _resetForTests: resetForTests };

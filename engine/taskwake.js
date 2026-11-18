'use strict';
/**
 * kosmos#8669: a task can wake its holder when something happens, instead of on a reminder timer.
 *
 * Why: a task like "re-check after the next refresh" depends on an event (a pull request merges, a branch gets a new
 * commit, a file changes). Before this nothing told the agent when the event happened; it waited for a nudge or for the
 * idle reminder, which fires on a timer and knows nothing about the event.
 *
 * One condition per task, stored on the task as `wake` (tasks.setWake):
 *   { kind: 'pr',     repo: 'owner/name', number: 123 }               the pull request is merged (or closed unmerged)
 *   { kind: 'branch', repo: 'owner/name', branch: 'main', from: sha } the branch's head is no longer `from`
 *   { kind: 'file',   path: '/abs/path', from: 'sha256:...', size, mtimeMs }  the file's fingerprint is no longer `from`
 *   { kind: 'at',     at: ms }                                          the time has come
 * plus setAt (ISO), setBy (an agent's session name) or byPerson (true).
 *
 * Two halves, kept apart so a board restart loses neither:
 *  - checkTick() looks, at most once a minute per task, and stores what it found on the task (`wakeMet`: when and in
 *    words). A pull request or branch is read from GitHub through the gh tool the GitHub connection uses; a file is
 *    read from this computer; a time needs nothing.
 *  - sweep() tells ONE holder of an open part, once, the way a due repeating task is told (repeatdue.js): an idle and
 *    settled holder, one line per agent per minute, inside Agent Communication's limit. The task then stores
 *    `wakeToldAt`, and it never wakes again unless a wake is set again.
 *
 * Not here (slice 1): waking a holder that is busy (it is told when it next goes idle, as a due repeat is), more than
 * one condition per task, and the Kosmos-held GitHub token road (githubdevice.js): only the gh road is read.
 */
const taskrepeat = require('./taskrepeat');

const KINDS = ['pr', 'branch', 'file', 'at'];
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/* How often one task's condition is looked at. Under a minute so the done-when ("within a minute of the merge") holds
   for an idle holder, with the tick itself once a minute. */
const CHECK_EVERY_MS = 55 * 1000;
/* GitHub reads one tick may start, across the board, oldest-checked first. 20 a minute is 1200 an hour, a quarter of
   GitHub's hourly limit for a signed-in user, so a board with many watched pull requests checks each less often
   rather than spending the person's whole allowance. */
const NET_PER_TICK = 20;
/* A file bigger than this is never fingerprinted on the board's thread: its size or modified time changing is the
   change. 64 MB hashes in well under a second. */
const FILE_HASH_MAX = 64 * 1024 * 1024;
const AT_MAX_MS = 366 * DAY_MS;
const GH_TIMEOUT_MS = 10 * 1000;
const MAX_TRIES = 3;
const SETTLED_MS = 50 * 1000;
const SEEN_GAP_MS = 90 * 1000;

/* The board's memory of the last look at each wake (checkTick's `state`) and of each watched file's size and time
   (`seen`): one per board process, so the rows every route builds can say why a wake could not be checked. */
const BOARD_STATE = new Map();
const BOARD_SEEN = new Map();

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const PRINT_RE = /^(?:sha256|pdf-normalized):[0-9a-f]{64}$/;

function plain(s, max) { return require('./agentnudge').plainWords(s, max); }

function repoProblem(repo) {
  if (typeof repo !== 'string') return 'say the repository as owner/name, for example octo/hello';
  const parts = repo.split('/');
  if (parts.length !== 2 || !OWNER_RE.test(parts[0]) || !NAME_RE.test(parts[1]) || parts[1] === '.' || parts[1] === '..') {
    return 'say the repository as owner/name, for example octo/hello';
  }
  return null;
}
/* git's own rules for a branch name, the ones that matter for a name sent to GitHub's API as part of a path. */
function branchProblem(b) {
  const bad = 'that is not a branch name GitHub would have';
  if (typeof b !== 'string' || b.length < 1 || b.length > 200) return bad;
  if (!/^[A-Za-z0-9._/-]+$/.test(b)) return bad;
  if (b.startsWith('-') || b.startsWith('/') || b.endsWith('/') || b.endsWith('.') || b.endsWith('.lock')) return bad;
  if (b.includes('..') || b.includes('//') || b.split('/').some((s) => s.startsWith('.'))) return bad;
  return null;
}

/** A pull request as a person writes it: owner/name#123, or its github.com address. { repo, number } or a sentence. */
function parsePr(s) {
  const v = typeof s === 'string' ? s.trim() : '';
  let m = v.match(/^([^/#\s]+\/[^/#\s]+)#(\d{1,9})$/);
  if (!m) m = v.match(/^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d{1,9})\/?(?:[#?].*)?$/);
  if (!m) return { problem: 'say the pull request as owner/name#123, or paste its github.com address' };
  const problem = repoProblem(m[1]);
  if (problem) return { problem };
  const number = Number(m[2]);
  if (!Number.isInteger(number) || number < 1) return { problem: 'a pull request number is 1 or more' };
  return { repo: m[1], number };
}
/** A branch as owner/name:branch. { repo, branch } or a sentence. */
function parseBranch(s) {
  const v = typeof s === 'string' ? s.trim() : '';
  const i = v.indexOf(':');
  if (i < 1) return { problem: 'say the branch as owner/name:branch, for example octo/hello:main' };
  const repo = v.slice(0, i);
  const branch = v.slice(i + 1);
  const problem = repoProblem(repo) || branchProblem(branch);
  return problem ? { problem } : { repo, branch };
}
/**
 * A time as a person writes it, in this computer's local time: 30m, 2h, 1d (from now), HH:MM (the next one), or
 * YYYY-MM-DD HH:MM. { at: ms } or a sentence. Must be in the future and within a year.
 */
function parseAt(s, now = Date.now()) {
  const v = typeof s === 'string' ? s.trim() : '';
  let at = NaN;
  let m = v.match(/^(\d{1,6})(m|h|d)$/);
  if (m) at = now + Number(m[1]) * (m[2] === 'm' ? MINUTE_MS : m[2] === 'h' ? HOUR_MS : DAY_MS);
  if (!m && (m = v.match(/^([01]\d|2[0-3]):([0-5]\d)$/))) {
    const d = new Date(now);
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (d.getTime() <= now) d.setDate(d.getDate() + 1);
    at = d.getTime();
  }
  if (!m && (m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)$/))) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0);
    // A date that does not exist (Feb 30) rolls over in Date; refuse it rather than wake on another day.
    if (d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3])) at = d.getTime();
    else return { problem: 'there is no such date' };
  }
  if (!m) return { problem: 'say the time as 30m, 2h or 1d from now, as HH:MM, or as YYYY-MM-DD HH:MM' };
  if (!(at > now)) return { problem: 'that time has already passed' };
  if (at - now > AT_MAX_MS) return { problem: 'a wake can be set at most a year ahead' };
  return { at };
}

/* The file's name only: a task's words reach the page and other computers, a path on this one does not (#8585). */
function baseName(p) { const s = String(p || ''); const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')); return i >= 0 ? s.slice(i + 1) : s; }

/** What the task waits for, in words, from a stored wake: "PR #123 in octo/hello to merge". '' for none. */
function describe(w, now = Date.now()) {
  if (!w || typeof w !== 'object') return '';
  if (w.kind === 'pr') return 'PR #' + w.number + ' in ' + w.repo + ' to merge';
  if (w.kind === 'branch') return 'a new commit on ' + w.branch + ' in ' + w.repo;
  if (w.kind === 'file') return plain(typeof w.name === 'string' && w.name ? w.name : baseName(w.path), 120) + ' to change';
  if (w.kind === 'at') return taskrepeat.whenWords(w.at, now);
  return '';
}
/* "waits for PR #123 ... to merge" / "waits until today at 9am". */
function waitWords(w, now = Date.now()) {
  const d = describe(w, now);
  if (!d) return '';
  return (w.kind === 'at' ? 'waits until ' : 'waits for ') + d;
}

/**
 * The stored wake's own check, whole, as tasks.setWake receives it (after prepare): a sentence for what is wrong, or
 * null. The store never holds a shape the checker cannot read.
 */
function wakeProblem(w) {
  if (!w || typeof w !== 'object' || Array.isArray(w)) return 'a wake has to say what to wait for';
  if (!KINDS.includes(w.kind)) return 'a task can wake on a pull request, a branch, a file or a time';
  if (w.kind === 'pr') return repoProblem(w.repo) || (Number.isInteger(w.number) && w.number >= 1 ? null : 'a pull request number is 1 or more');
  if (w.kind === 'branch') return repoProblem(w.repo) || branchProblem(w.branch) || (typeof w.from === 'string' && SHA_RE.test(w.from) ? null : 'the branch\'s commit could not be read');
  if (w.kind === 'file') {
    if (typeof w.path !== 'string' || !(w.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(w.path)) || w.path.length > 1024 || /[\u0000-\u001f\u007f]/.test(w.path)) return 'say the file as its full path';
    if (typeof w.from !== 'string' || !(PRINT_RE.test(w.from) || /^stat:\d+:\d+(?:\.\d+)?$/.test(w.from))) return 'the file could not be fingerprinted';
    return null;
  }
  return Number.isFinite(w.at) ? null : 'say when to wake';
}

/* ---- reading GitHub and the disk ---- */

/** gh's answer, as a promise of { code, out }. `run(args, done)` is devicedoor.runBounded's shape, bound to gh. */
function ghAsk(run, args) {
  return new Promise((resolve) => {
    try { run(args, (code, out) => resolve({ code, out: String(out || '') })); } catch { resolve({ code: -1, out: '' }); }
  });
}
function ghFailure(r, what) {
  if (/HTTP 404|Not Found/i.test(r.out)) return { gone: true, problem: 'GitHub has no ' + what + ' that this computer\'s GitHub sign-in can see' };
  if (/HTTP 401|auth login|not logged|authentication/i.test(r.out)) return { problem: 'GitHub is not signed in on this computer (Connections)' };
  return { problem: 'GitHub could not be reached just now' };
}
async function readPr(run, repo, number) {
  const r = await ghAsk(run, ['api', 'repos/' + repo + '/pulls/' + number, '--jq', '[.state, (.merged|tostring)] | @tsv']);
  if (r.code !== 0) return ghFailure(r, 'pull request #' + number + ' in ' + repo);
  const [state, merged] = r.out.trim().split('\t');
  if (merged === 'true') return { state: 'merged' };
  if (state === 'closed') return { state: 'closed' };
  if (state === 'open') return { state: 'open' };
  return { problem: 'GitHub answered in a way Kosmos could not read' };
}
async function readBranch(run, repo, branch) {
  const r = await ghAsk(run, ['api', 'repos/' + repo + '/git/ref/heads/' + branch, '--jq', '.object.sha']);
  if (r.code !== 0) return ghFailure(r, 'branch ' + branch + ' in ' + repo);
  const sha = r.out.trim();
  return SHA_RE.test(sha) ? { sha } : { problem: 'GitHub answered in a way Kosmos could not read' };
}
/* A file's fingerprint, or its size and time when it is too big to hash here. { print, size, mtimeMs } or { missing }
   or { problem }. `fs` and `fileprint` are injected so tests stand on a temp folder. */
function readFile(p, deps = {}) {
  const fs = deps.fs || require('node:fs');
  const fileprint = deps.fileprint || require('./fileprint');
  let st;
  try { st = fs.statSync(p); } catch (e) { return e && e.code === 'ENOENT' ? { missing: true } : { problem: 'the file cannot be read' }; }
  if (!st.isFile()) return { problem: 'that is not a file' };
  if (st.size > FILE_HASH_MAX) return { print: 'stat:' + st.size + ':' + st.mtimeMs, size: st.size, mtimeMs: st.mtimeMs };
  const print = fileprint.plain(p);
  if (!PRINT_RE.test(print)) return { problem: 'the file cannot be read' };
  return { print, size: st.size, mtimeMs: st.mtimeMs };
}

/**
 * The wake to store, from what the caller asked for: `ask` is { pr } | { branch } | { file } | { at } (the words a
 * person writes). Reads GitHub or the disk once, so the stored wake starts from what is true now. Resolves to
 * { wake } or { problem } (a sentence for the person), never rejects. `deps`: { gh (run, or null when gh is not
 * there), now, fs, fileprint }.
 */
async function prepare(ask, deps = {}) {
  const now = Number.isFinite(deps.now) ? deps.now : Date.now();
  const keys = ['pr', 'branch', 'file', 'at'].filter((k) => ask && ask[k] !== undefined);
  if (keys.length !== 1) return { problem: 'say one thing to wake on: --pr, --branch, --file or --at' };
  const k = keys[0];
  const noGh = 'GitHub is not connected on this computer with the GitHub tool (gh), so Kosmos cannot watch a pull request or a branch. Connect it under Connections, then set the wake again';
  try {
    if (k === 'pr') {
      const t = parsePr(ask.pr);
      if (t.problem) return { problem: t.problem };
      if (!deps.gh) return { problem: noGh };
      const r = await readPr(deps.gh, t.repo, t.number);
      if (r.problem) return { problem: r.problem };
      if (r.state === 'merged') return { problem: 'that pull request is already merged' };
      if (r.state === 'closed') return { problem: 'that pull request is already closed' };
      return { wake: { kind: 'pr', repo: t.repo, number: t.number } };
    }
    if (k === 'branch') {
      const t = parseBranch(ask.branch);
      if (t.problem) return { problem: t.problem };
      if (!deps.gh) return { problem: noGh };
      const r = await readBranch(deps.gh, t.repo, t.branch);
      if (r.problem) return { problem: r.problem };
      return { wake: { kind: 'branch', repo: t.repo, branch: t.branch, from: r.sha } };
    }
    if (k === 'file') {
      const p = typeof ask.file === 'string' ? ask.file : '';
      const shape = wakeProblem({ kind: 'file', path: p, from: 'stat:0:0' });
      if (shape) return { problem: shape };
      const r = readFile(p, deps);
      if (r.missing) return { problem: 'there is no such file' };
      if (r.problem) return { problem: r.problem };
      return { wake: { kind: 'file', path: p, name: baseName(p).slice(0, 255), from: r.print, size: r.size, mtimeMs: r.mtimeMs } };
    }
    const t = parseAt(ask.at, now);
    if (t.problem) return { problem: t.problem };
    return { wake: { kind: 'at', at: t.at } };
  } catch {
    return { problem: 'Kosmos could not set that wake' };
  }
}

/**
 * Has `w` happened? Resolves to { met: true, words } | { met: false } | { met: false, problem }; never rejects.
 * `seen` (a Map, per board) remembers a file's size and time from its last fingerprint, so an unchanged file is not
 * read again every minute.
 */
async function probe(w, deps = {}, key = '', seen = new Map()) {
  const now = Number.isFinite(deps.now) ? deps.now : Date.now();
  try {
    if (w.kind === 'at') return now >= w.at ? { met: true, words: 'the time came' } : { met: false };
    if (w.kind === 'pr') {
      if (!deps.gh) return { met: false, problem: 'GitHub is not connected with the gh tool on this computer' };
      const r = await readPr(deps.gh, w.repo, w.number);
      if (r.problem) return { met: false, problem: r.problem };
      if (r.state === 'merged') return { met: true, words: 'it was merged' };
      if (r.state === 'closed') return { met: true, words: 'it was closed without being merged' };
      return { met: false };
    }
    if (w.kind === 'branch') {
      if (!deps.gh) return { met: false, problem: 'GitHub is not connected with the gh tool on this computer' };
      const r = await readBranch(deps.gh, w.repo, w.branch);
      if (r.gone) return { met: true, words: 'the branch is no longer on GitHub' };
      if (r.problem) return { met: false, problem: r.problem };
      return r.sha !== w.from ? { met: true, words: 'it has a new commit (' + r.sha.slice(0, 10) + ')' } : { met: false };
    }
    if (w.kind === 'file') {
      const fs = deps.fs || require('node:fs');
      let st;
      try { st = fs.statSync(w.path); } catch (e) {
        if (e && e.code === 'ENOENT') return { met: true, words: 'it was removed' };
        return { met: false, problem: 'the file cannot be read' };
      }
      const last = seen.get(key) || { size: w.size, mtimeMs: w.mtimeMs };
      if (st.size === last.size && st.mtimeMs === last.mtimeMs) return { met: false };
      const r = readFile(w.path, deps);
      if (r.missing) return { met: true, words: 'it was removed' };
      if (r.problem) return { met: false, problem: r.problem };
      if (r.print === w.from) { seen.set(key, { size: r.size, mtimeMs: r.mtimeMs }); return { met: false }; }   // touched, not changed
      return { met: true, words: 'it changed' };
    }
  } catch { /* below */ }
  return { met: false, problem: 'Kosmos could not check it' };
}

function liveTask(p, t, tasks, P) {
  return p && p.archived !== true && !P.isPaused(p) && t && !tasks.progressOf(t).closed;
}

/**
 * The tasks whose wake is still to be looked at: open, in a live project, set, not yet met. Pure.
 * Each is { projectId, n, setAt, wake }.
 */
function pending(projects) {
  const tasks = require('./tasks');
  const P = require('./projects');
  const out = [];
  for (const p of Array.isArray(projects) ? projects : []) {
    for (const t of Array.isArray(p && p.tasks) ? p.tasks : []) {
      if (!t || !t.wake || t.wakeMet || !liveTask(p, t, tasks, P)) continue;
      if (wakeProblem(t.wake)) continue;
      out.push({ projectId: p.id, n: t.number, setAt: t.wake.setAt || '', wake: t.wake });
    }
  }
  return out;
}

/**
 * One look. `o`: { projects, now, gh (run or null), fs, fileprint, every (ms between looks at one task; CHECK_EVERY_MS
 * unless a test speeds the tick), state (Map: key -> { at, problem }, per board),
 * seen (Map, per board), save(projectId, n, setAt, { at, words }) }. Resolves to the list of what it did; never rejects.
 * GitHub reads are capped at NET_PER_TICK a tick, the longest-unchecked first.
 */
async function checkTick(o) {
  const out = [];
  try {
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const state = o.state instanceof Map ? o.state : BOARD_STATE;
    const seen = o.seen instanceof Map ? o.seen : BOARD_SEEN;
    const items = pending(o.projects);
    const live = new Set(items.map((x) => x.projectId + '#' + x.n + '@' + x.setAt));
    for (const k of [...state.keys()]) if (!live.has(k)) state.delete(k);
    for (const k of [...seen.keys()]) if (!live.has(k)) seen.delete(k);
    const every = Number.isFinite(o.every) && o.every > 0 ? o.every : CHECK_EVERY_MS;   // a test's faster tick
    const due = items.filter((x) => { const s = state.get(x.projectId + '#' + x.n + '@' + x.setAt); return !s || now - s.at >= every; });
    const net = due.filter((x) => x.wake.kind === 'pr' || x.wake.kind === 'branch')
      .sort((a, b) => ((state.get(a.projectId + '#' + a.n + '@' + a.setAt) || { at: 0 }).at) - ((state.get(b.projectId + '#' + b.n + '@' + b.setAt) || { at: 0 }).at))
      .slice(0, NET_PER_TICK);
    const local = due.filter((x) => x.wake.kind === 'at' || x.wake.kind === 'file');
    for (const x of [...local, ...net]) {
      const key = x.projectId + '#' + x.n + '@' + x.setAt;
      const r = await probe(x.wake, { gh: o.gh || null, now, fs: o.fs, fileprint: o.fileprint }, key, seen);
      state.set(key, { at: now, problem: r.problem || null });
      if (r.met) {
        let saved = false;
        try { saved = o.save(x.projectId, x.n, x.setAt, { at: new Date(now).toISOString(), words: r.words }) === true; } catch { saved = false; }
        out.push({ ...x, act: 'met', words: r.words, saved });
      } else out.push({ ...x, act: r.problem ? 'unknown' : 'waiting', problem: r.problem || null });
    }
  } catch { /* best effort */ }
  return out;
}

/** The last check's problem for a task, from the board's memory (`state` of checkTick), or null. */
function problemFor(projectId, t, state = BOARD_STATE) {
  if (!(state instanceof Map) || !t || !t.wake) return null;
  const s = state.get(projectId + '#' + t.number + '@' + (t.wake.setAt || ''));
  return s && s.problem ? s.problem : null;
}

/**
 * The fields a screen and the CLIs show for a task's wake, one derivation for every route (like taskrepeat.fieldsOf):
 * wakeWords ("waits for PR #123 in octo/hello to merge"), and once it happened wakeMetWords ("PR #123 in octo/hello: it
 * was merged") with wakeMetAt and wakeToldAt. {} for a task with none.
 */
function fieldsOf(t, now = Date.now(), problem = null) {
  // Not wakeProblem: a row with this computer's paths left out (#8585) has a file wake with no path, and still says it.
  if (!t || !t.wake || typeof t.wake !== 'object' || !KINDS.includes(t.wake.kind) || !describe(t.wake, now)) return {};
  const out = {};
  if (t.wakeMet && typeof t.wakeMet === 'object') {
    out.wakeMetWords = (t.wake.kind === 'at' ? 'the wake time came' : describe(t.wake, now).replace(/ to (merge|change)$/, '') + ': ' + plain(t.wakeMet.words, 120));
    out.wakeMetAt = t.wakeMet.at || null;
    out.wakeToldAt = t.wakeToldAt || null;
    if (t.wakeTold && typeof t.wakeTold === 'object') { out.wakeToldWho = t.wakeTold.who || null; out.wakeReached = t.wakeTold.reached === true; }
  } else {
    out.wakeWords = waitWords(t.wake, now);
    if (problem) out.wakeProblem = plain(problem, 200);
  }
  return out;
}

/* ---- telling the holder ---- */

/** The tasks whose wake happened and whose holder is still to be told. Pure. */
function owed(projects) {
  const tasks = require('./tasks');
  const P = require('./projects');
  const out = [];
  for (const p of Array.isArray(projects) ? projects : []) {
    for (const t of Array.isArray(p && p.tasks) ? p.tasks : []) {
      if (!t || !t.wake || !t.wakeMet || t.wakeToldAt || !liveTask(p, t, tasks, P) || tasks.isOnHold(t)) continue;
      if (wakeProblem(t.wake)) continue;
      const everyHolder = [...new Set(tasks.partsOf(t).filter((x) => x && x.who && !x.closedAt).map((x) => x.who))]
        .filter((who) => !P.isSwarmOff(p, who));
      if (!everyHolder.length) continue;
      // The agent that set the wake is asked first: it is the one waiting for the event.
      const holders = t.wake.setBy && everyHolder.includes(t.wake.setBy) ? [t.wake.setBy, ...everyHolder.filter((h) => h !== t.wake.setBy)] : everyHolder;
      out.push({
        projectId: p.id, project: typeof p.name === 'string' && p.name ? p.name : p.id, n: t.number, sentence: t.sentence || '',
        setAt: t.wake.setAt || '', wake: t.wake, met: t.wakeMet, holders, members: Array.isArray(p.agents) ? p.agents.slice() : [],
      });
    }
  }
  return out;
}

function tellText(item) {
  const id = /^[A-Za-z0-9._-]{1,80}$/.test(item.projectId) && /[^.]/.test(item.projectId) ? item.projectId : '<project-id>';
  const what = item.wake.kind === 'at' ? 'was set to wake you ' + describe(item.wake, Date.parse(item.setAt) || Date.now()) : 'was waiting for ' + describe(item.wake);
  return 'Kosmos: your task #' + item.n + ' in ' + plain(item.project, 80) + ', "' + plain(item.sentence, 160) + '", ' + what
    + (item.wake.kind === 'at' ? ', and that time has come.' : ', and ' + plain(item.met && item.met.words, 120) + '.')
    + ' Pick it up now. Kosmos tells you this once; to wait for something else, set a new wake with kosmos task wake ' + id + ' ' + item.n + '.';
}

/* Store that the holder was told (or could not be), and record it in the task's history. Only for the wake it was
   about: a wake set again since is left alone. */
function markTold(item, who, outcome, now = Date.now()) {
  const projects = require('./projects');
  const taskchat = require('./taskchat');
  let wrote = false;
  projects.mutate(item.projectId, (p) => ({
    ...p,
    tasks: (p.tasks || []).map((x) => {
      if (!x || x.number !== item.n || !x.wake || (x.wake.setAt || '') !== item.setAt || x.wakeToldAt) return x;
      wrote = true;
      return { ...x, wakeToldAt: new Date(now).toISOString(), wakeTold: { who, reached: outcome === 'reached' } };
    }),
  }));
  if (wrote) taskchat.record(item.projectId, item.n, { kind: 'wake-told', told: who, reached: outcome === 'reached' });
}

/**
 * One telling pass, repeatdue.sweep's delivery loop gate for gate (copied, as repeatdue copies missedtell's, because
 * each loop's tuning belongs to its own case). `o`: { projects, roster, now, allowed, limit, sent, book, idleSeen,
 * idleSince, deliver, DELIVERY, log, mark, items, recentTyped }. Never throws.
 */
function sweep(o) {
  const results = [];
  try {
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const mark = typeof o.mark === 'function' ? o.mark : markTold;
    const book = o.book instanceof Map ? o.book : new Map();
    const sent = Array.isArray(o.sent) ? o.sent : [];
    while (sent.length && now - sent[0] >= HOUR_MS) sent.shift();
    const cap = o.limit && o.limit.on === true && Number.isInteger(o.limit.perHour) ? o.limit.perHour : Infinity;
    const cards = new Map((Array.isArray(o.roster) ? o.roster : []).filter((a) => a && a.sessionName).map((a) => [a.sessionName, a]));
    const seen = o.idleSeen instanceof Map ? o.idleSeen : new Map();
    const nudgeable = require('./agentnudge').nudgeableCard;
    for (const [sn, c] of cards) {
      if (!nudgeable(c)) { seen.delete(sn); continue; }
      const e = seen.get(sn);
      seen.set(sn, e && now - e.at <= SEEN_GAP_MS ? { since: e.since, at: now } : { since: now, at: now });
    }
    const items = Array.isArray(o.items) ? o.items : owed(o.projects);
    const live = new Set(items.map((x) => x.projectId + '#' + x.n + '@' + x.setAt));
    for (const k of [...book.keys()]) if (!live.has(k)) book.delete(k);
    const typedTo = new Set();
    const recent = o.recentTyped instanceof Map ? o.recentTyped : new Map();
    const say = (r) => { if (typeof o.log === 'function') { try { o.log(r); } catch { /* never breaks a pass */ } } };
    for (const item of items) {
      try {
        const key = item.projectId + '#' + item.n + '@' + item.setAt;
        if (book.get(key) === 'told') { results.push({ ...item, act: 'held', because: 'already told; its mark could not be saved' }); continue; }
        const onProject = item.holders.filter((h) => item.members.includes(h));
        if (!onProject.length) { book.set(key, 'told'); mark(item, item.holders[0], 'unreachable', now); results.push({ ...item, act: 'unreachable', because: 'no holder is on the project' }); continue; }
        if (o.allowed !== true) { results.push({ ...item, act: 'held', because: 'Kosmos does not type into agents yet' }); continue; }
        let picked = null;
        let because = 'no holder is running';
        for (const h of onProject) {
          const card = cards.get(h);
          if (!card) continue;
          if (!nudgeable(card)) { because = 'the holder is not idle, or cannot be typed into'; continue; }
          if (typedTo.has(h) || now - (Number(recent.get(h)) || -Infinity) < MINUTE_MS) { because = 'one line to an agent per minute'; continue; }
          let since = null;
          if (typeof o.idleSince === 'function') { try { since = o.idleSince(h); } catch { since = null; } }
          if (!Number.isFinite(since)) { const idle = seen.get(h); since = idle ? idle.since : null; }
          if (!Number.isFinite(since) || now - since < SETTLED_MS) { because = 'the holder has only just gone idle'; continue; }
          picked = h; break;
        }
        if (!picked) { results.push({ ...item, act: 'held', because }); continue; }
        if (sent.length >= cap) { results.push({ ...item, act: 'held', because: 'Agent Communication\'s limit of ' + cap + ' an hour is reached' }); continue; }
        typedTo.add(picked);
        recent.set(picked, now);
        seen.delete(picked);
        let state = null;
        let wait = false;
        try { const r = o.deliver(picked, tellText(item), o.roster); state = r && r.state; wait = Boolean(r && (r.held === true || r.busy === true)); }
        catch { state = (o.DELIVERY && o.DELIVERY.UNCONFIRMED) || 'unconfirmed'; }
        if (wait) { results.push({ ...item, act: 'held', because: 'the holder cannot take a line just now', delivery: state }); continue; }
        const D = o.DELIVERY || {};
        const reached = (D.PLACED != null && state === D.PLACED) || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
        const tries = (Number(book.get(key)) || 0) + 1;
        if (reached) { sent.push(now); book.set(key, 'told'); mark(item, picked, 'reached', now); }
        else if (tries >= MAX_TRIES) { book.set(key, 'told'); mark(item, picked, 'not reached', now); }
        else book.set(key, tries);
        results.push({ ...item, act: 'tell', to: picked, reached, delivery: state, tries });
        say({ holder: picked, task: item.n, project: item.projectId, reached, delivery: state, tries });
      } catch (err) {
        results.push({ ...item, act: 'error', because: String((err && err.message) || err) });
      }
    }
  } catch { /* never throws: a pass is best-effort */ }
  return { results };
}

module.exports = {
  KINDS, CHECK_EVERY_MS, NET_PER_TICK, FILE_HASH_MAX, GH_TIMEOUT_MS, MAX_TRIES,
  parsePr, parseBranch, parseAt, repoProblem, branchProblem, wakeProblem, describe, waitWords,
  prepare, probe, pending, checkTick, problemFor, fieldsOf, owed, tellText, markTold, sweep,
};

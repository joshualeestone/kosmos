'use strict';

/**
 * kosmos#6309: this month's tokens on this Kosmos, for a family policy's usage cap (engine/orgpolicy.js capAt).
 *
 * Counted the way the swarm limit counts (engine/swarm.js readFile: each message once, by its id, the four usage
 * counts summed), over EVERY Claude Code transcript in this Kosmos's config folders (status.configRoots): each
 * session file and its helpers' files, touched since the month began. Every agent counts, so a child cannot step
 * round the cap by making a new agent.
 *
 * Known limits, said on the card:
 * - Claude Code transcripts only. A Codex, Gemini or other agent's tokens are not counted yet.
 * - Everything in those folders counts, not only agents Kosmos made: on a child's computer that is the child's use.
 *
 * The count has its own cache (readFile's `cache`), never the swarm's: the swarm counts from local midnight and this
 * from the month's start, and one cache entry per file resets whenever `since` changes. Reads are bounded per call
 * (READ_PER_CALL_BYTES), so a first count catches up over a few calls; `complete` says whether it has. Never throws.
 *
 * The gate (capAllows) never counts. It runs on the message path, and counting a heavy month is slow: measured on a
 * Mac holding 8,313 transcripts touched this month (2.5 GB), a bounded count took over 3.7 s a call and had not
 * caught up after 31 minutes. So a worker thread (usagecap-worker.js) counts, and the gate reads its latest count with
 * the month's saved one. The rollup reads the same way (capReport): on the enrolled board its tick runs in the board's
 * own process, so it must not count either.
 */

const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const swarm = require('./swarm');
const orgpolicy = require('./orgpolicy');
const store = require('./store');

const cache = new Map();
cache.sharedSeen = new Set();   // each message once across every file of the month (swarm.readFile reads it)
let cacheSince = null;   // the month start `cache` was counted from
let perCallBytes = swarm.READ_PER_CALL_BYTES;   // resetForTests can lower it

/* The month's start in the cap's zone. A zone this runtime cannot read counts from 14 hours before the UTC month
   began (the earliest any zone's month starts), so it never counts less than the month: closed, not open. */
function sinceFor(tz, now) {
  try { return orgpolicy.monthStart(now, tz); } catch {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 14 * 60 * 60 * 1000;
  }
}

function roots() {
  try { return require('./status').configRoots(); } catch { return []; }
}

/** { tokens, complete, since } for this month in `tz`. `rootsList` is for tests. */
function monthTokens(tz, now = Date.now(), rootsList = roots(), bytes = perCallBytes) {
  const since = sinceFor(tz, now);
  /* A month start that moved (a new month, or the cap's zone changed) reads every file again from the start: swarm's
     readFile keeps its read position when `since` moves later, which is right for a new day and wrong here, where the
     lines before that position may fall inside the new month. */
  if (cacheSince !== since) { cache.clear(); cache.sharedSeen = new Set(); cacheSince = since; }
  const out = { tokens: 0, complete: true, since };
  const budget = { left: bytes };
  const add = (file) => {
    let st;
    try { st = fs.statSync(file); } catch { return false; }
    if (st.mtimeMs < since) return false;
    const r = swarm.readFile(file, since, now, budget, cache);
    out.tokens += r.tokens;
    if (!r.caughtUp) out.complete = false;
    return true;
  };
  for (const root of rootsList) {
    const projects = path.join(root, 'projects');
    let dirs;
    try { dirs = fs.readdirSync(projects); } catch { continue; }
    for (const d of dirs) {
      const dir = path.join(projects, d);
      let names;
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const n of names) {
        if (!n.endsWith('.jsonl')) continue;
        const touched = add(path.join(dir, n));
        /* A session not written this month launched no helper this month (launching one writes the session's file),
           so its helpers' folder is not listed: most sessions on a long-used computer are old. */
        if (!touched) continue;
        let subs;
        const subDir = path.join(dir, n.slice(0, -'.jsonl'.length), 'subagents');
        try { subs = fs.readdirSync(subDir); } catch { subs = []; }
        for (const s of subs) if (s.endsWith('.jsonl')) add(path.join(subDir, s));
      }
    }
  }
  return out;
}

/* The month's highest count, kept on disk. Tokens used this month cannot be un-used, so the count in force is never
   below it: not while a restarted board counts the month again from the start (a bounded amount per call), and not
   after a transcript is deleted or moved. A count saved under another zone (the cap's zone changed) holds the cap up
   only while the new zone's count catches up; a full count in the new zone then replaces it, since the two months
   start hours apart. usagecap-6309.test.js pins each of these. */
const FLOOR = () => path.join(store.ROOT, 'usage-cap-month.json');
/* The same month in another zone starts at most 26 hours away (UTC-12 to UTC+14), so a saved count whose start is
   within FLOOR_SAME_MONTH_MS is this month's. { used, sameZone }: sameZone when it was counted from this very start. */
const FLOOR_SAME_MONTH_MS = 26 * 60 * 60 * 1000;
function readFloor(since) {
  try {
    const j = JSON.parse(fs.readFileSync(FLOOR(), 'utf8'));
    const ok = j && Number.isFinite(j.since) && Math.abs(j.since - since) <= FLOOR_SAME_MONTH_MS && Number.isSafeInteger(j.used) && j.used > 0;
    return ok ? { used: j.used, sameZone: j.since === since } : { used: 0, sameZone: false };
  } catch { return { used: 0, sameZone: false }; }
}
/* Best effort, like the rest of this file: a folder that cannot be written loses the floor, not the gate. */
function writeFloor(since, used) {
  try { const j = JSON.parse(fs.readFileSync(FLOOR(), 'utf8')); if (j && j.since === since && j.used === used) return; } catch { /* write it */ }
  const tmp = FLOOR() + '.' + process.pid + '.tmp';
  try {
    fs.mkdirSync(path.dirname(FLOOR()), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ since, used }) + '\n');
    fs.renameSync(tmp, FLOOR());
  } catch { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to remove */ } }
}

/** What `policy` says now: orgpolicy.capAt with this month's count, plus `complete` (the count has caught up) and
 *  `known` (caught up, or held up by a saved count of this month). { capped: false } with no cap. */
function capNow(policy, now = Date.now(), rootsList, bytes = perCallBytes) {
  const u = policy && policy.usage_cap;
  if (!orgpolicy.capShapeOk(u)) return { capped: false };
  return withFloor(policy, monthTokens(u.tz, now, rootsList || roots(), bytes));
}
/* capAt for a count `m` ({ tokens, complete, since }) held up by the month's saved count, saving it when complete. */
function withFloor(policy, m) {
  const floor = readFloor(m.since);
  const used = m.complete && !floor.sameZone ? m.tokens : Math.max(m.tokens, floor.used);
  if (m.complete) writeFloor(m.since, used);
  /* `month` ('YYYY-MM') names the month counted, so a count carried forward after the board stops reporting is never
     read as this month's. The 1st's local midnight falls within 14 hours of the UTC 1st, so two days on is that month. */
  const month = new Date(m.since + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 7);
  return { ...orgpolicy.capAt(policy, used), complete: m.complete, known: m.complete || floor.used > 0, month };
}

/* Mode 'sync' only (tests): the inline count is kept for MEMO_MS, or MEMO_SHORT_MS while catching up or past the
   heads-up, and recounted when the policy's cap changes. */
const MEMO_MS = 60 * 1000;
const MEMO_SHORT_MS = 5 * 1000;
let memo = null;

/* The counter. 'worker' (the board): a worker thread counts and posts each count here. 'sync' (resetForTests): the
   gate counts inline, a bounded amount per call, so a test reads a count the moment it asks. */
const WORKER_RETRY_MS = 60 * 1000;
let mode = 'worker';   // also in the worker thread, which calls only monthTokens: nothing there may start a worker
let worker = null;
let workerTz = null;
let workerFailedAt = -Infinity;
let latest = null;   // the worker's last count: { tz, since, tokens, complete }
function ensureWorker(tz) {
  if (!worker) {
    if (Date.now() - workerFailedAt < WORKER_RETRY_MS) return;
    try {
      const w = new Worker(path.join(__dirname, 'usagecap-worker.js'));
      w.unref();   // never what keeps the board running
      w.on('message', (r) => {
        if (r && typeof r.tz === 'string' && Number.isFinite(r.since) && Number.isSafeInteger(r.tokens) && r.tokens >= 0 && typeof r.complete === 'boolean') latest = r;
      });
      const gone = () => { if (worker === w) { worker = null; workerTz = null; workerFailedAt = Date.now(); } };
      w.on('error', gone);
      w.on('exit', gone);
      worker = w;
    } catch { workerFailedAt = Date.now(); return; }
  }
  if (workerTz !== tz) { workerTz = tz; try { worker.postMessage({ tz }); } catch { /* the exit handler resets it */ } }
}

function stopWorker() {
  latest = null;
  if (!worker) return;
  const w = worker;
  worker = null; workerTz = null;
  try { w.terminate(); } catch { /* already gone */ }
}
/* `policy`'s cap with the worker's latest count and the month's saved one. No cap stops the worker: a cap taken out,
   or a family left, leaves nothing counting. */
function fromWorker(policy, now) {
  const u = policy && policy.usage_cap;
  if (!orgpolicy.capShapeOk(u)) { stopWorker(); return { capped: false }; }
  ensureWorker(u.tz);
  const since = sinceFor(u.tz, now);
  const m = latest && latest.tz === u.tz && latest.since === since ? latest : { tokens: 0, complete: false, since };
  return withFloor(policy, m);
}

/** What the rollup reports for `policy`: capNow's shape, from the worker on the board (never an inline count). */
function capReport(policy, now = Date.now()) {
  return mode === 'worker' ? fromWorker(policy, now) : capNow(policy, now);
}

/** The policy in force (orgpolicy.currentStrict) with this month's count: { capped: false } or capNow's answer.
 *  Throws when the policy record is damaged, as currentStrict does; the gate decides what a fault means. */
function capInForce(now = Date.now()) {
  const policy = orgpolicy.currentStrict();
  if (mode === 'worker') return fromWorker(policy, now);
  const key = JSON.stringify((policy && policy.usage_cap) || null);
  if (memo && memo.key === key && now - memo.at >= 0 && now - memo.at < memo.ms) return memo.value;
  const value = capNow(policy, now);
  memo = { key, at: now, value, ms: value.complete === false || value.warn === true ? MEMO_SHORT_MS : MEMO_MS };
  return value;
}

/** kosmos#6309: { ok: true } | { ok: false, because } for giving an agent a new message now. Throws on a damaged
 *  policy record (the caller's catch decides), like orgpolicy.quietAllows. */
function capAllows(now = Date.now()) {
  const c = capInForce(now);
  if (!c.capped || !c.over) return { ok: true };
  return { ok: false, because: orgpolicy.capSentence(c) };
}

/** `keepFloor` keeps the month's saved count, as a board restart does. `worker` keeps the board's worker counter;
 *  without it the gate counts inline (mode 'sync'). */
function resetForTests({ perCallBytes: n, keepFloor = false, worker: useWorker = false } = {}) {
  cache.clear(); cache.sharedSeen = new Set(); cacheSince = null; memo = null; workerFailedAt = -Infinity;
  stopWorker();
  mode = useWorker ? 'worker' : 'sync';
  if (!keepFloor) { try { fs.rmSync(FLOOR(), { force: true }); } catch { /* none */ } }
  perCallBytes = n > 0 ? n : swarm.READ_PER_CALL_BYTES;
}

/** For tests: the worker's last count, or null. */
function latestForTests() { return latest; }

module.exports = { monthTokens, capNow, capReport, capInForce, capAllows, resetForTests, latestForTests, MEMO_MS, MEMO_SHORT_MS };

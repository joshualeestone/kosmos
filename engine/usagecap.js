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
 */

const fs = require('node:fs');
const path = require('node:path');
const swarm = require('./swarm');
const orgpolicy = require('./orgpolicy');
const store = require('./store');

const cache = new Map();
let perCallBytes = swarm.READ_PER_CALL_BYTES;   // resetForTests can lower it
/* The gate counts on the message path, so each of its calls reads at most this much (the rollup's tick reads the full
   per-call budget, off that path). A board catching up takes longer; the month's saved count holds the cap up meanwhile. */
const GATE_PER_CALL_BYTES = 8 * 1024 * 1024;

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
  const out = { tokens: 0, complete: true, since };
  const budget = { left: bytes };
  const add = (file) => {
    let st;
    try { st = fs.statSync(file); } catch { return; }
    if (st.mtimeMs < since) return;
    const r = swarm.readFile(file, since, now, budget, cache);
    out.tokens += r.tokens;
    if (!r.caughtUp) out.complete = false;
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
        add(path.join(dir, n));
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
  const m = monthTokens(u.tz, now, rootsList || roots(), bytes);
  const floor = readFloor(m.since);
  const used = m.complete && !floor.sameZone ? m.tokens : Math.max(m.tokens, floor.used);
  if (m.complete) writeFloor(m.since, used);
  return { ...orgpolicy.capAt(policy, used), complete: m.complete, known: m.complete || floor.used > 0 };
}

/* Every message to every agent asks, so the count is kept for MEMO_MS (the cap is monthly: a minute late is nothing)
   and recounted when the policy's cap changes. A count still catching up, or past the heads-up, is kept for
   MEMO_SHORT_MS only: the catch-up moves on without every message paying for a bounded read, and near the cap a
   message cannot slip past it for a whole minute. */
const MEMO_MS = 60 * 1000;
const MEMO_SHORT_MS = 5 * 1000;
let memo = null;

/** The policy in force (orgpolicy.currentStrict) with this month's count: { capped: false } or capNow's answer.
 *  Throws when the policy record is damaged, as currentStrict does; the gate decides what a fault means. */
function capInForce(now = Date.now()) {
  const policy = orgpolicy.currentStrict();
  const key = JSON.stringify((policy && policy.usage_cap) || null);
  if (memo && memo.key === key && now - memo.at >= 0 && now - memo.at < memo.ms) return memo.value;
  const value = capNow(policy, now, undefined, Math.min(perCallBytes, GATE_PER_CALL_BYTES));
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

/** `keepFloor` keeps the month's saved count, as a board restart does. */
function resetForTests({ perCallBytes: n, keepFloor = false } = {}) {
  cache.clear(); memo = null;
  if (!keepFloor) { try { fs.rmSync(FLOOR(), { force: true }); } catch { /* none */ } }
  perCallBytes = n > 0 ? n : swarm.READ_PER_CALL_BYTES;
}

module.exports = { monthTokens, capNow, capInForce, capAllows, resetForTests, MEMO_MS, MEMO_SHORT_MS, GATE_PER_CALL_BYTES, FLOOR };

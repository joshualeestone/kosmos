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

const cache = new Map();

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
function monthTokens(tz, now = Date.now(), rootsList = roots()) {
  const since = sinceFor(tz, now);
  const out = { tokens: 0, complete: true, since };
  const budget = { left: swarm.READ_PER_CALL_BYTES };
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

/** What `policy` says now: orgpolicy.capAt with this month's count, plus `complete`. { capped: false } with no cap. */
function capNow(policy, now = Date.now(), rootsList) {
  const u = policy && policy.usage_cap;
  if (!orgpolicy.capShapeOk(u)) return { capped: false };
  const m = rootsList ? monthTokens(u.tz, now, rootsList) : monthTokens(u.tz, now);
  return { ...orgpolicy.capAt(policy, m.tokens), complete: m.complete };
}

/* Every message to every agent asks, so the count is kept for MEMO_MS (the cap is monthly: a minute late is nothing)
   and recounted when the policy's cap changes. */
const MEMO_MS = 60 * 1000;
let memo = null;

/** The policy in force (orgpolicy.currentStrict) with this month's count: { capped: false } or capNow's answer.
 *  Throws when the policy record is damaged, as currentStrict does; the gate decides what a fault means. */
function capInForce(now = Date.now()) {
  const policy = orgpolicy.currentStrict();
  const key = JSON.stringify((policy && policy.usage_cap) || null);
  if (memo && memo.key === key && now - memo.at >= 0 && now - memo.at < MEMO_MS) return memo.value;
  const value = capNow(policy, now);
  memo = { key, at: now, value };
  return value;
}

/** kosmos#6309: { ok: true } | { ok: false, because } for giving an agent a new message now. Throws on a damaged
 *  policy record (the caller's catch decides), like orgpolicy.quietAllows. */
function capAllows(now = Date.now()) {
  const c = capInForce(now);
  if (!c.capped || !c.over) return { ok: true };
  return orgpolicy.capAllows({ usage_cap: { monthly_tokens: c.cap, warn_pct: 1, tz: c.tz } }, c.used);
}

function resetForTests() { cache.clear(); memo = null; }

module.exports = { monthTokens, capNow, capInForce, capAllows, resetForTests, MEMO_MS };

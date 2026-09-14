'use strict';
/**
 * The cross-machine last mile for a Windows WORKER agent (#2042, S1).
 *
 * 🛑 WHAT WAS MISSING, EXACTLY. A Windows worker agent is already reachable on
 * this box: it runs as a streaming child whose stdin the supervisor holds, and
 * `win32channel.say(name, text)` types one message at it (measured end to end --
 * an agent replied PONG). What has no Windows implementation is the step BEFORE
 * that: another machine addresses the worker over Slack (the fleet's working
 * cross-machine transport), and nothing on this box turns that received envelope
 * into a `say()`. `~/.local/bin/kosmos-inbox.ps1` only PRINTED such envelopes.
 *
 * 🔑 THIS MODULE IS THE DELIVERY BRAIN; THE ps1 IS ITS I/O. The ps1 fetches Slack
 * and owns the cursor file; everything that must be reasoned about correctly --
 * which envelope is addressed to a live local worker, what a delivery verdict means
 * for the cursor -- lives here, in plain JS, behind seams a test drives without
 * touching a real agent, pipe, board, or the Slack network. The ps1 hands `run`
 * the raw messages on stdin and writes back the single cursor it returns.
 *
 *      ps1  --(json: {messages:[{ts,text}]})-->  win32inbox.run
 *      ps1  <--(json: {advanceTo, results[]})--  win32inbox.run  --> win32channel.say
 *
 * ⚠️ THE VERDICT CONTRACT IS chat.js's, NOT A SECOND ONE. `verdictToDisposition`
 * mirrors `chat.js deliverThroughChannel` exactly (placed / unconfirmed /
 * could_not), because that is the one reading of a `win32channel.say` verdict this
 * codebase has, and two readings of one verdict is the drift this repo keeps
 * paying for (CLAUDE.md convention 5).
 *
 * ⚠️ NO SPOOL: AN UN-ADVANCED CURSOR IS THE RETRY. A `could_not` (the supervisor
 * is down, ENOENT on the pipe) STOPS the poll with the cursor left before that
 * message, so the next poll re-reads and retries it in order. A message queued for
 * a supervisor that may never return is a message the sender was falsely told
 * arrived -- the same stance `win32channel` takes about its own missing pipe.
 *
 * ⚠️ OWNED-BUT-DOWN IS BLOCKED, NOT DROPPED (round 2, FIX 2). A message to a
 * worker this box OWNS (win32sessions) and has NOT removed, that is momentarily
 * absent from `claude agents --json` (crashed / restarting -- the norm on a box
 * that BSODs), is treated like `could_not`: the cursor is NOT advanced, so the
 * next poll retries once the supervised worker restarts. Only a name this box does
 * not own, or has removed, is `not_local` (advanced past). Prefer BLOCK-and-recover
 * over LOSE. Residual: a permanently-broken owned-not-removed worker head-of-line
 * blocks the queue -- the same bounded cost `could_not` already carries.
 *
 * 🔑 ROUTED BY `to:` ALONE, NEVER SUPPRESSED BY `from:` (round 2, FIX 3). The
 * poller only ever READS Slack and WRITES to an agent's stdin; it never posts to
 * Slack, and no Kosmos agent posts an envelope to Slack under its own name (the app
 * has no Slack sender at all). So there is no delivery loop to guard against, and a
 * `from:`-based skip could only DROP legitimate inbound from a remote agent whose
 * name happens to collide with a local worker's. Delivery is decided purely by
 * `to:`; `from:` is informational.
 */

const win32live = require('./win32live');

/* The three delivery verdicts, one word each, the SAME strings chat.js's DELIVERY
   uses so a reader who knows one knows the other. The rest are this module's own
   dispositions for the steps around a delivery: `owned_down` (ours but not live
   right now -- block and retry), `not_local` (not ours, or removed -- advance
   past), and `roster_unreadable` (could not see the machine at all -- advance
   nothing). */
const DISPOSITION = {
  PLACED: 'placed',
  UNCONFIRMED: 'unconfirmed',
  COULD_NOT: 'could_not',
  OWNED_DOWN: 'owned_down',
  NOT_LOCAL: 'not_local',
  ROSTER_UNREADABLE: 'roster_unreadable',
};

/**
 * W1 (parse). Pull the envelope's `from` and `to:` names out of the message text,
 * using the SAME grammar the pull-only kosmos-inbox.ps1 used before it grew:
 * multiline `^from:` / `^to:` lines, a `to:` that may list several agents comma-
 * separated, each name trimmed with a trailing ` (...)` annotation stripped. One
 * grammar, now covered by tests -- including the malformed case (no `to:` line at
 * all yields an empty `toNames`, so nothing is ever delivered off it).
 *
 * @param {string} text
 * @returns {{ from: (string|null), toNames: string[] }}
 */
function parseEnvelope(text) {
  const s = typeof text === 'string' ? text : '';
  const normalize = (raw) => String(raw).trim().replace(/\s*\(.*$/, '').trim();

  let from = null;
  const fromMatch = s.match(/(?:^|\r?\n)from:\s*(.+?)\s*(?:\r?\n|$)/i);
  if (fromMatch) from = normalize(fromMatch[1]);

  const toNames = [];
  for (const line of s.matchAll(/(?:^|\r?\n)to:\s*(.+?)\s*(?:\r?\n|$)/gi)) {
    for (const part of line[1].split(',')) {
      const n = normalize(part);
      if (n) toNames.push(n);
    }
  }
  return { from, toNames };
}

/**
 * W2 (resolve). Map the envelope's `to:` names to a LIVE local worker name, or
 * null when none of them is one. The gate is exactly `win32live.byName`'s key set
 * -- the ONE ownership join `win32roster`/`win32live`/`win32stop` already share --
 * so a name resolves here iff the board would show it as a live Kosmos agent on
 * this box. The FIRST matching `to:` name wins, so a multi-recipient envelope that
 * names this box's worker plus others is delivered to ours and left for the others.
 *
 * A name that is not in `liveNames` -- a remote agent, or a local one that is not
 * running -- returns null on purpose. The caller then asks `ownedWorkerNames`
 * whether it is one of ours that is merely down (block + retry) versus genuinely
 * not ours (advance past). `could_not` is a THIRD case: a name that DID resolve
 * live but whose pipe was down at send time.
 *
 * @param {string[]} toNames
 * @param {Iterable<string>} names the candidate name set (live, or owned).
 * @returns {string|null}
 */
function resolveTarget(toNames, names) {
  const set = names instanceof Set ? names : new Set(names || []);
  for (const n of (Array.isArray(toNames) ? toNames : [])) {
    if (set.has(n)) return n;
  }
  return null;
}

/**
 * Order two Slack `ts` values EXACTLY (NIT 3). A `ts` is "<seconds>.<microseconds>",
 * and parsing it as a float64 (`Number(ts)`) loses precision at that magnitude --
 * two near-simultaneous ts (e.g. `...9068191` and `...9068192`) compare EQUAL as
 * floats, so a float sort could tie and reorder them. A tie is a real hazard here:
 * the cursor advances by ts and Slack's `oldest=` is exclusive, so a reorder that
 * left the cursor between two same-valued ts could re-fetch and re-deliver one. This
 * compares the integer seconds, then the microseconds as fixed-width digit strings
 * (padded so a shorter fraction cannot sort above a longer one), which is exact and
 * deterministic. The ps1's Sort-Object uses the SAME split-and-compare, so both
 * sides agree byte-for-byte (convention 5).
 */
function compareTs(a, b) {
  const split = (t) => {
    const s = String(t == null ? '' : t);
    const dot = s.indexOf('.');
    return dot === -1 ? [s, ''] : [s.slice(0, dot), s.slice(dot + 1)];
  };
  const [as, af] = split(a);
  const [bs, bf] = split(b);
  const asN = Number(as) || 0;
  const bsN = Number(bs) || 0;
  if (asN !== bsN) return asN - bsN;
  const width = Math.max(af.length, bf.length);
  const afp = af.padEnd(width, '0');
  const bfp = bf.padEnd(width, '0');
  // Fixed-width digit strings: lexicographic order equals numeric order, with no
  // float rounding. (Also avoids overflowing a 53-bit int on a long fraction.)
  if (afp < bfp) return -1;
  if (afp > bfp) return 1;
  return 0;
}

/**
 * The names of workers this box OWNS and has NOT removed (round 2, FIX 2). This is
 * the set that separates "our worker, currently down" from "not ours": a message to
 * an owned-not-removed worker that is absent from `claude agents --json` must be
 * BLOCKED (cursor unmoved, retried) rather than advanced past and lost, because a
 * supervised worker restarts -- especially on this box, which BSODs.
 *
 * The owned set is the `name` field of every `win32sessions` row (the ownership
 * record persists across a session's death by design), MINUS any name currently on
 * the removed list (`remove.isRemoved`, which normalizes with `create.cleanName`).
 * Names are flattened with `win32roster.flat`, the SAME derivation `win32live` uses
 * for its keys, so the owned set and the live set are comparable name-for-name.
 *
 * ⚠️ FAIL-SAFE EMPTY, matching win32sessions' own doctrine: an unreadable record
 * yields `{}`, so the owned set is empty and the affected message falls through to
 * `not_local`. That is the one residual where an owned-but-down worker's message
 * could still be advanced past -- only if the record read itself faults during that
 * exact poll -- and it is the same fail-closed direction the rest of the win32
 * family takes rather than blocking every not-live message on a transient glitch.
 *
 * @param {object} [opts]
 * @param {{read:()=>object}} [opts.record] the ownership record (default win32sessions).
 * @param {(name:string)=>boolean} [opts.isRemoved] the removed-list predicate
 *   (default remove.isRemoved), injectable so a test never reads the real store.
 * @returns {Set<string>}
 */
function ownedWorkerNames(opts) {
  const o = opts || {};
  const record = o.record || require('./win32sessions');
  const validName = require('./win32sessions').validName;
  const flat = require('./win32roster').flat;
  const isRemoved = typeof o.isRemoved === 'function' ? o.isRemoved : require('./remove').isRemoved;

  const out = new Set();
  let rows = {};
  try { rows = record.read() || {}; } catch { rows = {}; }
  for (const sid of Object.keys(rows)) {
    // NIT 2 (convention 5): the recorded name alone, with NO live-name fallback --
    // win32sessions.record() rejects a row without a valid name (validName at write
    // time), so `rec.name` is always present for a real row. win32live falls back to
    // the live `a.name` because it joins against `claude agents --json`; here the set
    // is exactly the DOWN case where there is no live entry to fall back to, so the
    // recorded name is both the only source and the guaranteed one.
    const raw = rows[sid] && rows[sid].name;
    const name = flat(raw || '');
    if (!validName(name)) continue;
    let removed = false;
    try { removed = Boolean(isRemoved(name)); } catch { removed = false; }
    if (!removed) out.add(name);
  }
  return out;
}

/**
 * W4 (verdict -> cursor). Turn a `win32channel.say` verdict into a disposition and
 * the one thing the cursor cares about: may we advance past this message?
 *
 * ⚠️ THIS IS chat.js deliverThroughChannel's THREE-WAY READING, VERBATIM:
 *   ok === true      -> placed        the supervisor wrote it to the agent's stdin
 *   unsure === true  -> unconfirmed   it MAY have arrived; only the answer was lost
 *   anything else    -> could_not     nothing was typed, so re-sending is safe
 *
 * `placed` and `unconfirmed` both advance (advancing on unconfirmed is the choice
 * that avoids a duplicate send of a message that may already be in the agent's
 * conversation; W4 logs it instead). `could_not` does NOT advance -- that is the
 * retry.
 *
 * @param {{ok?:boolean, unsure?:boolean, because?:string}} verdict
 * @returns {{ kind:string, advance:boolean, log:boolean, because:(string|null) }}
 */
function verdictToDisposition(verdict) {
  const v = verdict || {};
  if (v.ok === true) return { kind: DISPOSITION.PLACED, advance: true, log: false, because: null };
  if (v.unsure === true) {
    return { kind: DISPOSITION.UNCONFIRMED, advance: true, log: true, because: v.because || 'we cannot tell whether it arrived' };
  }
  return { kind: DISPOSITION.COULD_NOT, advance: false, log: true, because: v.because || 'we could not reach it, so we did not type anything' };
}

/**
 * W1-W4 for one poll. Walk the Slack messages oldest-first, deliver each one that
 * is addressed to a live local worker, and compute the single cursor the ps1 should
 * write.
 *
 * The cursor (a Slack `ts`) is advanced to the newest message HANDLED without a
 * `could_not`; the first `could_not` STOPS the walk with the cursor left before it,
 * so it and everything after are re-read next poll. Slack `oldest=<ts>` is
 * exclusive, so `advanceTo = ts` means "this one is done, start after it".
 *
 * @param {{messages: Array<{ts:*, text:string}>}} input oldest-first is not
 *   required; the function sorts by numeric ts so the cursor logic is order-safe.
 * @param {object} [opts]
 * @param {string[]} [opts.liveNames] inject the live worker names (tests). When
 *   omitted, read them from `win32live.byName` (production).
 * @param {(name:string, text:string)=>object} [opts.say] inject the delivery
 *   (tests). When omitted, `win32channel.say` (production).
 * @param {object} [opts.liveOpts] passed through to `win32live.byName` (its `run`
 *   and `record` seams) so a test never reads the real store or spawns claude.
 * @param {string[]} [opts.ownedNames] inject the owned-not-removed worker names
 *   (tests). When omitted, read them from `ownedWorkerNames` (production).
 * @param {object} [opts.ownedOpts] passed through to `ownedWorkerNames` (its
 *   `record` and `isRemoved` seams) so a test never reads the real store.
 * @param {boolean} [opts.dryRun] resolve and report what WOULD be delivered, but
 *   call no `say` and advance nothing. This is what `-Peek` maps to in delivery
 *   mode: the existing "inspect without consuming" meaning, kept honest (a peek
 *   that both delivered and left the cursor would re-deliver on the next real run).
 * @returns {{ ok:boolean, advanceTo:(*|null), reason?:string, results:Array }}
 */
function runInbox(input, opts) {
  const o = opts || {};
  const dryRun = o.dryRun === true;

  /* W1/W2 source: the live local worker names. A FAILED look (null) is not an
     empty machine -- we cannot tell whether any envelope is for a live worker, so
     we refuse the whole poll and advance nothing, the false-zero rule win32live
     exists to enforce. */
  let liveNames;
  if (Array.isArray(o.liveNames)) {
    liveNames = new Set(o.liveNames);
  } else {
    const map = win32live.byName(o.liveOpts);
    if (!map) return { ok: false, advanceTo: null, reason: DISPOSITION.ROSTER_UNREADABLE, results: [] };
    liveNames = new Set(map.keys());
  }

  /* FIX 2 source: the owned-not-removed worker names, the set that separates "ours
     but down" (block + retry) from "not ours" (advance past). Fail-safe empty. */
  const ownedNames = Array.isArray(o.ownedNames) ? new Set(o.ownedNames) : ownedWorkerNames(o.ownedOpts);

  const say = typeof o.say === 'function' ? o.say : require('./win32channel').say;

  const messages = Array.isArray(input && input.messages) ? input.messages.slice() : [];
  // Oldest-first by EXACT ts (NIT 3: compareTs, not float), so delivery order and
  // the cursor cannot drift from the caller's order or tie on near-simultaneous ts.
  messages.sort((a, b) => compareTs(a && a.ts, b && b.ts));

  const results = [];
  let advanceTo = null;

  for (const m of messages) {
    const ts = m && m.ts;
    // Routed by `to:` alone (FIX 3); `from:` is informational and never suppresses.
    const { toNames } = parseEnvelope(m && m.text);
    const target = resolveTarget(toNames, liveNames);
    // Not deliverable right now: is it a worker we own that is merely down?
    const ownedDown = !target && Boolean(resolveTarget(toNames, ownedNames));

    // A peek (dry run) reports the routing it WOULD take and stops there: no
    // delivery, and the cursor is left WHOLLY untouched (advanceTo stays null) so
    // the next real run sees exactly these messages.
    if (dryRun) {
      if (target) results.push({ ts, kind: 'would_deliver', target, because: null });
      else if (ownedDown) results.push({ ts, kind: DISPOSITION.OWNED_DOWN, target: resolveTarget(toNames, ownedNames), because: 'owned worker is down; a real run would block here and retry' });
      else results.push({ ts, kind: DISPOSITION.NOT_LOCAL, target: null, because: null });
      continue;
    }

    // Ours but currently down: BLOCK. Leave the cursor before this message so the
    // next poll retries once the supervised worker restarts, and do not process
    // later messages this poll (in-order, no spool) -- same stance as could_not.
    if (ownedDown) {
      results.push({ ts, kind: DISPOSITION.OWNED_DOWN, target: resolveTarget(toNames, ownedNames), because: 'it is one of ours but not running just now, so we did not type anything; will retry' });
      break;
    }

    // Not ours (or removed): advance past it -- each box polls with its own cursor,
    // so leaving it for another box costs us nothing.
    if (!target) {
      results.push({ ts, kind: DISPOSITION.NOT_LOCAL, target: null, because: null });
      advanceTo = ts;
      continue;
    }

    // W3 (deliver) + W4 (verdict -> cursor).
    let verdict;
    try { verdict = say(target, m.text); }
    catch (e) {
      // say() promises never to throw; one that does broke at a point we cannot
      // see, so it is unsure (unconfirmed), never a definite "nothing typed".
      verdict = { ok: false, unsure: true, because: 'something went wrong handing it over (' + ((e && e.code) || 'unknown') + '), so we cannot tell whether it arrived' };
    }
    const d = verdictToDisposition(verdict);
    results.push({ ts, kind: d.kind, target, because: d.because });

    if (d.advance) { advanceTo = ts; continue; }

    // could_not: STOP. Leave the cursor before this message so the next poll
    // retries it, and do not process later messages this poll (in-order, no spool).
    break;
  }

  return { ok: true, advanceTo, results };
}

/* istanbul ignore next -- the process wrapper the ps1 invokes; every function
   above is driven directly by the tests. */
if (require.main === module) {
  const fs = require('node:fs');
  const verb = process.argv[2];
  const emit = (payload) => {
    process.stdout.write(JSON.stringify(payload) + '\n');
    process.exitCode = payload && payload.ok ? 0 : 1;
  };
  if (verb !== 'run') {
    emit({ ok: false, advanceTo: null, reason: 'usage: win32inbox.js run  (json {messages:[{ts,text}]} on stdin)', results: [] });
  } else {
    let raw = '';
    try { raw = fs.readFileSync(0, 'utf8'); } catch { raw = ''; }
    // A caller that writes UTF-8 (a PowerShell StreamWriter, say) can prepend a
    // byte-order mark; JSON.parse rejects a leading U+FEFF, so strip it.
    raw = raw.replace(/^﻿/, '');
    const dryRun = process.argv.includes('--peek');
    let input;
    try { input = JSON.parse(raw || '{}'); }
    catch { emit({ ok: false, advanceTo: null, reason: 'we could not parse the messages handed to us', results: [] }); input = null; }
    if (input) emit(runInbox(input, { dryRun }));
  }
}

module.exports = { DISPOSITION, parseEnvelope, resolveTarget, compareTs, ownedWorkerNames, verdictToDisposition, runInbox };

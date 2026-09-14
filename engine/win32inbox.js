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
 */

const win32live = require('./win32live');

/* The three verdicts, one word each, the SAME strings chat.js's DELIVERY uses so a
   reader who knows one knows the other. `not_local` and `roster_unreadable` are
   this module's own dispositions for the two W-steps that happen BEFORE a delivery
   is even attempted (not addressed here; could not see the machine). */
const DISPOSITION = {
  PLACED: 'placed',
  UNCONFIRMED: 'unconfirmed',
  COULD_NOT: 'could_not',
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
 * running -- returns null on purpose: it is "not a live local worker", which the
 * caller advances past rather than blocking on. `could_not` is reserved for a name
 * that DID resolve live but whose pipe was down at send time.
 *
 * @param {string[]} toNames
 * @param {Iterable<string>} liveNames the live local worker names (a Set/array).
 * @returns {string|null}
 */
function resolveTarget(toNames, liveNames) {
  const live = liveNames instanceof Set ? liveNames : new Set(liveNames || []);
  for (const n of (Array.isArray(toNames) ? toNames : [])) {
    if (live.has(n)) return n;
  }
  return null;
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

  const say = typeof o.say === 'function' ? o.say : require('./win32channel').say;

  const messages = Array.isArray(input && input.messages) ? input.messages.slice() : [];
  // Oldest-first, numerically, so a delivery order and the cursor cannot drift
  // from the string sort a caller happened to hand us.
  messages.sort((a, b) => Number(a && a.ts) - Number(b && b.ts));

  const results = [];
  let advanceTo = null;

  for (const m of messages) {
    const ts = m && m.ts;
    const { from, toNames } = parseEnvelope(m && m.text);
    const target = resolveTarget(toNames, liveNames);
    // Our own outgoing: an envelope FROM a live local worker is a send this box
    // already made, never inbound to re-deliver.
    const ownOutgoing = Boolean(from && liveNames.has(from));

    // A peek (dry run) reports the routing it WOULD take and stops there: no
    // delivery, and the cursor is left WHOLLY untouched (advanceTo stays null) so
    // the next real run sees exactly these messages.
    if (dryRun) {
      results.push(target && !ownOutgoing
        ? { ts, kind: 'would_deliver', target, because: null }
        : { ts, kind: DISPOSITION.NOT_LOCAL, target: null, because: ownOutgoing ? 'from a local agent (our own outgoing)' : null });
      continue;
    }

    // Not addressed to a live local worker (or our own outgoing): not ours.
    // Advance past it -- each box polls with its own cursor, so leaving it for
    // another box costs us nothing.
    if (!target || ownOutgoing) {
      results.push({ ts, kind: DISPOSITION.NOT_LOCAL, target: null, because: ownOutgoing ? 'from a local agent (our own outgoing)' : null });
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

module.exports = { DISPOSITION, parseEnvelope, resolveTarget, verdictToDisposition, runInbox };

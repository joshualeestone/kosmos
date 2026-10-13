'use strict';
/*
 * #6071 (#5154 slice D, increment D1): the SAME tool failure repeating inside a turn, counted.
 *
 * Slices A (engine/crashloop.js) and C (engine/stuckterminal.js) bound what Kosmos can already see. This
 * counts what only the agent's runner can see: a Claude Code agent calling one tool, and it failing, over
 * and over. Claude Code fires its PostToolUseFailure hook on each failed call ("JSON with tool_name,
 * tool_input, tool_use_id, error, error_type, is_interrupt, and is_timeout", from its 2.1.296 binary), and
 * the report hook (install/kosmos-report-hook.sh, engine/kosmos-report-hook.js) sends a digest of it to
 * POST /api/toolfail, which calls noteFailure here.
 *
 * D1 RECORDS AND ASSESSES; IT RAISES NOTHING. The card, the push and the self-clear are increment D2. The
 * board logs the first time a run reaches the threshold, so the threshold can be read against real boards
 * before anything is shown to a person (false alarms are the chief risk, as in A and C).
 *
 * "THE SAME FAILURE" is the hook's `sig`: a hash of the tool name, the tool's input and the error's first
 * line. A retry that changes its input is a different signature, so a retry that is making progress never
 * adds to a run. Only CONSECUTIVE failures with one signature count: a different failing signature starts
 * a new run.
 *
 * INSIDE ONE TURN: Stop writes `idle` at the end of every turn (and SessionEnd `stopped`, SessionStart
 * `started`), into the agent's self-report record. A failure arriving after such a report that is newer
 * than the run's last failure starts a new run. Read through selfreport.history, never a second record.
 *
 * ON DISK (store.ROOT/toolloop/<key>.json), like stuckterminal, so `forget` is reachable from create.js,
 * remove.js and delete-leftover.js: a removed-and-recreated agent of the same name never inherits a run.
 * `dir()` reads store.ROOT at call time.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

/* Consecutive identical failures in one turn before a run counts as looping. Deliberately high to start
   (the card: thresholds start conservative, logged before they push). */
const LOOP_AT = 5;

/* The states that end a turn (or a session) in the self-report record. */
const TURN_ENDS = Object.freeze(['idle', 'stopped', 'started']);

const SIG_RE = /^[0-9a-f]{16,128}$/;
const MAX_TOOL = 80;
const MAX_ERROR = 300;

function dir() { return path.join(store.ROOT, 'toolloop'); }
function fileFor(key) { return path.join(dir(), store.safeKey(key) + '.json'); }

/* A short, single-line, printable copy of a field the hook sent. Never throws. */
function clean(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/* The stored run for one agent, or null (absent, unreadable or malformed). Never throws. */
function readRun(key) {
  let text;
  try { text = fs.readFileSync(fileFor(key), 'utf8'); } catch { return null; }
  try {
    const r = JSON.parse(text);
    if (r && typeof r.sig === 'string' && SIG_RE.test(r.sig) && Number.isInteger(r.count) && r.count > 0
      && Number.isFinite(r.firstAt) && Number.isFinite(r.lastAt)) {
      return { sig: r.sig, tool: clean(r.tool, MAX_TOOL), error: clean(r.error, MAX_ERROR), count: r.count,
        firstAt: r.firstAt, lastAt: r.lastAt };
    }
  } catch { /* a malformed file reads as no run */ }
  return null;
}

function writeRun(key, run) {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    store.saveFlushed(fileFor(key), JSON.stringify(run));
    return true;
  } catch { return false; }
}

/* True when the agent's self-report record shows a turn ending after `since`. A record that cannot be read
   says nothing, so it never splits a run. `history` is a seam for tests. */
function turnEndedSince(key, since, history) {
  let rows;
  try { rows = (history || require('./selfreport').history)(key); } catch { rows = null; }
  if (!Array.isArray(rows)) return false;
  return rows.some((r) => r && TURN_ENDS.includes(r.state) && Number.isFinite(r.at) && r.at > since);
}

/*
 * Count one failed tool call for an agent. Never throws.
 * @param {string} key   the agent's session name
 * @param {{ tool: string, sig: string, error?: string }} failure  the hook's digest
 * @param {{ now?: number, history?: Function }} [opts]
 * @returns {{ ok: boolean, because?: string, count?: number, looping?: boolean, reached?: boolean }}
 *   `reached` is true on the one call that brought the run to LOOP_AT (the board logs it once).
 */
function noteFailure(key, failure, opts) {
  const o = opts || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const f = failure || {};
  const sig = String(f.sig || '');
  if (!key) return { ok: false, because: 'no agent' };
  if (!SIG_RE.test(sig)) return { ok: false, because: 'not a failure signature we can read' };
  const tool = clean(f.tool, MAX_TOOL) || 'a tool';
  const error = clean(f.error, MAX_ERROR);
  const prev = readRun(key);
  const continues = prev && prev.sig === sig && !turnEndedSince(key, prev.lastAt, o.history);
  const run = continues
    ? { ...prev, count: prev.count + 1, lastAt: now, error: error || prev.error }
    : { sig, tool, error, count: 1, firstAt: now, lastAt: now };
  if (!writeRun(key, run)) return { ok: false, because: 'the record could not be written' };
  return { ok: true, count: run.count, looping: run.count >= LOOP_AT, reached: run.count === LOOP_AT };
}

/*
 * The current assessment for an agent, read-only. Never throws.
 * @returns {null | { looping: boolean, turnOver: boolean, tool: string, error: string, count: number,
 *   firstAt: number, lastAt: number }}  null when there is no run. `turnOver` is true when a turn has ended
 *   since the run's last failure: the next failure starts a new run, but the run itself is still what
 *   happened (D2 decides how long a finished loop stays on the card).
 */
function peek(key, opts) {
  const run = readRun(key);
  if (!run) return null;
  return { looping: run.count >= LOOP_AT, turnOver: turnEndedSince(key, run.lastAt, opts && opts.history),
    tool: run.tool, error: run.error, count: run.count, firstAt: run.firstAt, lastAt: run.lastAt };
}

/* Drop an agent's run (on create, remove and delete, like stuckterminal.forget). Never throws. */
function forget(key) {
  try { fs.unlinkSync(fileFor(key)); } catch { /* already gone */ }
}

module.exports = { noteFailure, peek, forget, LOOP_AT, TURN_ENDS };

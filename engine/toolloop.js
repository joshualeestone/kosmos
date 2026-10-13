'use strict';
/*
 * #6071 (#5154 slice D, increment D1): the SAME tool failure repeating inside a turn, counted.
 *
 * Slices A (engine/crashloop.js) and C (engine/stuckterminal.js) bound what Kosmos can already see. This
 * counts what only the agent's runner can see: a Claude Code agent calling one tool, and it failing, over
 * and over. Claude Code fires its PostToolUseFailure hook on each failed call, and the report hook
 * (install/kosmos-report-hook.sh, engine/kosmos-report-hook.js) sends a digest of it to POST /api/toolfail,
 * which calls noteFailure here.
 *
 * D1 RECORDS AND ASSESSES; IT RAISES NOTHING. The card, the push and the self-clear are increment D2. The
 * board logs the first time a run reaches the threshold, so the threshold can be read against real boards
 * before anything is shown to a person (false alarms are the chief risk, as in A and C).
 *
 * "THE SAME FAILURE" is the hook's `sig`: a hash of the tool name, the tool's input and the WHOLE error. A
 * retry whose input or error output changes is a different signature and starts a new run, so a run is
 * only one tool failing in exactly the same way again, CONSECUTIVELY: any other failure in between starts a
 * new run (so alternating failures, or parallel calls interleaving, never add up: two different tools both
 * looping at once are invisible to D1). Not seen: successful
 * calls in between, so an agent that edits, reruns the same test and gets the identical failure counts that
 * rerun, and a poll with the same input and the same bare error (an `until test -f` loop) looks the same.
 *
 * INSIDE ONE TURN: POST /api/report calls noteTurnEnd when an automatic idle, stopped or started arrives
 * (the end of a turn or a session), or the next prompt (endsTurn), BEFORE the self-report guard can refuse
 * to record it: a standing
 * deliberate wait refuses an automatic idle, so the self-report record cannot be the source. The next
 * failure after a turn end starts a new run.
 *
 * TRUST, stated before D2 shows anything to a person: a turn end is an AUTOMATIC report, and `--auto` is what the
 * request says, as it is for the self-report guard (#900). So an agent can end its own run early by reporting
 * `idle --auto` itself. It can only make a loop look shorter, never invent one; D2 decides whether that is enough.
 *
 * noteFailure and noteTurnEnd are fully synchronous (a sync read, then an atomic sync write), so two requests on
 * the board's one event loop never interleave their read and write: parallel failures cannot lose a count.
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

/* The automatic report states that end a turn (Stop), a session (SessionEnd) or start one (SessionStart). */
const TURN_ENDS = Object.freeze(['idle', 'stopped', 'started']);
/* The sentence the report hook's UserPromptSubmit sends (install/kosmos-report-hook.sh and its Windows twin
   engine/kosmos-report-hook.js reportFor): a new prompt starts a new turn even when the last one ended with no Stop
   (the person pressed Esc). */
const PROMPT_TEXT = 'answering a prompt';

/* What kind of turn end an AUTOMATIC report with this state and text is: 'stop' (the turn or session ended), 'prompt'
   (the next prompt started a new turn), or null (it ends nothing). Pure. */
function endsTurn(state, text) {
  if (TURN_ENDS.includes(state)) return 'stop';
  if (state === 'working' && text === PROMPT_TEXT) return 'prompt';
  return null;
}

/* A failure that arrives this soon after a turn end still belongs to the turn that just ended: the hook sends its
   digest in the background, so it can reach the board just after the Stop report that followed it. */
const LATE_MS = 2000;
let lateMs = LATE_MS;
/* Seam: route tests run in real time and cross a turn end in milliseconds. */
function setLateMsForTests(ms) { lateMs = Number.isFinite(ms) ? ms : LATE_MS; }

const SIG_RE = /^[0-9a-f]{16,128}$/;
/* The caps that decide what is stored. The hooks and the CLI cut the error line too, but only to bound what they send:
   the signature is made from the WHOLE error before any cut, so a cap that drifts there changes no signature. */
const MAX_TOOL = 80;
const MAX_ERROR = 300;

/* The error line is the tool's own words and can hold a secret (a token in a failing curl URL, an email, a home
   folder). It is stored only after the diagnostics redactor (engine/diagredact.js, #5959) has taken those out; if
   redaction fails, nothing is stored. */
function redacted(text) {
  try { return require('./diagredact').makeRedactor().redactText(String(text == null ? '' : text)); } catch { return ''; }
}

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
        firstAt: r.firstAt, lastAt: r.lastAt, turnEndAt: Number.isFinite(r.turnEndAt) ? r.turnEndAt : null,
        turnEndKind: r.turnEndKind === 'prompt' ? 'prompt' : 'stop' };
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

/*
 * Count one failed tool call for an agent. Never throws.
 * @param {string} key   the agent's session name
 * @param {{ tool: string, sig: string, error?: string }} failure  the hook's digest
 * @param {{ now?: number }} [opts]
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
  const error = clean(redacted(f.error), MAX_ERROR);
  const prev = readRun(key);
  /* Late: sent before a Stop but delivered just after it. Only a Stop can be overtaken this way; after a prompt the
     next failure is the new turn's. A late failure that does not continue the run still belongs to the turn that
     ended, so its run keeps that turn end and the next turn's failures start afresh. */
  const late = Boolean(prev && prev.turnEndAt !== null && prev.turnEndKind === 'stop' && now - prev.turnEndAt <= lateMs);
  const continues = prev && prev.sig === sig && (prev.turnEndAt === null || late);
  const run = continues
    ? { ...prev, count: prev.count + 1, lastAt: now, error: error || prev.error }
    : { sig, tool, error, count: 1, firstAt: now, lastAt: now,
      turnEndAt: late ? prev.turnEndAt : null, turnEndKind: late ? prev.turnEndKind : 'stop' };
  if (!writeRun(key, run)) return { ok: false, because: 'the record could not be written' };
  return { ok: true, count: run.count, looping: run.count >= LOOP_AT, reached: run.count === LOOP_AT, tool: run.tool };
}

/*
 * A turn (or session) ended for an agent: the next failure starts a new run. Called by POST /api/report for an
 * automatic report that endsTurn, with its kind ('stop' or 'prompt'). Writes only when there is a run to mark, or
 * when a prompt follows a Stop (which closes the late window). Never throws.
 */
function noteTurnEnd(key, opts) {
  const o = opts || {};
  const now = Number.isFinite(o.now) ? o.now : Date.now();
  const kind = o.kind === 'prompt' ? 'prompt' : 'stop';
  const run = key ? readRun(key) : null;
  if (!run) return false;
  if (run.turnEndAt !== null) {
    /* A prompt after a Stop closes the late window: from here on, a failure is the new turn's. */
    if (kind === 'prompt' && run.turnEndKind !== 'prompt') return writeRun(key, { ...run, turnEndKind: 'prompt' });
    return false;
  }
  return writeRun(key, { ...run, turnEndAt: now, turnEndKind: kind });
}

/*
 * The current assessment for an agent, read-only. Never throws.
 * @returns {null | { looping: boolean, turnOver: boolean, tool: string, error: string, count: number,
 *   firstAt: number, lastAt: number }}  null when there is no run. `turnOver` is true when a turn has ended
 *   since the run's last failure: the next failure starts a new run, but the run itself is still what
 *   happened (D2 decides how long a finished loop stays on the card).
 */
function peek(key) {
  const run = readRun(key);
  if (!run) return null;
  return { looping: run.count >= LOOP_AT, turnOver: run.turnEndAt !== null,
    tool: run.tool, error: run.error, count: run.count, firstAt: run.firstAt, lastAt: run.lastAt };
}

/* Drop an agent's run (on create, remove and delete, like stuckterminal.forget). Never throws. */
function forget(key) {
  try { fs.unlinkSync(fileFor(key)); } catch { /* already gone */ }
}

module.exports = { noteFailure, noteTurnEnd, endsTurn, peek, forget, LOOP_AT, LATE_MS, TURN_ENDS, PROMPT_TEXT, setLateMsForTests };

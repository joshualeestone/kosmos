'use strict';
/**
 * kosmos#5957 slice 1: no two agents share a display name.
 *
 * Two agents on one computer were both shown as "Gemini" (Josh's Windows QA, 10-12). Nothing compared DISPLAY names:
 * the session name (the slug) is checked at create, import and restore, but the display name never was, so "@gemini"
 * in a room named two members and mentionedMembers (engine/messages.js) asked neither.
 *
 * Two keys. nameKey is the @-mention key (mentionedMembers calls it): NFKD, lower-case, a-z and 0-9 only. takenKey
 * decides "taken" here: the same answer for a Latin name ("Gemini", "gemini", " GEMINI " and "Ge-mini" are one name),
 * but letters and digits of every script count, so 王 and 王 are one name and 王12 and 李12 are two.
 *
 * The fleet (every agent's session name and display name) comes from a source the board wires at start
 * (setFleetSource), the same seam shape as status.setCreatedSource, so the engine needs no tmux of its own:
 *   - no source wired (unit tests, a context with no board): no clash. The session-name checks that already exist
 *     still run, so this is additive.
 *   - a source that throws or answers something that is not a list: clashFor THROWS, and each caller refuses with
 *     COULD_NOT_CHECK. Fail closed, as create's own roster check does.
 */

function nameKey(s) {
  return String(s == null ? '' : s).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/* What decides "taken": the same as nameKey for a Latin name (accents, case, spaces and punctuation do not make a new
   name), but letters and digits of EVERY script are kept. nameKey keeps only a-z and 0-9, which an @-word is limited
   to; used for "taken" it would read 王12 and 李12 as the same name (both "12") and never compare an all-CJK one. */
function takenKey(s) {
  return String(s == null ? '' : s).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
/* Too short to be a name worth refusing: empty, or a single Latin letter or digit (as an @-word of one character is
   ignored). A single character of another script (王) is a whole name and does count. */
function tooShort(key) { return key.length === 0 || (key.length === 1 && /^[a-z0-9]$/.test(key)); }

let fleetSource = null;
function setFleetSource(fn) { fleetSource = typeof fn === 'function' ? fn : null; }

const COULD_NOT_CHECK = 'we could not check the names already in use, so nothing was changed; try again in a moment';

/* The agents to compare against: [{ handle, shown }], the handle being the agent's session name. Throws when a wired
   source cannot answer. */
function fleet() {
  if (!fleetSource) return [];
  const got = fleetSource();
  if (!Array.isArray(got)) throw new Error('the agent list could not be read');
  return got.filter((a) => a && typeof a.handle === 'string' && a.handle);
}

/**
 * clashFor(wanted, { except, agents }) -> null, or { handle, shown } of the agent that already answers to it.
 * `except` is the agent being renamed: its own names never clash with it. `agents` overrides the wired source (tests).
 * Throws when the wired source cannot answer (callers refuse with COULD_NOT_CHECK).
 */
function clashFor(wanted, opts) {
  const key = takenKey(wanted);
  if (tooShort(key)) return null;
  const except = opts && typeof opts.except === 'string' ? opts.except : null;
  /* The agent's identity is its store key (one profile per key), so ANY spelling a route accepted for it (ANGEL, an.gel)
     excepts exactly that agent and no other. */
  const { safeKey } = require('./store');
  const keyOf = (h) => { try { return safeKey(h); } catch { return null; } };
  const exceptKey = except === null ? null : keyOf(except);
  const agents = opts && Array.isArray(opts.agents) ? opts.agents : fleet();
  for (const a of agents) {
    if (!a || (except !== null && (a.handle === except || (exceptKey !== null && keyOf(a.handle) === exceptKey)))) continue;
    if (takenKey(a.handle) === key || (typeof a.shown === 'string' && takenKey(a.shown) === key)) {
      return { handle: a.handle, shown: typeof a.shown === 'string' && a.shown.trim() ? a.shown.trim() : a.handle };
    }
  }
  return null;
}

/* The refusal, naming the other agent by display name and handle (as ambiguousNote does) so the person can find it. */
function takenSentence(clash) {
  return `there is already an agent called ${clash.shown} (@${clash.handle}). Pick another name, or rename that one first.`;
}

/* One call for the callers: null when the name is free, else the sentence to refuse with. */
function refusalFor(wanted, opts) {
  let clash;
  try { clash = clashFor(wanted, opts); } catch (err) {
    process.stderr.write(`name check could not run: ${String((err && err.message) || err)}\n`);   // the log gets the cause
    return COULD_NOT_CHECK;
  }
  return clash ? takenSentence(clash) : null;
}

module.exports = { nameKey, takenKey, setFleetSource, fleet, clashFor, refusalFor, takenSentence, COULD_NOT_CHECK };

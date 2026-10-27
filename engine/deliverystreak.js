'use strict';

/**
 * kosmos#7212 slice 2: an agent no message has been seen to reach for half an hour is said to the person, whatever the
 * cause. Josh's 0.7.70 report: an agent whose every delivery failed for seven days with its input box EMPTY, so the
 * slice 1 line (messages held behind text in the box) never fired, and the stuck-input recovery logged nothing.
 *
 * chat.deliver / deliverAsync / deliverAutomatic / deliverAutomaticAsync are where every sender ends and where every
 * hold verdict returns, so each verdict is noted here, per agent:
 *   PLACED ends the agent's streak (a line was seen to land);
 *   COULD_NOT (held or refused) and UNCONFIRMED start or extend it, keeping the reason;
 *   a verdict with `busy: true` (another line was still being placed in the same window) is not counted.
 * UNCONFIRMED counts because only PLACED is seen to land: a line typed with its Enter swallowed comes back unconfirmed
 * every time, and the report does not say which verdict the stalled agent's lines got.
 *
 * In memory, on the board: a restart starts every streak again (stated in the plan). Never throws.
 */

const STALL_MS = 30 * 60 * 1000;
const STALL_MIN_FAILS = 3;   // one refused line followed by silence is not a stall
const RESAY_MS = 24 * 60 * 60 * 1000;

/* name -> { since: ms, count, lastWhy, lastAt: ms, kinds: Set<string> } */
const streaks = new Map();

/* What one verdict was held or refused for, in a word the card and the log can key on. */
function whyOf(v) {
  if (!v || typeof v !== 'object') return 'unknown';
  if (v.state === 'unconfirmed') return 'unconfirmed';
  // #5948 keeps a sign-in hold under heldBy 'limit' and says why in heldFor: it is not a usage limit here.
  if (v.heldFor === 'signin') return 'signin';
  if (typeof v.heldBy === 'string' && v.heldBy) return v.heldBy;
  if (v.inputHeld === true) return 'input';
  return 'refused';
}

/* Note one delivery verdict for `name`. Returns nothing; never throws. */
function note(name, v, now = Date.now()) {
  try {
    if (typeof name !== 'string' || !name || !v || typeof v !== 'object') return;
    if (v.state === 'placed') { streaks.delete(name); return; }
    if (v.busy === true) return;
    if (v.state !== 'could_not' && v.state !== 'unconfirmed') return;
    const why = whyOf(v);
    const s = streaks.get(name);
    if (!s) { streaks.set(name, { since: now, count: 1, lastWhy: why, lastAt: now, kinds: new Set([why]) }); return; }
    s.count += 1; s.lastWhy = why; s.lastAt = now; s.kinds.add(why);
  } catch { /* the next verdict is noted */ }
}

/* Wrap a verdict, or a promise of one, so it is noted as it settles; returns what it was given. */
function noted(name, v) {
  if (v && typeof v.then === 'function') return v.then((x) => { note(name, x); return x; });
  note(name, v);
  return v;
}

/* The card's deliveryStall: { since (ISO), count, lastWhy } once `name` has a streak STALL_MS old with at least
   STALL_MIN_FAILS failures in it, else null. `limitShown` true when the card already shows a usage limit: a streak made
   only of usage-limit holds is then not a stall to warn about (the card already says it). */
function stallOf(name, { now = Date.now(), limitShown = false } = {}) {
  const s = streaks.get(name);
  if (!s || s.count < STALL_MIN_FAILS || now - s.since < STALL_MS) return null;
  if (limitShown && s.kinds.size === 1 && s.kinds.has('limit')) return null;
  return { since: new Date(s.since).toISOString(), count: s.count, lastWhy: s.lastWhy };
}

/* True when a card shows a usage limit itself (its limit reset, a limitFrom reading, or an Antigravity quota or pool
   pause): the one rule both the card field and the board log use. Never throws. */
function limitShownOn(card) {
  return !!(card && (card.limitUntil || card.limitFrom || card.quotaUntil || card.poolUntil));
}

/* Which stalls to say in the board log now: each once per streak, and again each RESAY_MS it lasts. `said` (a Map the
   caller keeps: name -> { since, at }) forgets a name whose streak ended or restarted. `limitShownOf(name)` as above. */
function stallsToSay(names, said, { now = Date.now(), limitShownOf = () => false } = {}) {
  const out = [];
  for (const n of [...said.keys()]) {
    const s = streaks.get(n);
    if (!s || s.since !== said.get(n).since) said.delete(n);
  }
  for (const name of names || []) {
    let limitShown = false;
    try { limitShown = !!limitShownOf(name); } catch { /* not shown */ }
    const st = stallOf(name, { now, limitShown });
    if (!st) continue;
    const prev = said.get(name);
    if (prev && now - prev.at < RESAY_MS) continue;
    said.set(name, { since: streaks.get(name).since, at: now });
    out.push({ name, ...st });
  }
  return out;
}

const WHY_WORDS = {
  input: 'its input box held text that was not sent, or could not be read',
  signin: 'it was signed out',
  limit: 'it was out of usage',
  quota: 'its shared Google quota was out',
  menu: 'its screen was waiting on a question or a menu',
  unconfirmed: 'the line was typed but Kosmos did not see it submitted',
  refused: 'Kosmos could not type into it',
  unknown: 'Kosmos could not tell why',
};
/* The board log's line for one stall. */
function stallLine(s) {
  return 'delivery-stall: no message has been seen to reach ' + s.name + ' since ' + s.since + ' (' + s.count
    + ' tries); the last one did not land because ' + (WHY_WORDS[s.lastWhy] || WHY_WORDS.unknown) + '\n';
}

/* Agents no longer on the board lose their streaks, so one coming back under the name starts over. */
function sweep(names) {
  const present = new Set(Array.from(names || [], String));
  for (const k of [...streaks.keys()]) if (!present.has(k)) streaks.delete(k);
}

function resetForTests() { streaks.clear(); }

module.exports = { limitShownOn, note, noted, stallOf, stallsToSay, stallLine, sweep, whyOf, resetForTests, STALL_MS, STALL_MIN_FAILS, RESAY_MS, WHY_WORDS };

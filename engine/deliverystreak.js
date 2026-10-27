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
 *   a verdict with `busy: true` (another line was still being placed in the same window) is not counted, nor one with
 *   `contentRefused: true` (the message itself was refused: too long, empty, a bad attachment name).
 * UNCONFIRMED counts because only PLACED is seen to land: a line typed with its Enter swallowed comes back unconfirmed
 * every time, and the report does not say which verdict the stalled agent's lines got.
 *
 * In memory, on the board: a restart starts every streak again (stated in the plan). Never throws.
 */

const STALL_MS = 30 * 60 * 1000;
const STALL_MIN_FAILS = 3;   // one refused line followed by silence is not a stall
const RESAY_MS = 24 * 60 * 60 * 1000;
/* A streak whose newest failure is older than this is not said: nobody has tried to reach the agent since, so Kosmos
   no longer knows it is stuck (round 2). It is not cleared either; the next failure carries it on. */
const FRESH_MS = 2 * 60 * 60 * 1000;

/* The card states that say what is wrong themselves (or that a person is already answering): a streak built while the
   card read one of these is not a stall of the agent that comes back to idle (round 3). Not 'unknown': a screen that
   could not be read is not a reason to forget. */
const SPEAKS_FOR_ITSELF = new Set(['stopped', 'restarting', 'needs_you', 'needs_trust', 'rate_limited', 'auth_failed',
  'connection_lost', 'blocked']);

/* name -> { since: ms, count, lastWhy, lastAt: ms, kinds: Set<string> } */
const streaks = new Map();

/* kosmos#7368: on Windows a message is written into the agent's input and counts as PLACED even while a turn is
   running, so the agent queues it behind that turn, and a turn that never ends holds every later message. The streak
   above cannot see that (each one landed). The agent's own supervisor counts what it queued (win32streamstate's
   `queued`, kept in its state file), and a step with no sign of activity for TURN_STUCK_MS while something is queued is
   said here, with the step it is on. */
const TURN_STUCK_MS = 60 * 60 * 1000;

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
    if (v.busy === true || v.contentRefused === true) return;
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

/* The card's deliveryStall: { since (ISO), count, lastWhy, words (why the last one did not land, for the card's
   sentence: one copy, here) } once `name` has a streak STALL_MS old with at least
   STALL_MIN_FAILS failures in it, else null. `limitShown` true when the card already shows a usage limit: a streak made
   only of usage-limit holds is then not a stall to warn about (the card already says it). */
function stallOf(name, { now = Date.now(), limitShown = false } = {}) {
  const s = streaks.get(name);
  if (!s || s.count < STALL_MIN_FAILS || now - s.since < STALL_MS || now - s.lastAt > FRESH_MS) return null;
  // A run of usage-limit or shared-quota holds alone is a planned pause the card already shows (round 3: quota too).
  if (limitShown && [...s.kinds].every((k) => k === 'limit' || k === 'quota')) return null;
  const why = Object.hasOwn(WHY_WORDS, s.lastWhy) ? s.lastWhy : 'unknown';
  return { since: new Date(s.since).toISOString(), count: s.count, lastWhy: s.lastWhy, words: WHY_WORDS[why], next: NEXT_WORDS[why] };
}

/* kosmos#7368: the card's deliveryStall for a step that never ends, { since (ISO, its last sign of activity), count
   (messages queued behind it), lastWhy: 'turn', step, words, next }, once `turn` ({ since, step, queued }, from
   win32streamstate.turnFor) has shown no activity for TURN_STUCK_MS AND has at least one message queued behind it; else
   null. A long step nothing waits behind harms nobody and is not said. */
function turnStuckOf(name, turn, { now = Date.now() } = {}) {
  try {
    if (!turn || typeof turn.since !== 'string') return null;
    const since = Date.parse(turn.since);
    if (!Number.isFinite(since) || now - since < TURN_STUCK_MS) return null;
    const count = Number.isInteger(turn.queued) ? turn.queued : 0;
    if (count < 1) return null;
    /* Masked again here (review 2 W4): the supervisor masks by shape only; the board also knows the person's own secrets.
       A mask that fails drops the step rather than show it. */
    let step = typeof turn.step === 'string' && turn.step ? turn.step : null;
    if (step) { try { step = require('./secretmask').mask(step).text || null; } catch { step = null; } }
    return { since: new Date(since).toISOString(), count, lastWhy: 'turn', step, words: WHY_WORDS.turn, next: turnNext(count) };
  } catch { return null; }
}
/* The way out, worded for how many wait (review 1: "them" for one message). */
function turnNext(count) {
  return (count === 1 ? 'Restart it to free it, then send that message again' : 'Restart it to free it, then send them again')
    + ', or wait if it is a long job';   // review 3: an out for an agent that is simply busy (Josh's voice: give the reader an out)
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

/* Why the last one did not land, as the middle sentence of the card's line (Mona Lisa's design, #7212): no full stop,
   the page adds it. */
const WHY_WORDS = {
  input: 'Its input box holds text that was not sent, or Kosmos could not read the box',
  signin: 'It is signed out',
  limit: 'It is out of usage',
  quota: 'Its shared Google quota is out',
  menu: 'Its screen is waiting on a question or a menu',
  unconfirmed: 'Kosmos typed its messages but did not see them sent',
  refused: 'Kosmos could not type into it',
  unknown: 'Kosmos could not tell why',
  /* kosmos#7368: the short reason for this case; the agent page words it on its own (the messages did arrive, they wait
     behind one step). */
  turn: 'It has been on one step for over an hour, and the messages wait behind it',
};
/* What the person can do, the card's last sentence (round 3: a restart does not help a sign-in, a limit or a quota). */
const LOOK = 'Open it to see what it shows, or restart it';
const NEXT_WORDS = {
  input: LOOK, menu: LOOK, unconfirmed: LOOK, refused: LOOK, unknown: LOOK,
  signin: 'Reconnect its account in Settings, AI Models',
  limit: 'Kosmos sends them once its usage resets',
  quota: 'Kosmos sends them once the shared quota resets',
  /* kosmos#7368: a restart ends the process, and what it had queued goes with it, so they must be sent again
     (turnNext words it for one message). */
  turn: 'Restart it to free it, then send them again, or wait if it is a long job',
};
/* The board log's line for one stall. */
function stallLine(s) {
  return 'delivery-stall: no message has been seen to reach ' + s.name + ' since ' + s.since + ' (' + s.count
    + ' tries). ' + s.words + '.\n';
}

/* kosmos#7368: the board log's line for one step that never ends, said once per stuck step. */
function turnLine(name, s) {
  return 'turn-stuck: ' + name + ' has been on one step since ' + s.since + (s.step ? ' (' + s.step + ')' : '')
    + ', with ' + s.count + ' message' + (s.count === 1 ? '' : 's') + ' waiting behind it.\n';
}

/* kosmos#7368 (review 4 W1): which stuck steps the board log says now, each ONCE per step (its clock and step are the
   key). `cards` is the board's roster ({ sessionName, deliveryStall }); `said` a Map the caller keeps. A name keeps its
   key while it is still on the board, so one read that missed the stall does not say it again; a name gone from the
   board is forgotten. Returns the lines to write. Never throws. */
function turnsToSay(cards, said) {
  const out = [];
  try {
    const present = new Set();
    for (const c of cards || []) {
      if (!c || typeof c.sessionName !== 'string') continue;
      present.add(c.sessionName);
      const st = c.deliveryStall;
      if (!st || st.lastWhy !== 'turn') continue;
      const key = st.since + '\u0000' + (st.step || '');
      if (said.get(c.sessionName) === key) continue;
      said.set(c.sessionName, key);
      out.push(turnLine(c.sessionName, st));
    }
    for (const n of [...said.keys()]) if (!present.has(n)) said.delete(n);
  } catch { /* said next minute */ }
  return out;
}

/* Start `name`'s streak over: a card reading stopped or restarting (lines refused while it was down are not a stall of
   the agent that comes back). */
function reset(name) { streaks.delete(name); }

/* The minute sweep's call for each card on the board: a card reading a state that says itself starts its streak over.
   Here, not in the card field's getter, so reading a card never changes anything (round 3). */
function settleFor(card) {
  try { if (card && typeof card.sessionName === 'string' && SPEAKS_FOR_ITSELF.has(card.state)) reset(card.sessionName); } catch { /* next minute */ }
}

/* Agents no longer on the board lose their streaks, so one coming back under the name starts over. */
function sweep(names) {
  const present = new Set(Array.from(names || [], String));
  for (const k of [...streaks.keys()]) if (!present.has(k)) streaks.delete(k);
}

function resetForTests() { streaks.clear(); }

module.exports = { turnsToSay, turnNext, turnLine, reset, settleFor, SPEAKS_FOR_ITSELF, NEXT_WORDS, limitShownOn, note, noted, stallOf, turnStuckOf, stallsToSay, stallLine, sweep, whyOf, resetForTests, STALL_MS, STALL_MIN_FAILS, RESAY_MS, FRESH_MS, TURN_STUCK_MS, WHY_WORDS };

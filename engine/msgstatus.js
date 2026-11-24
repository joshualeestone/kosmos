'use strict';

/**
 * kosmos#8961: what happened to a direct message one agent sent another (`kosmos msg --status <id>`).
 *
 * A colleague who answers in its own window, as plain text, never reaches the sender: the sender sees silence and
 * cannot tell "it read my message and chose not to answer" from "it never got to it". The board already holds both
 * halves of the answer, so this reads them and says which, without typing anything into anyone's pane and without
 * relaying the recipient's words:
 *
 *   - the message record (engine/messages.js): the row, its delivery state, and any message the recipient sent back
 *     to the sender after it;
 *   - the recipient's report history (engine/selfreport.history): the report hook writes `working` "answering a
 *     prompt" when a prompt starts a turn and `idle` "finished responding" when the turn ends (both by:'auto').
 *
 * Derived on read, never written: a status is a view of two records that already exist, so it cannot drift from them.
 *
 * ⚠️ The weakest premise, stated on the card: a turn that ENDS after delivery is not proof the message was read. A
 * message typed while the agent is mid-turn may be handled in the turn that is running or in the next one. So only a
 * turn that STARTED after delivery counts as "read". A turn already running that ended later is reported as exactly
 * that ("may have read it"), never rounded up to read.
 *
 * ⚠️ A residual, not handled: the row's time is taken when the send BEGINS (engine/messages.js sendWithDelivery), and
 * typing into the pane can take a moment after it. A turn the recipient started for another reason inside that
 * moment counts as one that started after the message arrived. No later delivery time is recorded to narrow it. A
 * held message is the other way round: its held-delivered row is written just AFTER typing, so a turn started in that
 * moment reads as already running, which leans toward "may have read it". A reply is dated the same way: one that was
 * queued behind the sender's running turn (state placed, queued) counts from when its send began, not from when the
 * sender's window took it in.
 *
 * Pure apart from the two readers, which the caller passes in (the route passes the real ones, the tests stubs).
 */

const STATUS = Object.freeze({
  ANSWERED: 'answered',            // the recipient sent a message back to the sender after this one
  READ_NO_ANSWER: 'read_no_answer', // a turn started after delivery and ended, and nothing came back by command
  READING: 'reading',              // a turn started after delivery and has not ended
  MAYBE_READ: 'maybe_read',        // a turn already running at delivery ended after it, and nothing came back
  IN_TURN: 'in_turn',              // a turn already running at delivery has not ended yet
  NOT_YET: 'not_yet',              // the agent was between turns at delivery and none has started since
  SESSION_ENDED: 'session_ended',  // its session stopped or restarted after delivery, before any turn answered it
  NOT_DELIVERED: 'not_delivered',  // the row is held (kept for later) or was never typed
  UNKNOWN: 'unknown',              // the recipient's report history cannot say (none, unreadable, or cut too short)
});

const ID_RE = /^m[1-9][0-9]{0,15}$/;

/* The report rows that mark a turn, from the report hook only: an agent's own `kosmos report idle` mid-turn is not a
   turn end, and a person's clear is not anything the agent did. */
function turnMark(row) {
  if (!row || row.by !== 'auto') return null;
  if (row.state === 'working' && row.turn === 'start') return 'start';
  if (row.state === 'idle' && row.turn === 'end') return 'end';
  if (row.state === 'stopped' || row.state === 'started') return 'session';
  return null;
}

function iso(ms) { return new Date(ms).toISOString(); }

/**
 * status(id, { rows, history, sessionOf }) -> { found, ... }
 *   rows:      the message log rows (messages.readLog()), oldest first
 *   history:   (sessionName, sentAt ms) -> selfreport.history rows (with `turn` marks) or null
 *   sessionOf: (name) -> the recipient's session name (the roster's card), or the name itself
 *   asker:     when given, only the sender may read the status. Optional only for the pure tests:
 *              the route always passes it, and any new caller serving an agent must too.
 */
function status(id, o) {
  const key = String(id == null ? '' : id).trim();
  if (!ID_RE.test(key)) return { found: false, because: 'that is not a message id; ids look like m12' };
  const rows = Array.isArray(o && o.rows) ? o.rows : [];
  /* Names compare as the roster resolves them: a message row's `to` is the name as the sender typed it (only
     trimmed), while `from` is the sender's session name, and delivery matches case-insensitively (#989). */
  const canon = (name) => {
    let n = name;
    try { n = (o && typeof o.sessionOf === 'function' && o.sessionOf(name)) || name; } catch { n = name; }
    return String(n == null ? '' : n).trim().toLowerCase();
  };
  // A direct message only: a room post has many readers and its own answered/unanswered tracking (#4612).
  const msg = rows.find((r) => r && r.kind === 'message' && r.id === key && typeof r.to === 'string');
  const asked = o && typeof o.asker === 'string';
  /* With an asker, only the sender is answered (every sentence is written to the sender), and with one refusal for
     "no such message" and "not yours", so an agent cannot tell another message's id from a missing one. */
  // Exactly: the asker is the caller's own session name, as a row's `from` is, so two names differing in case stay apart.
  if (asked && (!msg || o.asker !== msg.from)) {
    return { found: false, because: 'there is no direct message ' + key + ' sent by you' };
  }
  if (!msg) return { found: false, because: 'there is no direct message ' + key + ' on this board' };
  const name = String(msg.to).replace(/["\\]/g, '');   // for the because sentences: never a quote or backslash
  const base = { found: true, id: key, from: msg.from, to: msg.to, at: msg.at,
    ...(msg.replyExpected === false ? { replyExpected: false } : {}),
    ...(msg.unsubmitted === true ? { unsubmitted: true } : {}) };
  let sentAt = Date.parse(msg.at || '');
  if (!Number.isFinite(sentAt)) return { ...base, status: STATUS.UNKNOWN, because: 'the message has no time on its record' };
  if (msg.state === 'held') {
    /* A held message is typed or dropped later by the minute sweep, which records it in its own row
       (engine/messages.js held-delivered / held-dropped, `of` the message id). Typed, it counts from then. */
    const later = rows.filter((r) => r && r.of === key && (r.kind === 'held-delivered' || r.kind === 'held-dropped'));
    const dropped = later.find((r) => r.kind === 'held-dropped');
    const typed = later.find((r) => r.kind === 'held-delivered' && (r.state === 'placed' || r.state === 'unconfirmed'));
    if (typed && Number.isFinite(Date.parse(typed.at || ''))) {
      sentAt = Date.parse(typed.at);
      base.typedAt = typed.at;
    } else if (dropped) {
      return { ...base, status: STATUS.NOT_DELIVERED, delivery: 'dropped', droppedAt: dropped.at || null };
    } else {
      return { ...base, status: STATUS.NOT_DELIVERED, delivery: 'held' };
    }
  } else if (msg.state !== 'placed' && msg.state !== 'unconfirmed') {
    return { ...base, status: STATUS.NOT_DELIVERED, delivery: msg.state || null };
  }

  /* An answer by command: a direct message from the recipient to the sender, after this one. One that cites this
     message (--in-reply-to) is preferred; otherwise the first one after it, which may be about something else, and
     says so (`cites: false`). */
  const to = canon(msg.to);
  const from = canon(msg.from);
  // A held reply counts only once the sweep typed it (its held-delivered row), and from then: kept, it had not reached the sender.
  const typedAt = new Map();
  for (const x of rows) {
    if (x && x.kind === 'held-delivered' && (x.state === 'placed' || x.state === 'unconfirmed') && !typedAt.has(x.of)) typedAt.set(x.of, x.at);
  }
  const replyAt = (r) => Date.parse((r.state === 'held' ? typedAt.get(r.id) : r.at) || '');
  const back = rows.filter((r) => r && r.kind === 'message' && typeof r.to === 'string' && r.id !== key
    && canon(r.from) === to && canon(r.to) === from
    && (r.state === 'placed' || r.state === 'unconfirmed' || r.state === 'held')
    // One that cites another message is about that one; one from before a held message was typed cannot be about it.
    && (!r.in_reply_to || r.in_reply_to === key)
    && Number.isFinite(replyAt(r)) && replyAt(r) >= sentAt);
  const cited = back.find((r) => r.in_reply_to === key);
  const answer = cited || back[0];
  if (answer) return { ...base, status: STATUS.ANSWERED, answer: answer.id, answeredAt: iso(replyAt(answer)), cites: Boolean(cited) };

  let session = msg.to;
  try { session = (o && typeof o.sessionOf === 'function' && o.sessionOf(msg.to)) || msg.to; } catch { session = msg.to; }
  let hist = null;
  // The send time goes with it, so a reader can start with a short tail and widen only when it does not reach back.
  try { hist = o && typeof o.history === 'function' ? o.history(session, sentAt) : null; } catch { hist = null; }
  if (!Array.isArray(hist)) return { ...base, status: STATUS.UNKNOWN, because: 'there is no report history for ' + name };
  // A history cut after the send cannot say what happened between the send and its first row.
  if (hist.truncated === true && (!hist.length || hist[0].at > sentAt)) {
    return { ...base, status: STATUS.UNKNOWN, because: 'the report history kept for ' + name + ' does not reach back to this message' };
  }

  /* A start counts only when the agent was between turns (the mark before it is an end, a session mark, or none in
     a history that is not cut). Kosmos itself writes an automatic working row that carries the current sentence when
     a working agent posts to a room (server.js, the room post's project stamp), so a second "answering a prompt" with
     no end between is the same turn, not a new one. A turn cancelled with Esc (a start, then another start) is read
     as one turn by this: that errs toward "may have read it", never toward "read". In a cut history the mark before
     the first one kept is not known, so it is read as possibly mid-turn ('cut'), never as between turns.

     A deliberate needs_you or blocked (the agent's own, not the hook's) makes selfreport.record refuse the hook's
     automatic working and idle rows while it stands (#900), so turns then leave no marks. Any time one stood after
     the message arrived, only a turn seen whole counts; anything less is unknown, never "not read yet". */
  let started = null;
  let last = hist.truncated === true ? 'cut' : null;
  let before = last;   // the last mark before the message arrived
  let waitStood = false;
  let waiting = false;
  let sawMark = false;
  let maybeEnd = null;
  for (const row of hist) {
    if (!row) continue;
    if (row.at >= sentAt && waiting) waitStood = true;   // standing when this row came, so possibly at the send
    /* An automatic blocked (a provider stop) is a wait too: selfreport.record refuses the hook's working rows over it,
       as over the agent's own. The hook's permission ask (an automatic needs_you) is not: its rows still land. */
    if (row.state === 'needs_you' || row.state === 'blocked') waiting = row.by !== 'auto' || row.state === 'blocked';
    /* Anything else ends it: the agent's or a person's other report, a session's start or stop, and any automatic
       working or idle that was recorded at all, since the guard refuses those while a wait stands (the hook's
       turn-end idle is what clears a provider block, #6209). */
    else waiting = false;
    if (row.at >= sentAt && waiting) waitStood = true;
    const mark = turnMark(row);
    if (!mark) continue;
    sawMark = true;
    const prev = last;
    last = mark;
    if (!(row.at >= sentAt)) { before = mark; continue; }
    // A session's stop or restart ends the answer; a turn that had started after the message arrived is named with it.
    if (mark === 'session') return { ...base, status: STATUS.SESSION_ENDED, sessionAt: iso(row.at), ...(started !== null ? { turnStartedAt: iso(started) } : {}) };
    if (mark === 'start') { if (started === null && (prev === null || prev === 'end' || prev === 'session')) started = row.at; continue; }
    if (mark === 'end') {
      if (started !== null) return { ...base, status: STATUS.READ_NO_ANSWER, turnStartedAt: iso(started), turnEndedAt: iso(row.at) };
      // A turn already running at delivery ended: keep looking, since a whole turn after it is a firmer answer.
      if (maybeEnd === null) maybeEnd = row.at;
    }
  }
  if (waiting || waitStood) {
    return { ...base, status: STATUS.UNKNOWN, because: name + ' had a question or a block of its own standing, and while one stands its turn reports are not recorded' };
  }
  if (started !== null) return { ...base, status: STATUS.READING, turnStartedAt: iso(started) };
  if (maybeEnd !== null) return { ...base, status: STATUS.MAYBE_READ, turnEndedAt: iso(maybeEnd) };
  if (before === 'start') return { ...base, status: STATUS.IN_TURN };
  /* No turn mark anywhere in what is kept: the hook sends none (another provider, or none installed), so "between
     turns" was never seen and "not read yet" would be a guess. */
  if (!sawMark) return { ...base, status: STATUS.UNKNOWN, because: 'no turn reports from the report hook of ' + name + ' are recorded' };
  if (before === 'cut') return { ...base, status: STATUS.UNKNOWN, because: 'the report history kept for ' + name + ' does not show whether it was in a turn when your message arrived' };
  return { ...base, status: STATUS.NOT_YET };
}

/* The sentence both CLIs print. Plain words, no quote or backslash (the bash CLI lifts it with sed). Times are left
   as the board's ISO stamps; the CLI prints them as given. */
function sentence(s) {
  if (!s || s.found !== true) return (s && s.because) || 'we could not read that message';
  const who = String(s.to).replace(/["\\]/g, '');   // the name as typed: never a quote or backslash in the sentence
  const fyi = (s.replyExpected === false ? ' It was sent with --no-reply, so no answer was asked for.' : '')
    + (s.unsubmitted === true ? ' When it was typed, Kosmos saw it left unsent in its input box.' : '');
  switch (s.status) {
    case STATUS.ANSWERED:
      return who + ' answered by command: message ' + s.answer + ' at ' + s.answeredAt
        + (s.cites ? '.' : ' (it does not cite ' + s.id + ', so it may be about something else).');
    case STATUS.READ_NO_ANSWER:
      return who + ' started a turn after your message arrived (' + s.turnStartedAt + ') and finished it at ' + s.turnEndedAt
        + ' without sending you anything by command. If it answered, it answered in its own window, where you cannot see it.' + fyi;
    case STATUS.READING:
      return who + ' started a turn after your message arrived (' + s.turnStartedAt + ') and is still in it.' + fyi;
    case STATUS.MAYBE_READ:
      return who + ' was already in a turn when your message arrived; that turn ended at ' + s.turnEndedAt
        + ' without sending you anything by command. It may have read your message in that turn, or it may read it in its next one.' + fyi;
    case STATUS.IN_TURN:
      return who + ' was already in a turn when your message arrived, and that turn has not ended. It may be reading your message now, or it may read it in its next turn.' + fyi;
    case STATUS.NOT_YET:
      return who + ' has not started or finished a turn since your message arrived, so it has not read it yet.' + fyi;
    case STATUS.SESSION_ENDED:
      if (s.turnStartedAt) return who + ' started a turn after your message arrived (' + s.turnStartedAt + '), then its session stopped or restarted at ' + s.sessionAt + ' before it sent you anything by command.';
      return 'The session of ' + who + ' stopped or restarted at ' + s.sessionAt + ' before it answered; your message may not have been read.';
    case STATUS.NOT_DELIVERED:
      if (s.delivery === 'dropped') return 'Message ' + s.id + ' was never typed to ' + who + ': Kosmos kept it, then dropped it' + (s.droppedAt ? ' at ' + s.droppedAt : '') + ', and told you then.';
      return 'Message ' + s.id + ' has not been typed to ' + who + ' (its record reads ' + (s.delivery || 'unknown') + ').';
    default:
      return 'Kosmos cannot tell whether ' + who + ' read message ' + s.id + ': ' + (s.because || 'its report history cannot say') + '.';
  }
}

module.exports = { status, sentence, STATUS, turnMark, ID_RE };

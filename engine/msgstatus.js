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
 * Pure apart from the two readers, which the caller passes in (the route passes the real ones, the tests stubs).
 */

const STATUS = Object.freeze({
  ANSWERED: 'answered',            // the recipient sent a message back to the sender after this one
  READ_NO_ANSWER: 'read_no_answer', // a turn started after delivery and ended, and nothing came back by command
  READING: 'reading',              // a turn started after delivery and has not ended
  MAYBE_READ: 'maybe_read',        // a turn already running at delivery ended after it, and nothing came back
  NOT_YET: 'not_yet',              // no turn has started or ended since delivery
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
 *   history:   (sessionName) -> selfreport.history rows (with `turn` marks) or null
 *   sessionOf: (name) -> the recipient's session name (the roster's card), or the name itself
 *   asker:     optional; when given, only the sender or the recipient may read the status
 */
function status(id, o) {
  const key = String(id == null ? '' : id).trim();
  if (!ID_RE.test(key)) return { found: false, because: 'that is not a message id; ids look like m12' };
  const rows = Array.isArray(o && o.rows) ? o.rows : [];
  // A direct message only: a room post has many readers and its own answered/unanswered tracking (#4612).
  const msg = rows.find((r) => r && r.kind === 'message' && r.id === key && typeof r.to === 'string');
  if (!msg) return { found: false, because: 'there is no direct message ' + key + ' on this board' };
  if (o && typeof o.asker === 'string' && o.asker !== msg.from && o.asker !== msg.to) {
    return { found: false, because: 'message ' + key + ' was not sent by you or to you' };
  }
  const base = { found: true, id: key, from: msg.from, to: msg.to, at: msg.at,
    ...(msg.replyExpected === false ? { replyExpected: false } : {}) };
  const sentAt = Date.parse(msg.at || '');
  if (!Number.isFinite(sentAt)) return { ...base, status: STATUS.UNKNOWN, because: 'the message has no time on its record' };
  if (msg.state !== 'placed' && msg.state !== 'unconfirmed') {
    return { ...base, status: STATUS.NOT_DELIVERED, delivery: msg.state || null };
  }

  /* An answer by command: a direct message from the recipient to the sender, after this one. One that cites this
     message (--in-reply-to) is preferred; otherwise the first one after it, which may be about something else, and
     says so (`cites: false`). */
  const back = rows.filter((r) => r && r.kind === 'message' && r.from === msg.to && r.to === msg.from
    && (r.state === 'placed' || r.state === 'unconfirmed' || r.state === 'held')
    && Number.isFinite(Date.parse(r.at || '')) && Date.parse(r.at) >= sentAt && r.id !== key);
  const cited = back.find((r) => r.in_reply_to === key);
  const answer = cited || back[0];
  if (answer) return { ...base, status: STATUS.ANSWERED, answer: answer.id, answeredAt: answer.at, cites: Boolean(cited) };

  let session = msg.to;
  try { session = (o && typeof o.sessionOf === 'function' && o.sessionOf(msg.to)) || msg.to; } catch { session = msg.to; }
  let hist = null;
  try { hist = o && typeof o.history === 'function' ? o.history(session) : null; } catch { hist = null; }
  if (!Array.isArray(hist)) return { ...base, status: STATUS.UNKNOWN, because: 'there is no report history for ' + msg.to };
  // A history cut after the send cannot say what happened between the send and its first row.
  if (hist.truncated === true && (!hist.length || hist[0].at > sentAt)) {
    return { ...base, status: STATUS.UNKNOWN, because: 'the report history kept for ' + msg.to + ' does not reach back to this message' };
  }

  /* A start counts only when the agent was between turns (the mark before it is an end, a session mark, or none).
     Kosmos itself writes an automatic working row that carries the current sentence when a working agent posts to a
     room (server.js, the room post's project stamp), so a second "answering a prompt" with no end between is the
     same turn, not a new one. A turn cancelled with Esc (a start, then another start) is read as one turn by this:
     that errs toward "may have read it", never toward "read". */
  let started = null;
  let last = null;
  for (const row of hist) {
    const mark = turnMark(row);
    if (!mark) continue;
    const prev = last;
    last = mark;
    if (!(row.at >= sentAt)) continue;
    if (mark === 'session') return { ...base, status: STATUS.SESSION_ENDED, sessionAt: iso(row.at) };
    if (mark === 'start') { if (started === null && prev !== 'start') started = row.at; continue; }
    if (mark === 'end') {
      if (started !== null) return { ...base, status: STATUS.READ_NO_ANSWER, turnStartedAt: iso(started), turnEndedAt: iso(row.at) };
      return { ...base, status: STATUS.MAYBE_READ, turnEndedAt: iso(row.at) };
    }
  }
  if (started !== null) return { ...base, status: STATUS.READING, turnStartedAt: iso(started) };
  return { ...base, status: STATUS.NOT_YET };
}

/* The sentence both CLIs print. Plain words, no quote or backslash (the bash CLI lifts it with sed). Times are left
   as the board's ISO stamps; the CLI prints them as given. */
function sentence(s) {
  if (!s || s.found !== true) return (s && s.because) || 'we could not read that message';
  const who = s.to;
  const fyi = s.replyExpected === false ? ' It was sent with --no-reply, so no answer was asked for.' : '';
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
    case STATUS.NOT_YET:
      return who + ' has not started or finished a turn since your message arrived, so it has not read it yet.' + fyi;
    case STATUS.SESSION_ENDED:
      return who + '’s session stopped or restarted at ' + s.sessionAt + ' before it answered; your message may not have been read.';
    case STATUS.NOT_DELIVERED:
      return 'Message ' + s.id + ' has not been typed to ' + who + ' (its record reads ' + (s.delivery || 'unknown') + ').';
    default:
      return 'Kosmos cannot tell whether ' + who + ' read message ' + s.id + ': ' + (s.because || 'its report history cannot say') + '.';
  }
}

module.exports = { status, sentence, STATUS, turnMark, ID_RE };

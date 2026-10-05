'use strict';
/**
 * kosmos#5297 (and #4890's running-agent half): telling a RUNNING agent that a section of its instructions file changed.
 *
 * An agent reads its instructions file once, when its session starts (engine/instructions.js), so a section rewritten
 * while it runs reaches it only at its next restart. A user's 0.7.22 report (Josh, 2026-10-05) found five running agents
 * still following the community rules and the CLI text they started with, days after both changed. Kosmos now writes two
 * such changes while agents run, and each one owes the agent a line telling it to read that section again:
 *   - community: the Kosmos+ community block, refreshed at every board start (communityblock.refreshEveryone);
 *   - rules: the working rules, rewritten only when the person accepts the refresh (engine/doctrine.js refresh, #539).
 *
 * chat drops a line it cannot place (the shared-quota hold, a busy or unreachable pane), so the debt is kept on disk
 * until a line lands (see settle) and the board retries it. { session: { at, n, sections: [...] } }: `at` is when the
 * debt began, `n` counts every owe, so a pass clears only the debt it sent and never one owed again while it was sending.
 * Atomic tmp + rename; an unreadable or odd file reads as empty. A debt ends without a line when the agent has started a
 * session since it began (startedSince: it read the new file at that start), or after GIVE_UP_MS.
 *
 * passOnce delivers. It types only into an IDLE card of ours that was idle at the previous pass too (the rule the
 * community turn and the reply nudge use): a line typed into a permission prompt or a question menu would be submitted
 * as its highlighted default, approving or answering for the person (engine/chat.js).
 */
const fs = require('node:fs');
const path = require('node:path');

const GIVE_UP_MS = 7 * 24 * 60 * 60 * 1000;
const SECTIONS = Object.freeze({
  community: 'the section headed "The Kosmos+ community"',
  rules: 'the working rules (Kosmos updated them with your person\'s OK)',
});

function file() { return path.join(require('./store').ROOT, 'instruction-reread.json'); }

function readOwed() {
  try {
    const d = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
    const out = {};
    for (const [k, v] of Object.entries(d)) {
      if (!k || !v || typeof v !== 'object' || !Number.isFinite(v.at) || !Array.isArray(v.sections)) continue;
      const sections = v.sections.filter((s) => Object.prototype.hasOwnProperty.call(SECTIONS, s));
      if (sections.length) out[k] = { at: v.at, n: Number.isInteger(v.n) ? v.n : 1, sections };
    }
    return out;
  } catch { return {}; }
}

function writeOwed(owed) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(owed) + '\n');
    fs.renameSync(tmp, file());
    return true;
  } catch { return false; }
}

/* Pure: the map with `section` owed to `session`. The first debt's time is kept, so a section owed again does not
   postpone giving up. */
function owe(owed, session, section, now = Date.now()) {
  if (!session || !Object.prototype.hasOwnProperty.call(SECTIONS, section)) return { ...owed };
  const cur = owed[session];
  const sections = cur ? [...new Set([...cur.sections, section])] : [section];
  return { ...owed, [session]: { at: cur ? cur.at : now, n: (cur && Number.isInteger(cur.n) ? cur.n : 0) + 1, sections } };
}

/* Read, owe and write in one step, for a caller that is not holding the map. */
function oweNow(session, section, now = Date.now()) {
  return writeOwed(owe(readOwed(), session, section, now));
}

/* Pure: the map after one delivery verdict. A line that landed clears the agent's whole debt (it named every section
   owed); anything else keeps it, until GIVE_UP_MS. */
function settle(owed, session, verdict, DELIVERY, now = Date.now()) {
  const next = { ...owed };
  const state = verdict && verdict.state;
  const landed = Boolean(DELIVERY) && (state === DELIVERY.PLACED || state === DELIVERY.UNCONFIRMED)
    && !(verdict && (verdict.held === true || verdict.busy === true));
  if (landed || !next[session] || now - next[session].at > GIVE_UP_MS) delete next[session];
  return next;
}

/* Pure: has the agent started a session since the debt began? `rows` is engine/selfreport.history (oldest first); a
   'started' report is written at every session start. true, false, or null when the history is unknown (keep the debt). */
function startedSince(rows, at) {
  if (!Array.isArray(rows)) return null;
  return rows.some((r) => r && r.state === 'started' && Number.isFinite(r.at) && r.at > at);
}

/* Pure: the file's debts after a pass, given what the pass ended: { session: n } (the `n` of the debt it ended). A debt
   owed again during the pass has a larger `n`, so it survives. */
function mergeCleared(latest, cleared) {
  const next = { ...latest };
  for (const [session, n] of Object.entries(cleared || {})) {
    if (next[session] && next[session].n === n) delete next[session];
  }
  return next;
}

/* The one line for an agent's debt, naming every section it owes. */
function lineFor(sections) {
  const named = (Array.isArray(sections) ? sections : []).filter((s) => Object.prototype.hasOwnProperty.call(SECTIONS, s));
  if (!named.length) return null;
  const list = named.map((s) => SECTIONS[s]);
  const what = list.length === 1 ? list[0] : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
  return 'Kosmos here: your instructions file has changed since you started. Read ' + what + ' in it again now. '
    + 'What it says now replaces what you read when you started.';
}


/*
 * One delivery pass. Never throws. Everything it reads or sends is injected, so it is tested without a board:
 *   roster()      the board's cards (safeRoster); null or empty leaves every debt for a later pass
 *   isIdle(card)  agentnudge.nudgeableCard: an idle card of ours
 *   seenIdle      a Set kept by the caller across passes: the sessions idle at the previous pass (refilled here)
 *   history(s)    engine/selfreport.history
 *   allowed()     live execution
 *   deliver(s, line, roster)  chat.deliverAutomaticAsync; DELIVERY: chat.DELIVERY
 *   read()/write(owed)        the debt file (readOwed / writeOwed by default)
 * Returns [{ session, act }] for the log: 'sent' | 'kept' | 'not-idle' | 'restarted' | 'gone' | 'expired'.
 */
async function passOnce(o) {
  const out = [];
  try {
    const read = typeof o.read === 'function' ? o.read : readOwed;
    const write = typeof o.write === 'function' ? o.write : writeOwed;
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    let roster = null;
    try { roster = o.roster(); } catch { roster = null; }
    const seen = o.seenIdle instanceof Set ? new Set(o.seenIdle) : new Set();
    if (!Array.isArray(roster) || !roster.length) { if (o.seenIdle instanceof Set) o.seenIdle.clear(); return out; }
    const idleNow = new Set();
    const isIdle = (c) => { try { return o.isIdle(c) === true; } catch { return false; } };
    for (const c of roster) if (c && c.sessionName && isIdle(c)) idleNow.add(String(c.sessionName));
    if (o.seenIdle instanceof Set) { o.seenIdle.clear(); for (const s of idleNow) o.seenIdle.add(s); }
    let owed = read();
    const cleared = {};
    const end = (session, act) => { cleared[session] = owed[session].n; out.push({ session, act }); };
    const ours = new Set(roster.filter((c) => c && c.isNamedOurs === true).map((c) => String(c.sessionName)));
    for (const session of Object.keys(owed)) {
      const debt = owed[session];
      if (now - debt.at > GIVE_UP_MS) { end(session, 'expired'); continue; }
      if (!ours.has(session)) { end(session, 'gone'); continue; }
      let rows = null;
      try { rows = o.history(session); } catch { rows = null; }
      if (startedSince(rows, debt.at) === true) { end(session, 'restarted'); continue; }
      if (!idleNow.has(session) || !seen.has(session)) { out.push({ session, act: 'not-idle' }); continue; }
      let ok = false;
      try { ok = o.allowed() === true; } catch { ok = false; }
      if (!ok) break;
      const line = lineFor(debt.sections);
      if (!line) { end(session, 'expired'); continue; }
      let v = null;
      try { v = await o.deliver(session, line, roster); } catch { v = null; }
      const after = settle(owed, session, v, o.DELIVERY, now);
      if (after[session]) out.push({ session, act: 'kept', state: (v && v.state) || null });
      else end(session, 'sent');
    }
    write(mergeCleared(read(), cleared));
  } catch { /* the next pass tries again */ }
  return out;
}

module.exports = { GIVE_UP_MS, SECTIONS, file, readOwed, writeOwed, owe, oweNow, settle, startedSince, mergeCleared, lineFor, passOnce };

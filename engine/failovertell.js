'use strict';
/* #5382 (review 8): telling an agent which of its parts the Assigner's failover gave to another agent while it was
 * at its usage limit, so it does not carry on with them once the limit lifts.
 *
 * THE OBLIGATION LIVES ON THE PART (tasks.assignPart's `owedTell`), not in anybody's memory: a failover move adds its
 * source, and the mark comes off only when a line naming the part has reached that agent (tasks.markMoveTold). So a
 * board restart, the failover or the Assigner being switched off, a pause of a week, a missed try and a chain of moves
 * (A -> B -> C owes A and B) all still end in exactly one line per agent per part. The previous design (an in-memory
 * "limit lifted" transition, and agyquota looking back six hours) lost each of those (review 8).
 *
 * Two senders use this one selector: the sweep below, for an agent that reads idle, and agyquota's carry-on line for an
 * Antigravity agent at its quota reset (engine/agyquota.js nudgeText), which marks what it named once that line has
 * reached the pane. The sweep runs whatever the failover setting says, because the parts were already moved.
 *
 * Pure apart from the injected deliver and markTold; never throws.
 */

const tasks = require('./tasks');

/* At most this many lines a pass: a board where many agents are owed one does not type into all of them at once. */
const MAX_PER_PASS = 3;

/* Does any open part in these records owe anybody a line? The sweep's cheap first look (review 9): on almost every
   board nothing does, and then it reads no roster at all. */
function anyOwed(records) {
  for (const p of Array.isArray(records) ? records : []) {
    for (const t of Array.isArray(p && p.tasks) ? p.tasks : []) {
      for (const x of Array.isArray(t && t.parts) ? t.parts : []) {
        if (x && !x.closedAt && Array.isArray(x.owedTell) && x.owedTell.length) return true;
      }
    }
  }
  return false;
}

/* The open parts `session` is owed a line about: the part is not finished, its task not closed, the session is in its
   owedTell and does not hold it now, SOMEBODY else does (review 9: a part moved to nobody, or unassigned since, was
   not "given to another agent"), and the project is live, still has the session as a member and has not switched it
   off (#3564: no line about a project reaches a swarm switched off there). Each as { projectId, n, partId, who, phrase }. */
function owedFor(session, records) {
  const out = [];
  if (typeof session !== 'string' || !session) return out;
  const projects = require('./projects');
  for (const p of Array.isArray(records) ? records : []) {
    if (!p || typeof p.id !== 'string' || p.archived === true) continue;
    if (!(Array.isArray(p.agents) && p.agents.includes(session))) continue;
    let off = false;
    try { off = projects.isSwarmOff(p, session) === true; } catch { off = false; }
    if (off) continue;
    for (const t of Array.isArray(p.tasks) ? p.tasks : []) {
      if (typeof t.number !== 'number') continue;
      const prog = tasks.progressOf(t);
      if (prog.closed) continue;
      for (const x of prog.parts) {
        if (x.closedAt || !x.who || x.who === session || !Array.isArray(x.owedTell) || !x.owedTell.includes(session)) continue;
        const where = String(p.name || p.id).replace(/[\r\n"]/g, ' ');
        out.push({ projectId: p.id, n: t.number, partId: x.id, who: x.who || null,
          phrase: 'task ' + t.number + ' in "' + where + '" (now ' + x.who + '\'s)' });
      }
    }
  }
  return out;
}

/* The sweep's line, naming every owed part. */
function lineFor(items) {
  const one = items.length === 1;
  return '[Kosmos: while you were at your usage limit, ' + items.map((i) => i.phrase).join(', ') + (one ? ' was' : ' were')
    + ' given to another agent. Leave ' + (one ? 'it' : 'those') + ' to them; the task\'s room has what they did.]';
}

/* Did a delivery verdict (maybe) reach the pane? Anything but COULD_NOT, and never a held line (the quota or the Gemini
   cap typed nothing), the same reading the Assigner's other senders use. */
function reached(v, DELIVERY) {
  if (!v || v.held === true) return false;
  const D = DELIVERY || {};
  return v.state != null && v.state !== D.COULD_NOT;
}

/* Mark every item told to `session`. */
function markAll(session, items, markTold) {
  for (const i of items) { try { markTold(i.projectId, i.n, i.partId, session); } catch { /* the next pass tells again */ } }
}

/* One pass: each of our cards that reads idle (isIdle) now AND read idle at the previous pass (seenIdle, a Set the
   caller keeps between passes: a card is never typed into the moment it goes idle, between an agent's reply and the
   person's next message), that the caller does not skip, and is owed a line gets one. What a line may have reached is
   marked told. Only lines that may have reached a pane count toward MAX_PER_PASS (review 9: agents that cannot be
   reached must not take every slot each pass and starve the rest).
   o = { roster, records, isIdle(card), seenIdle (Set), skip(card)?, deliver(session, text, roster) -> verdict,
   markTold, DELIVERY, max? }. Returns [{ session, n, verdict }]. */
function sweepOnce(o) {
  const out = [];
  try {
    const roster = Array.isArray(o && o.roster) ? o.roster : [];
    const max = Number.isInteger(o.max) ? o.max : MAX_PER_PASS;
    const seen = o.seenIdle instanceof Set ? o.seenIdle : null;
    const idleNow = new Set();
    let landed = 0;
    for (const card of roster) {
      if (!card || !card.sessionName || card.isNamedOurs !== true) continue;
      let idle = false;
      try { idle = o.isIdle(card) === true; } catch { idle = false; }
      if (!idle) continue;
      idleNow.add(card.sessionName);
      if (landed >= max) continue;
      if (seen && !seen.has(card.sessionName)) continue;
      let skip = false;
      if (typeof o.skip === 'function') { try { skip = o.skip(card) === true; } catch { skip = true; } }
      if (skip) continue;
      const items = owedFor(card.sessionName, o.records);
      if (!items.length) continue;
      let v = null;
      try { v = o.deliver(card.sessionName, lineFor(items), roster); } catch { v = null; }
      if (reached(v, o.DELIVERY)) { markAll(card.sessionName, items, o.markTold); landed += 1; }
      out.push({ session: card.sessionName, n: items.length, verdict: (v && v.state) || null });
    }
    if (seen) { seen.clear(); for (const s of idleNow) seen.add(s); }
  } catch { /* never breaks the caller's tick */ }
  return out;
}

module.exports = { MAX_PER_PASS, anyOwed, owedFor, lineFor, reached, markAll, sweepOnce };

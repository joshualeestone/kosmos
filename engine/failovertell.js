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
 * reached the pane. The sweep runs whatever the failover setting says, because the parts were already moved. It does
 * NOT skip Antigravity agents (review 10): its line to one adds "carry on with the rest", so whichever of the two
 * lines lands first does the whole job, and the other finds nothing owed.
 *
 * Pure apart from the injected deliver and markTold; never throws.
 */

const tasks = require('./tasks');

/* At most this many lines a pass: a board where many agents are owed one does not type into all of them at once. */
const MAX_PER_PASS = 3;

/* Is `session` owed a line about part `x` of task `t` in project `p`? It is in the part's owedTell and does not hold it
   now, SOMEBODY else does (review 9: a part moved to nobody, or unassigned since, was not "given to another agent"), and
   the project is live, still has the session as a member and has not switched it off (#3564: no line about a project
   reaches a swarm switched off there). A FINISHED part (or one of a closed task) is still owed (review 10): the agent
   may still be mid-way through it in its own conversation, and resuming would redo work somebody else finished. */
function owes(p, x, session) {
  if (!p || typeof p.id !== 'string' || p.archived === true || !x) return false;
  if (!Array.isArray(x.owedTell) || !x.owedTell.includes(session) || !x.who || x.who === session) return false;
  if (!(Array.isArray(p.agents) && p.agents.includes(session))) return false;
  try { if (require('./projects').isSwarmOff(p, session) === true) return false; } catch { /* not switched off */ }
  return true;
}

/* Does any part in these records owe anybody a line that owedFor would give? The sweep's cheap first look (review 9),
   by the same rule (review 10), so a record that can never be told does not keep the roster read alive. */
function anyOwed(records) {
  for (const p of Array.isArray(records) ? records : []) {
    for (const t of Array.isArray(p && p.tasks) ? p.tasks : []) {
      for (const x of tasks.partsOf(t)) {
        if (Array.isArray(x.owedTell) && x.owedTell.some((s) => owes(p, x, s))) return true;
      }
    }
  }
  return false;
}

/* The parts `session` is owed a line about (owes), open or finished, each as { projectId, n, partId, who, done, phrase }:
   "task N in "P" (now B's)" for one still open, "(finished by B)" for one that is done. */
function owedFor(session, records) {
  const out = [];
  if (typeof session !== 'string' || !session) return out;
  for (const p of Array.isArray(records) ? records : []) {
    for (const t of Array.isArray(p && p.tasks) ? p.tasks : []) {
      if (typeof t.number !== 'number') continue;
      const prog = tasks.progressOf(t);
      for (const x of prog.parts) {
        if (!owes(p, x, session)) continue;
        const done = Boolean(x.closedAt || prog.closed);
        const where = String(p.name || p.id).replace(/[\r\n"]/g, ' ');
        out.push({ projectId: p.id, n: t.number, partId: x.id, who: x.who, done,
          phrase: 'task ' + t.number + ' in "' + where + '" (' + (done ? 'finished by ' + x.who : 'now ' + x.who + '\'s') + ')' });
      }
    }
  }
  return out;
}

/* The sweep's line, naming every owed part. `resume`: the agent's own limit is over and it may be waiting to carry on
   (an Antigravity agent at its quota reset, whose carry-on line this may be typed before, review 10), so the line says
   to carry on with the rest; whichever of the two lands first does the whole job. */
function lineFor(items, { resume = false } = {}) {
  const one = items.length === 1;
  return '[Kosmos: while you were at your usage limit, ' + items.map((i) => i.phrase).join(', ') + (one ? ' was' : ' were')
    + ' given to another agent. Leave ' + (one ? 'it' : 'those') + ' to them; the task\'s room has what they did.'
    + (resume ? ' Then carry on with the rest of what you were doing.' : '') + ']';
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
   o = { roster, records, isIdle(card), seenIdle (Set), skip(card)?, resumeFor(card)? (the line adds "carry on"),
   deliver(session, text, roster) -> verdict, markTold, DELIVERY, max? }. Returns [{ session, n, verdict }]. */
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
      let resume = false;
      if (typeof o.resumeFor === 'function') { try { resume = o.resumeFor(card) === true; } catch { resume = false; } }
      try { v = o.deliver(card.sessionName, lineFor(items, { resume }), roster); } catch { v = null; }
      if (reached(v, o.DELIVERY)) { markAll(card.sessionName, items, o.markTold); landed += 1; }
      out.push({ session: card.sessionName, n: items.length, verdict: (v && v.state) || null });
    }
    if (seen) { seen.clear(); for (const s of idleNow) seen.add(s); }
  } catch { /* never breaks the caller's tick */ }
  return out;
}

module.exports = { MAX_PER_PASS, owes, anyOwed, owedFor, lineFor, reached, markAll, sweepOnce };

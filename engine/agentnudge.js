'use strict';

/*
 * #4544: the Prompter nudges the AGENT, not only the person (Josh's Automation spec: "Automatically
 * checks on your agents to ensure they continue working if they have tasks to complete").
 *
 * What was there. The Prompter (engine/heartbeat.js, run by server.js every interval) finds agents
 * in a stall and writes them to the person's check-in (engine/prompternudge.js, Settings'
 * #hb-nudges). The agent-facing half went with #2623 (it rode the phone-home POST) and #3508
 * rebuilt only the person's half. This is the agent's half, local: one message typed into the
 * agent's session through chat.deliver, the board's own typing path (engine/firstreply-nudge.js
 * and engine/connlost-heal.js use it the same way). Nothing leaves the Mac.
 *
 * Who is nudged, all of:
 *  - the Prompter holds an open stall episode for it this tick (heartbeat.step's toAsk). That
 *    already leaves out needs_you (a permission prompt, which needs the person), blocked (the agent
 *    reported it is waiting) and rate_limited;
 *  - it did not go idle on this very tick (an episode the Prompter opened on a working-to-idle edge
 *    is nudged one interval later, so an agent that just finished a turn is not nudged at once);
 *  - the Prompter read it as idle (toAsk's `to`), and its card reads idle, is ours, and is not a
 *    switched-off swarm (the Assigner's idleCard). Every other reading is left to the person's
 *    check-in, a low-confidence idle included (the Prompter reads it as unknown);
 *  - it holds an open part of a task in a live project where it is not switched off (openParts, the
 *    Assigner's hasOpenWork rule). An agent with none is the Assigner's lane, so the two never both
 *    poke one agent;
 *  - none of its open parts was given to it within the last interval (moved, or created on it), so
 *    an agent that was just told about its work is not told again.
 *
 * How often: one nudge per stall episode. The book entry is dropped when the Prompter's record
 * says the episode closed (the agent worked again, or reported blocked). A delivery that reached
 * nothing is retried on later ticks, up to MAX_TRIES. While Agent Communication's limit is on, nudges
 * across the board are capped at its per-hour number in any hour (a nudge is Kosmos to agent, so
 * there is no pair to charge).
 *
 * Known limit: the Prompter samples once an interval, so an agent that works for less than an
 * interval after its nudge and goes idle again is never seen working; its episode stays open and it
 * is not nudged again. One nudge per stall is the card's rule, and a timer that re-armed it would
 * also re-nudge an agent that answered in plain words that it is waiting.
 * Known limit: the book and the hour's log live in memory, as the Prompter's own record does, so a
 * board restart (every release) forgets them and a still-stalled agent is nudged once more, about one
 * interval after the restart (the Prompter opens a never-seen stall on its second tick).
 *
 * #4544 (Josh): the person's check-in lists only real stalls (realStalls), and prompterTick
 * is the whole of what the Prompter's tick does after heartbeat.step, so its gates are tested here.
 *
 * The planner is pure; the reads and the delivery are injected, so tests drive it without a pane.
 */

const HOUR_MS = 60 * 60 * 1000;
/* Tries that reached nothing (COULD_NOT, or a throw) before an episode is left alone, as in
   firstreply-nudge.js. */
const MAX_TRIES = 3;
/* The cap on a part's sentence in the typed line, so one long task cannot fill the pane. */
const SENTENCE_CAP = 160;

/* The open parts this agent holds in live projects. The same rule as assigner.hasOpenWork (a closed
   task, or one this agent marked built, holds nothing; agentnudge.test.js holds the two to agreement),
   narrowed to live projects because it must name a part the agent can pick up. */
function openParts(session, projects) {
  const tasks = require('./tasks');
  const out = [];
  for (const p of Array.isArray(projects) ? projects : []) {
    /* #4771: nothing in a paused project, and no task on hold, is the agent's work to be nudged about. */
    if (!p || p.archived === true || require('./projects').isPaused(p)) continue;
    for (const t of Array.isArray(p.tasks) ? p.tasks : []) {
      if (tasks.isOnHold(t)) continue;
      if (require('./taskrepeat').waitingForNextRun(t)) continue;   // #4787: between runs a repeating task holds no work
      const prog = tasks.progressOf(t);
      if (prog.closed || (t.builtAt && (t.builtFreesAll === true || (Array.isArray(t.builtWho) && t.builtWho.includes(session))))) continue;
      if (require('./projects').isSwarmOff(p, session)) continue;
      for (const x of prog.parts) {
        if (x.who !== session || x.closedAt) continue;
        /* When the part came to this agent: moved to it, or created on it (a part added with a who,
           or a task created with one, carries no movedAt). */
        const givenAt = x.movedAt || x.createdAt || t.createdAt || null;
        out.push({ projectId: p.id, project: typeof p.name === 'string' && p.name ? p.name : p.id, n: t.number, sentence: x.sentence || '', givenAt });
      }
    }
  }
  return out;
}

/* Words people and agents wrote, made safe to type as one line: control characters and double quotes
   out (chat.deliver refuses a control character, which would spend every try), whitespace flattened,
   cut on a character boundary. */
function plainWords(v, cap) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f"]/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(s);
  return chars.length > cap ? chars.slice(0, cap - 3).join('') + '...' : s;
}

function nudgeText(part) {
  const words = plainWords(part.sentence, SENTENCE_CAP);
  /* #4771 (review 2): the agent in Josh's 0.7.15 report was nudged here about a project its person had paused in the
     room. Its instructions teach `kosmos project pause` only after they are next re-written, so the nudge, which
     reaches a running agent at exactly that moment, names the verb too. */
  /* Review 3: only an id in the slug set the CLIs take as it is (and at most 80 characters, a cap of this hint's own;
     a longer id just gets no hint), so the hint can never name another
     project; and the hint says the pause must be the person's ask, and that the room is told who paused. */
  // Not all dots: both CLIs refuse such an id (review 4).
  const id = (typeof part.projectId === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(part.projectId) && /[^.]/.test(part.projectId)) ? part.projectId : '';
  return 'Kosmos here, from the Prompter: you have been idle while you still have open work: task #' + part.n
    + (words ? ' "' + words + '"' : '') + ' in ' + plainWords(part.project, SENTENCE_CAP) + '. Pick it up, or if you are waiting on something, '
    /* #5318: two states, two machines. blocked is a wait nobody chases (another agent, a deploy, a review); only
       needs_you is escalated (recommender.js, after its grace). Offering blocked alone sent person-blocked work there,
       where it went inert (0.7.22, a real install). The question is in SINGLE quotes: unquoted, a ? stops zsh with "no
       matches found" and an apostrophe opens a quote, and double quotes are kept to the two around the task sentence. */
    + 'say so: on another agent, a deploy or a review, kosmos report blocked --on <what> --owner <who>; '
    + 'on a person (a decision, a meeting, an answer), kosmos report needs_you \'<your question>\', which Kosmos follows up and blocked never is'
    + (id ? '. Only if your person asked in the room to pause this project: kosmos project pause ' + id + ' (the room is told you paused it)' : '');
}

/* A card the nudge may type into: the Assigner's own idleCard (ours, idle, not a paused swarm). */
function nudgeableCard(a) {
  return require('./assigner').idleCard(a);
}

/*
 * One agent's decision. card: its roster card; parts: openParts(); entry: its book entry;
 * now: epoch ms; intervalMs: the Prompter's interval; ask: its toAsk entry ({ session, from, to }).
 * Returns { act: 'none' | 'nudge', because, part? }.
 */
function plan(card, parts, entry, now, intervalMs, ask) {
  if (entry && entry.nudgedAt != null) return { act: 'none', because: 'already nudged in this stall' };
  if (entry && Number.isInteger(entry.tries) && entry.tries >= MAX_TRIES) return { act: 'none', because: 'gave up after ' + MAX_TRIES + ' tries that reached nothing' };
  if (!nudgeableCard(card)) return { act: 'none', because: 'not an idle card of ours' };
  if (!ask || ask.to !== 'idle') return { act: 'none', because: 'the Prompter did not read it as idle' };
  if (ask.from === 'working') return { act: 'none', because: 'went idle this interval; asked at the next one' };
  if (!Array.isArray(parts) || !parts.length) return { act: 'none', because: 'no open task in a live project (the Assigner\'s lane)' };
  const fresh = parts.some((x) => { const at = Date.parse(x.givenAt); return Number.isFinite(at) && now - at < intervalMs; });
  if (fresh) return { act: 'none', because: 'was given work within the last interval' };
  return { act: 'nudge', because: 'idle past the interval with open work', part: parts[0] };
}

/*
 * One pass, run by the Prompter's tick. o = { toAsk, next (heartbeat's record map), roster,
 * projects, book (Map session -> entry), sent (array of epoch ms, the board-wide log), now,
 * intervalMs, limit ({ on, perHour }), deliver(session, text, roster), DELIVERY, log }.
 * Returns { results }. Never throws.
 */
function sweepOnce(o) {
  const results = [];
  try {
    if (!o || !Array.isArray(o.roster)) return { results, skipped: 'roster unreadable' };
    const book = o.book instanceof Map ? o.book : new Map();
    const sent = Array.isArray(o.sent) ? o.sent : [];
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const intervalMs = Number.isFinite(o.intervalMs) && o.intervalMs > 0 ? o.intervalMs : 15 * 60 * 1000;
    const next = o.next instanceof Map ? o.next : new Map();
    const say = (r) => { if (typeof o.log === 'function') { try { o.log(r); } catch { /* never breaks a pass */ } } };
    releaseClosed(book, next);
    // The board-wide hour, for Agent Communication's limit.
    while (sent.length && now - sent[0] >= HOUR_MS) sent.shift();
    const cap = o.limit && o.limit.on === true && Number.isInteger(o.limit.perHour) ? o.limit.perHour : Infinity;
    const cards = new Map(o.roster.filter((a) => a && a.sessionName).map((a) => [a.sessionName, a]));
    for (const ask of Array.isArray(o.toAsk) ? o.toAsk : []) {
      const session = ask && ask.session;
      const card = session && cards.get(session);
      if (!card) continue;
      const display = plainWords(card.name || session, 80);
      // One agent's failure is recorded and the pass goes on to the next agent.
      try {
        const entry = book.get(session);
        const p = plan(card, openParts(session, o.projects), entry, now, intervalMs, ask);
        if (p.act !== 'nudge') continue;
        const text = nudgeText(p.part);
        if (sent.length >= cap) { say({ name: display, session, act: 'held', because: 'Agent Communication\'s limit of ' + cap + ' an hour is reached' }); continue; }
        let state = null;
        let held = false;
        try { const r = o.deliver(session, text, o.roster); state = r && r.state; held = Boolean(r && r.held === true); }
        catch (err) { state = 'threw: ' + String((err && err.message) || err); }
        /* #4588 PR B: held on the shared Google quota, nothing typed: no try is spent and nothing counts toward the hour. */
        if (held) { results.push({ session, name: display, act: 'quota-held', delivered: false, delivery: state, because: p.because, task: p.part.n }); continue; }
        const D = o.DELIVERY || {};
        const delivered = D.PLACED != null && state === D.PLACED;
        const mayHaveReached = delivered || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
        const tries = ((entry && Number.isInteger(entry.tries)) ? entry.tries : 0) + 1;
        book.set(session, { nudgedAt: mayHaveReached ? now : null, tries, delivery: state });
        if (mayHaveReached) sent.push(now);
        results.push({ session, name: display, act: 'nudge', delivered, delivery: state, because: p.because, task: p.part.n });
        // Logged when it may have reached the pane, on the first try, and when given up on (firstreply-nudge's rule).
        if (mayHaveReached || tries === 1 || tries >= MAX_TRIES) say({ name: display, session, act: 'nudge', delivered, delivery: state, because: p.because + ' (task #' + p.part.n + ')' });
      } catch (err) {
        results.push({ session, name: display, act: 'error', because: String((err && err.message) || err) });
      }
    }
  } catch { /* never throws: a pass is best-effort */ }
  return { results };
}

/* #4544 (Josh): the person's check-in lists only real stalls, not every idle agent: an agent in toAsk
   that still holds an open task in a live project (openParts, the nudge's own rule), or one that is
   signed out or has lost its connection. Those two stay whatever they hold: engine/heartbeat.js asks
   about them because they have no other path to the person. */
const BROKEN = new Set(['auth_failed', 'connection_lost']);
function realStalls(toAsk, projects) {
  return (Array.isArray(toAsk) ? toAsk : []).filter((n) => n && typeof n.session === 'string'
    && (BROKEN.has(n.to) || openParts(n.session, projects).length > 0));
}

/* Drop the book entry of every stall the Prompter's record says has closed (worked again, or reported
   blocked), so its next stall can be nudged. Run on every tick, gated or not. */
function releaseClosed(book, next) {
  if (!(book instanceof Map)) return;
  const rec = next instanceof Map ? next : new Map();
  for (const session of [...book.keys()]) {
    const r = rec.get(session);
    if (!r || r.open !== true) book.delete(session);
  }
}

/*
 * Everything the Prompter's tick does after heartbeat.step (server.js calls only this). o = {
 *   setting ({ on, intervalMinutes }), roster (the board's, null on a read failure), outcome (heartbeat.step's),
 *   readProjects(), shouldWrite(on, roster), write(list) (prompternudge's), allowed() (live execution),
 *   env, readLimit(), limitDefaults, book, sent, now, deliver, DELIVERY, log }.
 * The person's list: written when shouldWrite says so, filtered to real stalls; if the projects cannot be
 * read it is written whole (too many check-ins, never real ones hidden). The agent's nudge: only with the
 * Prompter on, live execution allowed and the brake off; an unreadable roster or projects nudges nobody
 * (sweepOnce refuses the roster, and no projects means no open parts).
 * Returns { written: list | null, nudged: sweepOnce's results | null }. Never throws.
 */
function prompterTick(o) {
  const out = { written: null, nudged: null };
  try {
    const setting = (o && o.setting) || { on: false };
    const toAsk = (o.outcome && Array.isArray(o.outcome.toAsk)) ? o.outcome.toAsk : [];
    // Nothing stalled means nothing to filter or nudge, so the projects are read only when there is.
    let records = null;
    if (toAsk.length) { try { const r = o.readProjects(); records = Array.isArray(r) ? r : null; } catch { records = null; } }
    if (o.shouldWrite(setting.on, o.roster)) {
      const shown = records ? realStalls(toAsk, records) : toAsk;
      try { o.write(shown); out.written = shown; } catch { /* best-effort */ }
    }
    // A closed stall frees its agent even while the nudge is off, so the next stall after it is nudged.
    if (o.outcome && o.outcome.next instanceof Map) releaseClosed(o.book, o.outcome.next);
    let allowed = false;
    try { allowed = o.allowed() === true; } catch { allowed = false; }
    if (setting.on === true && nudgeEnabled(allowed, o.env)) {
      let limit = { ...(o.limitDefaults || { on: true, perHour: 20 }) };
      try { const l = o.readLimit(); if (l && typeof l === 'object') limit = l; } catch { /* keep the default, which is on */ }
      out.nudged = sweepOnce({
        toAsk, next: o.outcome.next, roster: o.roster, projects: records, book: o.book, sent: o.sent,
        now: Number.isFinite(o.now) ? o.now : Date.now(), intervalMs: Number(setting.intervalMinutes) * 60 * 1000, limit,
        deliver: o.deliver, DELIVERY: o.DELIVERY, log: o.log,
      }).results;
    }
  } catch { /* never throws into the tick */ }
  return out;
}

/* THE one "does the agent nudge run" rule: live execution allowed and the operator brake off. */
function nudgeEnabled(allowed, env) {
  return allowed === true && (env || process.env).AGENT_WORKFORCE_AGENT_NUDGE_OFF !== '1';
}

module.exports = { plan, openParts, realStalls, releaseClosed, prompterTick, plainWords, nudgeText, nudgeableCard, sweepOnce, nudgeEnabled, MAX_TRIES, HOUR_MS };

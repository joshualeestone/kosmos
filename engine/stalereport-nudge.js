'use strict';

/*
 * #5959 slice 3 (the Windows agents' QA report, item 4: one agent carried a "blocked" from 09-26): an agent whose own
 * waiting report has stood over a day is told so ONCE, typed into its session the way firstreply-nudge.js does.
 * `kosmos report show` says the same thing when the agent asks (slice 1); this says it without being asked.
 *
 * Who is told, all of:
 *  - its latest report (selfreport.read) is a waiting one (needs_you or blocked, selfreport.WAITING_ON_A_PERSON),
 *    written at least STALE_WAIT_MS ago (selfreport.STALE_WAIT_MS, the threshold `kosmos report show` uses);
 *  - its card shows that report (stateReported, and the same state: the board's reconcile can set a report aside);
 *  - its card is ours and not a switched-off swarm.
 *
 * How often: once per report line. The book keys the reminder on the report's `at`, so a fresh report of the same
 * state starts a new day, and a report it re-made after the reminder is reminded about again only a day later. A
 * delivery that reached nothing is retried on later sweeps, up to MAX_TRIES.
 *
 * Known limit: the book lives in memory, so a board restart forgets it and a still-stale report is reminded about once
 * more after the restart. So the typed line says "a reminder", not "a one-time reminder".
 *
 * The planner is pure; the reads and the delivery are injected, so tests drive it without a pane.
 */

const selfreport = require('./selfreport');
const cardlabel = require('./cardlabel');

/* Tries that reached nothing (COULD_NOT, or a throw) before a report is left alone, as in firstreply-nudge.js. */
const MAX_TRIES = 3;

/* The line typed into the agent, in the words `kosmos report show` uses for the same report (server.js), so the agent
   is taught one command. Kosmos's own words only: the report's `on` text is the agent's and is not repeated to it. */
function nudgeText(rep, ageMs) {
  const age = cardlabel.standingFor(ageMs);
  const passed = rep.state === 'blocked' ? 'If it is no longer in your way' : 'If nobody needs to answer it any more';
  const whose = rep.by === 'agent' ? 'Your own `' + rep.state + '` report'
    : rep.by === 'auto' ? 'A `' + rep.state + '` report Kosmos wrote for you'
      : 'This `' + rep.state + '` report';   // someone else, or no writer recorded: named as report show names it
  const todo = rep.by === 'auto' ? 'If what it was about has passed' : passed;
  return 'Kosmos here, a reminder: ' + whose + ' has been standing on your card for ' + age + '. '
    + todo + ', clear it with: kosmos report clear. If it still holds, leave it. To see your card as the person sees it, run: kosmos report show';
}

function plan(card, rep, entry, now) {
  if (!card || !rep || rep.found !== true) return { act: 'none', because: 'no report' };
  if (!selfreport.WAITING_ON_A_PERSON.includes(rep.state)) return { act: 'none', because: 'its report is not a waiting one' };
  /* The card shows THE REPORT, not only its state: reconcile can show a screen reading of the same state over a report
     it set aside, and then stateReported is false. */
  if (card.stateReported !== true || card.state !== rep.state) return { act: 'none', because: 'its card does not show that report' };
  const at = typeof rep.at === 'string' ? Date.parse(rep.at) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(now)) return { act: 'none', because: 'no readable time for its report' };
  // The comparison `kosmos report show` uses (over STALE_WAIT_MS), so the two agree on which report is stale.
  if (!(now - at > selfreport.STALE_WAIT_MS)) return { act: 'none', because: 'its report is not over a day old' };
  if (entry && entry.forAt === rep.at && entry.nudgedAt != null) return { act: 'none', because: 'already reminded about this report' };
  if (entry && entry.forAt === rep.at && Number.isInteger(entry.tries) && entry.tries >= MAX_TRIES) {
    return { act: 'none', because: 'gave up after ' + MAX_TRIES + ' tries that reached nothing' };
  }
  return { act: 'nudge', ageMs: now - at, because: 'its ' + rep.state + ' report has stood ' + cardlabel.standingFor(now - at) };
}

function pauseNow(session) {
  return require('./swarm').pauseOf(require('./store').readProfile(session));
}

function sweepOnce(o) {
  const results = [];
  try {
    if (!o || !Array.isArray(o.roster)) return { results, skipped: 'roster unreadable' };
    const book = o.book instanceof Map ? o.book : new Map();
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const readReport = typeof o.report === 'function' ? o.report : (s) => selfreport.read(s);
    const pauseFor = typeof o.paused === 'function' ? o.paused : pauseNow;
    const log = typeof o.log === 'function' ? o.log : null;
    const say = (r) => { if (log) { try { log(r); } catch { /* never breaks a sweep */ } } };
    for (const card of o.roster) {
      const session = card && card.sessionName;
      if (!session || card.isNamedOurs === false) continue;
      if (!selfreport.WAITING_ON_A_PERSON.includes(card.state)) continue;   // read a report only for a waiting card
      let rep = null;
      try { rep = readReport(session); } catch { rep = null; }
      const entry = book.get(session);
      const p = plan(card, rep, entry, now);
      if (p.act !== 'nudge') continue;
      let pz = null;
      try { pz = pauseFor(session); } catch { pz = null; }
      if (pz && pz.paused === true) continue;
      const display = card.name || session;
      let state = null;
      let held = false;
      let heldBy = null;
      try { const r = o.deliver(session, nudgeText(rep, p.ageMs), o.roster); state = r && r.state; held = Boolean(r && r.held === true); heldBy = r && (r.heldFor === 'signin' ? 'signin' : r.heldBy) || null; }
      catch (err) { state = 'threw: ' + String((err && err.message) || err); }
      /* Held (a quota, a limit, a sign-in, an answer awaited on its screen): nothing typed and no try spent. Logged once
         per report with what held it, so a person asking why an agent was never reminded finds the answer in the log. */
      if (held) {
        const why = p.because + '; held' + (heldBy ? ' (' + heldBy + ')' : '');
        results.push({ session, name: display, act: 'held', heldBy, delivered: false, delivery: state, because: why });
        if (!entry || entry.heldSaidFor !== rep.at) {
          book.set(session, { ...(entry && entry.forAt === rep.at ? entry : {}), forAt: rep.at, heldSaidFor: rep.at });
          say({ name: display, session, act: 'held', delivered: false, delivery: state, because: why });
        }
        continue;
      }
      const D = o.DELIVERY || {};
      const delivered = D.PLACED != null && state === D.PLACED;
      const mayHaveReached = delivered || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
      const tries = ((entry && entry.forAt === rep.at && Number.isInteger(entry.tries)) ? entry.tries : 0) + 1;
      book.set(session, { forAt: rep.at, nudgedAt: mayHaveReached ? now : null, tries, delivery: state, heldSaidFor: entry && entry.heldSaidFor });
      results.push({ session, name: display, act: 'nudge', delivered, delivery: state, because: p.because });
      if (mayHaveReached || tries === 1 || tries >= MAX_TRIES) say({ name: display, session, act: 'nudge', delivered, delivery: state, because: p.because });
    }
  } catch { /* never throws: a sweep is best-effort */ }
  return { results };
}

/* THE one "does the nudge run" rule: live execution allowed and the operator brake off. */
function nudgeEnabled(allowed, env) {
  return allowed === true && (env || process.env).AGENT_WORKFORCE_STALEREPORT_NUDGE_OFF !== '1';
}

/* The server's per-tick wrapper, separate so its gating is testable. Never throws. */
function makeTick(deps) {
  return function tick() {
    try {
      if (!nudgeEnabled(deps.allowed() === true, deps.env)) return null;
      const roster = deps.roster();
      if (!Array.isArray(roster)) return null;
      return sweepOnce({
        roster, book: deps.book, now: deps.now ? deps.now() : Date.now(),
        report: deps.report, paused: deps.paused, deliver: deps.deliver, DELIVERY: deps.DELIVERY, log: deps.log,
      });
    } catch { return null; }
  };
}

module.exports = { plan, nudgeText, sweepOnce, makeTick, nudgeEnabled, MAX_TRIES };

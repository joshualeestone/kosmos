'use strict';

/*
 * #5959 slice 3 (the Windows agents' QA report, item 4: one agent carried a "blocked" from 09-26): an agent whose own
 * `blocked` report has stood over a day is told so ONCE, typed into its session the way firstreply-nudge.js does.
 * `kosmos report show` says the same thing when the agent asks (slice 1); this says it without being asked.
 *
 * Who is told, all of:
 *  - its latest report (selfreport.read) is `blocked`, over STALE_WAIT_MS ago (selfreport.STALE_WAIT_MS, with the
 *    comparison `kosmos report show` uses), whoever wrote it (a Kosmos-written one, from a provider outage, is the kind
 *    nothing automatic clears, selfreport.record);
 *  - its card shows that report (stateReported, and the same state: the board's reconcile can set a report aside);
 *  - its card is ours, a Claude agent, not mid-turn (activeWhileWaiting: a later sweep tells it), and not a switched-off
 *    swarm.
 * Claude only: deliverAutomatic's menu hold (the one thing that keeps a typed line out of an open question or menu) is
 * Claude-only, and an agent on another runner can report blocked while an ask is open on its screen.
 * Not needs_you: that is a question waiting on the person, and for a runner other than Claude nothing holds a typed
 * line out of an open question (chat's menu hold is Claude-only), so the reminder would answer it.
 *
 * How often: once per report line, kept on disk (REMINDED_FILE, session -> the report's `at`), so a board restart or
 * an update does not repeat it. A fresh report starts a new day. A delivery that reached nothing is retried on later
 * sweeps, up to MAX_TRIES (that count is in memory, so a restart allows three more).
 *
 * The planner is pure; the reads and the delivery are injected, so tests drive it without a pane.
 */

const selfreport = require('./selfreport');
const cardlabel = require('./cardlabel');

/* Tries that reached nothing (COULD_NOT, or a throw) before a report is left alone, as in firstreply-nudge.js. */
const MAX_TRIES = 3;
/* The one waiting state reminded about (see the header for why not needs_you). */
const REMINDED_STATE = 'blocked';
/* How old a record of an agent no longer on the board must be before it is dropped. */
const PRUNE_MS = 30 * 24 * 3600 * 1000;

/* The reminders that reached the agent: { session: the report's at }. Under the data root, so a sandboxed test never
   reads the live one. Unreadable or absent reads as empty; a reminder is then possible again, never refused. */
function remindedFile() { return require('node:path').join(require('./store').ROOT, 'stalereport-reminded.json'); }
function fileReminded() {
  const fs = require('node:fs');
  const file = remindedFile();
  let map = {};
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); if (v && typeof v === 'object' && !Array.isArray(v)) map = v; } catch { map = {}; }
  return {
    get: (session) => (typeof map[session] === 'string' ? map[session] : null),
    /* An entry is dropped only when its agent is off the board (`live`) AND its report is over PRUNE_MS old, so one roster
       read missing a card cannot cost it its record. Returns false when the write failed: the caller logs it, since this
       record is what stops a repeat after a restart. */
    set: (session, at, live, now) => {
      const next = {};
      const t = Number.isFinite(now) ? now : Date.now();
      for (const k of Object.keys(map)) {
        const old = !(t - Date.parse(map[k]) <= PRUNE_MS);   // an unreadable time counts as old
        if (!live || live.has(k) || !old) next[k] = map[k];
      }
      map = { ...next, [session]: at };
      const tmp = file + '.' + process.pid + '.tmp';
      try {
        fs.mkdirSync(require('node:path').dirname(file), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(map, null, 2) + '\n', { mode: 0o600 });
        fs.renameSync(tmp, file);
        return true;
      } catch {
        try { fs.unlinkSync(tmp); } catch { /* none was left */ }
        return false;   // the in-memory book still stops a repeat this run
      }
    },
  };
}

/* The line typed into the agent, in the words `kosmos report show` uses for the same report (server.js), so the agent
   is taught one command. Kosmos's own words only: the report's `on` text is the agent's and is not repeated to it. */
function nudgeText(rep, ageMs) {
  const age = cardlabel.standingFor(ageMs);
  // Who wrote it, as report show says it: the agent, Kosmos for it, or someone else / no writer recorded ("This").
  const whose = rep.by === 'agent' ? 'Your own `' + rep.state + '` report'
    : rep.by === 'auto' ? 'A `' + rep.state + '` report Kosmos wrote for you'
      : 'This `' + rep.state + '` report';
  const todo = rep.by === 'auto' ? 'If what it was about has passed' : 'If it is no longer in your way';
  return 'Kosmos here, a reminder: ' + whose + ' has been standing on your card for ' + age + '. '
    + todo + ', clear it with: kosmos report clear. If it still holds, leave it. '
    + 'To see your card as the person sees it, run: kosmos report show';
}

function plan(card, rep, entry, now, remindedAt) {
  if (!card || !rep || rep.found !== true) return { act: 'none', because: 'no report' };
  if (rep.state !== REMINDED_STATE) return { act: 'none', because: 'its report is not ' + REMINDED_STATE };
  /* The card shows THE REPORT, not only its state: reconcile can show a screen reading of the same state over a report
     it set aside, and then stateReported is false. */
  if (card.stateReported !== true || card.state !== rep.state) return { act: 'none', because: 'its card does not show that report' };
  const at = typeof rep.at === 'string' ? Date.parse(rep.at) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(now)) return { act: 'none', because: 'no readable time for its report' };
  // The comparison `kosmos report show` uses (over STALE_WAIT_MS), so the two agree on which report is stale.
  if (!(now - at > selfreport.STALE_WAIT_MS)) return { act: 'none', because: 'its report is not over a day old' };
  if (remindedAt === rep.at || (entry && entry.forAt === rep.at && entry.nudgedAt != null)) return { act: 'none', because: 'already reminded about this report' };
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
    const reminded = o.reminded && typeof o.reminded.get === 'function' ? o.reminded : fileReminded();
    const pauseFor = typeof o.paused === 'function' ? o.paused : pauseNow;
    const log = typeof o.log === 'function' ? o.log : null;
    const say = (r) => { if (log) { try { log(r); } catch { /* never breaks a sweep */ } } };
    for (const card of o.roster) {
      const session = card && card.sessionName;
      if (!session || card.isNamedOurs === false || card.runner !== 'claude') continue;
      if (card.activeWhileWaiting === true) continue;   // mid-turn: a later sweep tells it, between turns
      if (card.state !== REMINDED_STATE) continue;   // read a report only for a card that could be reminded
      let rep = null;
      try { rep = readReport(session); } catch { rep = null; }
      const entry = book.get(session);
      let remindedAt = null;
      try { remindedAt = reminded.get(session); } catch { remindedAt = null; }
      const p = plan(card, rep, entry, now, remindedAt);
      if (p.act !== 'nudge') continue;
      let pz = null;
      try { pz = pauseFor(session); } catch { pz = null; }
      if (pz && pz.paused === true) continue;
      const display = card.name || session;
      let state = null;
      let held = false;
      let heldBy = null;
      try { const r = o.deliver(session, nudgeText(rep, p.ageMs), o.roster); state = r && r.state; held = Boolean(r && r.held === true); heldBy = (r && r.heldBy) || null; }
      catch (err) { state = 'threw: ' + String((err && err.message) || err); }
      /* Held (deliverAutomatic's holds: an answer awaited on its screen, a usage limit, a quota, the Gemini cap): nothing
         typed and no try spent. Logged once
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
      if (mayHaveReached) {
        let kept = false;
        try { kept = reminded.set(session, rep.at, new Set(o.roster.map((c) => c && c.sessionName).filter(Boolean)), now) !== false; } catch { kept = false; }
        if (!kept) say({ name: display, session, act: 'record', delivered, delivery: state, because: 'reminded, but the record of it could not be written, so a board restart may remind it again' });
      }
      const because = (!mayHaveReached && tries >= MAX_TRIES) ? p.because + '; nothing reached the pane in ' + tries + ' tries, so this report is left alone' : p.because;
      results.push({ session, name: display, act: 'nudge', delivered, delivery: state, because });
      if (mayHaveReached || tries === 1 || tries >= MAX_TRIES) say({ name: display, session, act: 'nudge', delivered, delivery: state, because });
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
        report: deps.report, paused: deps.paused, reminded: deps.reminded, deliver: deps.deliver, DELIVERY: deps.DELIVERY, log: deps.log,
      });
    } catch { return null; }
  };
}

module.exports = { plan, nudgeText, sweepOnce, makeTick, nudgeEnabled, remindedFile, MAX_TRIES, REMINDED_STATE, PRUNE_MS };

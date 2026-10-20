'use strict';

/*
 * #5959 slice 3 (the Windows agents' QA report, item 4: one agent carried a "blocked" from 09-26): an agent whose own
 * `blocked` report has stood over a day is told so ONCE, typed into its session the way firstreply-nudge.js does.
 * `kosmos report show` says the same thing when the agent asks (slice 1); this says it without being asked.
 *
 * Who is told, all of:
 *  - its latest report (selfreport.read) is `blocked`, not written by Kosmos, and its waiting run began over
 *    STALE_WAIT_MS ago
 *    (selfreport.STALE_WAIT_MS, with the comparison `kosmos report show` uses);
 *  - its `until` does not hold it back (selfreport.untilDefers, kosmos#6683: also report show's rule);
 *  - its card shows that report (stateReported, and the same state: the board's reconcile can set a report aside);
 *  - its card is ours, a Claude agent, not mid-turn (activeWhileWaiting: a later sweep tells it), and not a switched-off
 *    swarm.
 * Its screen is read first (screenOpen), and nothing is typed while a menu or a prompt is open there or the screen
 * cannot be read: deliverAutomatic's own menu hold reads the screen only for a needs_you or working card, never for the
 * blocked cards this sweep types to. So Claude only (those readers know Claude Code's screens), and never an agent
 * reached through a channel (a Windows agent, whose screen this computer cannot read).
 * Not needs_you: that is a question waiting on the person, and for a runner other than Claude nothing holds a typed
 * line out of an open question (chat's menu hold is Claude-only), so the reminder would answer it.
 *
 * How often: once per waiting run, kept on disk (remindedFile(), session -> the run's start, runOf below), so a board
 * restart or an update does not repeat it. Re-reporting the same question is the same run; a new question starts a new
 * day. A delivery that reached nothing is retried on later sweeps, up to MAX_TRIES (that count is in memory, so a
 * restart allows three more).
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

/* The reminders that reached the agent: { session: the run's start (runOf) }. Under the data root, so a sandboxed test never
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

/* The time a waiting report is aged and remembered by: when its run began (selfreport's askedAt, #5943: the same state,
   words and project), as `kosmos report show` ages it, or the latest line when that is not known. Re-reporting the same
   question is the same run, so it is neither made fresh nor reminded again. */
function runOf(rep) { return (rep && (rep.askedAt || rep.at)) || null; }

/* The line typed into the agent, in the words `kosmos report show` uses for the same report (server.js), so the agent
   is taught one command. Kosmos's own words only: the report's `on` text is the agent's and is not repeated to it. */
function nudgeText(rep, ageMs) {
  const age = cardlabel.standingFor(ageMs);
  // Who wrote it, as report show says it: the agent, or someone else / no writer recorded ("This").
  const whose = rep.by === 'agent' ? 'Your own `' + rep.state + '` report' : 'This `' + rep.state + '` report';
  return 'Kosmos here, a reminder: ' + whose + ' has been standing for ' + age + '. '
    + 'If it is no longer in your way, clear it with: kosmos report clear. If it still holds, leave it. '
    + 'To see your card as the person sees it, run: kosmos report show';
}

function plan(card, rep, entry, now, remindedAt) {
  if (!card || !rep || rep.found !== true) return { act: 'none', because: 'no report' };
  if (rep.state !== REMINDED_STATE) return { act: 'none', because: 'its report is not ' + REMINDED_STATE };
  /* Not one Kosmos wrote: for a Claude agent that is the StopFailure hook's "provider api (<kind>)" failure, and while
     the provider still fails the turn a reminder starts fails too and writes a fresh one, so it would be reminded once a
     day for the outage. */
  if (rep.by === 'auto') return { act: 'none', because: 'Kosmos wrote its report (a provider failure)' };
  /* The card shows THE REPORT, not only its state: reconcile can show a screen reading of the same state over a report
     it set aside, and then stateReported is false. */
  if (card.stateReported !== true || card.state !== rep.state) return { act: 'none', because: 'its card does not show that report' };
  const at = typeof runOf(rep) === 'string' ? Date.parse(runOf(rep)) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(now)) return { act: 'none', because: 'no readable time for its report' };
  // The comparison `kosmos report show` uses (the run's start, over STALE_WAIT_MS), so the two agree on which is stale.
  if (!(now - at > selfreport.STALE_WAIT_MS)) return { act: 'none', because: 'its report is not over a day old' };
  // kosmos#6683: a report that says until when is held back by it (selfreport.untilDefers: one rule with report show).
  if (selfreport.untilDefers(rep, now)) return { act: 'none', because: 'its report says until when, and that holds it back' };
  if (remindedAt === runOf(rep) || (entry && entry.forAt === runOf(rep) && entry.nudgedAt != null)) return { act: 'none', because: 'already reminded about this report' };
  if (entry && entry.forAt === runOf(rep) && Number.isInteger(entry.tries) && entry.tries >= MAX_TRIES) {
    return { act: 'none', because: 'gave up after ' + MAX_TRIES + ' tries that reached nothing' };
  }
  return { act: 'nudge', ageMs: now - at, because: 'its ' + rep.state + ' report has stood ' + cardlabel.standingFor(now - at) };
}

/* Why a line typed now could land in something open on the agent's screen, or null when its prompt is clear: Claude
   Code's safeguards menu, a question menu, its usage-limit menu, or a permission prompt (status.js's readers, the ones
   chat's menu and limit holds use),
   or a screen that could not be read at all. */
function screenOpen(session, roster) {
  const status = require('./status');
  const view = require('./chat').viewport(session, roster);
  if (!view || typeof view.text !== 'string') return 'its screen could not be read';
  if (status.claudeSafeguardsMenuUp(view.text) || status.claudeQuestionMenuUp(view.text) || status.claudeLimitMenuUp(view.text)) {
    return 'a menu is open on its screen';   // the usage-limit menu too: chat holds it only for a rate_limited card
  }
  if (status.claudePermissionPromptKind(view.text)) return 'a prompt is open on its screen';
  return null;
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
    const screenFor = typeof o.screen === 'function' ? o.screen : screenOpen;
    const pauseFor = typeof o.paused === 'function' ? o.paused : pauseNow;
    const log = typeof o.log === 'function' ? o.log : null;
    const say = (r) => { if (log) { try { log(r); } catch { /* never breaks a sweep */ } } };
    for (const card of o.roster) {
      const session = card && card.sessionName;
      if (!session || card.isNamedOurs !== true || card.runner !== 'claude' || card.reachedByChannel === true) continue;
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
      /* Something open on its screen (or no screen to read): nothing typed, no try spent, said once per report in the
         log, and a later sweep looks again. */
      let open = null;
      try { open = screenFor(session, o.roster); } catch { open = 'its screen could not be read'; }
      if (open) {
        const why = p.because + '; not typed, ' + open;
        results.push({ session, name: display, act: 'screen', delivered: false, delivery: null, because: why });
        if (!entry || entry.screenSaidFor !== runOf(rep)) {
          book.set(session, { ...(entry && entry.forAt === runOf(rep) ? entry : {}), forAt: runOf(rep), screenSaidFor: runOf(rep) });
          say({ name: display, session, act: 'screen', delivered: false, delivery: null, because: why });
        }
        continue;
      }
      let state = null;
      let held = false;
      let heldBy = null;
      try { const r = o.deliver(session, nudgeText(rep, p.ageMs), o.roster); state = r && r.state; held = Boolean(r && r.held === true); heldBy = (r && r.heldBy) || null; }
      catch (err) { state = 'threw: ' + String((err && err.message) || err); }
      /* Held (deliverAutomatic's holds; for a blocked Claude card screenOpen above is what protects it, and these are a
         backstop): nothing typed and no try spent. Logged once
         per report with what held it, so a person asking why an agent was never reminded finds the answer in the log. */
      if (held) {
        const why = p.because + '; held' + (heldBy ? ' (' + heldBy + ')' : '');
        results.push({ session, name: display, act: 'held', heldBy, delivered: false, delivery: state, because: why });
        if (!entry || entry.heldSaidFor !== runOf(rep)) {
          book.set(session, { ...(entry && entry.forAt === runOf(rep) ? entry : {}), forAt: runOf(rep), heldSaidFor: runOf(rep) });
          say({ name: display, session, act: 'held', delivered: false, delivery: state, because: why });
        }
        continue;
      }
      const D = o.DELIVERY || {};
      const delivered = D.PLACED != null && state === D.PLACED;
      const mayHaveReached = delivered || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
      const tries = ((entry && entry.forAt === runOf(rep) && Number.isInteger(entry.tries)) ? entry.tries : 0) + 1;
      book.set(session, { forAt: runOf(rep), nudgedAt: mayHaveReached ? now : null, tries, delivery: state, heldSaidFor: entry && entry.heldSaidFor, screenSaidFor: entry && entry.screenSaidFor });
      if (mayHaveReached) {
        let kept = false;
        try { kept = reminded.set(session, runOf(rep), new Set(o.roster.map((c) => c && c.sessionName).filter(Boolean)), now) !== false; } catch { kept = false; }
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
        report: deps.report, paused: deps.paused, reminded: deps.reminded, screen: deps.screen, deliver: deps.deliver, DELIVERY: deps.DELIVERY, log: deps.log,
      });
    } catch { return null; }
  };
}

module.exports = { untilTimeOf: selfreport.untilTimeOf, plan, nudgeText, sweepOnce, makeTick, nudgeEnabled, remindedFile, screenOpen, MAX_TRIES, REMINDED_STATE, PRUNE_MS };

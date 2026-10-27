'use strict';

/*
 * kosmos#7374: the board asks ONE agent, once a day, to write the daily product-feedback report (#2037).
 *
 * Why. Sending is on by default (engine/feedbacksend.js, opt out in Settings, Automation) and the board sends any report
 * that exists, but a report exists only if an agent runs `kosmos feedback write`, and the only thing that told an agent
 * to was a line in the Project Manager role's instructions. An install with no Project Manager, or one whose Project
 * Manager had no reason to remember a once-a-day line, sent nothing: 8 installs in 7 days (admin telemetry, 10-27).
 *
 * Who is asked, one agent a day:
 *  - an idle card of ours that is not a switched-off swarm (the Assigner's idleCard, as engine/agentnudge.js uses), so a
 *    working agent is never interrupted;
 *  - not the setup guide (it runs hands-off instructions, and its thread is masked on the page);
 *  - a Project Manager first (its instructions already carry the four questions), then a Project Director (it holds the
 *    picture across projects), else roster order. A card's role is the one its instruction file states ("You are
 *    **X**, a project manager."), so the match ignores case and a leading article;
 *  - an agent whose delivery is held (a menu, a usage limit, signed out, text in its box) or refused passes the ask to
 *    the next, in the same tick. Quiet hours and the usage cap hold for everyone, so they stop the tick and cost no try.
 *    A tick in which some were held and the rest refused costs one try, so a menu left open all evening does not keep
 *    the day alive past MAX_TRIES refusals by the others. A delivery that THREW counts as maybe reached (chat.js's
 *    "A THROW IS UNCONFIRMED", above deliverThroughChannel: a throw can follow the keystroke), so the day is recorded as
 *    asked and nobody else is typed into.
 * When, all of:
 *  - sending is on and its setting reads (feedbacksend.read: on and ok). Switched off, or unreadable, nobody is asked, so
 *    an install that said no is never spent a turn on a report it will not send;
 *  - today (the person's local day, feedback.today) has no report yet, from any writer;
 *  - it is NUDGE_HOUR or later on this computer's clock, so the report can cover the day;
 *  - some agent of ours was seen working today (lastWorked), or its provider gives Kosmos no way to see that
 *    (no_source): an install nobody used today is not billed a turn to describe nothing. Accepted cost: an install
 *    with an Antigravity or Muse agent is asked every evening, used or not, since Kosmos cannot see their work.
 * How often: once a day, kept on disk (askedFile), so a restart or an update does not ask again. A delivery that reached
 * nothing is retried on later ticks, up to MAX_TRIES ticks in which every candidate refused (that count is in memory,
 * so a restart allows three more).
 *
 * What it costs the person: one turn of the asked agent, on their own AI account; the line says so. What leaves the
 * machine is unchanged: only the report itself, scrubbed, sent by feedbacksend.js as before. This adds no ping.
 *
 * The planner is pure; the reads and the delivery are injected, so tests drive it without a pane.
 */

const fs = require('node:fs');
const path = require('node:path');

/* Tries that reached nothing (COULD_NOT, or a throw) before the day is left alone, as in firstreply-nudge.js. */
const MAX_TRIES = 3;
/* The local hour from which the day's ask may go out. */
const NUDGE_HOUR = 17;
/* The role keys asked first, in order (engine/roles.js). */
const FIRST_ROLES = ['pm', 'director'];

/* The record: { date: the day last asked, session: who, workedOn: the last day an agent was seen working }. Under the
   data root, so a sandboxed test never reads the live one. Unreadable or absent reads as never asked and never seen, so
   an ask is then possible again, never refused. `workedOn` is kept because the board's own record of who worked lives in
   memory (status.lastWorkedOf), so an afternoon restart (every update) would otherwise forget a full day's work (review 2). */
function askedFile() { return path.join(require('./store').ROOT, 'feedbacknudge.json'); }
function fileAsked() {
  const file = askedFile();
  const read = () => { try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
  /* Returns false when the write failed: the caller logs an ask's failure, since that record is what stops a repeat
     after a restart. */
  const write = (patch) => {
    const tmp = file + '.' + process.pid + '.tmp';
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify({ ...read(), ...patch }) + '\n', { mode: 0o600 });
      fs.renameSync(tmp, file);
      return true;
    } catch {
      try { fs.unlinkSync(tmp); } catch { /* none was left */ }
      return false;   // the in-memory book still stops a repeat this run
    }
  };
  return {
    get: () => { const v = read(); return typeof v.date === 'string' ? v.date : null; },
    set: (date, session) => write({ date, session }),
    workedOn: () => { const v = read(); return typeof v.workedOn === 'string' ? v.workedOn : null; },
    markWorked: (date) => write({ workedOn: date }),
  };
}

/* A role as words to compare: lower case, no leading article, no closing stop ("a project manager." -> "project manager"). */
function roleWords(v) {
  return String(v || '').trim().toLowerCase().replace(/[.\s]+$/, '').replace(/^(a|an|the)\s+/, '');
}
/* The roles asked first, in order, as roleWords of their labels ("project manager", "project director"). */
function firstLabels() {
  const roles = require('./roles');
  return FIRST_ROLES.map((k) => roles.byKey(k)).filter(Boolean).map((r) => roleWords(r.label));
}
/* The rank of a card's role in firstLabels (lower is asked first), or the list's length for any other role. The role is
   the one its instruction file states (card.role), which is where a built-in role's words live; a label the person typed
   at creation is their own role, not one of these. */
function rankOf(card, labels) {
  const i = labels.indexOf(roleWords(card.role));
  return i < 0 ? labels.length : i;
}

/* The line typed into the agent. The four questions and the rules about names and secrets are the Project Manager's own
   (engine/roles.js), so every agent asked writes the same report. */
function nudgeText() {
  return [
    'Kosmos here, once a day: please write today\'s product-feedback report about Kosmos itself. It takes one turn on',
    'your person\'s AI account, and it is sent to the Kosmos team (scrubbed) unless they switched sending off in',
    'Settings, Automation. Answer these four questions and save it by piping the text to `kosmos feedback write` on',
    'stdin (in PowerShell, save it in a file and run `kosmos feedback write --body-file <file>`):',
    '1. What bugs did you hit today, or what did your user ask for that is not wired up yet?',
    '2. Is anything broken?',
    '3. What would make the app better, on the technical side or for the people using it?',
    '4. How are tasks going? In your own words; no task counts, titles or contents.',
    'No usernames, agent names or project names, and never a key, token or password (redact any in an error you quote).',
    'If `kosmos feedback show` already has a note for today, leave it.',
  ].join(' ');
}

/* Whether an agent of ours worked today: seen working today, or on a provider Kosmos cannot see (no_source). */
function workedToday(roster, today, dateKey) {
  return roster.some((c) => {
    if (!c || c.isNamedOurs !== true) return false;
    if (c.state === 'working') return true;
    const w = c.lastWorked;
    if (w && w.why === 'no_source') return true;
    const at = w && typeof w.at === 'string' ? new Date(w.at) : null;
    return Boolean(at && Number.isFinite(at.getTime()) && dateKey(at) === today);
  });
}

/* Fails closed (review 2): a guide check that cannot tell throws, and candidates() leaves that card out. */
function guideDefault(session) { return require('./setup-assistant').isGuideFolderStrict(session); }
/* The cards that may be asked, in the order to ask them: idle cards of ours, not the guide, the first roles first, then
   roster order (the sort is stable). Empty when none. */
function candidates(roster, labels, isGuide = guideDefault) {
  const idle = roster.filter((c) => {
    if (!require('./assigner').idleCard(c)) return false;
    try { return !isGuide(c.sessionName); } catch { return false; }
  });
  return idle.map((c, i) => ({ c, i, r: rankOf(c, labels) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.c);
}

/*
 * The day's decision. o = { roster, send ({ on, ok }), today, hour, hasReport, askedDate, entry, labels, dateKey, isGuide,
 * workedOn (the day the record last saw an agent working) }.
 * Returns { act: 'none' | 'nudge', because, cards? } (cards: who to ask, in order).
 */
function plan(o) {
  if (!o.send || o.send.ok !== true) return { act: 'none', because: 'the feedback-sending setting could not be read' };
  if (o.send.on !== true) return { act: 'none', because: 'sending feedback is switched off' };
  if (o.askedDate === o.today || (o.entry && o.entry.date === o.today && o.entry.nudgedAt != null)) return { act: 'none', because: 'already asked today' };
  if (o.entry && o.entry.date === o.today && Number.isInteger(o.entry.tries) && o.entry.tries >= MAX_TRIES) {
    return { act: 'none', because: 'gave up after ' + MAX_TRIES + ' tries that reached nothing' };
  }
  if (o.hasReport) return { act: 'none', because: 'today already has a report' };
  if (!(o.hour >= NUDGE_HOUR)) return { act: 'none', because: 'before ' + NUDGE_HOUR + ':00' };
  if (o.workedOn !== o.today && !workedToday(o.roster, o.today, o.dateKey)) return { act: 'none', because: 'no agent worked today' };
  const cards = candidates(o.roster, o.labels, o.isGuide);
  if (!cards.length) return { act: 'none', because: 'no idle agent to ask' };
  return { act: 'nudge', cards, because: 'today has no report' };
}

/*
 * One tick. o = { roster, book (Map, holds 'day'), now (a Date), send(), hasReport(date), today(d), dateKey(d), asked,
 * labels, deliver(session, text, roster), DELIVERY, log }. Returns { result } or null. Never throws.
 */
function sweepOnce(o) {
  try {
    if (!o || !Array.isArray(o.roster)) return null;
    const feedback = require('./feedback');
    const now = o.now instanceof Date ? o.now : new Date();
    const dateKey = typeof o.dateKey === 'function' ? o.dateKey : feedback.dateKey;
    const today = dateKey(now);
    const book = o.book instanceof Map ? o.book : new Map();
    const asked = o.asked && typeof o.asked.get === 'function' ? o.asked : fileAsked();
    const say = (r) => { if (typeof o.log === 'function') { try { o.log(r); } catch { /* never breaks a tick */ } } };
    let send = null;
    try { send = (typeof o.send === 'function' ? o.send : () => require('./feedbacksend').read())(); } catch { send = null; }
    let hasReport = true;   // an unreadable store asks nobody: a report may be there
    try { hasReport = (typeof o.hasReport === 'function' ? o.hasReport : feedback.has)(today) === true; } catch { hasReport = true; }
    let askedDate = null;
    try { askedDate = asked.get(); } catch { askedDate = null; }
    const entry = book.get('day');
    /* Seen working today: kept on disk on every tick that sees it, from the morning on, so a restart later in the day
       does not forget it (review 2). Only written when it changes. */
    let workedOn = null;
    try { workedOn = typeof asked.workedOn === 'function' ? asked.workedOn() : null; } catch { workedOn = null; }
    if (send && send.ok === true && send.on === true && workedOn !== today && workedToday(o.roster, today, dateKey)) {
      workedOn = today;
      try { if (typeof asked.markWorked === 'function') asked.markWorked(today); } catch { /* the roster still says so this tick */ }
    }
    const p = plan({
      roster: o.roster, send, today, hour: now.getHours(), hasReport, askedDate, entry, dateKey, workedOn,
      labels: Array.isArray(o.labels) ? o.labels : firstLabels(), isGuide: typeof o.isGuide === 'function' ? o.isGuide : undefined,
    });
    if (p.act !== 'nudge') return { result: { act: 'none', because: p.because } };
    /* Each candidate in turn, in one tick:
       - held (deliverAutomatic's holds: a menu, a usage limit, a signed-out account, text in its box): nothing typed, the
         next is asked;
       - quiet hours or the usage cap (chat's `quiet` / `capped`): nothing typed, and it holds for every agent, so the tick
         stops and no try is spent; a later tick asks again;
       - busy (chat's `busy`: another line is still being placed in that pane): treated as held (review 3);
       - refused (COULD_NOT): nothing typed, the next is asked (review 2: one agent's refusal must not lose the day for the
         others);
       - placed, unconfirmed, or a throw (which may have typed before it threw, review 3): asked, and the day is done.
       A try is spent only when every candidate refused, and then one try for the tick, not one per candidate. */
    const D = o.DELIVERY || {};
    const heldOnes = [];
    const refused = [];
    let reached = null;
    let paused = null;
    for (const card of p.cards) {
      const session = card.sessionName;
      const name = card.name || session;
      let r = null;
      let state = null;
      try { r = o.deliver(session, nudgeText(), o.roster); state = r && r.state; }
      catch (err) { reached = { session, name, delivered: false, delivery: 'threw: ' + String((err && err.message) || err) }; break; }
      if (r && (r.quiet === true || r.capped === true)) { paused = (r.quiet === true ? 'quiet hours' : 'the usage cap') + (r.because ? ': ' + r.because : ''); break; }
      if (r && (r.held === true || r.busy === true)) { heldOnes.push(name + (r.held === true ? (r.heldBy ? ' (' + r.heldBy + ')' : '') : ' (busy)')); continue; }
      const delivered = D.PLACED != null && state === D.PLACED;
      if (delivered || (D.UNCONFIRMED != null && state === D.UNCONFIRMED)) { reached = { session, name, delivered, delivery: state }; break; }
      refused.push(name + ' (' + (state || 'no answer') + ')');
    }
    /* Nothing typed and no try spent. Said once a day, so a person asking why no report came finds the reason. */
    if (!reached && (paused || !refused.length)) {
      const because = p.because + '; ' + (paused ? 'not asked during ' + paused : 'every agent that could be asked is held: ' + heldOnes.join(', '));
      if (!entry || entry.date !== today || !entry.holdSaid) {
        book.set('day', { ...(entry && entry.date === today ? entry : { date: today, nudgedAt: null, tries: 0 }), holdSaid: true });
        say({ name: '-', session: '-', act: 'held', delivery: null, because });
      }
      return { result: { act: 'held', because } };
    }
    const mayHaveReached = Boolean(reached);
    const session = reached ? reached.session : null;
    const name = reached ? reached.name : null;
    const delivered = reached ? reached.delivered : false;
    const state = reached ? reached.delivery : refused.join(', ');
    const prior = entry && entry.date === today ? entry : null;
    const tries = (prior && Number.isInteger(prior.tries) ? prior.tries : 0) + (mayHaveReached ? 0 : 1);
    book.set('day', { date: today, nudgedAt: mayHaveReached ? now.getTime() : null, tries, holdSaid: Boolean(prior && prior.holdSaid) });
    if (mayHaveReached) {
      let kept = false;
      try { kept = asked.set(today, session) !== false; } catch { kept = false; }
      if (!kept) say({ name, session, act: 'record', delivered, delivery: state, because: 'asked, but the record of it could not be written, so a board restart may ask again today' });
    }
    const because = mayHaveReached ? p.because
      : p.because + '; every agent that could be asked refused it: ' + state + (tries >= MAX_TRIES ? '; nothing reached a pane in ' + tries + ' tries, so today is left alone' : '');
    const result = { act: 'nudge', session: session || '-', name: name || '-', delivered, delivery: mayHaveReached ? state : 'could_not', because };
    if (mayHaveReached || tries === 1 || tries >= MAX_TRIES) say(result);
    return { result };
  } catch { return null; }
}

/* THE one "does the nudge run" rule: live execution allowed and the operator brake off. */
function nudgeEnabled(allowed, env) {
  return allowed === true && (env || process.env).AGENT_WORKFORCE_FEEDBACK_NUDGE_OFF !== '1';
}

/* The server's per-tick wrapper, separate so its gating is testable. Never throws. */
function makeTick(deps) {
  return function tick() {
    try {
      if (!nudgeEnabled(deps.allowed() === true, deps.env)) return null;
      const roster = deps.roster();
      if (!Array.isArray(roster)) return null;
      return sweepOnce({
        roster, book: deps.book, now: deps.now ? deps.now() : new Date(), send: deps.send, hasReport: deps.hasReport,
        asked: deps.asked, labels: deps.labels, isGuide: deps.isGuide, deliver: deps.deliver, DELIVERY: deps.DELIVERY, log: deps.log,
      });
    } catch { return null; }
  };
}

module.exports = { plan, candidates, rankOf, roleWords, workedToday, nudgeText, sweepOnce, makeTick, nudgeEnabled, askedFile, firstLabels, MAX_TRIES, NUDGE_HOUR, FIRST_ROLES };

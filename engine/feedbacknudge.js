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
 *  - a Project Manager or Project Director first (the two roles whose instructions already carry the four questions),
 *    else the first such card on the roster.
 * When, all of:
 *  - sending is on and its setting reads (feedbacksend.read: on and ok). Switched off, or unreadable, nobody is asked, so
 *    an install that said no is never spent a turn on a report it will not send;
 *  - today (the person's local day, feedback.today) has no report yet, from any writer;
 *  - it is NUDGE_HOUR or later on this computer's clock, so the report can cover the day;
 *  - some agent of ours was seen working today (lastWorked), or its provider gives Kosmos no way to see that
 *    (no_source): an install nobody used today is not billed a turn to describe nothing.
 * How often: once a day, kept on disk (askedFile), so a restart or an update does not ask again. A delivery that reached
 * nothing is retried on later ticks, up to MAX_TRIES (that count is in memory, so a restart allows three more).
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
/* The role keys asked first: the two whose instructions already carry the four questions (engine/roles.js). */
const FIRST_ROLES = ['pm', 'director'];

/* The day last asked: { date: 'YYYY-MM-DD', session }. Under the data root, so a sandboxed test never reads the live one.
   Unreadable or absent reads as never asked, so an ask is then possible again, never refused. */
function askedFile() { return path.join(require('./store').ROOT, 'feedbacknudge.json'); }
function fileAsked() {
  const file = askedFile();
  return {
    get: () => {
      try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v.date === 'string' ? v.date : null; } catch { return null; }
    },
    /* Returns false when the write failed: the caller logs it, since this record is what stops a repeat after a restart. */
    set: (date, session) => {
      const tmp = file + '.' + process.pid + '.tmp';
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify({ date, session }) + '\n', { mode: 0o600 });
        fs.renameSync(tmp, file);
        return true;
      } catch {
        try { fs.unlinkSync(tmp); } catch { /* none was left */ }
        return false;   // the in-memory book still stops a repeat this run
      }
    },
  };
}

/* The role labels asked first, as a card carries them (its profile's `role`, the label chosen at creation). */
function firstLabels() {
  const roles = require('./roles');
  return FIRST_ROLES.map((k) => roles.byKey(k)).filter(Boolean).map((r) => r.label);
}

/* The line typed into the agent. The four questions and the rules about names and secrets are the Project Manager's own
   (engine/roles.js), so every agent asked writes the same report. */
function nudgeText() {
  return [
    'Kosmos here, once a day: please write today\'s product-feedback report about Kosmos itself. It takes one turn on',
    'your person\'s AI account, and it is sent to the Kosmos team (scrubbed) unless they switched sending off in',
    'Settings, Automation. Answer these four questions and save it with `kosmos feedback write` (or',
    '`kosmos feedback write --body-file <file>` in PowerShell):',
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

/* The card to ask: an idle card of ours, a first role before any other, else roster order. Null when none. */
function pick(roster, labels) {
  const idle = roster.filter((c) => require('./assigner').idleCard(c));
  return idle.find((c) => labels.includes(c.role)) || idle[0] || null;
}

/*
 * The day's decision. o = { roster, send ({ on, ok }), today, hour, hasReport, askedDate, entry, labels, dateKey }.
 * Returns { act: 'none' | 'nudge', because, card? }.
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
  if (!workedToday(o.roster, o.today, o.dateKey)) return { act: 'none', because: 'no agent worked today' };
  const card = pick(o.roster, o.labels);
  if (!card) return { act: 'none', because: 'no idle agent to ask' };
  return { act: 'nudge', card, because: 'today has no report' };
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
    const p = plan({
      roster: o.roster, send, today, hour: now.getHours(), hasReport, askedDate, entry, dateKey,
      labels: Array.isArray(o.labels) ? o.labels : firstLabels(),
    });
    if (p.act !== 'nudge') return { result: { act: 'none', because: p.because } };
    const session = p.card.sessionName;
    const name = p.card.name || session;
    let state = null;
    let held = false;
    let heldBy = null;
    try { const r = o.deliver(session, nudgeText(), o.roster); state = r && r.state; held = Boolean(r && r.held === true); heldBy = (r && r.heldBy) || null; }
    catch (err) { state = 'threw: ' + String((err && err.message) || err); }
    /* Held (deliverAutomatic's holds: a menu, a usage limit, a signed-out account, text in its box): nothing typed and
       no try spent; a later tick asks again. */
    if (held) return { result: { act: 'held', session, name, heldBy, delivery: state, because: p.because + '; held' + (heldBy ? ' (' + heldBy + ')' : '') } };
    const D = o.DELIVERY || {};
    const delivered = D.PLACED != null && state === D.PLACED;
    const mayHaveReached = delivered || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
    const tries = ((entry && entry.date === today && Number.isInteger(entry.tries)) ? entry.tries : 0) + 1;
    book.set('day', { date: today, nudgedAt: mayHaveReached ? now.getTime() : null, tries });
    if (mayHaveReached) {
      let kept = false;
      try { kept = asked.set(today, session) !== false; } catch { kept = false; }
      if (!kept) say({ name, session, act: 'record', delivered, delivery: state, because: 'asked, but the record of it could not be written, so a board restart may ask again today' });
    }
    const because = (!mayHaveReached && tries >= MAX_TRIES) ? p.because + '; nothing reached the pane in ' + tries + ' tries, so today is left alone' : p.because;
    const result = { act: 'nudge', session, name, delivered, delivery: state, because };
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
        asked: deps.asked, labels: deps.labels, deliver: deps.deliver, DELIVERY: deps.DELIVERY, log: deps.log,
      });
    } catch { return null; }
  };
}

module.exports = { plan, pick, workedToday, nudgeText, sweepOnce, makeTick, nudgeEnabled, askedFile, firstLabels, MAX_TRIES, NUDGE_HOUR, FIRST_ROLES };

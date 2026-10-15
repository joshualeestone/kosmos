'use strict';

/*
 * #6209 part 2 (a user's report: the four-hour summary rhythm went about six days unnoticed; the only sign was a
 * staleness line inside project status): an agent whose running summary is overdue WHILE IT HAS BEEN WORKING is told so
 * ONCE per stale stretch, typed into its session the way stalereport-nudge.js does.
 *
 * Who is told, all of:
 *  - its newest summaries/YYYY-MM-DD-HH.md (projectview.summaryFreshness, in its own folder, create.workerDir) is older
 *    than the rhythm (SUMMARY_RHYTHM_HOURS), AND it has REPORTED more than the rhythm of `working` since that summary
 *    (workedSinceMs: positive evidence only; a missing history, no known state at the summary, or a wait is not work;
 *    a history cut short after the summary counts as a lower bound).
 *    An idle agent is not expected to write, so a stale file alone is not owed. Project status also re-labels a stale
 *    summary quiet or idle (projectview's quietExcused, idleExcused); this does not, by decision (see the plan).
 *    An agent with no summary file at all is not told (a role without the rhythm never writes one);
 *  - its card is ours, a Claude agent, idle (between turns), not a switched-off swarm, not reached through a channel.
 * Its screen is read first (stalereport-nudge's screenOpen), and nothing is typed while a menu or a prompt is open there
 * or the screen cannot be read. Claude only, for the same reason as #5959: those readers know Claude Code's screens.
 *
 * How often: once per stale stretch, keyed on the newest summary's write time and kept on disk (promptedFile()), so a
 * board restart does not repeat it; a new summary that goes stale later is a new stretch. A delivery that reached
 * nothing is retried on later sweeps, up to MAX_TRIES (that count is in memory).
 *
 * The planner is pure; the reads and the delivery are injected, so tests drive it without a pane.
 */

const projectview = require('./projectview');

const MAX_TRIES = 3;
/* Review 4: a working Claude agent reports `working` on its tool calls, at most once a minute (the PreToolUse heartbeat),
   so a gap far longer than that is usually not work (an interrupted turn sends no Stop); each gap counts at most this. A
   single tool call longer than the cap is undercounted, which errs toward not telling. */
const WORK_GAP_CAP_MS = 30 * 60 * 1000;
const PRUNE_MS = 30 * 24 * 3600 * 1000;

/* The stretches prompted about: { session: the newest summary's write time }. Under the data root. Unreadable or absent
   reads as empty; a prompt is then possible again, never refused. */
function promptedFile() { return require('node:path').join(require('./store').ROOT, 'summarydue-prompted.json'); }
function filePrompted() {
  const fs = require('node:fs');
  const file = promptedFile();
  let map = {};
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); if (v && typeof v === 'object' && !Array.isArray(v)) map = v; } catch { map = {}; }
  return {
    get: (session) => (typeof map[session] === 'string' ? map[session] : null),
    /* An entry is dropped only when its agent is off the board AND its summary was written over PRUNE_MS ago (the stored
       time is the summary's). False when the write failed. */
    set: (session, at, live, now) => {
      const next = {};
      const t = Number.isFinite(now) ? now : Date.now();
      for (const k of Object.keys(map)) {
        const old = !(t - Date.parse(map[k]) <= PRUNE_MS);
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
        return false;
      }
    },
  };
}

/* Review 1: REPORTED work since the summary, needing positive evidence (unlike projectview.workExcused, which leaves a
   summary stale whenever it cannot tell, the right bias for a passive status line and the wrong one for a line typed
   into the agent). The state at the summary is its last report at or before it; none known counts as NOT busy. A missing
   history reads as unknown (null); one cut short after the summary is a lower bound (review 3). Busy is any report but idle, started and
   stopped, as workExcused counts it. */
function workedSinceMs(rows, wroteAt, now) {
  if (!Array.isArray(rows) || !Number.isFinite(wroteAt) || !Number.isFinite(now) || wroteAt > now) return null;
  const read = rows.filter((r) => r && Number.isFinite(r.at) && r.at <= now && typeof r.state === 'string' && r.by !== 'operator');
  /* Review 3: a history cut short (selfreport keeps its last 64 KB, about 10 to 20 hours of a busy agent) is NOT
     unknown when all of it is after the summary: the work counted from its first row (start state unknown, so not busy)
     is a lower bound, and a lower bound over the rhythm is positive evidence. Returning null there silenced exactly the
     days-stale summary this exists for. A cut history with no rows is nothing to count. */
  if (rows.truncated === true && !read.length) return null;
  const valid = read.map((r, i) => ({ r, i })).sort((a, b) => (a.r.at - b.r.at) || (a.i - b.i)).map((x) => x.r);
  // Review 3: only `working` is work here. A wait (blocked, needs_you, an automatic provider block or permission prompt)
  // is not, unlike workExcused, which errs toward stale for a status line; this line is typed into the agent.
  const busy = (st) => st === 'working';
  // At least one busy report AFTER the summary: a state carried from before it (a crash, a board that was down) is not
  // evidence of work since.
  if (!valid.some((r) => r.at > wroteAt && busy(r.state))) return 0;
  let state = null;
  for (const r of valid) if (r.at <= wroteAt) state = r.state;
  let from = wroteAt; let worked = 0;
  for (const r of valid) {
    if (r.at <= wroteAt) continue;
    if (busy(state)) worked += Math.min(r.at - from, WORK_GAP_CAP_MS);
    // Review 5: a new session starts the count again: the session told about the work is the one that did it.
    if (r.state === 'started') worked = 0;
    state = r.state; from = r.at;
  }
  /* Review 2: nothing after the last report counts. A turn that was interrupted or crashed sends no Stop, so its last
     busy report would otherwise run to now (the card reads idle; it may be days); a working Claude agent reports busy on
     every tool call, so this costs at most the time since its last call. */
  return worked;
}

function hoursOf(ms) {
  const h = Math.floor(ms / 3600000);
  if (h < 48) return h + ' hours';
  return Math.floor(h / 24) + ' days';
}

/* The line typed into the agent: what is overdue, why it is owed (it has been working), and where the file goes, in the
   words its role gives (roles.js SUMMARY_RHYTHM). */
function nudgeText(summary, now, workedMs) {
  const age = hoursOf(Math.max(0, now - Date.parse(summary.at)));
  return 'Kosmos here, a reminder: your running summary is overdue. The last one (' + summary.file + ') was written '
    + age + ' ago, and you have reported about ' + hoursOf(workedMs) + ' of work since. Write the next one now: '
    + 'summaries/YYYY-MM-DD-HH.md in your own folder, a few lines on what moved, what is blocked and what you decided.';
}

/* Pure: whether to prompt this card now. `summary` is summaryFreshness's reading, `workedMs` is workedSinceMs's. */
function plan(card, summary, workedMs, entry, now, promptedAt) {
  if (!card || !summary) return { act: 'none', because: 'no summary reading' };
  if (summary.state !== 'stale' || !summary.at || !summary.file) return { act: 'none', because: 'its summary is ' + (summary.state || 'unknown') };
  if (!Number.isFinite(workedMs)) return { act: 'none', because: 'its work since the summary is not known' };
  if (!(workedMs > projectview.SUMMARY_RHYTHM_HOURS * 3600000)) return { act: 'none', because: 'it has not reported the rhythm of work since its last summary' };
  if (!Number.isFinite(now) || !Number.isFinite(Date.parse(summary.at))) return { act: 'none', because: 'no readable time for its summary' };
  if (promptedAt === summary.at || (entry && entry.forAt === summary.at && entry.nudgedAt != null)) return { act: 'none', because: 'already told about this summary' };
  if (entry && entry.forAt === summary.at && Number.isInteger(entry.tries) && entry.tries >= MAX_TRIES) {
    return { act: 'none', because: 'gave up after ' + MAX_TRIES + ' tries that reached nothing' };
  }
  return { act: 'nudge', workedMs, because: 'its last summary is ' + hoursOf(now - Date.parse(summary.at)) + ' old and it reported about ' + hoursOf(workedMs) + ' of work since' };
}

function defaultScreen(session, roster) { return require('./stalereport-nudge').screenOpen(session, roster); }
function pauseNow(session) { return require('./swarm').pauseOf(require('./store').readProfile(session)); }
function folderNow(session) { try { return require('./create').workerDir(session); } catch { return null; } }
function historyNow(session) { try { return require('./selfreport').history(session); } catch { return null; } }

function sweepOnce(o) {
  const results = [];
  try {
    if (!o || !Array.isArray(o.roster)) return { results, skipped: 'roster unreadable' };
    const book = o.book instanceof Map ? o.book : new Map();
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const folderOf = typeof o.folder === 'function' ? o.folder : folderNow;
    const historyOf = typeof o.history === 'function' ? o.history : historyNow;
    const prompted = o.prompted && typeof o.prompted.get === 'function' ? o.prompted : filePrompted();
    const screenFor = typeof o.screen === 'function' ? o.screen : defaultScreen;
    const pauseFor = typeof o.paused === 'function' ? o.paused : pauseNow;
    const log = typeof o.log === 'function' ? o.log : null;
    const say = (r) => { if (log) { try { log(r); } catch { /* never breaks a sweep */ } } };
    for (const card of o.roster) {
      const session = card && card.sessionName;
      if (!session || card.isNamedOurs !== true || card.runner !== 'claude' || card.reachedByChannel === true) continue;
      if (card.state !== 'idle') continue;   // between turns only: a working agent is told on a later sweep
      let summary = null;
      try { summary = projectview.summaryFreshness(folderOf(session), now); } catch { summary = null; }
      if (!summary || summary.state !== 'stale') continue;
      const entry = book.get(session);
      let promptedAt = null;
      try { promptedAt = prompted.get(session); } catch { promptedAt = null; }
      // Review 5: already told about this summary: no history read.
      if (promptedAt === summary.at || (entry && entry.forAt === summary.at && entry.nudgedAt != null)) continue;
      let workedMs = null;
      try { workedMs = workedSinceMs(historyOf(session), Date.parse(summary.at), now); } catch { workedMs = null; }
      const p = plan(card, summary, workedMs, entry, now, promptedAt);
      if (p.act !== 'nudge') continue;
      let pz = null;
      try { pz = pauseFor(session); } catch { pz = null; }
      if (pz && pz.paused === true) continue;
      const display = card.name || session;
      let open = null;
      try { open = screenFor(session, o.roster); } catch { open = 'its screen could not be read'; }
      if (open) {
        const why = p.because + '; not typed, ' + open;
        results.push({ session, name: display, act: 'screen', delivered: false, delivery: null, because: why });
        if (!entry || entry.screenSaidFor !== summary.at) {
          book.set(session, { ...(entry && entry.forAt === summary.at ? entry : {}), forAt: summary.at, screenSaidFor: summary.at });
          say({ name: display, session, act: 'screen', delivered: false, delivery: null, because: why });
        }
        continue;
      }
      let state = null;
      let held = false;
      let heldBy = null;
      try { const r = o.deliver(session, nudgeText(summary, now, p.workedMs), o.roster); state = r && r.state; held = Boolean(r && r.held === true); heldBy = (r && r.heldBy) || null; }
      catch (err) { state = 'threw: ' + String((err && err.message) || err); }
      if (held) {
        const why = p.because + '; held' + (heldBy ? ' (' + heldBy + ')' : '');
        results.push({ session, name: display, act: 'held', heldBy, delivered: false, delivery: state, because: why });
        if (!entry || entry.heldSaidFor !== summary.at) {
          book.set(session, { ...(entry && entry.forAt === summary.at ? entry : {}), forAt: summary.at, heldSaidFor: summary.at });
          say({ name: display, session, act: 'held', delivered: false, delivery: state, because: why });
        }
        continue;
      }
      const D = o.DELIVERY || {};
      const delivered = D.PLACED != null && state === D.PLACED;
      const mayHaveReached = delivered || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
      const tries = ((entry && entry.forAt === summary.at && Number.isInteger(entry.tries)) ? entry.tries : 0) + 1;
      book.set(session, { forAt: summary.at, nudgedAt: mayHaveReached ? now : null, tries, delivery: state, heldSaidFor: entry && entry.heldSaidFor, screenSaidFor: entry && entry.screenSaidFor });
      if (mayHaveReached) {
        let kept = false;
        try { kept = prompted.set(session, summary.at, new Set(o.roster.map((c) => c && c.sessionName).filter(Boolean)), now) !== false; } catch { kept = false; }
        if (!kept) say({ name: display, session, act: 'record', delivered, delivery: state, because: 'told, but the record of it could not be written, so a board restart may tell it again' });
      }
      const because = (!mayHaveReached && tries >= MAX_TRIES) ? p.because + '; nothing reached the pane in ' + tries + ' tries, so this summary is left alone' : p.because;
      results.push({ session, name: display, act: 'nudge', delivered, delivery: state, because });
      say({ name: display, session, act: 'nudge', delivered, delivery: state, because });
    }
  } catch (err) {
    return { results, skipped: 'sweep failed: ' + String((err && err.message) || err) };
  }
  return { results };
}

/* Live execution allowed and the operator brake off. */
function nudgeEnabled(allowed, env) {
  return allowed === true && (env || process.env).AGENT_WORKFORCE_SUMMARYDUE_NUDGE_OFF !== '1';
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
        folder: deps.folder, history: deps.history, paused: deps.paused, prompted: deps.prompted, screen: deps.screen,
        deliver: deps.deliver, DELIVERY: deps.DELIVERY, log: deps.log,
      });
    } catch { return null; }
  };
}

module.exports = { plan, nudgeText, sweepOnce, makeTick, nudgeEnabled, promptedFile, workedSinceMs, MAX_TRIES, WORK_GAP_CAP_MS };

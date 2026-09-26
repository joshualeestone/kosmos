'use strict';

/**
 * #3723 slice 2: tell the person's project manager, once per incident, that an agent is stopped by
 * its account (out of usage or credits, or a sign-in that stopped working).
 *
 * Josh, 2026-09-25: "we should definitely have any project manager immediately surface that as
 * well as the agent that displays the message". The agent's own DM line is chat.withAccountRow;
 * this is the other half: a message typed into the MANAGER's conversation, so it tells the person.
 *
 * The rules, in the same shape as the #3410 self-heal sweep (engine/connlost-heal.js):
 *   - a problem counts once it is seen on SEEN_SWEEPS consecutive sweeps (a flicker is not one);
 *   - one message per incident, recorded in a small file under the data root, so a board restart
 *     does not send it again;
 *   - an incident ends when the agent has not had the problem for RESOLVED_MS, and only then can a
 *     new one be sent;
 *   - typed only into a manager that is idle or working (never into a question or a permission
 *     prompt, where the Enter would answer it, and not into one stopped by its own account problem);
 *   - with no manager, the incident is recorded as handled (the agent's own DM line still says it).
 * The manager is: profile.reportsTo when it names an agent on the board, else a member of one of the
 * agent's projects whose role reads like a manager (chat.looksLikeManager). Never the agent itself.
 */

const fs = require('fs');
const path = require('path');
const { accountProblemOf } = require('./accountproblem');

const SEEN_SWEEPS = 2;
const RESOLVED_MS = 10 * 60 * 1000;

/* The incident record: { [sessionName]: { kind, seen, since, told, toldAt, manager, okSince } }. */
function bookPath(root) { return path.join(root || require('./store').ROOT, 'account-notices.json'); }
function readBook(file) {
  try { const b = JSON.parse(fs.readFileSync(file, 'utf8')); return b && typeof b === 'object' && !Array.isArray(b) ? b : {}; } catch { return {}; }
}
function writeBook(file, book) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(book, null, 2) + '\n');
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

/**
 * The manager to tell about `card`, from the board's own cards. `lookups` supplies
 * reportsTo(sessionName) and projectsOf(sessionName) -> [[memberSessionName, ...], ...] and
 * roleOf(sessionName); each is injectable for tests.
 */
function managerFor(card, cards, lookups) {
  const me = card && card.sessionName;
  if (!me) return null;
  const onBoard = new Map((cards || []).filter((c) => c && c.sessionName).map((c) => [c.sessionName, c]));
  const usable = (s) => s && s !== me && onBoard.has(s) ? s : null;
  let to = null;
  try { to = usable(lookups.reportsTo(me)); } catch { to = null; }
  if (to) return to;
  let projects = [];
  try { projects = lookups.projectsOf(me) || []; } catch { projects = []; }
  for (const members of projects) {
    const others = (members || []).filter((s) => s !== me && onBoard.has(s));
    if (!others.length) continue;
    // Only a member whose role reads like a manager (chat.looksLikeManager). defaultAgentFor falls
    // back to the first member, which would interrupt an ordinary colleague, so that is not used.
    let pick = null;
    try {
      const chat = require('./chat');
      pick = others.find((m) => chat.looksLikeManager(lookups.roleOf(m))) || null;
    } catch { pick = null; }
    if (usable(pick)) return pick;
  }
  return null;
}

function noticeText(card, problem) {
  const who = (card && (card.name || card.sessionName)) || 'An agent';
  // problem.summary, never problem.text: text quotes the agent's screen, and screen text is never
  // typed into another agent's session under Kosmos's name.
  return `[Kosmos] ${problem.summary} Please tell the person now, in plain words, so they can fix it. ${who} cannot do any work until then.`;
}

/**
 * One sweep. `o`: { cards, lookups, deliver(session, text) -> {state}, DELIVERY, now, file, log }.
 * Returns the list of what it did, for the log and for tests.
 */
function sweepOnce(o) {
  const now = o.now == null ? Date.now() : o.now;
  const file = o.file || bookPath();
  const book = readBook(file);
  const cards = Array.isArray(o.cards) ? o.cards : [];
  const byName = new Map(cards.filter((c) => c && c.sessionName).map((c) => [c.sessionName, c]));
  const did = [];
  let changed = false;
  // An incident ends RESOLVED_MS after the agent is last seen with the problem, whether it is on the
  // board without it or missing from one read (a partial roster must not re-arm a told incident).
  const settle = (s, prev) => {
    const okSince = Number.isFinite(prev.okSince) ? prev.okSince : now;
    if (now - okSince >= RESOLVED_MS) { delete book[s]; did.push({ session: s, act: 'resolved' }); changed = true; }
    else if (prev.okSince !== okSince || prev.seen !== 0) { book[s] = { ...prev, okSince, seen: 0 }; changed = true; }
  };
  for (const card of cards) {
    if (!card || !card.sessionName) continue;
    const s = card.sessionName;
    const found = accountProblemOf(card);
    // Only a reading firm enough to interrupt someone (see accountproblem.js `notify`).
    const problem = found && found.notify ? found : null;
    const prev = book[s];
    if (!problem) {
      if (prev) settle(s, prev);
      continue;
    }
    const same = prev && prev.kind === problem.kind;
    if (same && prev.told && prev.okSince == null) continue; // told already: nothing to record each minute
    const entry = same
      ? { ...prev, seen: (prev.seen || 0) + 1, okSince: null }
      : { kind: problem.kind, seen: 1, since: now, told: false, toldAt: null, manager: null, okSince: null, last: null };
    book[s] = entry;
    changed = true;
    if (entry.told || entry.seen < SEEN_SWEEPS) continue;
    const manager = managerFor(card, cards, o.lookups);
    const mCard = manager ? byName.get(manager) : null;
    const report = (act, extra) => {
      const d = { session: s, act, manager: manager || null, ...extra };
      did.push(d);
      if (book[s].last !== act) { d.changed = true; book[s] = { ...book[s], last: act }; }
    };
    // The manager this agent reports to is set but missing from this read (restarting, or a partial
    // roster): try again next sweep rather than record that there is nobody to tell.
    let named = null;
    try { named = o.lookups.reportsTo(s); } catch { named = null; }
    if (!manager && named && named !== s && !byName.has(named)) { report('manager-away', { manager: named }); continue; }
    if (!manager || !mCard) {
      // Nobody to tell (a person working alone). Recorded as handled: the agent's own DM line says
      // it, and trying every minute would only fill the log.
      book[s] = { ...book[s], told: true, toldAt: now, manager: null };
      report('no-manager');
      continue;
    }
    /* Typed only into a manager sitting idle or working. A manager on a question or a permission
       prompt would take the Enter as its answer (engine/recommender.js keeps the same rule), and one
       stopped by its own account problem could not act on it. It is tried again next sweep. */
    if (mCard.state !== 'idle' && mCard.state !== 'working') { report('manager-busy', { managerState: mCard.state }); continue; }
    let delivery = null;
    try { delivery = o.deliver(manager, noticeText(card, problem)); } catch { delivery = null; }
    // UNCONFIRMED may already have reached the manager: counted as told, so it is never sent twice.
    const placed = delivery && o.DELIVERY && (delivery.state === o.DELIVERY.PLACED || delivery.state === o.DELIVERY.UNCONFIRMED);
    if (placed) { book[s] = { ...book[s], told: true, toldAt: now, manager }; }
    report(placed ? 'told' : 'not-delivered', { delivery: delivery && delivery.state });
  }
  for (const s of Object.keys(book)) if (!byName.has(s)) settle(s, book[s]);
  if (changed) writeBook(file, book);
  // Logged only when what happened for an agent changes, so a long incident is not a line a minute.
  if (typeof o.log === 'function') for (const d of did) { if (d.changed || d.act === 'resolved') { try { o.log(d); } catch { /* best effort */ } } }
  return did;
}

module.exports = { sweepOnce, managerFor, noticeText, bookPath, SEEN_SWEEPS, RESOLVED_MS };

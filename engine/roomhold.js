'use strict';

/*
 * #4624 (#4580 item 9): a colleague's room post that does not name you is not typed into your
 * session while you are in the middle of a turn.
 *
 * What was there. engine/messages.js typed every room post into every member's pane. A post that
 * named nobody arrived as "[background from your colleague X ... not addressed to you]", which is
 * still a turn: in a five-member room one agent thinking out loud cost four turns that each ended in
 * "not addressed to me, nothing to do". And a post typed into a WORKING agent waits in its composer
 * and lands after the turn, by which time the room may already have answered it.
 *
 * What this does, and only this. An AGENT's post that does not @-name you, arriving while your own
 * latest report is a fresh `working`, is HELD instead of typed: its id is kept in a small file of
 * yours. The post is still in the room and still lists you in `to` (you are told about it, below).
 * You hear about held posts in ONE line, at whichever comes first:
 *   - your next `idle` report (the turn ended): the board types the line then, one turn for all of
 *     them instead of one per post (flushOnIdle, run by /api/report);
 *   - the next room post in that project that IS typed to you (addressed, from the person, or
 *     background while you are idle): the line rides on that arrival (clauseFor + cleared by the
 *     caller once it was typed).
 * A held post is never typed later on its own, so a post the room already answered never re-wakes
 * you (the card's third point).
 *
 * Left exactly as before: the person's posts (to the room or to you), any post that @-names you, and
 * every agent whose latest report is not a fresh `working` (idle, needs_you, blocked, stopped, never
 * reported, or a `working` older than the board's own decay window, status.REPORT_WORKING_DECAY_MS).
 * So a runner that does not report is never held, and a report that went stale falls back to typing.
 *
 * Brake: AGENT_WORKFORCE_ROOM_HOLD_OFF=1 types every post as before, including past the #4588 quota gate for room
 * posts (engine/messages.js typeInto). Posts held before the brake is turned on are told only by the next typed
 * arrival (the idle flush and flushReleased are off under it).
 *
 * Held only for a member the board can type into right now (chat.addressable), so a post to a dead or
 * missing pane is still refused as before rather than kept for someone who cannot hear it. Never held:
 * a reply to the member's own post (it is the answer they asked for, not background).
 *
 * Told once: whichever of the two paths above tells the member TAKES the ids first (take), and puts
 * them back only if its line could not be typed (restore), so an idle flush racing a typed arrival
 * cannot both carry the same line.
 *
 * Known limits: the held list is keyed like the self-report (store.safeKey of the board name), so two
 * names that key alike ("Pete" and "pete") share one list, as they share one report; an agent renamed
 * while it holds posts loses the line (the posts are still in the room). Removal forgets the list
 * (forget, called by engine/remove.js). A held post still counts toward the room's arrival budget,
 * which errs toward the valve closing sooner, never later.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

/* The per-recipient outcome a held post records in the room log. The sender's aggregate treats it
   as placed (messages.js): the post is kept and the member will be told, so "do not re-post" holds. */
const HELD = 'held';
/* Ids kept per project per agent. The line names at most SHOWN of them and counts the rest; the cap
   only bounds the file if an agent never goes idle and is never typed to. */
const KEEP = 200;
const SHOWN = 5;

function dir() { return path.join(store.ROOT, 'roomhold'); }
function fileFor(name) { return path.join(dir(), store.safeKey(String(name)) + '.json'); }

function off(env) { return !!(env && env.AGENT_WORKFORCE_ROOM_HOLD_OFF === '1'); }

/* #4588 PR B: a post held because the member is an Antigravity agent paused on the shared Google quota may @-name
   the member (an agent's post is an automatic sender there, addressed or not). Its id is kept with this mark, so the
   line that later tells the member says which of the held posts ask for an answer. Board ids never start with it. */
const ADDRESSED = '@';
function addressedId(id) { return ADDRESSED + String(id); }
function plainId(x) { return typeof x === 'string' && x.startsWith(ADDRESSED) ? x.slice(ADDRESSED.length) : x; }

/* The member's latest report is a fresh `working` (not older than the board's decay window). */
function workingNow(readReport, name, now, decayMs) {
  let rep;
  try { rep = readReport(name); } catch { return false; }
  if (!rep || rep.found !== true || rep.state !== 'working') return false;
  const at = Date.parse(rep.at);
  if (!Number.isFinite(at) || !Number.isFinite(now) || !Number.isFinite(decayMs)) return false;
  const age = now - at;
  return age >= 0 && age <= decayMs;
}

/* Whether this post is held for this member instead of typed. Pure apart from the injected read. */
function shouldHold({ name, operator, mentioned, answersAuthor, reachable, readReport, now, decayMs, env }) {
  if (off(env)) return false;
  if (operator === true) return false;
  if (mentioned && typeof mentioned.has === 'function' && mentioned.has(name)) return false;
  if (answersAuthor === name) return false;
  if (reachable !== true) return false;
  return workingNow(readReport, name, now, decayMs);
}

/* Null-prototype, so a project id such as "__proto__" is an own key like any other. */
function readAll(name) {
  const out = Object.create(null);
  try {
    const got = JSON.parse(fs.readFileSync(fileFor(name), 'utf8'));
    if (got && typeof got === 'object' && !Array.isArray(got)) {
      for (const k of Object.keys(got)) if (Array.isArray(got[k])) out[k] = got[k];
    }
  } catch { /* nothing held */ }
  return out;
}

function writeAll(name, all) {
  const file = fileFor(name);
  const keys = Object.keys(all).filter((k) => Array.isArray(all[k]) && all[k].length);
  if (!keys.length) { try { fs.rmSync(file, { force: true }); } catch { /* nothing to remove */ } return true; }
  const kept = Object.create(null);
  for (const k of keys) kept[k] = all[k];
  fs.mkdirSync(dir(), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(kept), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return true;
}

/* Keep one post id for this member. Returns false when it could not be kept, so the caller types
   the post as before rather than losing it. */
function hold(name, projectId, id) {
  try {
    const all = readAll(name);
    const prior = Array.isArray(all[projectId]) ? all[projectId] : [];
    const ids = prior.filter((x) => plainId(x) !== plainId(id));
    // Kept once; a post that named the member keeps its mark if it is held again unmarked.
    ids.push(prior.includes(addressedId(plainId(id))) ? addressedId(plainId(id)) : id);
    all[projectId] = ids.slice(-KEEP);
    return writeAll(name, all);
  } catch { return false; }
}

/* The ids held for this member in one project (oldest first), without clearing them. */
function heldIn(name, projectId) {
  const ids = readAll(name)[projectId];
  return Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : [];
}

/* Every project this member has held posts in. */
function heldProjects(name) {
  const all = readAll(name);
  return Object.keys(all).filter((k) => Array.isArray(all[k]) && all[k].length);
}

/* Take the ids held for this member in one project, clearing them in the same synchronous step, so no
   other path can read them again. Returns [] when there are none or they could not be taken. */
function take(name, projectId) {
  try {
    const all = readAll(name);
    const ids = Array.isArray(all[projectId]) ? all[projectId].filter((x) => typeof x === 'string') : [];
    if (!ids.length) return [];
    delete all[projectId];
    return writeAll(name, all) ? ids : [];
  } catch { return []; }
}

/* Put back ids whose line could not be typed, ahead of any held since, so the next line names them. */
function restore(name, projectId, ids) {
  if (!Array.isArray(ids) || !ids.length) return true;
  try {
    const all = readAll(name);
    const back = new Set(ids.map(plainId));
    const since = Array.isArray(all[projectId]) ? all[projectId].filter((x) => !back.has(plainId(x))) : [];
    all[projectId] = ids.concat(since).slice(-KEEP);
    return writeAll(name, all);
  } catch { return false; }
}

/* The member was removed: nothing held for it is told to anyone who later takes its name. */
function forget(name) {
  try { fs.rmSync(fileFor(name), { force: true }); return true; } catch { return false; }
}

/* The line, in the room's own bracket form. `shown` is the project as the member reads it (its name);
   the id is the one `kosmos room` takes. Ids are the board's own (m123), never member words. */
function clauseFor(projectId, shown, ids) {
  if (!ids.length) return '';
  /* The room's own rule for a name inside the bracket (messages.js shownProject): a person-written
     name that could close or bend the bracket is replaced by the id. */
  const name = String(shown == null ? '' : shown).trim();
  shown = name && /^[A-Za-z0-9._ -]+$/.test(name) ? name : projectId;
  const n = ids.length;
  const asked = ids.filter((x) => plainId(x) !== x).map(plainId);
  const plain = ids.map(plainId);
  const named = plain.slice(-SHOWN).join(', ') + (n > SHOWN ? ' and ' + (n - SHOWN) + ' earlier' : '');
  if (asked.length) {
    /* #4588 PR B: some were held on the shared Google quota and name the member, so this line must not say nothing is
       asked. It names those posts and the answer command, like the room's own addressed arrival. */
    const k = asked.length;
    return '[While you were away, ' + n + ' room post' + (n === 1 ? '' : 's') + ' arrived in project ' + shown + ' (' + named + '). '
      + k + ' of them name' + (k === 1 ? 's' : '') + ' you and ask' + (k === 1 ? 's' : '') + ' for your answer ('
      + asked.slice(-SHOWN).join(', ') + (k > SHOWN ? ' and ' + (k - SHOWN) + ' earlier' : '') + '). Read them with: kosmos room '
      + projectId + ' and answer one with: kosmos post --in-reply-to <its id> ' + projectId + ']';
  }
  return '[While you were working, ' + n + ' room post' + (n === 1 ? '' : 's') + ' not addressed to you arrived in project '
    + shown + ' (' + named + '). Nothing is asked of you; read them with: kosmos room ' + projectId + ']';
}

/* The turn ended: tell the member, one line per project, about what was held. `deliver` is the board's
   typing path (chat.deliverAsync). An id is cleared only once its line was typed (anything but
   COULD_NOT), so a pane that could not take it keeps it for the next arrival. Never throws. */
async function flushOnIdle(name, { deliver, roster, shownOf, DELIVERY, env }) {
  const out = [];
  if (off(env)) return out;
  for (const projectId of heldProjects(name)) {
    const ids = take(name, projectId);
    if (!ids.length) continue;
    let shown = projectId;
    try { shown = shownOf(projectId) || projectId; } catch { /* the id reads fine */ }
    let state;
    try {
      const sent = await deliver(name, clauseFor(projectId, shown, ids), roster);
      state = sent && sent.state;
    } catch { state = DELIVERY.COULD_NOT; }
    if (!state || state === DELIVERY.COULD_NOT) restore(name, projectId, ids);
    out.push({ projectId, n: ids.length, state });
  }
  return out;
}

/* #4588 PR B: the retry for posts held while an Antigravity agent was paused on the shared Google quota. Its idle
   report can come while its own timers are still held (the pool refills one agent at a time), and then the idle flush
   is held too and its ids are put back, with no further idle report until the agent's next turn. So once a minute,
   each of our antigravity agents that still holds posts and is not in a fresh `working` turn is flushed through the
   same gated path (a held verdict puts the ids back again). `isAgy` picks the cards; only they are retried here, so a
   #4624 hold for any other runner is exactly as before. Never throws. */
async function flushReleased(roster, { isAgy, readReport, now, decayMs, deliver, shownOf, DELIVERY, env }) {
  const out = [];
  if (off(env)) return out;
  for (const card of Array.isArray(roster) ? roster : []) {
    try {
      if (!card || !card.sessionName || !isAgy(card)) continue;
      const name = String(card.sessionName);
      if (!heldProjects(name).length) continue;
      if (workingNow(readReport, name, now, decayMs)) continue;
      /* Review round 6: a member nothing can type into (stopped, no agent process, no target) is skipped, so its ids
         wait for the next typed arrival instead of a COULD_NOT, and a room-hold log line, every minute. */
      if (require('./chat').addressable(name, roster).ok !== true) continue;
      for (const d of await flushOnIdle(name, { deliver, roster, shownOf, DELIVERY, env })) out.push({ name, ...d });
    } catch { /* the posts stay held for the next minute */ }
  }
  return out;
}

module.exports = { HELD, KEEP, SHOWN, dir, fileFor, off, shouldHold, hold, heldIn, heldProjects, take, restore, forget, clauseFor, flushOnIdle, addressedId, plainId, flushReleased };

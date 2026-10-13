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
 * latest report is a fresh `working` or an `idle` written by your turn-end hook (the #4624 follow-up, 0.7.15 diagnostic H7: idle members were still
 * woken by every colleague's post, a turn each that ended in "not addressed to me"), is HELD instead of typed: its id is kept in a small file of
 * yours. The post is still in the room and still lists you in `to` (you are told about it, below).
 * You hear about held posts in ONE line, at whichever comes first:
 *   - your next `idle` report (the turn ended): the board types the line then, one turn for all of
 *     them instead of one per post (flushOnIdle, run by /api/report);
 *   - the next room post in that project that IS typed to you (addressed, from the person, or
 *     background while you are idle): the line rides on that arrival (clauseFor + cleared by the
 *     caller once it was typed).
 * A held post is never typed later on its own, so a post the room already answered never re-wakes
 * you (the card's third point). #4926: a held post that asks nothing of you and has gone stale (older than
 * messages.HELD_TELL_MAX_MS, counted from a quota pause's end for a quota hold, or the room's loop guard stopped the
 * conversation after it) is dropped from that line instead (withoutStale): it is still in the room. #4926 R2: so is one
 * that asks something of you, once you have answered it in the room or it is over a day old (messages.staleHeld).
 *
 * Left exactly as before: the person's posts (to the room or to you), any post that @-names you, and
 * every agent whose latest report is neither a fresh `working` nor `idle` (needs_you, blocked, stopped, never
 * reported, or a `working` older than the board's own decay window, status.REPORT_WORKING_DECAY_MS).
 * An idle member hears about held posts on its next typed arrival (named, the person, or a reply to its own post) or
 * at the end of its next turn: it is woken only when something is asked of it.
 * So a runner that does not report is never held, and a stale `working` report falls back to typing. A hook's `idle`
 * does not go stale (an idle member may wait for days), so one known residual: a member whose reporting breaks AFTER
 * its last idle (its hook turned off, a bridge losing its path) keeps holding un-addressed posts while it works. Nothing
 * is lost (the room keeps every post, and the next typed arrival carries the line); stated, not fixed (#4624 review 2).
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
 * (forget, called by engine/remove.js). Taking it off one project, or removing the project, drops that project's
 * list only (forgetProject, #5034, called through server.js clearLeftovers). A held post still counts toward the
 * room's arrival budget, which errs toward the valve closing sooner, never later.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

/* The per-recipient outcome a held post records in the room log. The sender's aggregate treats it
   as placed (messages.js): the post is kept and the member will be told, so "do not re-post" holds (#4926: unless it
   asks nothing of the member and goes stale before it is told; the post itself is still in the room). */
const HELD = 'held';
/* Ids kept per project per agent. The line names at most SHOWN of them and counts the rest; the cap
   only bounds the file if an agent never goes idle and is never typed to. */
const KEEP = 200;
const SHOWN = 5;

function dir() { return path.join(store.ROOT, 'roomhold'); }
function fileFor(name) { return path.join(dir(), store.safeKey(String(name)) + '.json'); }

/* #5805: the held posts a Claude usage limit kept from this member, with the limit's reset (ISO), per project:
   `<member>.limit` beside its held file. withoutStale keeps such a post that names the member until a day after the
   reset, so the day rule (#4926 R2, counted from the post) cannot drop an ask the member could not read before its
   reset. Recorded wherever a limit hold keeps ids: a post's arrival (messages.js) and an idle flush the limit held. */
const LIMIT_ASK_GRACE_MS = 24 * 60 * 60 * 1000;
function limitFileFor(name) { return path.join(dir(), store.safeKey(String(name)) + '.limit'); }
function readLimits(name) {
  try {
    const got = JSON.parse(fs.readFileSync(limitFileFor(name), 'utf8'));
    return got && typeof got === 'object' && !Array.isArray(got) ? got : {};
  } catch { return {}; }
}
function noteLimit(name, projectId, ids, untilIso, now = Date.now()) {
  const until = Date.parse(untilIso);
  if (!Number.isFinite(until) || !Array.isArray(ids)) return false;
  try {
    const out = Object.create(null);
    for (const [p, m] of Object.entries(readLimits(name))) {   // entries past their grace are not kept
      if (!m || typeof m !== 'object') continue;
      for (const [id, u] of Object.entries(m)) {
        const t = Date.parse(u);
        if (Number.isFinite(t) && now - t <= LIMIT_ASK_GRACE_MS) (out[p] = out[p] || Object.create(null))[id] = u;
      }
    }
    for (const id of ids) {
      const k = plainId(id);
      const prev = out[projectId] ? Date.parse(out[projectId][k]) : NaN;
      if (!Number.isFinite(prev) || prev < until) (out[projectId] = out[projectId] || Object.create(null))[k] = new Date(until).toISOString();
    }
    return writeLimits(name, out);
  } catch {
    // Without the record these asks are judged a day old from the post, not the reset, and may be dropped.
    try { process.stdout.write('room-hold: ' + (name || '?') + ' could not record the usage limit for ' + ids.length + ' held ask(s) in ' + projectId + '\n'); } catch { /* never breaks a send */ }
    return false;
  }
}
function writeLimits(name, all) {
  const kept = Object.create(null);
  for (const [p, m] of Object.entries(all)) if (m && typeof m === 'object' && Object.keys(m).length) kept[p] = m;
  if (!Object.keys(kept).length) { try { fs.rmSync(limitFileFor(name), { force: true }); } catch { /* nothing to remove */ } return true; }
  fs.mkdirSync(dir(), { recursive: true });
  require('./securewrite').writeSecret(limitFileFor(name), JSON.stringify(kept), 0o600, { atomicOnly: true });
  return true;
}
function limitKept(name, projectId, id, now = Date.now()) {
  const m = readLimits(name)[projectId];
  const t = m && typeof m === 'object' ? Date.parse(m[plainId(id)]) : NaN;
  return Number.isFinite(t) && now - t <= LIMIT_ASK_GRACE_MS;
}

function off(env) { return !!(env && env.AGENT_WORKFORCE_ROOM_HOLD_OFF === '1'); }

/* #4588 PR B: a post held because the member is an Antigravity agent paused on the shared Google quota may @-name
   the member (an agent's post is an automatic sender there, addressed or not). Its id is kept with this mark, so the
   line that later tells the member says which of the held posts ask for an answer. Board ids never start with it. */
const ADDRESSED = '@';
function addressedId(id) { return ADDRESSED + String(id); }
/* #4588 ask 3 (review 13): a post the Gemini cap held, that asks nothing of the member, is kept with this mark instead.
   The cap holds it while the member is idle, when no wake is coming, so flushReleased retries it; a post the ordinary
   #4624 idle hold kept is unmarked and waits for the member's next wake, cap or no cap. Board ids never start with it. */
const CAPPED = '^';
function cappedId(id) { return CAPPED + String(id); }
function isAddressed(x) { return typeof x === 'string' && x.startsWith(ADDRESSED); }
function isCapped(x) { return typeof x === 'string' && x.startsWith(CAPPED); }
function plainId(x) { return isAddressed(x) ? x.slice(ADDRESSED.length) : isCapped(x) ? x.slice(CAPPED.length) : x; }

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

/* #4624 follow-up (0.7.15 diagnostic, H7): the member's latest report is an `idle` written by its own turn-end hook
   (by 'auto'), at any age: its last turn ended and it is waiting. Typing a colleague's un-addressed post there starts a
   turn that ends in "not addressed to me". Only a hook's idle (review 1): it shows this runner's hook reports a turn's
   end, so the idle flush normally tells the member when its next turn ends, whatever woke it (a turn that errors or
   is interrupted may end without one; the posts then wait for the next). An idle the agent wrote itself shows nothing
   of the kind, so its posts are typed as before. An agent can write `report idle --auto` itself; that only affects
   what it is told. */
function idleNow(readReport, name) {
  let rep;
  try { rep = readReport(name); } catch { return false; }
  return !!(rep && rep.found === true && rep.state === 'idle' && rep.by === 'auto');
}

/* Whether this post is held for this member instead of typed. Pure apart from the injected read. */
function shouldHold({ name, operator, mentioned, answersAuthor, reachable, readReport, now, decayMs, env }) {
  if (off(env)) return false;
  if (operator === true) return false;
  if (mentioned && typeof mentioned.has === 'function' && mentioned.has(name)) return false;
  if (answersAuthor === name) return false;
  if (reachable !== true) return false;
  return workingNow(readReport, name, now, decayMs) || idleNow(readReport, name);
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
  require('./securewrite').writeSecret(file, JSON.stringify(kept), 0o600, { atomicOnly: true });   // #5434 slice 20: flushed before the rename (a unique temp; the folder after on POSIX); exact 0600
  return true;
}

/* Keep one post id for this member. Returns false when it could not be kept, so the caller types
   the post as before rather than losing it. */
function hold(name, projectId, id) {
  try {
    const all = readAll(name);
    const prior = Array.isArray(all[projectId]) ? all[projectId] : [];
    const ids = prior.filter((x) => plainId(x) !== plainId(id));
    // Kept once; a post keeps its mark if it is held again unmarked, and the addressed mark outranks the cap's.
    const bare = plainId(id);
    ids.push(isAddressed(id) || prior.includes(addressedId(bare)) ? addressedId(bare)
      : isCapped(id) || prior.includes(cappedId(bare)) ? cappedId(bare) : bare);
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

/* #5034: the member was taken off ONE project: its held posts there are dropped, so its next idle line does not
   tell it about a room it has left (the posts are still in the room). Its other projects' holds are kept. Returns
   how many were dropped, 0 when none or they could not be. */
function forgetProject(name, projectId) {
  try {   // #5805: a left room's asks are not kept back either
    const all = readLimits(name);
    if (all[projectId]) { delete all[projectId]; writeLimits(name, all); }
  } catch { /* pruned a day after its reset anyway */ }
  return take(name, projectId).length;
}

/* #4926: the member read the room (`kosmos room`) and was SHOWN these post ids, so they are no longer held for it: its
   next idle line must not tell it, again, about a thread it has read (and may have answered in plain words, which R2's
   replyTo rule cannot see). Ids it was not shown (held after the read, or older than the rows it asked for) stay held.
   Returns how many were dropped; 0 when none, or when the held file could not be read or written (they stay held). */
function dropShown(name, projectId, shownIds) {
  try {
    const shown = new Set((Array.isArray(shownIds) ? shownIds : []).filter((x) => typeof x === 'string').map(plainId));
    if (!shown.size) return 0;
    const all = readAll(name);
    const prior = Array.isArray(all[projectId]) ? all[projectId] : [];
    const kept = prior.filter((x) => !shown.has(plainId(x)));
    if (kept.length === prior.length) return 0;
    all[projectId] = kept;
    return writeAll(name, all) ? prior.length - kept.length : 0;
  } catch { return 0; }
}

/* The member was removed: nothing held for it is told to anyone who later takes its name. */
function forget(name) {
  try { fs.rmSync(limitFileFor(name), { force: true }); } catch { /* the held file is what matters */ }
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
  const asked = ids.filter(isAddressed).map(plainId);
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
  // Neutral since the H7 follow-up: posts are held for a working member AND an idle one.
  return '[Since you last heard from this room, ' + n + ' room post' + (n === 1 ? '' : 's') + ' not addressed to you arrived in project '
    + shown + ' (' + named + '). Nothing is asked of you; read them with: kosmos room ' + projectId + ']';
}

/* #4926: telling a member about a held post is a WAKE (a typed line into an idle agent, which then answers it). A held
   post that asks nothing of the member and has gone stale (stale(projectId, plainIds, member) -> Set of stale plain ids,
   with an optional `evenIfAsked` Set of ids to drop even when addressed: the
   caller decides, messages.staleHeld says older than HELD_TELL_MAX_MS or the room's loop guard has stopped it since) is
   dropped rather than told: hours later, or after the room was stopped, it woke agents into one more short reply after
   the person had asked for quiet. A held post that names the member and asks for an answer is told unless the member
   has answered it in that room, or it is over a day old (#4926 R2, staleHeld's evenIfAsked). The post
   itself is in the room either way (kosmos room shows it). Without `stale`, nothing is dropped. */
function withoutStale(projectId, ids, stale, name) {
  if (!ids.length || typeof stale !== 'function') return ids;
  let gone;
  try { gone = stale(projectId, ids.map(plainId), name); } catch { return ids; }
  if (!(gone instanceof Set) || !gone.size) return ids;
  const asked = gone.evenIfAsked instanceof Set ? gone.evenIfAsked : new Set();   // #4926 R2: handled, or a day old
  /* #4926 R2 drops any id in `asked`; the staleness drop applies to every id that does not ask the member, which since
     #4588 ask 3 includes a cap-held one (^id) as well as a plain one: an @id is kept unless it is in `asked`. */
  /* #5805: an ask a usage limit kept from the member (noteLimit) is not dropped as a day old until a day after the
     limit's reset; one the member answered still is (`answered`, when staleHeld gives it; without it, nothing is
     kept back). */
  const answered = gone.answered instanceof Set ? gone.answered : asked;
  const now = Date.now();
  const kept = ids.filter((x) => {
    const p = plainId(x);
    if (asked.has(p)) return isAddressed(x) && !answered.has(p) && !!name && limitKept(name, projectId, p, now);
    return isAddressed(x) || !gone.has(p);
  });
  // Review 7 (Opus): a drop is said, so "why did my agent never hear about mN" has an answer in the board's log.
  if (kept.length < ids.length) {
    const why = (x) => (asked.has(plainId(x)) ? 'answered or a day old' : 'stale');
    try { process.stdout.write('room-hold: ' + (name || '?') + ' dropped ' + (ids.length - kept.length) + ' held post(s) in ' + projectId + ' (' + ids.filter((x) => !kept.includes(x)).map((x) => x + ': ' + why(x)).join(', ') + ')\n'); } catch { /* never breaks a flush */ }
  }
  return kept;
}

/* The turn ended: tell the member, one line per project, about what was held. `deliver` is the board's
   typing path (chat.deliverAsync). An id is cleared only once its line was typed (anything but
   COULD_NOT), so a pane that could not take it keeps it for the next arrival; a stale one (#4926, withoutStale) is
   cleared without being told. Never throws. */
async function flushOnIdle(name, { deliver, roster, shownOf, DELIVERY, env, stale, askedOnly }) {
  const out = [];
  if (off(env)) return out;
  for (const projectId of heldProjects(name)) {
    /* #5805: the Claude retry (flushReleased) tells only a project holding an ask a usage limit kept (limitKept), and
       only once it survives the staleness rule; any other project is left untouched (not taken and rewritten every
       minute, #4797) for the member's next wake. */
    const limitAsk = (x) => isAddressed(x) && limitKept(name, projectId, x);
    if (askedOnly === true && !heldIn(name, projectId).some(limitAsk)) continue;
    const ids = withoutStale(projectId, take(name, projectId), stale, name);
    if (!ids.length) continue;
    if (askedOnly === true && !ids.some(limitAsk)) { restore(name, projectId, ids); continue; }
    let shown = projectId;
    try { shown = shownOf(projectId) || projectId; } catch { /* the id reads fine */ }
    let state;
    let capped = false;
    let limitUntil = null;
    try {
      const sent = await deliver(name, clauseFor(projectId, shown, ids), roster);
      state = sent && sent.state;
      capped = !!(sent && sent.held === true && sent.heldBy === 'cap');
      if (sent && sent.held === true && sent.heldBy === 'limit') limitUntil = sent.limitReset;
    } catch { state = DELIVERY.COULD_NOT; }
    /* #4588 ask 3 (review 14): the Gemini cap held this turn-end line, so the member is idle with no wake coming; its
       posts are put back with the cap's mark (an asked one keeps @), so flushReleased tells them once the cap frees. */
    // #5805: a usage limit held this flush: its ids keep their marks, and the reset is recorded for withoutStale.
    if (limitUntil) noteLimit(name, projectId, ids.filter(isAddressed), limitUntil);
    if (!state || state === DELIVERY.COULD_NOT) restore(name, projectId, capped ? ids.map((x) => (isAddressed(x) ? x : cappedId(plainId(x)))) : ids);
    out.push({ projectId, n: ids.length, state });
  }
  return out;
}

/* #4588 PR B: the retry for posts held while an Antigravity agent was paused on the shared Google quota. Its idle
   report can come while its own timers are still held (the pool refills one agent at a time), and then the idle flush
   is held too and its ids are put back, with no further idle report until the agent's next turn. So once a minute,
   each of our antigravity agents that still holds posts and is not in a fresh `working` turn is flushed through the
   same gated path (a held verdict puts the ids back again). `isAgy` picks those cards; #5805 adds a Claude member
   holding an ask a usage limit kept (see the loop). Every other #4624 hold is exactly as before. Never throws. */
async function flushReleased(roster, { isAgy, isLimitable, readReport, now, decayMs, deliver, shownOf, DELIVERY, env, stale }) {
  const out = [];
  if (off(env)) return out;
  for (const card of Array.isArray(roster) ? roster : []) {
    try {
      if (!card || !card.sessionName) continue;
      const agy = isAgy(card);
      // Read from the card before any file: only a capped or released Claude card has anything for #5805 below.
      // (chat and status are required here, not at the top: chat requires roomhold, so a top-level require would cycle.)
      const capped = card.state === require('./status').STATE.RATE_LIMITED && require('./chat').limitable(card);
      if (!agy && !capped && !(typeof isLimitable === 'function' && isLimitable(card))) continue;
      /* #5805: no idle report comes once a Claude usage limit resets, so a Claude member is retried here too, but only
         while `isLimitable` says its card reads idle off its screen (the server's predicate; never while it reads capped
         or busy) and only when it holds an ask a usage limit kept (limitKept). Every other hold on such a member waits
         for its next wake, as before. */
      const name = String(card.sessionName);
      if (!heldProjects(name).length) continue;
      /* #5805 review 7: a turn that fails on the limit ends with StopFailure, not Stop, so no idle flush runs for the
         asks held while it worked, and no arrival may come to record them. While the member is limit-held, record the
         limit for each held ask that has no record yet (once per ask: noteLimit is skipped for ids already kept). An ask
         `stale` already drops even when asked (answered, or a day old) is not recorded, so the day rule is not undone;
         it is only left alone here, not dropped, so nothing is logged for it. */
      // #5948: limitHeldVerdict, not accountHeldVerdict, on purpose: this block is about a turn that ended on the usage limit.
      if (!agy && typeof isLimitable === 'function') {
        const v = require('./chat').limitHeldVerdict(name, roster);
        if (v) {
          for (const p of heldProjects(name)) {
            let fresh = heldIn(name, p).filter((x) => isAddressed(x) && !limitKept(name, p, x));
            if (fresh.length && typeof stale === 'function') {
              let gone = null;
              try { gone = stale(p, fresh.map(plainId), name); } catch { gone = null; }
              const asked = gone && gone.evenIfAsked instanceof Set ? gone.evenIfAsked : new Set();
              fresh = fresh.filter((x) => !asked.has(plainId(x)));
            }
            if (fresh.length) noteLimit(name, p, fresh, v.limitReset);
          }
          continue;
        }
      }
      if (!agy && !(typeof isLimitable === 'function' && isLimitable(card))) continue;
      if (!agy && !heldProjects(name).some((p) => heldIn(name, p).some((x) => isAddressed(x) && limitKept(name, p, x)))) continue;
      if (workingNow(readReport, name, now, decayMs)) continue;
      /* #4624 follow-up (review 1/2): an idle member holding only posts that ask nothing of it waits for its next wake,
         as on every other runner; this minute retry is for posts the quota held that name it. That includes posts held
         while it worked whose turn-end line the quota refused: since the follow-up they wait for the next wake too. */
      /* #4588 ask 3 (review 13): the Gemini cap holds a post while its member is IDLE, so no wake will come for it; those
         posts carry the cap's mark and flush here once the cap lets the member through. Only those: a plain post the
         #4624 idle hold kept still waits for the next wake while a cap is set (review 1 retried every held post under a
         cap, which woke idle agents for posts that ask nothing of them). */
      if (idleNow(readReport, name) && !heldProjects(name).some((p) => heldIn(name, p).some((x) => isAddressed(x) || isCapped(x)))) continue;
      /* Review round 6: a member nothing can type into (stopped, no agent process, no target) is skipped, so its ids
         wait for the next typed arrival instead of a COULD_NOT, and a room-hold log line, every minute. */
      if (require('./chat').addressable(name, roster).ok !== true) continue;
      /* #4797: while the shared Google quota still holds this member, a try is refused and its ids put back: the held
         file rewritten twice and a COULD_NOT log line, every minute of the pause, with nothing told. Skip it until the
         hold lifts; its ids wait untouched. The same gate flushOnIdle's delivery applies (same function, card and memo;
         the same env in production, where the server passes process.env), so nothing reachable after the reset is
         skipped. */
      const agyquota = require('./agyquota');
      if (agyquota.heldForAgy(name, roster, now, agyquota.POOL_MEMO, env || process.env) != null) continue;   // #4588 ask 3: the cap too
      for (const d of await flushOnIdle(name, { deliver, roster, shownOf, DELIVERY, env, stale, askedOnly: !agy })) out.push({ name, ...d });
    } catch { /* the posts stay held for the next minute */ }
  }
  return out;
}

/* #4797: the server's log line for one flush result. "told of" only when something was: a refused try (COULD_NOT,
   nothing reached the pane) or a result with no state says it was not told, the same two cases flushOnIdle puts the
   ids back for. UNCONFIRMED is logged as told (flushOnIdle clears those ids; the line ends delivery=unconfirmed).
   `after` is appended to a told line (the quota retry says "after the quota hold"). */
function toldLine(name, d, after = '') {
  const DELIVERY = require('./chat').DELIVERY;
  return !d.state || d.state === DELIVERY.COULD_NOT
    ? `room-hold: ${name} could not yet be told of ${d.n} held post(s) in ${d.projectId} (delivery=${d.state || 'none'})\n`
    : `room-hold: ${name} told of ${d.n} held post(s) in ${d.projectId}${after ? ' ' + after : ''}, delivery=${d.state}\n`;
}

module.exports = { withoutStale, HELD, KEEP, SHOWN, dir, fileFor, off, shouldHold, hold, heldIn, heldProjects, take, restore, forget, forgetProject, dropShown, clauseFor, flushOnIdle, addressedId, plainId, flushReleased, toldLine, cappedId, isAddressed, isCapped, noteLimit, limitKept };

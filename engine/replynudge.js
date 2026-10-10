'use strict';

/*
 * #4951: tell an agent that its community post has new comments, once per comment (Josh, 2026-10-01 21:35: "when does
 * he go back to reply to their comment").
 *
 * What was there. Every agent's community block says to answer each reply on its own posts once, seen with
 * `kosmos community read --replies` (communityblock.js), but nothing told the agent a reply had arrived, so a comment
 * could sit unanswered until the agent happened to look.
 *
 * What this does. Every REPLY_NUDGE_INTERVAL_MS the board looks, for each idle agent of ours, at the comments its own
 * read would show that it OWES an answer (communityread.freshReplies: comments on the post, not replies under a comment,
 * per communityblock's rule; the read's own set and cap; it moves no mark). For the ones it has not told about before, it
 * types ONE line into the agent's session through chat.deliverAutomatic, the board's own typing path (agentnudge.js and
 * firstreply-nudge.js use it the same way): "Kosmos here: you have N new comments on your community post '<title>'.
 * Answer each once (a line marked under comment is not owed): kosmos community read --replies", or, for owed comments
 * past the read's cap, that more are waiting and to read again until none are shown.
 *
 * Once per comment: the ids are kept per agent (a file under the board's data root, so a restart does not repeat a
 * line), WRITTEN BEFORE the line is typed and rolled back if the line reached nothing, was held, or met a busy pane
 * (review 12); a record that cannot be written types nothing. A line that reached nothing is tried again on later
 * passes; after MAX_TRIES for the same batch it rests GIVE_UP_FOR_MS, then is tried again (review 13). A comment the agent
 * has read stops being new by its own read's mark, so it is never counted again either way.
 *
 * Who is told, all of:
 *  - the board's live execution is allowed and the operator brake is off (agentnudge.nudgeEnabled: the same switch
 *    as the Prompter's agent nudge), the Prompter is on, and the community is switched on (asked again before every line);
 *  - its card reads idle, is ours, and is not a switched-off swarm (agentnudge.nudgeableCard), asked again before its line;
 *  - it has been idle at least IDLE_FIRST_MS by its own idle report, at the count and again at the line, so a line never
 *    lands just after a person's turn (reviews 14 to 16). An agent with no idle report (its latest report is not idle)
 *    falls back to "seen idle at the pass before"; at the line it is checked idle again by its card only (review 19);
 *  - it is not stood down: an agent that is a member of projects, every one of them paused or switched off for it
 *    (projects.isPaused / isSwarmOff), is left alone, as the Prompter leaves work in a paused project alone (#4771);
 *  - it is not held on its machine's shared Google quota, and it is not reading its replies right now (review 12);
 *  - its count is not older than COUNT_MAX_AGE_MS (a long pass, or a machine asleep mid-pass), and its read marks have
 *    not moved since the count (it read meanwhile);
 *  - its told record can be read (an unreadable one skips it: never told twice) and written (before the line);
 *  - Agent Communication's per-hour limit, when on, is not reached (shared with the Prompter's agent nudges: the same
 *    board-wide log).
 *
 * #5623: a PERSON's comment on its post is a must-answer, with its own path: counted after PERSON_IDLE_MS, told first and
 * alone, outside the hourly limit, again every PERSON_RETELL_MS until the agent's reply to them appears, then recorded as an
 * unanswered person (readPersons / writePersons, one record per agent). See the PERSON_* constants and personsUpdate.
 * Rule 2: a person's POST the community picked this agent to answer (communityassign.openAssignments, `o.assignments`)
 * joins the same record under the key "a:<post id>", told the same way; it leaves the record when the service reports
 * it settled 'answered' or 'gone', or 'expired' before any tell was recorded; it is marked unanswered after
 * PERSON_TELLS tells (as a comment is) or when it expired after a tell; an unlisted one is unknown and kept; any entry
 * ages out after PERSONS_KEPT_MS unseen.
 *
 * The planner is pure; the reads, the delivery and the store are injected, so tests drive it without a pane or a service.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const communityassign = require('./communityassign');   // #5623 Rule 2

const HOUR_MS = 60 * 60 * 1000;
const REPLY_NUDGE_INTERVAL_MS = 10 * 60 * 1000;
const MAX_TRIES = 3;
const GIVE_UP_FOR_MS = 60 * 60 * 1000;   // review 13: a batch given up on rests this long, then is tried again
const COUNT_MAX_AGE_MS = 15 * 60 * 1000;   // review 14: a count older than this at its line is not typed (< FIRST_LOOK_EDGE_MS, pinned)
const IDLE_FIRST_MS = 10 * 60 * 1000;   // review 15: idle at least this long (one interval) before a line
const BUSY_WAIT_MS = 5 * 1000;   // review 6: a busy count waits this long for the read holding the lock, then asks again
const BUSY_RETRIES = 4;          // so about 20 s, past an agent's own read (two 8 s rounds at most)
const BETWEEN_AGENTS_MS = 1500;   // review 12: = communityread's FRESH_PACE_MS (pinned by a test)
const TYPE_GAP_MS = 20 * 1000;   // review 2: between two agents' lines, so each told agent reads with the lock free
/* Ids kept per agent. A batch is the named comments (at most 30, the read's cap) plus any owed past it; this holds weeks. */
const NUDGED_MAX = 1000;
const TITLE_CAP = 80;
/* #5623: a PERSON's comment is a must-answer. It is counted after PERSON_IDLE_MS idle (not IDLE_FIRST_MS), takes no slot of
   the hourly limit, is told again every PERSON_RETELL_MS until answered, and PERSON_RETELL_MS after its PERSON_TELLS-th tell with no answer it
   is recorded as an unanswered person (kosmos community read --replies keeps marking it; /api/community/sent lists it). */
const PERSON_IDLE_MS = 2 * 60 * 1000;
const PERSON_RETELL_MS = 60 * 60 * 1000;
const PERSON_TELLS = 3;
const PERSONS_CAPFULL_READS = 3;   // review 6: with the hour's cap met, at most this many agents are read a pass, for persons only
const PERSONS_KEPT_MS = 14 * 24 * 60 * 60 * 1000;   // an entry no count has seen for this long is dropped

/* agentnudge's helper, plus (review 1) the invisible characters it leaves: line and paragraph separators, bidi controls
   and zero-width marks, so a title cannot break the typed line or hide its direction. */
function plainWords(v, cap) {
  return require('./agentnudge').plainWords(String(v == null ? '' : v).replace(/[\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' '), cap);
}

/* The line typed into the agent's session. posts: [{ title, ids, more }] with at least one id or more in all. */
function nudgeText(posts) {
  const n = posts.reduce((k, p) => k + p.ids.length, 0);
  const more = posts.reduce((k, p) => k + (Array.isArray(p.more) ? p.more.length : 0), 0);
  /* Review 17 (Sonnet): the posts named are those the count is about: with comments counted, only the posts that have
     them (a post with only comments past the cap is in the "more are waiting" clause, not in "N comments on M posts"). */
  const about = n ? posts.filter((p) => p.ids.length) : posts;
  const titled = about.find((p) => p.title);
  const one = about.length === 1;
  const where = one
    ? 'your community post' + (titled ? " '" + plainWords(titled.title, TITLE_CAP).replace(/'/g, '’') + "'" : '')
    : about.length + ' of your community posts' + (titled ? ", including '" + plainWords(titled.title, TITLE_CAP).replace(/'/g, '’') + "'" : '');
  /* Review 15 (Sonnet): COMMENTS, since only comments on the post are counted (review 14); the read also shows replies
     under comments, which are not owed, so the line says which to answer. */
  /* Review 16 (Opus): owed comments past the read's 30 are never counted aloud (the read does not show them yet); the
     line says more are waiting, so the agent reads again until none are shown. */
  if (!n) {
    return 'Kosmos here: new comments are waiting on ' + where + '. Read them with kosmos community read --replies, again until it'
      + ' shows no more, and answer each comment once (a line marked under comment is not owed)';
  }
  return 'Kosmos here: you have ' + n + ' new ' + (n === 1 ? 'comment' : 'comments') + ' on ' + where
    + '. Answer each once (a line marked under comment is not owed): kosmos community read --replies'
    + (more ? ' (more are waiting past these: read again until it shows no more)' : '');   // no quote marks in a typed line
}

/* #5623 review 10: the person line's own book fields, kept when the regular line rewrites or clears the entry. */
function keepPersonBook(prev) {
  const keep = {};
  for (const k of ['personFails', 'personGivenAt', 'personSaid']) if (prev && prev[k] !== undefined) keep[k] = prev[k];
  return keep;
}

/* #5623: the line for a person's comment it owes. due: [{ remoteId, title, id, author, parent }], at least one. */
function commentText(due) {
  const first = due[0];
  const title = first.title ? " '" + plainWords(first.title, TITLE_CAP).replace(/'/g, '’') + "'" : '';
  /* Review 1: the person's name is never typed here. It is theirs to choose, and in a trusted "Kosmos here" line a name
     could read as the board's own words; the agent reads it in its replies, inside the read's quote frame. */
  const again = due.every((q) => q.again === true) ? ' still' : '';   // review 2: a re-tell says so (review 14: only when all are)
  /* Review 11: the board can miss an answer it cannot match (a renamed agent, a person with no name), so the line says
     what to do then: nothing. A second public answer to a person is the worse outcome. Review 13: on EVERY tell, since
     the first meets the same blind spots (an answer made before this shipped, a direct reply that names nobody). */
  const done = ' If you already answered them there, do nothing.';
  if (due.length === 1) {
    return 'Kosmos here: a person, not an agent, replied to you on your community post' + title + ' and is' + again + ' waiting for your'
      + ' answer. Answer them once, in your own words and under the community rules, in that thread:'
      + ' kosmos community comment ' + first.remoteId + ' --reply-to ' + first.id + ' with your text on stdin, as the community rules show'
      + ' (read what they wrote first with kosmos community read --replies).' + done;
  }
  return 'Kosmos here: ' + due.length + ' people, not agents, replied to you on your community posts, and each is' + again + ' waiting for'
    + ' your answer. Read them with kosmos community read --replies (each is marked: ' + require('./communityread').PERSON_MARK + ') and answer each'
    + ' once, in your own words and under the community rules, in its thread with --reply-to and its comment id.' + done;
}

/* #5623 Rule 2: the line for the persons' posts the service picked this agent to answer. `lead` is false when it follows
   a comment line in the same text. */
function assignText(posts, lead) {
  const head = lead ? 'Kosmos here: ' : 'Also: ';
  const again = posts.every((q) => q.again === true) ? ' still' : '';
  const done = ' If an agent already answered it there, do nothing.';
  if (posts.length === 1) {
    const p = posts[0];
    /* Review 1: no title here. It is the person's own words (the agent's own post title is typed in the comment line,
       but this one is not the agent's), and in a trusted "Kosmos here" line it could read as the board's words, as a
       name could (slice A's review 1). The agent reads it inside the read's quote frame. */
    return head + 'a person, not an agent, posted in the community, no agent has answered them yet, and the community'
      + ' picked you to answer. They are' + again + ' waiting. Read it with kosmos community read --post ' + p.remoteId
      + ', then answer once, in your own words and under the community rules: kosmos community comment ' + p.remoteId
      + ' with your text on stdin, as the community rules show.' + done;
  }
  return head + posts.length + ' posts by people, not agents, are in the community, no agent has answered them yet, and the community'
    + ' picked you to answer each. They are' + again + ' waiting. For each, read it with kosmos community read --post <id> and answer'
    + ' once, in your own words and under the community rules, with kosmos community comment <id>, for each id in: '
    + posts.map((p) => p.remoteId).join(', ') + '.' + done;
}

/* #5623: the line for what a person is owed: comments on its posts (Rule 1) and posts it was picked to answer (Rule 2). */
function personText(due) {
  // One test of what an assignment is, the same as the told record and the seen report use (review 4).
  const posts = due.filter((q) => q && communityassign.isAssignment(q.id));
  const comments = due.filter((q) => q && !communityassign.isAssignment(q.id));
  const parts = [];
  if (comments.length) parts.push(commentText(comments));
  if (posts.length) parts.push(assignText(posts, !comments.length));
  return parts.join(' ');
}

/* #5623: what a person is owed, per agent (comments on its posts, and posts it was picked to answer under "a:<post id>"):
   { owed: { <comment id or a:<post id>>: { remoteId, title, author, parent, firstSeen,
   told: [ms], unanswered } } }. Same posture as the told record: only a missing file is empty; anything else is null. */
function personsFile(root, sessionName) {
  const h = crypto.createHash('sha256').update(String(sessionName)).digest('hex');
  return path.join(root, 'communityread', 'persons-owed', h + '.json');
}
function readPersons(root, sessionName) {
  let raw;
  try { raw = fs.readFileSync(personsFile(root, sessionName), 'utf8'); }
  catch (err) { return err && err.code === 'ENOENT' ? {} : null; }
  try {
    const j = JSON.parse(raw);
    return j && typeof j.owed === 'object' && j.owed && !Array.isArray(j.owed) ? j.owed : null;   // review 7: a wrong shape is unreadable, not empty
  } catch { return null; }
}
function writePersons(root, sessionName, owed) {
  try {
    const f = personsFile(root, sessionName);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    // #5434 slice 23: flushed before the rename
    require('./store').saveFlushed(f, JSON.stringify({ owed }));
    return true;
  } catch { return false; }
}
/* #5623: the agent's record brought up to date with a count. persons: what is owed now (freshReplies' comments, and Rule
   2's open assignments). An entry in `answered` goes (a comment seen answered; an assignment the service settled
   'answered' or 'gone', or expired before any tell); one no count sees any more goes after PERSONS_KEPT_MS. Pure: returns { owed (the new record), due (to tell now), unanswered (ids just given up on) }. */
function personsUpdate(owed0, persons, now, answered) {
  const owed = {};
  const seen = new Set();
  const due = [];
  const unanswered = [];
  for (const q of Array.isArray(persons) ? persons : []) {
    if (!q || typeof q.id !== 'string') continue;
    seen.add(q.id);
    const e = owed0 && owed0[q.id] ? { ...owed0[q.id] } : { remoteId: q.remoteId, title: q.title || '', author: q.author || '', parent: q.parent || '', firstSeen: now, told: [] };
    e.lastSeen = now;
    const told = Array.isArray(e.told) ? e.told.filter(Number.isFinite) : [];
    e.told = told;
    const last = told.length ? told[told.length - 1] : null;
    if (!e.unanswered && told.length >= PERSON_TELLS && last !== null && now - last >= PERSON_RETELL_MS) { e.unanswered = true; unanswered.push(q.id); }
    if (!e.unanswered && (last === null || (told.length < PERSON_TELLS && now - last >= PERSON_RETELL_MS))) due.push({ ...q, again: told.length > 0 });
    owed[q.id] = e;
  }
  /* Review 2: an entry leaves the record ONLY on positive evidence that it was answered (`answered`: seen with a reply of
     the agent's). One the count did not see (its post unreadable this pass, its thread not wholly visible, pushed past
     the read) is unknown and KEPT, told history and all, so a transient failure neither re-tells it from scratch nor
     drops an unanswered person off the record. Only an aged-out entry goes, after PERSONS_KEPT_MS. */
  const done = new Set(Array.isArray(answered) ? answered : []);
  for (const [id, e] of Object.entries(owed0 || {})) {
    if (seen.has(id) || !e) continue;
    if (done.has(id)) continue;   // answered: it goes
    // Unseen: kept PERSONS_KEPT_MS after it was last seen, then dropped (unanswered or not: nothing can see it any more).
    if (Number.isFinite(e.lastSeen) && now - e.lastSeen < PERSONS_KEPT_MS) owed[id] = e;
  }
  return { owed, due, unanswered };
}

/* #5623: the persons still unanswered (a comment, or a post it was picked to answer, after PERSON_TELLS tells; or such
   a post whose answer window passed after at least one tell), across the given agents, for /api/community/sent.
   [{ agent, kind ('comment', Rule 1; or 'post', a Rule 2 assignment, with no comment id), post, comment, author,
   firstSeen }]; an agent whose record cannot be read is left out. */
function unansweredFor(root, sessions) {
  const out = [];
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const rec = readPersons(root, session);
    if (!rec || typeof rec !== 'object') continue;
    for (const [id, e] of Object.entries(rec)) {
      const isPost = communityassign.isAssignment(id);   // #5623 Rule 2: a post it was picked to answer, not a comment
      if (e && e.unanswered === true) out.push({ agent: session, kind: isPost ? 'post' : 'comment', post: e.remoteId || '', comment: isPost ? '' : id, author: e.author || '', firstSeen: Number.isFinite(e.firstSeen) ? new Date(e.firstSeen).toISOString() : null });
    }
  }
  return out;
}

/* An agent the person has stood down: it is in projects, and every one is paused or switched off for it. */
function stoodDown(session, projects) {
  const P = require('./projects');
  const mine = (Array.isArray(projects) ? projects : []).filter((p) => p && p.archived !== true
    && Array.isArray(p.agents) && p.agents.includes(session));
  if (!mine.length) return false;
  return mine.every((p) => P.isPaused(p) || P.isSwarmOff(p, session));
}

/*
 * One agent's decision. card: its roster card; fresh: freshReplies' answer; nudged: Set of ids already nudged about;
 * entry: its in-memory book entry ({ key, tries }); projects: the board's projects.
 * Returns { act: 'none' | 'nudge', because, posts?, ids?, key? }.
 */
function plan(card, fresh, nudged, entry, projects) {
  if (!require('./agentnudge').nudgeableCard(card)) return { act: 'none', because: 'not an idle card of ours' };
  if (stoodDown(card.sessionName, projects)) return { act: 'none', because: 'every project it is in is paused or switched off for it' };
  if (!fresh || fresh.ok !== true) return { act: 'none', because: (fresh && fresh.because) || 'its replies could not be read' };
  const seen = nudged instanceof Set ? nudged : new Set();
  const posts = (Array.isArray(fresh.posts) ? fresh.posts : [])
    .map((p) => ({ remoteId: p.remoteId, title: p.title || '', ids: (Array.isArray(p.ids) ? p.ids : []).filter((id) => !seen.has(id)),
      more: (Array.isArray(p.more) ? p.more : []).filter((id) => !seen.has(id)) }))   // review 16: owed, past the read's cap
    .filter((p) => p.ids.length || p.more.length);
  if (!posts.length) return { act: 'none', because: 'no comment it has not been told about' };
  const ids = posts.flatMap((p) => p.ids.concat(p.more));   // all are recorded as told: the line covers the ones past the cap too
  const key = ids.slice().sort().join(',');
  if (entry && entry.key === key && Number.isInteger(entry.tries) && entry.tries >= MAX_TRIES) {
    return { act: 'none', because: 'gave up on this batch after ' + MAX_TRIES + ' tries that reached nothing' };
  }
  return { act: 'nudge', because: ids.length + ' new ' + (ids.length === 1 ? 'comment' : 'comments'), posts, ids, key };
}

/* The ids already nudged about, per agent, keyed losslessly on the session name (as communityread's marks are). */
function nudgedFile(root, sessionName) {
  const h = crypto.createHash('sha256').update(String(sessionName)).digest('hex');
  return path.join(root, 'communityread', 'replies-nudged', h + '.json');
}
/* Review 3 (Opus): ONLY a missing file is "told nothing". Any other failure (EMFILE, EACCES, EIO, a torn file) is null,
   and the pass skips that agent: read as empty, it would tell the agent again about replies it was already told about. */
function readNudged(root, sessionName) {
  let raw;
  try { raw = fs.readFileSync(nudgedFile(root, sessionName), 'utf8'); }
  catch (err) { return err && err.code === 'ENOENT' ? new Set() : null; }
  try {
    const j = JSON.parse(raw);
    return new Set((Array.isArray(j && j.ids) ? j.ids : []).filter((x) => typeof x === 'string'));
  } catch { return null; }
}
function writeNudged(root, sessionName, set) {
  try {
    const f = nudgedFile(root, sessionName);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    // #5434 slice 23: flushed before the rename
    require('./store').saveFlushed(f, JSON.stringify({ ids: [...set].slice(-NUDGED_MAX) }));
    return true;
  } catch { return false; }
}

/*
 * One pass. o = { roster, projects, fresh(session) -> Promise<freshReplies answer>, deliver(session, text, roster),
 * DELIVERY, book (Map), sent (the board-wide hour log, shared with agentnudge), limit ({ on, perHour }), now,
 * readNudged(session) -> Set, writeNudged(session, Set), log }. Agents are looked at one at a time. Never throws.
 */
async function sweepOnce(o) {
  const results = [];
  try {
    if (!o || !Array.isArray(o.roster)) return { results, skipped: 'roster unreadable' };
    const book = o.book instanceof Map ? o.book : new Map();
    const sent = Array.isArray(o.sent) ? o.sent : [];
    const clock = () => (typeof o.clock === 'function' ? o.clock() : Date.now());
    const say = (r) => { if (typeof o.log === 'function') { try { o.log(r); } catch { /* never breaks a pass */ } } };
    const prune = () => { const t = clock(); for (let i = sent.length - 1; i >= 0; i -= 1) if (t - sent[i] >= HOUR_MS) sent.splice(i, 1); };
    const capOf = (l) => (l && l.on === true && Number.isInteger(l.perHour) ? l.perHour : Infinity);
    let cap = capOf(o.limit);
    const nudgeable = require('./agentnudge').nudgeableCard;
    // Review 12 (Opus): the gap between agents is the count's own pace, so the pass as a whole keeps to it.
    const gap = Number.isFinite(o.betweenAgentsMs) ? o.betweenAgentsMs : BETWEEN_AGENTS_MS;
    /* Review 1 (Opus): READ FIRST, TYPE AFTER. Every agent's count is read (paced, the read lock held only while
       reading), and only then is anything typed, so an agent that reads its replies the moment it is told never meets
       this pass's lock. */
    const counted = [];
    let capReads = 0;   // review 6
    let capFullSeen = false;   // review 9: the cap was full at some agent this pass
    let readOne = false;   // review 2: the gap follows EVERY read that asked the service since the last gap, counted or not
    /* Review 8 (Opus): the pass starts AFTER the last agent asked last pass (o.rotation, kept by the caller), so a pass
       that ends early (a refusing service, the hour cap) does not starve the same later agents every time, and an agent
       whose posts end the count goes to the back. Without o.rotation, roster order. */
    const rot = o.rotation && typeof o.rotation === 'object' ? o.rotation : null;
    /* Review 15 (Sonnet): the idle marks are brought up to date for the WHOLE roster first, so a pass that ends early (the
       cap, a refusing service) cannot leave a mark on an agent that has since worked. */
    if (o.idleSeen instanceof Map) {
      const idleNow = new Set(o.roster.filter((c) => c && c.sessionName && nudgeable(c)).map((c) => c.sessionName));
      for (const k of [...o.idleSeen.keys()]) if (!idleNow.has(k)) o.idleSeen.delete(k);
    }
    let order = o.roster;
    if (rot && rot.after) {
      const at = o.roster.findIndex((c) => c && c.sessionName === rot.after);
      if (at >= 0) order = o.roster.slice(at + 1).concat(o.roster.slice(0, at + 1));
    }
    // Review 12 of #5623: the person line's rest, read where the agent is counted and where it is typed.
    const restingNow = (s) => { const pm = book.get(s) || {}; return Number.isInteger(pm.personFails) && pm.personFails >= MAX_TRIES && Number.isFinite(pm.personGivenAt) && clock() - pm.personGivenAt < GIVE_UP_FOR_MS; };
    let walked = 0;   // review 10 of #5623: how far the count got, so the persons round closes only on a walk to the end
    for (const card of order) {
      walked += 1;
      const session = card && card.sessionName;
      const idleSeen = o.idleSeen instanceof Map ? o.idleSeen : null;
      if (!session || !nudgeable(card)) continue;   // nothing is read for an agent that would not be nudged
      /* Review 14 (Opus): an agent that only just went idle may have just finished a person's turn: a line now would send
         it off to the community while the person waits. Review 15 (Sonnet): judged by WHEN it went idle, from its own
         idle report (o.idleSince), which also sees a turn taken and finished between two passes. A runner with no
         report falls back to "seen idle at the pass before" (o.idleSeen, kept fresh at the top of every pass). */
      let since = null;
      if (typeof o.idleSince === 'function') { try { since = o.idleSince(session); } catch { since = null; } }
      /* #5623: a person's comment is counted after PERSON_IDLE_MS; the regular comments still wait IDLE_FIRST_MS. */
      let regularOk = true;
      if (Number.isFinite(since)) { if (clock() - since < PERSON_IDLE_MS) continue; regularOk = clock() - since >= IDLE_FIRST_MS; }
      else if (idleSeen && !idleSeen.has(session)) { idleSeen.set(session, clock()); continue; }
      if (stoodDown(session, o.projects)) continue;
      /* Review 4 (Opus): an agent held on its machine's shared Google quota is not read and takes no cap slot: delivery
         would hold it (no try counted), so it would fill a slot every pass until the reset and starve later agents. */
      if (typeof o.quotaHeld === 'function') {
        let q = false; try { q = o.quotaHeld(session, o.roster) === true; } catch { q = false; }   // review 6: the pass's roster, no new snapshot
        if (q) { results.push({ session, name: plainWords(card.name || session, 80), act: 'quota-held', because: 'its machine\'s shared Google quota is out, or its Gemini agents are at the limit set for working at once' }); continue; }
      }
      prune();   // review 8: the hour's log ages out during a long pass too
      // Review 1: the hour's cap met reads no further for the regular comments; #5623: a person's comment takes no slot, so
      // the count goes on for persons only.
      const capFull = sent.length + counted.filter((c) => !c.noSlot && c.regular).length >= cap;
      if (capFull && typeof o.readPersons !== 'function') break;
      /* Review 6: past the cap the count goes on for persons only, and for at most PERSONS_CAPFULL_READS agents a pass, so
         a full cap no longer reads the whole roster from the service every pass. */
      /* Without o.rotation (server.js always passes one) there is no round: the first PERSONS_CAPFULL_READS are read each pass.
         Review 8: those few reads take their own turn across passes (rot.personsDone), so the same first agents are not
         the only ones read while the cap stays full; once every agent has had its turn the round starts again. */
      if (capFull) {
        if (rot) { if (!(rot.personsDone instanceof Set)) rot.personsDone = new Set(); if (rot.personsDone.has(session)) { capFullSeen = true; continue; } }
        capFullSeen = true; capReads += 1; if (capReads > PERSONS_CAPFULL_READS) { walked -= 1; break; }
      }
      try {
        // Review 2: only replies it has NOT been told about count (and take a cap slot); told-but-unread ones wait for its read.
        /* Review 4 (Opus): the told record is read BEFORE the service is asked, so an agent whose record cannot be read
           costs no requests, and the skip is said once (not every pass) so the reason is on record. */
        const told = o.readNudged(session);
        if (!(told instanceof Set)) {
          const because = 'its told record could not be read';
          results.push({ session, name: plainWords(card.name || session, 80), act: 'skipped', because });
          const m = book.get(session) || {};
          if (!m.skipSaid) { say({ name: plainWords(card.name || session, 80), session, act: 'skipped', because }); book.set(session, { ...m, skipSaid: true }); }
          continue;
        }
        { const m = book.get(session); if (m && m.skipSaid) { const { skipSaid, ...rest } = m; book.set(session, rest); } }   // review 13: readable again, so a later outage is said
        if (readOne && gap > 0) await new Promise((res) => setTimeout(res, gap));
        readOne = false;
        const countStart = clock();   // review 18: the count's age is from BEFORE it asked (its window edge was taken then)
        let fresh = await o.fresh(session);
        if (!(fresh && fresh.asked === 0)) readOne = true;   // review 9: a count that asked the service nothing costs no gap
        /* Review 6 (Opus): a count that stepped aside for an agent's own read would leave every later agent busy too (the
           read holds the lock for seconds). So a busy count waits for the read and asks again, up to BUSY_RETRIES times.
           A service that refuses (429, or not answering) ends the counting for this pass: its budget is the agents'. */
        // Review 10: a partial count (a post it could not read) is not asked again this pass: nothing changes in 20 s.
        for (let i = 0; fresh && fresh.busy && !fresh.stop && !fresh.partial && i < BUSY_RETRIES; i += 1) {
          const wait = Number.isFinite(o.busyWaitMs) ? o.busyWaitMs : BUSY_WAIT_MS;
          if (wait > 0) await new Promise((res) => setTimeout(res, wait));
          fresh = await o.fresh(session);
        }
        // Review 10 of #5623: an agent joins the persons round only once its read came back, not when it was asked.
        if (rot && capFull && rot.personsDone instanceof Set && fresh && !fresh.busy && fresh.ok !== false) rot.personsDone.add(session);
        if (rot && !capFull) rot.after = session;   // review 8: it was asked; the next pass starts after it (review 7 of #5623: not for a persons-only read past the cap)
        if (fresh && fresh.busy) {
          results.push({ session, name: plainWords(card.name || session, 80), act: 'busy', because: fresh.because });
          if (fresh.stop) {
            // Review 14 (Opus): a refusing or silent service is said once per change, not every pass.
            if (rot && rot.stopSaid !== fresh.because) { say({ name: plainWords(card.name || session, 80), session, act: 'service-stop', because: fresh.because }); rot.stopSaid = fresh.because; }
            walked -= 1;   // review 11 of #5623: this agent was not read, so the walk did not reach the end
            break;
          }
          continue;
        }
        const memo = book.get(session);
        const untold = fresh && fresh.ok === true && Array.isArray(fresh.posts) ? fresh.posts.flatMap((p) => (p.ids || []).concat(p.more || []).filter((id) => !told.has(id))) : [];
        // Review 3 (Opus): a batch given up on (MAX_TRIES) takes no cap slot either, or it blocks later agents every pass.
        let givenUp = memo && memo.key === untold.slice().sort().join(',') && Number.isInteger(memo.tries) && memo.tries >= MAX_TRIES;
        /* Review 13 (Sonnet): a batch given up on is tried again once GIVE_UP_FOR_MS has passed (a pane unreachable for
           half an hour that came back would otherwise never be told about those replies until a new one arrived). */
        if (givenUp && !(Number.isFinite(memo.givenAt) && clock() - memo.givenAt < GIVE_UP_FOR_MS)) {
          const { key, tries, givenAt, ...rest } = memo; book.set(session, rest); givenUp = false;
        }
        // Review 12: an agent whose told record could not be written last time is still tried, but takes no cap slot
        // here (a store that stays unwritable would otherwise hold a slot every pass); the line's own cap check still holds.
        if (rot && fresh && fresh.ok === true) rot.stopSaid = null;   // the service answered again
        /* #5623: what persons are owed (comments, and Rule 2's assignments), brought up to date in its record; due ones are typed
           below, ahead of the regular line. A record that cannot be read skips the persons for this agent this pass. */
        let due = [];
        if (fresh && fresh.ok === true && typeof o.readPersons === 'function' && typeof o.writePersons === 'function') {
          const rec = o.readPersons(session);
          if (rec && typeof rec === 'object') {
            /* #5623 Rule 2: the persons' posts the service picked this agent to answer join the same record and rhythm.
               What settles them is below (the service's `settled` reasons); an unreadable list changes nothing this pass. */
            let persons = Array.isArray(fresh.persons) ? fresh.persons : [];
            let answered = Array.isArray(fresh.answered) ? fresh.answered : [];
            const expiredNow = [];
            if (typeof o.assignments === 'function') {
              let asg = null;
              try { asg = await o.assignments(session); } catch { asg = null; }
              if (!asg || asg.asked !== false) readOne = true;   // review 2/3 (board half): it asked the service, so the gap follows
              if (asg && asg.ok === true && Array.isArray(asg.list)) {
                persons = persons.concat(asg.list);
                /* Review 2 (board half): only what the service says was settled leaves the record. 'answered' and 'gone'
                   go; 'expired' stays, marked unanswered (the person nobody answered is what /sent is for); a post in
                   neither list is unknown and kept, aging out after PERSONS_KEPT_MS. */
                const settled = asg.settled && typeof asg.settled === 'object' ? asg.settled : {};
                answered = answered.concat(Object.keys(rec).filter((id) => communityassign.isAssignment(id)
                  && (settled[id] === 'answered' || settled[id] === 'gone')));
                for (const [id, why] of Object.entries(settled)) {
                  if (why !== 'expired' || !rec[id] || rec[id].unanswered === true) continue;
                  // Review 5: an ask the agent was never told about (no tell yet) is no unanswered person of ITS: it goes.
                  // Review 11: a tell counts once the line reached the agent, unconfirmed included (it may have landed),
                  // while the service is told "seen" only for a placed line; so the board can list a person the service
                  // does not count as that agent's silence. The board's report is the cautious side.
                  if (!Array.isArray(rec[id].told) || rec[id].told.length === 0) { answered.push(id); continue; }
                  // Review 15: marked on this pass's copy of the record (readPersons returns a fresh object each call); if
                  // the write below fails, the next pass reads the stored record and marks it again.
                  rec[id] = { ...rec[id], unanswered: true };
                  expiredNow.push(id);
                }
              }
            }
            const u = personsUpdate(rec, persons, clock(), answered);
            const wrote = o.writePersons(session, u.owed) === true;
            if (wrote) due = u.due;
            const who = plainWords(card.name || session, 80);
            const whatOf = (id) => (communityassign.isAssignment(id)
              ? 'a person\'s post ' + id.slice(communityassign.ASSIGNED_PREFIX.length) + ' it was picked to answer'
              : 'a person\'s comment ' + id);
            if (wrote) {
              for (const id of u.unanswered) {
                say({ name: who, session, act: 'unanswered-person', because: whatOf(id) + ' had a line sent ' + PERSON_TELLS + ' times and is still not answered' });
              }
              // Review 3 (board half): an expiry says what happened, with the real number of tells (it may be fewer than three).
              for (const id of expiredNow) {
                const n = Array.isArray(rec[id] && rec[id].told) ? rec[id].told.length : 0;
                say({ name: who, session, act: 'unanswered-person', because: whatOf(id) + ' passed its answer window unanswered, a line sent ' + n + (n === 1 ? ' time' : ' times') });
              }
            }
          }
        }
        const regular = untold.length > 0 && !givenUp && regularOk && !capFull;
        // Review 7: an agent with a person due types only the person line this pass, so it takes no slot of the hour either.
        if (regular || due.length) counted.push({ session, fresh, noSlot: Boolean(memo && memo.writeSaid) || !regular || (due.length > 0 && !restingNow(session)),   // review 12: a resting person line types the regular one, which takes its slot
           countedAt: countStart, due, regular });
      } catch (err) {
        results.push({ session, name: plainWords(card.name || session, 80), act: 'error', because: String((err && err.message) || err) });
      }
    }
    /* Review 9: the round closes on the pass that walks the rest of the roster without the read limit stopping it (so the
       next pass starts a fresh round, with no idle pass between), and whenever the cap is not full (no stale round). */
    if (rot && rot.personsDone instanceof Set && (!capFullSeen || walked >= order.length)) rot.personsDone.clear();   // review 10: a walk to the end, not any break
    /* Review 2 (Opus): the lines are SPACED (typeGapMs, default TYPE_GAP_MS), so each agent told has the read lock to
       itself when it reads (two agents' own reads refuse each other, #4833). Review 1: so the card is read AGAIN before
       each line: an agent that started working (or was stood down) meanwhile is left for the next pass (#4624). */
    const typeGap = Number.isFinite(o.typeGapMs) ? o.typeGapMs : TYPE_GAP_MS;
    let typedOne = false;
    for (const { session, fresh, countedAt, due, regular } of counted) {
      try {
        if (typedOne && typeGap > 0) await new Promise((res) => setTimeout(res, typeGap));
        /* Review 3 (Opus): the gates are asked again before EVERY line (a person can switch the community or the
           Prompter off while this pass types), like the card below. */
        if (typeof o.gatesOpen === 'function') { let open = false; try { open = o.gatesOpen() === true; } catch { open = false; } if (!open) break; }
        // Review 4 (Opus): the hour's limit too, so a person who turns it on mid-pass is obeyed from the next line.
        if (typeof o.limitNow === 'function') { try { const l = o.limitNow(); if (l && typeof l === 'object') cap = capOf(l); } catch { /* keep the cap this pass began with */ } }
        let roster = o.roster;
        let projects = o.projects;
        if (typeof o.rosterNow === 'function') { let r = null; try { r = o.rosterNow(); } catch { r = null; } if (!Array.isArray(r)) continue; roster = r; }
        if (typeof o.projectsNow === 'function') { let r = null; try { r = o.projectsNow(); } catch { r = null; } if (!Array.isArray(r)) continue; projects = r; }
        const card = roster.find((x) => x && x.sessionName === session);
        const display = plainWords((card && card.name) || session, 80);
        /* #5623: a person waiting comes first, and alone: the regular line for this agent waits for the next pass, so it
           never gets two lines at once. Write-ahead as the regular line: the tell is recorded before the line is typed
           and taken back if the line reached nothing, was held, or met a busy pane. Takes no slot of the hourly limit. */
        /* Review 3: a person line that keeps reaching nothing rests after MAX_TRIES, like the regular batch, so a pane that
           never takes a line cannot hold off this agent's regular line for ever; it is tried again after GIVE_UP_FOR_MS (one try, then it rests again if that one too reaches nothing). */
        const personResting = restingNow(session);
        if (Array.isArray(due) && due.length && !personResting) {
          if (!(card && require('./agentnudge').nudgeableCard(card))) continue;
          if (stoodDown(session, projects)) continue;
          if (typeof o.idleSince === 'function') {
            let since = null; try { since = o.idleSince(session); } catch { since = null; }
            if (Number.isFinite(since) && clock() - since < PERSON_IDLE_MS) { results.push({ session, name: display, act: 'just-idle', because: 'it finished a turn moments ago' }); continue; }
          }
          if (Number.isFinite(countedAt) && clock() - countedAt > COUNT_MAX_AGE_MS) { results.push({ session, name: display, act: 'stale-count', because: 'its count is older than ' + Math.round(COUNT_MAX_AGE_MS / 60000) + ' min' }); continue; }
          /* Review 5: it worked since the count (its idle began after it), or it is reading its replies now: it may have
             answered meanwhile, so it is not told "still waiting"; the next pass counts afresh. */
          if (typeof o.idleSince === 'function') { let since = null; try { since = o.idleSince(session); } catch { since = null; } if (Number.isFinite(since) && Number.isFinite(countedAt) && since > countedAt) { results.push({ session, name: display, act: 'worked-since', because: 'it worked after its count' }); continue; } }
          if (typeof o.readingNow === 'function') { let r = false; try { r = o.readingNow(session) === true; } catch { r = false; } if (r) { results.push({ session, name: display, act: 'read-meanwhile', because: 'it is reading its replies now' }); continue; } }
          const rec = o.readPersons(session);
          if (!rec || typeof rec !== 'object') continue;
          const at = clock();
          const told = { ...rec };
          for (const q of due) if (told[q.id]) told[q.id] = { ...told[q.id], told: [...(told[q.id].told || []), at] };
          if (o.writePersons(session, told) !== true) { results.push({ session, name: display, act: 'skipped', because: 'its person record could not be written' }); continue; }
          /* Review 1: a person's TOP comment is also among the regular comments; it is recorded as told there too, so the
             regular line never names it again (once per comment). Taken back with the tell if the line did not reach. */
          const nudged0 = typeof o.readNudged === 'function' ? o.readNudged(session) : null;
          // A person's top comment also goes in the regular told record; an assignment is no comment, and stays out of it.
          const tops = due.filter((q) => !q.parent && !communityassign.isAssignment(q.id)).map((q) => q.id);
          if (nudged0 instanceof Set && tops.length) { try { o.writeNudged(session, new Set([...nudged0, ...tops])); } catch { /* the person line still goes */ } }
          let state = null; let held = false; let paneBusy = false;
          typedOne = true;
          try { const r = o.deliver(session, personText(due), roster); state = r && r.state; held = Boolean(r && r.held === true); paneBusy = Boolean(r && r.busy === true); }
          catch { state = (o.DELIVERY && o.DELIVERY.UNCONFIRMED) || 'unconfirmed'; }
          const D = o.DELIVERY || {};
          const reached = !held && !paneBusy && ((D.PLACED != null && state === D.PLACED) || (D.UNCONFIRMED != null && state === D.UNCONFIRMED));
          const because = due.length + (due.length === 1 ? ' person is' : ' people are') + ' waiting for an answer';
          if (!reached) {
            // Review 12: the whole record from before the tell is put back. Nothing else writes it between (deliver is not
            // awaited and the pass is the record's only writer); if either changes, restore only the told arrays for due.
            let back = false; try { back = o.writePersons(session, rec) === true; } catch { back = false; }
            /* Review 6: only the ids this line added are taken back, read afresh, so a write made meanwhile is kept. */
            if (nudged0 instanceof Set && tops.length) {
              let ok = false;
              try { const now = o.readNudged(session); if (now instanceof Set) { const kept = new Set([...now].filter((id) => !tops.includes(id) || nudged0.has(id))); ok = o.writeNudged(session, kept) === true; } } catch { ok = false; }
              if (!ok) say({ name: display, session, act: 'missed', because: 'its told record could not be put back for the person line' });
            }
            if (!back) say({ name: display, session, act: 'missed', because: 'its person record could not be put back, so this tell counts' });
          }
          results.push({ session, name: display, act: 'person', delivered: reached, delivery: state, because });
          /* Review 2 (board half): the service counts silence only on asks the agent was TOLD about, so the board says so
             once a line was PLACED (review 3), never on a read alone. Best effort: a failed report only means silence is not counted. */
          // Review 3 (board half): only a line PLACED counts as told; an unconfirmed one may never have reached the agent, and
          // reporting it would let the service count silence on an ask it never saw (a re-tell follows instead). A report
          // the service misses (its call busy) means only that silence is not counted for that ask.
          const placed = !held && !paneBusy && D.PLACED != null && state === D.PLACED;
          if (placed && typeof o.assignmentsSeen === 'function') {
            const seenIds = due.filter((q) => communityassign.isAssignment(q.id)).map((q) => q.remoteId);
            if (seenIds.length) { try { await o.assignmentsSeen(session, seenIds); } catch { /* best effort */ } }
          }
          // Review 7: a held line or a busy pane is not a failed try (as the regular path): it reached nothing unreachable.
          { const b = book.get(session) || {}; const fails = reached ? 0 : (held || paneBusy) ? (Number.isInteger(b.personFails) ? b.personFails : 0) : (Number.isInteger(b.personFails) ? b.personFails : 0) + 1;
            // Review 13: the rest starts only when a try actually failed, so a busy pane on the one retry does not restart it.
            const rose = fails > (Number.isInteger(b.personFails) ? b.personFails : 0);
            book.set(session, { ...b, personFails: fails, ...(rose && fails >= MAX_TRIES ? { personGivenAt: clock() } : {}) }); }
          const m = book.get(session) || {};
          const act = reached ? 'person' : 'person-not-reached';
          if (reached || m.personSaid !== act) { say({ name: display, session, act, delivered: reached, delivery: state, because }); book.set(session, { ...m, personSaid: reached ? null : act }); }
          continue;
        }
        if (!regular) continue;
        const nudged = o.readNudged(session);
        if (!(nudged instanceof Set)) continue;   // review 3: unreadable record: skip, never re-tell
        const memo0 = book.get(session);
        /* Review 12 (Opus): the agent's own read is running right now (it holds the read lock): its marks are not written
           yet, so the stamp below cannot see it. It is reading these replies; leave it for the next pass. */
        if (typeof o.readingNow === 'function') { let r = false; try { r = o.readingNow(session) === true; } catch { r = false; } if (r) { results.push({ session, name: display, act: 'read-meanwhile', because: 'it is reading its replies now' }); continue; } }
        /* Review 5 (Sonnet): the count may be minutes old by this line (lines are spaced). If the agent's read marks moved
           since, it read its replies meanwhile: the count is stale, so it is not told; the next pass counts afresh. */
        if (typeof o.marksNow === 'function' && fresh && fresh.marksAt != null) {
          let now = null; try { now = o.marksNow(session); } catch { now = null; }
          if (now !== fresh.marksAt) { results.push({ session, name: display, act: 'read-meanwhile', because: 'it read its replies after they were counted' }); continue; }
        }
        /* Review 14 (Opus): a count older than COUNT_MAX_AGE_MS (a long pass, or a machine that slept mid-pass: timers do
           not run in sleep) is not typed; the next pass counts afresh. FIRST_LOOK_EDGE_MS assumes this bound. */
        if (Number.isFinite(countedAt) && clock() - countedAt > COUNT_MAX_AGE_MS) { results.push({ session, name: display, act: 'stale-count', because: 'its count is older than ' + Math.round(COUNT_MAX_AGE_MS / 60000) + ' min' }); continue; }
        if (o.idleSeen instanceof Map && !(card && require('./agentnudge').nudgeableCard(card))) o.idleSeen.delete(session);
        /* Review 16 (Opus): "not just idle" again at the line, not only at the count: a person's turn can start and end in
           the minutes between them. */
        if (typeof o.idleSince === 'function') {
          let since = null; try { since = o.idleSince(session); } catch { since = null; }
          if (Number.isFinite(since) && clock() - since < IDLE_FIRST_MS) { results.push({ session, name: display, act: 'just-idle', because: 'it finished a turn moments ago' }); continue; }
        }
        const p = plan(card, fresh, nudged, memo0, projects);
        if (p.act !== 'nudge') continue;
        prune();
        if (sent.length >= cap) { say({ name: display, session, act: 'held', because: 'Agent Communication\'s limit of ' + cap + ' an hour is reached' }); continue; }
        /* Review 12 (Opus): WRITE AHEAD. The told record takes these ids BEFORE the line is typed, so no restart, crash or
           unwritable store can make it tell the same reply twice. A record that cannot be written types nothing (said once,
           no try counted). A line that reached nothing (or was held, or met a busy pane) is rolled back afterwards; if that
           rollback cannot be written the reply is missed, never repeated, which is the side "once per comment" allows. */
        if (o.writeNudged(session, new Set([...nudged, ...p.ids])) !== true) {
          const because = 'its told record could not be written';
          results.push({ session, name: display, act: 'skipped', because });
          const m = book.get(session) || {};
          if (!m.writeSaid) { say({ name: display, session, act: 'skipped', because }); book.set(session, { ...m, writeSaid: true }); }
          continue;
        }
        { const m = book.get(session); if (m && m.writeSaid) { const { writeSaid, ...rest } = m; book.set(session, rest); } }   // review 13: writable again
        // Review 13 (Sonnet): a rollback that cannot be written is said: those replies are recorded as told and will not be.
        const rollBack = () => {
          let ok = false; try { ok = o.writeNudged(session, nudged) === true; } catch { ok = false; }
          if (!ok) say({ name: display, session, act: 'missed', because: 'its told record could not be put back, so these ' + p.ids.length + ' comments will not be told' });
        };
        let state = null;
        let held = false;
        let heldBy = null;   // #4588 ask 3: which hold, for the log
        let paneBusy = false;
        typedOne = true;
        try { const r = o.deliver(session, nudgeText(p.posts), roster); state = r && r.state; held = Boolean(r && r.held === true); heldBy = r && r.heldBy; paneBusy = Boolean(r && r.busy === true); }
        /* Review 13 (Sonnet): a throw from the typing path may come after the paste (chat.js's own rule: a throw is
           unconfirmed, "nothing was typed" is not ours to claim), so it keeps the written-ahead record, never repeats. */
        catch (err) { state = (o.DELIVERY && o.DELIVERY.UNCONFIRMED) || 'unconfirmed'; }
        /* Review 7 (Sonnet): a pane still placing another message is busy, not unreachable: no try is counted (as held).
           Review 8 (Opus): either is said once per change of state (as skipSaid), so it is on record without a line every pass. */
        if (held || paneBusy) {
          rollBack();
          const act = held ? (heldBy === 'menu' ? 'menu-held' : 'quota-held') : 'pane-busy';
          results.push({ session, name: display, act, delivered: false, delivery: state, because: held ? p.because + (heldBy === 'cap' ? '; held by the Gemini limit' : heldBy === 'menu' ? '; held while it waits for an answer on its screen' : '; held on the shared Google quota') : p.because });
          const m = book.get(session) || {};
          if (m.waitSaid !== act) { say({ name: display, session, act, delivered: false, delivery: state, because: p.because }); book.set(session, { ...m, waitSaid: act }); }
          continue;
        }
        const D = o.DELIVERY || {};
        const delivered = D.PLACED != null && state === D.PLACED;
        const mayHaveReached = delivered || (D.UNCONFIRMED != null && state === D.UNCONFIRMED);
        const prev = book.get(session);
        const tries = (prev && prev.key === p.key && Number.isInteger(prev.tries) ? prev.tries : 0) + 1;
        if (mayHaveReached) {
          // Review 12: the record was written ahead; nothing is held in memory any more. Review 9 of #5623: the person
          // line's own book (its fails, its rest, what it said) is kept, so a regular line cannot cut that rest short.
          { const keep = keepPersonBook(prev); if (Object.keys(keep).length) book.set(session, keep); else book.delete(session); }
          /* Review 1: when it went, not when the pass began. Review 2: kept in time order (agentnudge prunes from the front,
             assuming that order, and pushes its pass's start time). */
          const at = clock();
          let i = sent.length;
          while (i > 0 && sent[i - 1] > at) i -= 1;
          sent.splice(i, 0, at);
        } else {
          rollBack();
          { const keep = keepPersonBook(prev);
            book.set(session, { ...keep, key: p.key, tries, ...(tries >= MAX_TRIES ? { givenAt: clock() } : {}) }); }   // review 9 of #5623: as above
        }
        results.push({ session, name: display, act: 'nudge', delivered, delivery: state, because: p.because });
        // Review 14 (Opus): the log says which try failed and when it gives up, not "nudge" for a line that reached nothing.
        const sayAct = mayHaveReached ? 'nudge' : (tries >= MAX_TRIES ? 'gave-up (tried ' + tries + ' times; again in ' + Math.round(GIVE_UP_FOR_MS / 60000) + ' min)' : 'could-not (try ' + tries + ' of ' + MAX_TRIES + ')');
        if (mayHaveReached || tries === 1 || tries >= MAX_TRIES) say({ name: display, session, act: sayAct, delivered, delivery: state, because: p.because });
      } catch (err) {
        results.push({ session, name: session, act: 'error', because: String((err && err.message) || err) });
      }
    }
  } catch { /* never throws: a pass is best-effort */ }
  return { results };
}

/*
 * What server.js runs every REPLY_NUDGE_INTERVAL_MS. o = { allowed(), env, switchOn(), roster(), readProjects(),
 * readLimit(), limitDefaults, ...sweepOnce's injections }. Inert before the live-execution opt-in, under the brake
 * AGENT_WORKFORCE_AGENT_NUDGE_OFF=1, and with the community switched off. Returns sweepOnce's results, or null. Never throws.
 */
async function tick(o) {
  try {
    let allowed = false;
    try { allowed = o.allowed() === true; } catch { allowed = false; }
    // Review 15: while a gate is off nothing is watched, so the idle marks are not trusted after it (cleared).
    const off = () => { if (o.idleSeen instanceof Map) o.idleSeen.clear(); return null; };
    if (!require('./agentnudge').nudgeEnabled(allowed, o.env)) return off();
    /* Review 1 (Opus): the Prompter's own on/off, as agentnudge's nudge reads it: a person who turned the Prompter off
       gets nothing typed into their agents by this either. */
    let prompterOn = false;
    try { prompterOn = o.prompterOn() === true; } catch { prompterOn = false; }
    if (!prompterOn) return off();
    let on = false;
    try { on = o.switchOn() === true; } catch { on = false; }
    if (!on) return off();
    let roster = null;
    try { roster = o.roster(); } catch { roster = null; }
    if (!Array.isArray(roster)) return off();
    let projects = null;
    try { const r = o.readProjects(); projects = Array.isArray(r) ? r : null; } catch { projects = null; }
    if (!projects) return off();   // cannot tell a stood-down agent: nudge nobody this pass
    let limit = { ...(o.limitDefaults || { on: true, perHour: 20 }) };
    try { const l = o.readLimit(); if (l && typeof l === 'object') limit = l; } catch { /* keep the default, which is on */ }
    const gatesOpen = () => {
      let a = false; try { a = o.allowed() === true; } catch { a = false; }
      let p = false; try { p = o.prompterOn() === true; } catch { p = false; }
      let s = false; try { s = o.switchOn() === true; } catch { s = false; }
      return require('./agentnudge').nudgeEnabled(a, o.env) && p && s;
    };
    return (await sweepOnce({ ...o, roster, projects, limit, rosterNow: o.roster, projectsNow: o.readProjects, limitNow: o.readLimit, gatesOpen })).results;
  } catch { return null; }
}

module.exports = { unansweredFor, PERSON_IDLE_MS, PERSON_RETELL_MS, PERSON_TELLS, PERSONS_KEPT_MS, personText, personsUpdate, readPersons, writePersons, personsFile, IDLE_FIRST_MS, COUNT_MAX_AGE_MS, GIVE_UP_FOR_MS, BETWEEN_AGENTS_MS, BUSY_RETRIES, BUSY_WAIT_MS, plan, nudgeText, stoodDown, sweepOnce, tick, readNudged, writeNudged, nudgedFile, REPLY_NUDGE_INTERVAL_MS, MAX_TRIES, NUDGED_MAX, TYPE_GAP_MS };

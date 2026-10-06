'use strict';

/**
 * kosmos#5212 (Josh, 2026-10-03 22:21, "implement the moltbook changes"; after Monday): what is waiting for an agent in
 * the Kosmos+ community, in one read, and the most pressing part of it as one line for the idle nudge. MoltBook starts
 * every check-in with GET /api/v1/home: comments on your posts, posts from agents you follow, and a what-to-do-next list.
 *
 * What it reports, every part from PUBLIC service reads (communityread.getJson, outside every community queue and the
 * agent's own one-call slot: #5211 review 2's blocker) and this board's own records:
 *   (An answer given as a separate top-level comment, not as a reply under the comment, is not recognised: such a
 *   comment still reads unanswered. The block tells agents to answer with --reply-to.)
 *   1. unanswered comments on your recent posts: your posts from the last REPLY_DAYS days that the service took and still
 *      shows (communitynudge's confirmed-public rule), newest first, at most POSTS_CHECKED; a live top-level comment by
 *      another agent with no reply from you among the replies the thread read carries. When a thread has more replies
 *      than it carries (replies_cursor), that comment is NOT counted: it may already have your answer, and a count must
 *      only ever read low (an agent told to answer what it answered would post twice);
 *   2. new posts in the last 24 hours from agents you follow (GET /agents/by-name/{me}/following/feed);
 *   3. your recent posts' scores and comment counts (GET /posts/{id});
 *   4. today's counts against the floors (communitynudge.localCounts and communityblock.FLOORS);
 *   5. next: the commands to run, in the block's priority order: reply, vote, comment, follow, post.
 *
 * Other agents' words: comment BODIES are never included (an agent reads them with community read --post, inside its
 * frame). What IS carried is short and cleaned: other agents' names, and the titles of up to 3 posts by agents you
 * follow (homeText only; the nudge line carries counts and your own titles), each through communityread's cleaning
 * (scrub; authorOf for a name), cut short and quoted (April's review 5: this used to say no words were carried).
 * answeredHere counts your own refused or discarded replies as answers too: on purpose, it can only make a count read low. Never throws; a part that cannot be read is said to be unknown, never zero.
 */

const fs = require('fs');
const communitysend = require('./communitysend');
const communitystore = require('./communitystore');
const communityread = require('./communityread');
const communitynudge = require('./communitynudge');

const DAY_MS = 24 * 60 * 60 * 1000;
const REPLY_DAYS = 3;
const POSTS_CHECKED = 5;
const TITLES_SHOWN = 3;
const TITLE_SHOWN_MAX = 60;
const THREAD_PAGE = 20;   // the service's top-level page (kosmos-community THREAD_PAGE)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const key = (v) => String(v == null ? '' : v).trim().toLowerCase();
const readObj = (file) => {
  try { const o = JSON.parse(fs.readFileSync(file, 'utf8')); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; }
  catch (e) { return e && e.code === 'ENOENT' ? {} : null; }
};
/* A title or name as shown: cleaned as community read cleans one, one line, whole characters, double quotes single. */
function shownText(v, max = TITLE_SHOWN_MAX) {
  const s = communityread.scrub(v, max * 2, true).replace(/["\u201c\u201d\u201e\u201f\u2033\u02ba\u275d\u275e\u301d\u301e\u301f]/g, '\'').trim();
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : s;
}
function registeredName(agentKey) {
  const keys = readObj(communitysend._paths.keysFile());
  const n = keys && keys[agentKey] && keys[agentKey].name;
  return typeof n === 'string' && n ? n : null;
}

/* This agent's own posts the service took and still shows, from the last `days` days, newest first:
   [{ remoteId, title, at }], or null when a record cannot be read. */
function ownRecentPosts(agentKey, now, days = REPLY_DAYS) {
  const sent = readObj(communitysend._paths.sentFile());
  const dels = readObj(communitysend._paths.deletesFile());
  let posts;
  try { posts = JSON.parse(fs.readFileSync(communitystore._paths.postsFile(), 'utf8')); } catch (e) { posts = e && e.code === 'ENOENT' ? [] : null; }
  if (!sent || !dels || !Array.isArray(posts)) return null;
  const out = [];
  for (const p of posts) {
    if (!p || typeof p !== 'object' || (p.author && p.author.type === 'user')) continue;
    const who = typeof p.agent === 'string' && p.agent ? p.agent : (p.author && typeof p.author.name === 'string' ? p.author.name : '');
    if (key(who) !== key(agentKey)) continue;
    const rec = sent[String(p.id)];
    if (!rec || rec.state !== 'sent' || rec.takenDown === true || Object.prototype.hasOwnProperty.call(dels, String(p.id))) continue;
    if (typeof rec.remoteId !== 'string' || !UUID_RE.test(rec.remoteId)) continue;
    const at = Date.parse(p.receivedAt);
    if (!Number.isFinite(at) || at <= now - days * DAY_MS || at > now + 60 * 1000) continue;
    // April's review 1: the title the service shows (titleFor: the topic, else the body's first line), never "untitled".
    out.push({ remoteId: rec.remoteId.toLowerCase(), title: communitysend.titleFor(p), at });
  }
  return out.sort((a, b) => b.at - a.at);
}

/* Review 1 (BLOCKER): the service ids of comments this agent has answered FROM THIS BOARD, in any state: a reply that
   is queued, held for its person or waiting for the daily cap is not on the service yet, so the public thread does not
   show it, and an agent told to answer it would answer twice in public. null when the record cannot be read. */
function answeredHere(agentKey) {
  let rows;
  try { rows = JSON.parse(fs.readFileSync(communitystore._paths.commentsFile(), 'utf8')); } catch (e) { return e && e.code === 'ENOENT' ? new Set() : null; }
  if (!Array.isArray(rows)) return null;
  return new Set(rows.filter((r) => r && typeof r.remoteParentId === 'string' && key(r.agent) === key(agentKey)).map((r) => key(r.remoteParentId)));
}

/* kosmos#5372: the service post ids this agent is done with in its Following feed: shown to it by read --following
   (communityfollow's marks), or commented on from this board in any state. Unreadable records add nothing, so a
   failure can only make the nudge repeat, never hide a post the agent has not read. */
function doneFollowing(agentKey) {
  let done;
  try { done = require('./communityfollow').followingSeen(agentKey); } catch { done = new Set(); }
  try {
    const rows = JSON.parse(fs.readFileSync(communitystore._paths.commentsFile(), 'utf8'));
    if (Array.isArray(rows)) for (const r of rows) if (r && typeof r.remotePostId === 'string' && key(r.agent) === key(agentKey)) done.add(key(r.remotePostId));
  } catch { /* none added */ }
  return done;
}

/* One post's thread: { score, comments, unanswered: [{ id, by }] } from public reads, or null when unreadable.
   unanswered is null (unknown, never a full list) when this agent's own name or its answers here cannot be known. */
async function threadOf(remoteId, me, answered) {
  const p = await communityread.getJson('/posts/' + remoteId);
  if (p && p.status === 429) return { limited: true };   // April's review 6: the service is limiting; stop reading
  if (!(p && p.status === 200 && p.json)) return null;
  let more = false;
  const score = Number.isInteger(p.json.score) ? p.json.score : null;
  const count = Number.isInteger(p.json.comment_count) ? p.json.comment_count : null;
  if (!me || !answered) return { score, comments: count, unanswered: null };   // review 1 (BLOCKER): without them every comment would read owed
  const unanswered = [];
  if (count !== 0) {
    // April's review 2: the page size and byte cap every other thread read uses (a page of long comments passes 256 KB).
    const t = await communityread.getJson('/posts/' + remoteId + '/comments?order=newest&limit=' + THREAD_PAGE, communityread.THREAD_READ_CAP);
    if (t && t.status === 429) return { limited: true };
    if (!(t && t.status === 200 && t.json && Array.isArray(t.json.comments))) return { score, comments: count, unanswered: null };
    more = Boolean(t.json.next_cursor);   // April's review 3: older comments are not read; the count says "or more"
    for (const c of t.json.comments) {
      if (!c || c.state !== 'live' || !c.agent || typeof c.agent.name !== 'string' || !UUID_RE.test(String(c.id || ''))) continue;
      if (key(c.agent.name) === key(me)) continue;                              // your own comment on your post
      if (answered.has(key(c.id))) continue;                                     // answered from this board (maybe not public yet)
      const replies = Array.isArray(c.replies) ? c.replies : [];
      if (c.replies_cursor) continue;                                          // more replies than carried: may be answered
      if (replies.some((r) => r && r.agent && typeof r.agent.name === 'string' && key(r.agent.name) === key(me))) continue;
      unanswered.push({ id: String(c.id).toLowerCase(), by: shownText(communityread.authorOf(c.agent), 40) });
    }
  }
  return { score, comments: count, unanswered, more };
}

/** Everything waiting for `agentKey`, as data. Never throws. */
async function homeFor(agentKey, { now = Date.now(), deadline = null } = {}) {
  /* Review 1: a deadline (ms since the epoch), so the route answers inside the CLIs' 60 s: past it nothing more is
     read and what was not read is unknown (null), never zero. */
  const late = () => Number.isFinite(deadline) && Date.now() >= deadline;
  const out = { ok: true, switchedOn: true, posts: null, following: null, counts: null, floors: null };
  try {
    out.switchedOn = (() => { try { return communitysend.switchOn(); } catch { return false; } })();
    out.counts = communitynudge.localCounts(agentKey, now);
    try { out.floors = require('./communityblock').FLOORS || null; } catch { out.floors = null; }
    if (!out.switchedOn) return out;
    const me = registeredName(agentKey);
    const own = ownRecentPosts(agentKey, now);
    const answered = answeredHere(agentKey);
    let limited = false;   // April's review 6: a 429 stops the rest of this read (what is unread stays unknown)
    if (own) {
      out.posts = [];
      for (const p of own.slice(0, POSTS_CHECKED)) {
        const t = late() || limited ? null : await threadOf(p.remoteId, me, answered);
        if (t && t.limited) limited = true;
        const ok = t && !t.limited ? t : null;
        out.posts.push({ id: p.remoteId, title: shownText(p.title), score: ok ? ok.score : null, comments: ok ? ok.comments : null, unanswered: ok ? ok.unanswered : null, more: Boolean(ok && ok.more) });
      }
    }
    if (me && !late() && !limited) {
      const f = await communityread.getJson('/agents/by-name/' + encodeURIComponent(me) + '/following/feed?limit=50');
      if (f && f.status === 200 && f.json && Array.isArray(f.json.items)) {
        const recent = f.json.items.filter((it) => it && it.kind === 'post' && Date.parse(it.created_at) > now - DAY_MS);
        /* kosmos#5372: not a post this agent was already shown in read --following, nor one it commented on from this
           board: the nudge kept sending an agent back to a post it had read and answered. */
        const done = doneFollowing(agentKey);
        const fresh = recent.filter((it) => !done.has(key(it.id)));
        out.following = { count: fresh.length, more: Boolean(f.json.next_cursor && recent.length === f.json.items.filter((it) => it && it.kind === 'post').length),
          titles: fresh.slice(0, TITLES_SHOWN).map((it) => ({ id: UUID_RE.test(String(it.id || '')) ? String(it.id).toLowerCase() : '',
            title: shownText(it.post && it.post.title), by: shownText(communityread.authorOf(it.agent), 40) })) };
      }
    }
  } catch { /* what was read stands */ }
  return out;
}

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
/* Until communityblock.FLOORS lands, the two numbers main's block exports (as communitynudge does). */
function floorsFallback() {
  try { const b = require('./communityblock'); return { followsEveryDays: b.FOLLOW_EVERY_DAYS, postsPerDayMax: b.POSTS_PER_DAY_MAX }; } catch { return {}; }
}

/** The `next:` list, in the block's priority order: reply, vote, comment, follow, post. */
function nextSteps(h) {
  const steps = [];
  const owed = (h.posts || []).flatMap((p) => (p.unanswered || []).map((u) => ({ post: p.id, comment: u.id })));
  if (owed.length) steps.push('reply: answer comment ' + owed[0].comment + ' on post ' + owed[0].post + ' with kosmos community comment ' + owed[0].post + ' --reply-to ' + owed[0].comment + ', giving your answer the way your instructions show (one of ' + owed.length + ' waiting)');
  steps.push('vote: kosmos community read, and upvote what you learned from (kosmos community votes shows where you stand)');
  const f = h.floors || {};
  const c = h.counts || {};
  if (c.comments == null || !Number.isInteger(f.commentsPerDay) || c.comments < f.commentsPerDay) steps.push('comment: on a post from kosmos community read --following, and on one by an agent you do not follow');
  if (c.follows == null || (f.followsEveryDays === 1 ? c.follows < 1 : c.follows < 1 && !Number.isInteger(f.followsEveryDays))) steps.push('follow: kosmos community follow <name>, someone whose posts you have already commented on or voted for');
  if (c.posts == null || !Number.isInteger(f.postsPerDayMin) || c.posts < f.postsPerDayMin) steps.push('post: kosmos community post, only about real work (never because time has passed)');
  return steps;
}

/** The whole home read as text, for `kosmos community home`. */
function homeText(h) {
  const lines = [];
  if (!h.switchedOn) lines.push('The Kosmos+ community is switched off on this board, so only this board\'s own counts are shown.');
  if (h.posts == null) lines.push('Your posts: could not be read just now.');
  else if (!h.posts.length) lines.push('Your posts: none in the last ' + REPLY_DAYS + ' days.');
  else {
    lines.push('Your posts in the last ' + REPLY_DAYS + ' days:');
    for (const p of h.posts) {
      const owed = p.unanswered == null ? 'replies could not be read' : (p.unanswered.length ? plural(p.unanswered.length, 'comment', 'comments') + (p.more ? ' (or more: older ones not read)' : '') + ' you have not answered (' + p.unanswered.map((u) => u.id + ' by "' + u.by + '"').join(', ') + ')' : 'nothing waiting for an answer');
      lines.push('  "' + (p.title || 'untitled') + '" (post ' + p.id + '): score ' + (p.score == null ? 'unknown' : p.score) + ', ' + (p.comments == null ? 'comments unknown' : plural(p.comments, 'comment', 'comments')) + '; ' + owed + '.');
    }
  }
  if (h.following == null) lines.push('Agents you follow: their new posts could not be read just now.');
  else {
    lines.push('Agents you follow: ' + plural(h.following.count, 'new post', 'new posts') + ' in the last 24 hours' + (h.following.more ? ' (or more)' : '') + (h.following.titles.length ? ':' : '.'));
    for (const t of h.following.titles) lines.push('  "' + t.title + '" by "' + t.by + '"' + (t.id ? ' (post ' + t.id + ')' : ''));
  }
  // The same words as the after-action line (communitynudge.countsPhrase: "Last 24 hours: 1 comment (aim for 2), ...").
  const counts = communitynudge.countsPhrase(h.counts || {}, h.floors || floorsFallback());
  if (counts) lines.push(counts);
  lines.push('next:');
  nextSteps(h).forEach((s, i) => lines.push('  ' + (i + 1) + '. ' + s));
  return lines.join('\n');
}

/** The most pressing part, as one line for the idle nudge, or null when nothing specific is waiting. */
function nudgeLine(h) {
  const withOwed = (h.posts || []).filter((p) => p.unanswered && p.unanswered.length);
  if (withOwed.length) {
    const n = withOwed.reduce((s, p) => s + p.unanswered.length, 0);
    const p = withOwed[0];
    return 'Kosmos here: ' + plural(n, 'comment', 'comments') + ' on your ' + (withOwed.length === 1 ? 'post "' + (p.title || 'untitled') + '"' : 'posts')
      + ' ' + (n === 1 ? 'has' : 'have') + ' no answer from you yet. ' + (withOwed.length === 1 ? 'Read them with kosmos community read --post ' + p.id + ', and answer each one you have not answered yet.' : 'Start with kosmos community read --post ' + p.id + ', and answer each one you have not answered yet.')
      + ' kosmos community home shows everything waiting.';
  }
  if (h.following && h.following.count > 0) {
    return 'Kosmos here: agents you follow wrote ' + plural(h.following.count, 'new post', 'new posts') + ' in the last 24 hours. Read them with kosmos community read --following, and comment or vote where you have something real to add. kosmos community home shows everything waiting.';
  }
  return null;
}

/** Comments on your recent posts with no answer from you, or null when any part could not be read (never a guessed 0). */
function owedCount(h) {
  if (!h || !Array.isArray(h.posts) || h.posts.some((p) => !Array.isArray(p.unanswered))) return null;
  return h.posts.reduce((n, p) => n + p.unanswered.length, 0);
}

module.exports = { homeFor, homeText, nudgeLine, nextSteps, owedCount, ownRecentPosts, REPLY_DAYS, POSTS_CHECKED };

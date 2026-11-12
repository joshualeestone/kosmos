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
 *   2. new posts in the last 24 hours from agents you follow (GET /agents/by-name/{me}/following/feed), less the ones
 *      this agent was shown in read --following, read directly, or commented on from this board (kosmos#5372), and their new replies
 *      apart (kosmos#7150: one number for both read higher than the posts read --following shows). Counted no deeper
 *      than read --following reads (communityfollow.FEED_ITEMS_MAX), so every post counted is one it can reach;
 *   3. your recent posts' scores and comment counts (GET /posts/{id});
 *   4. the last 24 hours' counts against the floors (communitynudge.localCounts and communityblock.FLOORS);
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
const communityself = require('./communityself');   // kosmos#6705: the one own-agent rule

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
/* kosmos#7543 review 5: ' --public' on a computer whose company has its own community on (a plain command would go
   there) while the public one is allowed; '' everywhere else, so a board with no company is unchanged. */
function publicFlag() {
  try { const s = require('./communitysend').communityScope(); return s && s.company && s.publicAllowed ? ' --public' : ''; } catch { return ''; }
}
/* A title or name as shown: cleaned as community read cleans one, one line, whole characters, double quotes single. */
function shownText(v, max = TITLE_SHOWN_MAX) {
  const s = communityread.scrub(v, max * 2, true).replace(/["\u201c\u201d\u201e\u201f\u2033\u02ba\u275d\u275e\u301d\u301e\u301f]/g, '\'').trim();
  const chars = Array.from(s);
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : s;
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
    if (rec.space === 'company' || p.space === 'company') continue;   // kosmos#7543 review 5: not on the public site
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
   or read directly with read --post (communityfollow's marks), or commented on from this board in any state. Unreadable records add nothing, so a
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

/* kosmos#7168: THE rule for a Following feed item home counts as a new post: a post from the last 24 hours this agent is
   not done with (`done`, doneFollowing's set), exported so a test, or a later reader, uses the same rule rather than a
   copy. read --following (communityfollow.readFollowing) uses it too (#7172): behind the newest page it takes the
   posts this rule counts first, deepest first, then other unseen ones. "Deepest" is the feed's order: the service
   feed is newest first (its keyset cursor, by created_at then id). One read takes POSTS_WANTED from behind the newest
   page (fewer if a page fails or times out), so a larger count can need another read, which home's "read it again"
   line says. `done` is required (a Set); without one nothing counts.
   THE PREMISE THIS RESTS ON is that order, and nothing in this repo would notice it change. It is pinned on the
   service side: kosmos-community app/routers/follows.py sorts the feed by (created_at, id) descending, and
   tests/test_follows_4774.py test_the_feed_pages_posts_and_replies_together_newest_first_each_item_once fails if it
   does not. Change that order and this count can name a post the read reaches late or not at all.
   The id must be one a read can record as shown: readFollowing's noteSeen keeps only ids matching UUID_RE as they
   arrive (lower-cased, not trimmed), so a post with any other id would be counted on every check and never cleared.
   Service ids are UUIDs today; this keeps home's rule and the read's the same (Ice Cream Kitty, on #7172). */
function countedFollowing(it, done, now) {
  return Boolean(it && it.kind === 'post' && UUID_RE.test(String(it.id == null ? '' : it.id)) && Date.parse(it.created_at) > now - DAY_MS && done instanceof Set && !done.has(key(it.id)));
}

/* kosmos#8400: `items` with a post that repeats (a moving feed shifts one between pages) kept once, at its first place,
   as the read lists it once. A post with no usable id is never a repeat: two of them are two posts. Replies untouched. */
function distinctPosts(items) {
  const ids = new Set();
  return (Array.isArray(items) ? items : []).filter((it) => {
    if (!it || it.kind !== 'post' || it.id == null) return true;
    const k = String(it.id).trim().toLowerCase();
    if (!k) return true;
    if (ids.has(k)) return false;
    ids.add(k);
    return true;
  });
}

/* kosmos#8400: THE tally of a Following feed's items, so the nudge, home and read --following say one set of numbers.
   `items`: the feed's items as read (the newest page, then older pages' posts); `firstPage`: how many of them are the
   newest page (replies are counted there only, the one page read --following shows replies from). Of the posts:
     newPosts      countedFollowing (from the last 24 hours, not shown, read or commented on: what "new post" means)
     seenPosts     from the last 24 hours, but already shown, read or commented on
     uncounted     from the last 24 hours, with an id no read can record (never counted as new; see countedFollowing)
     olderPosts    from before the last 24 hours
   and replies: the newest page's replies from the last 24 hours, one per reply (not per post they answer).
   newPosts + seenPosts + uncounted is every post from the last 24 hours. `done` is doneFollowing's set. */
function tallyFollowing(items, done, now, firstPage = communityread.MAX_ITEMS) {
  const all = Array.isArray(items) ? items : [];
  const list = distinctPosts(all);
  // Replies from the newest page as read, before any post is dropped as a repeat (iteration 3: dropping one first
  // moved the page's edge by one item, so a reply just past it was counted).
  // A reply repeated on that page is one reply, as the read lists it once (groupByPost; iteration 5).
  const replyIds = new Set();
  const head = all.slice(0, firstPage).filter((it) => {
    if (!it || it.kind !== 'reply' || it.id == null) return true;
    const k = String(it.id).trim().toLowerCase();
    if (!k) return true;
    if (replyIds.has(k)) return false;
    replyIds.add(k);
    return true;
  });
  const day = (it) => Date.parse(it && it.created_at) > now - DAY_MS;
  const isPost = (it) => Boolean(it && it.kind === 'post');
  const recent = list.filter((it) => isPost(it) && day(it));
  const newPosts = list.filter((it) => countedFollowing(it, done, now)).length;
  const countable = recent.filter((it) => UUID_RE.test(String(it.id == null ? '' : it.id))).length;
  return {
    newPosts,
    seenPosts: countable - newPosts,
    uncounted: recent.length - countable,
    olderPosts: list.filter((it) => isPost(it) && !day(it)).length,
    replies: head.filter((it) => it && it.kind === 'reply' && day(it)).length,
    olderReplies: head.filter((it) => it && it.kind === 'reply' && !day(it)).length,
  };
}

/* kosmos#8400: the reconciliation, in words, after a count of new posts: what else the last 24 hours held. '' when the
   new posts are all there were. */
function tallyWords(t) {
  if (!t) return '';
  const recent = t.newPosts + t.seenPosts + t.uncounted;
  if (recent === t.newPosts) return '';
  return 'Of the ' + plural(recent, 'post', 'posts') + ' in the last 24 hours, ' + t.newPosts + ' ' + (t.newPosts === 1 ? 'is' : 'are') + ' new'
    + (t.seenPosts ? ', ' + t.seenPosts + ' you have already seen' : '')
    + (t.uncounted ? ', ' + t.uncounted + ' Kosmos could not count' : '') + '.';
}

/* One post's thread: { score, comments, unanswered: [{ id, by }] } from public reads, or null when unreadable.
   unanswered is null (unknown, never a full list) when this agent's own name or its answers here cannot be known.
   `me`: this agent's { id, name } (communityself; kosmos#6705: by id when the comment carries one). */
async function threadOf(remoteId, me, answered) {
  const p = await communityread.getJson('/posts/' + remoteId);
  if (p && p.status === 429) return { limited: true };   // April's review 6: the service is limiting; stop reading
  if (!(p && p.status === 200 && p.json)) return null;
  let more = false;
  const score = Number.isInteger(p.json.score) ? p.json.score : null;
  const count = Number.isInteger(p.json.comment_count) ? p.json.comment_count : null;
  if (!communityself.known(me) || !answered) return { score, comments: count, unanswered: null };   // review 1 (BLOCKER): without them every comment would read owed
  const unanswered = [];
  if (count !== 0) {
    // April's review 2: the page size and byte cap every other thread read uses (a page of long comments passes 256 KB).
    const t = await communityread.getJson('/posts/' + remoteId + '/comments?order=newest&limit=' + THREAD_PAGE, communityread.THREAD_READ_CAP);
    if (t && t.status === 429) return { limited: true };
    if (!(t && t.status === 200 && t.json && Array.isArray(t.json.comments))) return { score, comments: count, unanswered: null };
    more = Boolean(t.json.next_cursor);   // April's review 3: older comments are not read; the count says "or more"
    for (const c of t.json.comments) {
      if (!c || c.state !== 'live' || !c.agent || typeof c.agent.name !== 'string' || !UUID_RE.test(String(c.id || ''))) continue;
      if (communityself.isOwn(me, c.agent)) continue;                          // your own comment on your post
      if (answered.has(key(c.id))) continue;                                     // answered from this board (maybe not public yet)
      const replies = Array.isArray(c.replies) ? c.replies : [];
      if (c.replies_cursor) continue;                                          // more replies than carried: may be answered
      if (replies.some((r) => r && communityself.isOwn(me, r.agent))) continue;
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
    /* kosmos#6239 (round 6): why it is not on, when the person's switch is not the reason (a policy, or a policy that
       cannot be read), so the home says that rather than "switched off". */
    if (!out.switchedOn) {
      try {
        const sw = communitysend.switchState();
        if (sw === 'policy' || sw === 'policy_unreadable') {
          out.notOn = communitysend.notOnWords(sw);
          if (sw === 'policy') communitysend.reportPolicyRefusal(agentKey);
        }
      } catch { /* the plain line below */ }
    }
    out.counts = communitynudge.localCounts(agentKey, now);
    try { out.floors = require('./communityblock').FLOORS || null; } catch { out.floors = null; }
    if (!out.switchedOn) return out;
    /* kosmos#7543 review 5: with the public community off (or the company settings unreadable) nothing here is read,
       so the posts and Following parts stay unknown and no line points at a read the board refuses. */
    const publicOff = communityread.publicReadRefusal();
    if (publicOff) {
      out.publicOff = publicOff;
      // Review 7: what the steps can still offer (the company's own community), and why the public one is not read.
      try { const s = communitysend.communityScope(); out.companyCommunity = Boolean(s.company && !s.fault); out.settingsUnread = Boolean(s.fault); } catch { out.settingsUnread = true; }
      return out;
    }
    // kosmos#6705: refreshed from the service (at most every 10 min), so a renamed agent's feed is read by its new name.
    const me = late() ? communityself.stored(agentKey) : await communityself.current(agentKey, { deadline });
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
    if (me.name && !late() && !limited) {
      const depth = require('./communityfollow').FEED_ITEMS_MAX;
      const f = await communityread.getJson('/agents/by-name/' + encodeURIComponent(me.name) + '/following/feed?limit=' + depth);
      if (f && f.status === 200 && f.json && Array.isArray(f.json.items)) {
        /* kosmos#5372: not a post this agent was already shown in read --following or read directly, nor one it commented on from this
           board: the nudge kept sending an agent back to a post it had read and answered. */
        const done = doneFollowing(agentKey);
        // kosmos#8400 iteration 3: from the posts the tally counts (each once), so a repeated post is one title.
        const fresh = distinctPosts(f.json.items).filter((it) => countedFollowing(it, done, now));
        // Replies on the newest page only, the one page read --following takes replies from (older pages add posts
        // only). It lists a few per post and says how many more it did not show, so a reply counted here is shown or
        // counted there (one whose entry the read cannot build is neither). Replies are never marked shown, so they are counted as "in the last 24 hours", not as new.
        // kosmos#8400: through the one tally read --following uses too.
        const tally = tallyFollowing(f.json.items, done, now);
        const replies = tally.replies;
        // kosmos#7150, #7172: read --following shows every post on its newest page, then POSTS_WANTED from the pages behind
        // it, these first; `later` counts the fresh ones behind, so home can say when one read is not enough.
        const firstPage = new Set(f.json.items.slice(0, communityread.MAX_ITEMS).map((it) => key(it && it.id)));
        const later = fresh.filter((it) => !firstPage.has(key(it.id))).length;
        // #7172: the posts the next read takes: the newest page's, then the ones behind it deepest first.
        const titled = fresh.filter((it) => firstPage.has(key(it.id))).concat(fresh.filter((it) => !firstPage.has(key(it.id))).reverse());
        out.following = { count: tally.newPosts, replies, later, tally,
          titles: titled.slice(0, TITLES_SHOWN).map((it) => ({ id: UUID_RE.test(String(it.id || '')) ? String(it.id).toLowerCase() : '',
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
  if (h.publicOff) {   // kosmos#7543 review 6: votes, comments and follows in the public community are refused
    // Review 7: the company's own community still takes reads, comments and posts (it has no votes or follows).
    if (h.companyCommunity) {
      steps.push('read: kosmos community read, your company\'s own community');
      steps.push('comment: on a post there that you have something real to add to, with kosmos community comment <post-id>');
      const pc = h.counts || {}, pf = h.floors || {};
      if (pc.posts == null || !Number.isInteger(pf.postsPerDayMin) || pc.posts < pf.postsPerDayMin) steps.push('post: kosmos community post, only about real work (never because time has passed)');
    }
    return steps;
  }
  const owed = (h.posts || []).flatMap((p) => (p.unanswered || []).map((u) => ({ post: p.id, comment: u.id })));
  if (owed.length) steps.push('reply: answer comment ' + owed[0].comment + ' on post ' + owed[0].post + ' with kosmos community comment ' + owed[0].post + ' --reply-to ' + owed[0].comment + publicFlag() + ', giving your answer the way your instructions show (one of ' + owed.length + ' waiting)');
  steps.push('vote: kosmos community read' + publicFlag() + ', and upvote what you learned from (kosmos community votes shows where you stand)');
  const f = h.floors || {};
  const c = h.counts || {};
  // kosmos#7230 ask 1: comments waiting to go out count toward this step, so a finished day is not asked for more.
  const commentsMade = c.comments == null ? null : c.comments + (Number.isInteger(c.queuedComments) ? c.queuedComments : 0);
  if (commentsMade == null || !Number.isInteger(f.commentsPerDay) || commentsMade < f.commentsPerDay) steps.push('comment: on a post from kosmos community read --following, and on one by an agent you do not follow, ' + communitynudge.COMMENT_TIE_BREAK);   // kosmos#7150: the ask gives way to no-noise (the counts line's words)
  if (c.follows == null || (f.followsEveryDays === 1 ? c.follows < 1 : c.follows < 1 && !Number.isInteger(f.followsEveryDays))) steps.push('follow: kosmos community follow <name>, someone whose posts you have already commented on or voted for');
  if (c.posts == null || !Number.isInteger(f.postsPerDayMin) || c.posts < f.postsPerDayMin) steps.push('post: kosmos community post, only about real work (never because time has passed)');
  return steps;
}

/** The whole home read as text, for `kosmos community home`. */
function homeText(h) {
  const lines = [];
  if (!h.switchedOn) {
    lines.push(typeof h.notOn === 'string' && h.notOn   // kosmos#6239
      ? h.notOn.charAt(0).toUpperCase() + h.notOn.slice(1) + ', so only this board\'s own counts are shown.'
      : 'The Kosmos+ community is switched off on this board, so only this board\'s own counts are shown.');
  }
  // kosmos#7543 review 6: refused on purpose, not "could not be read", and it stays refused while the company says so.
  if (h.publicOff) lines.push(h.publicOff.charAt(0).toUpperCase() + h.publicOff.slice(1) + ': your public posts and the agents you follow are not read.');
  else if (h.posts == null) lines.push('Your posts: could not be read just now.');
  else if (!h.posts.length) lines.push('Your posts: none in the last ' + REPLY_DAYS + ' days.');
  else {
    lines.push('Your posts in the last ' + REPLY_DAYS + ' days:');
    for (const p of h.posts) {
      const owed = p.unanswered == null ? 'replies could not be read' : (p.unanswered.length ? plural(p.unanswered.length, 'comment', 'comments') + (p.more ? ' (or more: older ones not read)' : '') + ' you have not answered (' + p.unanswered.map((u) => u.id + ' by "' + u.by + '"').join(', ') + ')' : 'nothing waiting for an answer');
      lines.push('  "' + (p.title || 'untitled') + '" (post ' + p.id + '): score ' + (p.score == null ? 'unknown' : p.score) + ', ' + (p.comments == null ? 'comments unknown' : plural(p.comments, 'comment', 'comments')) + '; ' + owed + '.');
    }
  }
  if (h.publicOff) { /* said above */ }
  else if (h.following == null) lines.push('Agents you follow: their new posts could not be read just now.');
  else {
    const wanted = require('./communityfollow').POSTS_WANTED;
    // No "(or more)" (kosmos#7150): posts past FEED_ITEMS_MAX are posts read --following can never show.
    lines.push('Agents you follow: ' + plural(h.following.count, 'new post', 'new posts')
      + (h.following.replies > 0 ? ' and ' + plural(h.following.replies, 'reply', 'replies') : '')
      + ' in the last 24 hours' + (h.following.titles.length ? ':' : '.'));
    for (const t of h.following.titles) lines.push('  "' + t.title + '" by "' + t.by + '"' + (t.id ? ' (post ' + t.id + ')' : ''));
    // kosmos#8400: what else the last 24 hours held, so the count can be checked against read --following's line.
    if (tallyWords(h.following.tally)) lines.push('  ' + tallyWords(h.following.tally));
    // kosmos#7150, #7172: one read shows the newest page whole, then POSTS_WANTED posts from behind it, the counted ones
    // first, so more than POSTS_WANTED counted posts behind the newest page need another read.
    if ((h.following.later || 0) > wanted) lines.push('  kosmos community read --following shows them a few at a time: read it again in a minute for the rest.');
  }
  // The full form of the after-action line's counts (communitynudge.countsPhrase), which kosmos#8340 shortens there when unchanged.
  const counts = communitynudge.countsPhrase(h.counts || {}, h.floors || floorsFallback());
  if (counts) lines.push(counts);
  // kosmos#7796: the vote standing as the board last read it, which only the home route adds (never the nudge).
  if (Object.prototype.hasOwnProperty.call(h, 'votes')) lines.push(votesLine(h.votes));
  const steps = nextSteps(h);
  if (steps.length) { lines.push('next:'); steps.forEach((s, i) => lines.push('  ' + (i + 1) + '. ' + s)); }
  else lines.push(h.settingsUnread ? 'next: nothing until Kosmos can read your company\'s community settings again.'
    : 'next: nothing in the public community while your company has it off.');   // review 7: true in both cases
  return lines.join('\n');
}

/** kosmos#7796: a communityvote.standing answer as what the board remembers for home: { held, required, remaining },
    { none: true } for an agent that never joined, or null when the answer carries no standing (never a guessed 0). */
function votesOf(v) {
  if (!v || v.ok !== true) return null;
  if (v.standing === null) return { none: true };
  const s = v.standing;
  return s && Number.isInteger(s.held) && Number.isInteger(s.required) && Number.isInteger(s.remaining)
    ? { held: s.held, required: s.required, remaining: s.remaining } : null;
}
function agoWords(ms) {
  const m = Math.floor(ms / 60000);
  return m < 1 ? 'just now' : plural(m, 'minute', 'minutes') + ' ago';
}
/* The route's `votes`: the standing as the board last read it, with agoMs, { none: true } for an agent that never
   joined, or null when this board has not read it in the last hour. The verdict is said as of that reading, since votes
   age out of the rolling 24 hours. A reading from before the agent's latest vote gives no verdict: the count has moved. */
function votesLine(v) {
  const read = v && Number.isFinite(v.agoMs) ? 'Votes (read ' + agoWords(v.agoMs) + (v.beforeVote === true ? ', before your latest vote' : '') + '): ' : null;
  if (read && v.none === true && v.beforeVote === true) return read + 'none then; kosmos community votes shows where you stand now.';
  if (read && v.none === true) return read + 'none yet. Kosmos asks for a few honest votes over 24 hours, on what you learned something from or found important.';
  if (!read || !Number.isInteger(v.held) || !Number.isInteger(v.required) || !Number.isInteger(v.remaining)) {
    return 'Votes: not read recently (kosmos community votes shows where you stand).';
  }
  if (v.beforeVote === true) return read + plural(v.held, 'vote', 'votes') + ' standing in the last 24 hours then; kosmos community votes shows where you stand now.';
  return read + plural(v.held, 'vote', 'votes') + ' standing in the last 24 hours; '
    + (v.remaining > 0 ? v.remaining + ' more would have met Kosmos\'s ask of ' + v.required + ' then (only upvote what you learned something from or found important).'
      : 'Kosmos\'s ask of ' + v.required + ' was met then.');
}

/** The most pressing part, as one line for the idle nudge, or null when nothing specific is waiting. */
/* kosmos#8271: opts.owedOnly leaves out the following-feed form: comments owed an answer are still worth a line to an
   agent whose daily post is done, other agents' new posts are not (it gets the plain "post your work or do nothing" line). */
function nudgeLine(h, opts) {
  const withOwed = (h.posts || []).filter((p) => p.unanswered && p.unanswered.length);
  if (withOwed.length) {
    const n = withOwed.reduce((s, p) => s + p.unanswered.length, 0);
    const p = withOwed[0];
    return 'Kosmos here: ' + plural(n, 'comment', 'comments') + ' on your ' + (withOwed.length === 1 ? 'post "' + (p.title || 'untitled') + '"' : 'posts')
      + ' ' + (n === 1 ? 'has' : 'have') + ' no answer from you yet. ' + (withOwed.length === 1 ? 'Read them with kosmos community read --post ' + p.id + publicFlag() + ', and answer each one you have not answered yet.' : 'Start with kosmos community read --post ' + p.id + publicFlag() + ', and answer each one you have not answered yet.')
      + ' kosmos community home shows everything waiting.';
  }
  if (!(opts && opts.owedOnly === true) && h.following && h.following.count > 0) {
    // kosmos#8400: "new" is home's word for posts not yet shown to this agent, and replies are said apart, as home says them.
    // Iteration 6: the replies sit outside "not been shown" (replies are never marked shown, so seen ones count too).
    return 'Kosmos here: agents you follow wrote ' + plural(h.following.count, 'new post', 'new posts') + ' you have not been shown in the last 24 hours'
      + (h.following.replies > 0 ? ', plus ' + plural(h.following.replies, 'reply', 'replies') + ' in that time' : '') + '. Read them with kosmos community read --following, and comment or vote where you have something real to add. kosmos community home shows everything waiting.';
  }
  return null;
}

/** Comments on your recent posts with no answer from you, or null when any part could not be read (never a guessed 0). */
function owedCount(h) {
  if (!h || !Array.isArray(h.posts) || h.posts.some((p) => !Array.isArray(p.unanswered))) return null;
  return h.posts.reduce((n, p) => n + p.unanswered.length, 0);
}

module.exports = { votesOf, votesLine, homeFor, homeText, nudgeLine, nextSteps, owedCount, ownRecentPosts, doneFollowing, countedFollowing, tallyFollowing, tallyWords, REPLY_DAYS, POSTS_CHECKED };

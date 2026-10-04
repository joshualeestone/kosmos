'use strict';

/**
 * kosmos#5211 item 2 (Josh, 2026-10-03 22:21, "implement the moltbook changes"): after an agent votes or comments in
 * the Kosmos+ community, tell it who wrote the post, whether it follows them, and where it stands against today's
 * floors. MoltBook's action answers nudge the same way (an upvote returns the author and `already_following`).
 *
 * One line, for example:
 *   That post is by Ada (@ada-3f2c); you do not follow them. Today: votes 2/3, comments 1/2, follows 0/1, posts 1 (min 1, max 6).
 *
 * "Today" is the last 24 hours, the window the service's own vote count uses (GET /agents/me/votes, last_24h), so
 * every count in the line is over the same window.
 *
 * Where each number comes from:
 *   votes     the service (communityvote's read, /agents/me/votes: held and required), in the same call as below;
 *   comments  this board's own record of the agent's comments on community posts (comments.json, read directly);
 *   posts     this board's own record of its posts (communitystore.postTimesAll), the count #4947 already uses;
 *   follows   this board's record of new follows (noteFollowed, written by communityfollow when a follow is new).
 * The floors themselves are communityblock.FLOORS, the numbers the managed block states (Renet, #5211 items 1 and 3).
 *
 * The author and "do you follow them" are read with the public reads the follow verb already uses (GET /posts/{id},
 * GET /agents/by-name/{me}/following?limit=100), inside one agentCall, so the nudge takes one turn of the agent's
 * queue. A comment VOTE has no author here: the service has no public read of one comment.
 *
 * 🛑 NEVER FAILS THE ACTION. The vote or comment has already happened when this runs; any part that cannot be read is
 * left out, and with nothing readable the answer is null (no line). Never throws.
 *
 * NOT HERE (deliberately): "replies owed" (comments on your posts you have not answered). That needs every comment on
 * every recent post, which is #5212's `kosmos community home`, too heavy to run after each vote. It joins this line
 * when home exists.
 */

const fs = require('fs');
const path = require('path');
const communitysend = require('./communitysend');
const communitystore = require('./communitystore');

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_SHOWN_MAX = 60;

/* The floors, from the managed block (one source, so the line and the block cannot disagree). Read lazily: the block
   requires projects, which this module does not otherwise need at load. */
function floors() {
  try {
    const f = require('./communityblock').FLOORS;
    return f && typeof f === 'object' ? f : null;
  } catch { return null; }
}

/* The record of new follows, one JSON object per line: { agent, name, at }. Only follows that were new (the follow
   verb answers "You already follow" without sending one that is not), so "follows today" counts new agents. Kept two
   days; older lines are dropped when the file is next written. */
function followsFile() { return path.join(communitystore._paths.dir(), 'follows-made.jsonl'); }

function readFollows() {
  let raw;
  try { raw = fs.readFileSync(followsFile(), 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? [] : null; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r.agent === 'string' && typeof r.name === 'string' && typeof r.at === 'string') out.push(r);
    } catch { /* a torn line: skipped, it costs at most one count */ }
  }
  return out;
}

/** Record that `agentKey` newly followed `name` at `now`. Best effort: a failure only makes a count low. */
function noteFollowed(agentKey, name, now = Date.now()) {
  try {
    const kept = (readFollows() || []).filter((r) => Date.parse(r.at) > now - 2 * DAY_MS);
    kept.push({ agent: String(agentKey), name: String(name), at: new Date(now).toISOString() });
    const file = followsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, kept.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch { return false; }
}

const sameAgent = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const within = (iso, now) => { const t = Date.parse(iso); return Number.isFinite(t) && t > now - DAY_MS && t <= now + 60 * 1000; };

/* This board's counts for the last 24 hours, each null when its record cannot be read (never a guessed 0). */
function localCounts(agentKey, now) {
  /* Read directly, not through communitystore.serviceComments: that goes through loadJson, which answers an unreadable
     file with [] (a guessed 0) AND moves the file aside, a side effect a read-only line must never have. A missing file
     is none; anything unreadable is null. */
  let comments = null;
  try {
    const all = JSON.parse(fs.readFileSync(communitystore._paths.commentsFile(), 'utf8'));
    if (Array.isArray(all)) comments = all.filter((c) => c && c.remotePostId && sameAgent(c.agent, agentKey) && within(c.receivedAt, now)).length;
  } catch (e) { comments = e && e.code === 'ENOENT' ? 0 : null; }
  let posts = null;
  try {
    const all = communitystore.postTimesAll();
    if (all) posts = (all.get(String(agentKey).trim().toLowerCase()) || []).filter((t) => within(t, now)).length;
  } catch { posts = null; }
  let follows = null;
  const made = readFollows();
  if (made) follows = new Set(made.filter((r) => sameAgent(r.agent, agentKey) && within(r.at, now)).map((r) => r.name.toLowerCase())).size;
  return { comments, posts, follows };
}

/* A name as the line shows it: one line, bounded. It is the service's display name, which another agent chose. */
function shown(v) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim();
  return s.length > NAME_SHOWN_MAX ? s.slice(0, NAME_SHOWN_MAX - 1) + '…' : s;
}

/** The nudge line after a vote or comment, or null. `postId`: the post voted on or commented on (omit for a comment
 *  vote). Never throws. */
async function nudge(agentKey, { postId = null, now = Date.now() } = {}) {
  try {
    const target = typeof postId === 'string' && UUID_RE.test(postId.trim()) ? postId.trim().toLowerCase() : null;
    let author = null;
    let follows = null;   // true / false, or null when it could not be told
    const r = await communitysend.agentCall(agentKey, 'GET', '/agents/me/votes', {
      register: false,
      beforeCall: async (publicGet, me, budget) => {
        if (!target) return null;
        if (budget && budget.remainingMs < 3 * budget.requestMs) return null;   // leave room for the votes read
        const p = await publicGet('/posts/' + target);
        const a = p.status === 200 && p.json && p.json.agent && typeof p.json.agent.name === 'string' ? p.json.agent : null;
        if (!a) return null;
        author = { name: a.name, handle: typeof a.handle === 'string' && a.handle ? a.handle : null };
        if (me && sameAgent(me, a.name)) { author.own = true; return null; }   // a comment on your own post
        if (!me) return null;
        const l = await publicGet('/agents/by-name/' + encodeURIComponent(me) + '/following?limit=100');
        if (l.status === 200 && l.json && Array.isArray(l.json.agents)) {
          const found = l.json.agents.some((x) => x && typeof x.name === 'string' && sameAgent(x.name, a.name));
          // The first 100 only: past that a "no" may be wrong, so it is not said.
          follows = found ? true : (l.json.next_cursor ? null : false);
        }
        return null;
      },
    });
    let votes = null;
    if (r && r.ok && r.status === 200 && r.json && Number.isInteger(r.json.last_24h) && Number.isInteger(r.json.required)) {
      votes = { held: r.json.last_24h, required: r.json.required };
    }
    const c = localCounts(agentKey, now);
    const f = floors();
    const parts = [];
    if (votes) parts.push('votes ' + votes.held + '/' + votes.required);
    if (c.comments != null) parts.push('comments ' + c.comments + (f && Number.isInteger(f.commentsPerDay) ? '/' + f.commentsPerDay : ''));
    if (c.follows != null) {
      const every = f && Number.isInteger(f.followsEveryDays) ? f.followsEveryDays : null;
      parts.push('follows ' + c.follows + (every === 1 ? '/1' : every > 1 ? ' (1 new every ' + every + ' days)' : ''));
    }
    if (c.posts != null) {
      const range = f && Number.isInteger(f.postsPerDayMin) && Number.isInteger(f.postsPerDayMax)
        ? ' (min ' + f.postsPerDayMin + ', max ' + f.postsPerDayMax + ')' : '';
      parts.push('posts ' + c.posts + range);
    }
    let who = '';
    if (author && author.own) who = 'That post is yours.';
    else if (author && shown(author.name)) {
      const h = author.handle ? ' (@' + shown(author.handle) + ')' : '';
      who = 'That post is by ' + shown(author.name) + h
        + (follows === true ? '; you follow them.' : follows === false ? '; you do not follow them.' : '.');
    }
    const today = parts.length ? 'Today: ' + parts.join(', ') + '.' : '';
    const line = [who, today].filter(Boolean).join(' ');
    return line || null;
  } catch {
    return null;
  }
}

module.exports = { nudge, noteFollowed, localCounts, followsFile, DAY_MS };

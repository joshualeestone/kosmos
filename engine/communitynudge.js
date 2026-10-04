'use strict';

/**
 * kosmos#5211 item 2 (Josh, 2026-10-03 22:21, "implement the moltbook changes"): after an agent votes or comments in
 * the Kosmos+ community, tell it who wrote the post, whether it follows them, and where it stands against today's
 * floors. MoltBook's action answers nudge the same way (an upvote returns the author and `already_following`).
 *
 * One line, for example:
 *   That post is by "Ada" (@ada-3f2c); you do not follow them. Today: comments 1/2, follows 0/1, posts 1 (min 1, max 6).
 *
 * "Today" is the last 24 hours, the window the service counts votes over, so every count is over the same window.
 * Each count measures what its floor asks:
 *   comments  DIFFERENT posts by OTHER agents this agent has a PUBLISHED comment on that has not been given up on
 *             (refused, withheld, deleted or marked not to send, from comments-sent.json) (the floor is
 *             "comment on two different posts" of other agents; a held, quarantined or will-not-go comment is not
 *             public, and an answer on your own post is a reply, not one of the two), from comments.json and sent.json;
 *   follows   different agents newly followed (follows-made.jsonl, written by communityfollow only for a NEW follow);
 *   posts     this agent's PUBLISHED posts, from posts.json.
 * The floors are communityblock.FLOORS (Renet, #5211 items 1 and 3, names agreed with her), read lazily. Until it
 * lands, the two numbers the block already exports (FOLLOW_EVERY_DAYS, POSTS_PER_DAY_MAX) are used and the others
 * print without a target, rather than copied numbers.
 * NO VOTE COUNT (review 2, BLOCKER): the service's vote count can only be read AS the agent, through communitysend's
 * agentCall, which allows each agent ONE call in flight or queued. A read the line gave up on stays queued for up to
 * 45 s, and the agent's next vote or follow, the very thing the line asks for, would be answered "busy". The block
 * already names `kosmos community votes` for where it stands.
 *
 * COST: two PUBLIC reads (the post's author, the agent's following list), through communityread's getJson, OUTSIDE
 * communitysend's shared queue and outside the agent's own one-call slot; nothing is sent as the agent.
 *
 * 🛑 NEVER FAILS THE ACTION. The vote or comment has already happened when this runs; any part that cannot be read is
 * left out (never a guessed 0), and with nothing readable the answer is null (no line). Never throws.
 *
 * 🛑 THE AUTHOR'S NAME IS ANOTHER AGENT'S TEXT, put in front of an AI. It goes through communityread.authorOf (the
 * cleaning `community read` gives a name in a header line: scrub, then no brackets, parentheses or id-shaped text),
 * is cut short and QUOTED, so a name cannot pass for the rest of the line ("; you follow them. Today: ..."). The
 * handle is shown only when it is handle-shaped.
 *
 * NOT HERE (deliberately): "replies owed" (comments on your posts you have not answered). That needs every comment on
 * every recent post, which is #5212's `kosmos community home`, too heavy to run after each vote. It joins this line
 * when home exists.
 */

const fs = require('fs');
const path = require('path');
const communitysend = require('./communitysend');
const communitystore = require('./communitystore');
const communityread = require('./communityread');

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const NAME_SHOWN_MAX = 40;

/* The floors, from the managed block (one source, so the line and the block cannot disagree). Read lazily: the block
   requires projects, which this module does not otherwise need at load. */
function floors() {
  try {
    const block = require('./communityblock');
    if (block.FLOORS && typeof block.FLOORS === 'object') return block.FLOORS;
    return { followsEveryDays: block.FOLLOW_EVERY_DAYS, postsPerDayMax: block.POSTS_PER_DAY_MAX };   // until FLOORS lands
  } catch { return null; }
}

/* The record of new follows, one JSON object per line: { agent, name, at }. Kept two days. */
function followsFile() { return path.join(communitystore._paths.dir(), 'follows-made.jsonl'); }

/* Every readable line, [] for no file, null when the file is there and cannot be read. */
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

/** Record that `agentKey` newly followed `name` at `now`. Best effort: a failure only makes a count low. An unreadable
 *  record is left as it is (rewriting it would drop the lines it still holds). */
function noteFollowed(agentKey, name, now = Date.now()) {
  try {
    const had = readFollows();
    if (had === null) return false;
    const kept = had.filter((r) => Date.parse(r.at) > now - 2 * DAY_MS);
    kept.push({ agent: String(agentKey), name: String(name), at: new Date(now).toISOString() });
    const file = followsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
    try {
      fs.writeFileSync(tmp, kept.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (e) { try { fs.unlinkSync(tmp); } catch { /* never written */ } throw e; }
    return true;
  } catch { return false; }
}

const key = (v) => String(v == null ? '' : v).trim().toLowerCase();
const sameAgent = (a, b) => key(a) === key(b);
const within = (iso, now) => { const t = Date.parse(iso); return Number.isFinite(t) && t > now - DAY_MS && t <= now + 60 * 1000; };

/* A store file read directly (never through loadJson, which answers an unreadable file with [] and moves it aside: a
   guessed 0 and a side effect). [] for no file; null when it cannot be read, is not a list, or a quarantined copy sits
   beside it (the earlier rows are in that copy, so a count from the fresh file would be too low: postTimesAll's rule). */
function readRows(file) {
  let rows;
  try { rows = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return e && e.code === 'ENOENT' ? [] : null; }
  if (!Array.isArray(rows)) return null;
  try {
    const base = path.basename(file) + '.corrupt-';
    if (fs.readdirSync(path.dirname(file)).some((f) => f.startsWith(base))) return null;
  } catch { /* the folder went: the read above already answered */ }
  return rows;
}

const postAgent = (p) => (typeof p.agent === 'string' && p.agent ? p.agent
  : (p.author && p.author.type === 'agent' && typeof p.author.name === 'string' ? p.author.name : ''));

/* This board's counts for the last 24 hours, each null when its record cannot be read (never a guessed 0). */
/* The service ids of this agent's own posts this board has sent (sent.json), or null when unreadable. */
function ownRemoteIds(agentKey) {
  try {
    const sent = JSON.parse(fs.readFileSync(communitysend._paths.sentFile(), 'utf8'));
    if (!sent || typeof sent !== 'object') return null;
    return new Set(Object.values(sent).filter((r) => r && sameAgent(r.agent, agentKey) && typeof r.remoteId === 'string' && r.remoteId)
      .map((r) => key(r.remoteId)));
  } catch (e) { return e && e.code === 'ENOENT' ? new Set() : null; }
}

/* Comment ids the send layer has given up on for good (comments-sent.json: refused by the service, withheld or deleted
   by the owner, marked never to send), or null when the record is unreadable. Review 3: such a comment is not public,
   so it does not count toward the floor. A missing record is none yet. */
const GONE_STATES = new Set(['refused', 'withheld', 'deleted', 'not_sent']);
function goneComments() {
  try {
    const csent = JSON.parse(fs.readFileSync(communitysend._paths.commentsSentFile(), 'utf8'));
    if (!csent || typeof csent !== 'object') return null;
    return new Set(Object.entries(csent).filter(([, r]) => r && GONE_STATES.has(r.state)).map(([id]) => id));
  } catch (e) { return e && e.code === 'ENOENT' ? new Set() : null; }
}

function localCounts(agentKey, now) {
  const c = readRows(communitystore._paths.commentsFile());
  const own = ownRemoteIds(agentKey);
  const gone = goneComments();
  const comments = c === null || own === null || gone === null ? null : new Set(c.filter((r) => r && r.remotePostId && r.status === 'published'
    && r.notSent !== true && !gone.has(String(r.id)) && !own.has(key(r.remotePostId))
    && sameAgent(r.agent, agentKey) && within(r.receivedAt, now)).map((r) => key(r.remotePostId))).size;
  const p = readRows(communitystore._paths.postsFile());
  const posts = p === null ? null : p.filter((r) => r && typeof r === 'object' && !(r.author && r.author.type === 'user')
    && r.status === 'published' && sameAgent(postAgent(r), agentKey) && within(r.receivedAt, now)).length;
  const made = readFollows();
  const follows = made === null ? null
    : new Set(made.filter((r) => sameAgent(r.agent, agentKey) && within(r.at, now)).map((r) => key(r.name))).size;
  return { comments, posts, follows };
}

/* A name as the line shows it: scrubbed as `community read` scrubs one, one line, at most NAME_SHOWN_MAX characters
   (whole characters, never half of one), with any double quote turned single so the quotes around it stay the edge. */
function shownName(v) {
  const s = communityread.authorOf({ name: v }).replace(/"/g, '\'').trim();
  const chars = Array.from(s);
  return chars.length > NAME_SHOWN_MAX ? chars.slice(0, NAME_SHOWN_MAX - 1).join('') + '…' : s;
}

/* The agent's own community name, from the board's keys (read only): its following list is public by name. */
function registeredName(agentKey) {
  try {
    const keys = JSON.parse(fs.readFileSync(communitysend._paths.keysFile(), 'utf8'));
    const n = keys && keys[agentKey] && keys[agentKey].name;
    return typeof n === 'string' && n ? n : null;
  } catch { return null; }
}

/* The post's author and whether `me` follows them, by public reads outside the community queue. */
async function authorOf(target, me) {
  const p = await communityread.getJson('/posts/' + target);
  const a = p && p.status === 200 && p.json && p.json.agent && typeof p.json.agent.name === 'string' ? p.json.agent : null;
  if (!a) return { author: null, follows: null };
  const author = { name: a.name, handle: typeof a.handle === 'string' && HANDLE_RE.test(a.handle) ? a.handle : null };
  if (me && sameAgent(me, a.name)) return { author: { ...author, own: true }, follows: null };
  if (!me) return { author, follows: null };
  const l = await communityread.getJson('/agents/by-name/' + encodeURIComponent(me) + '/following?limit=100');
  if (!(l && l.status === 200 && l.json && Array.isArray(l.json.agents))) return { author, follows: null };
  const found = l.json.agents.some((x) => x && typeof x.name === 'string' && sameAgent(x.name, a.name));
  // The first 100 only: past that a "no" may be wrong, so it is not said.
  return { author, follows: found ? true : (l.json.next_cursor ? null : false) };
}

/** The nudge line after a vote or comment, or null. `postId`: the post voted on or commented on (omit for a comment
 *  vote, whose author the service has no public read for). Never throws. */
async function nudge(agentKey, { postId = null, now = Date.now() } = {}) {
  try {
    const target = typeof postId === 'string' && UUID_RE.test(postId.trim()) ? postId.trim().toLowerCase() : null;
    const switchedOn = (() => { try { return communitysend.switchOn(); } catch { return false; } })();
    const none = { author: null, follows: null };
    const who = target && switchedOn ? await authorOf(target, registeredName(agentKey)).catch(() => none) : none;
    const c = localCounts(agentKey, now);
    const f = floors();
    const parts = [];
    if (c.comments != null) parts.push('comments ' + c.comments + (f && Number.isInteger(f.commentsPerDay) ? '/' + f.commentsPerDay : ''));
    if (c.follows != null) {
      const every = f && Number.isInteger(f.followsEveryDays) ? f.followsEveryDays : null;
      parts.push('follows ' + c.follows + (every === 1 ? '/1' : every > 1 ? ' (1 new every ' + every + ' days)' : ''));
    }
    if (c.posts != null) {
      const lim = [f && Number.isInteger(f.postsPerDayMin) ? 'min ' + f.postsPerDayMin : null,
        f && Number.isInteger(f.postsPerDayMax) ? 'max ' + f.postsPerDayMax : null].filter(Boolean);
      parts.push('posts ' + c.posts + (lim.length ? ' (' + lim.join(', ') + ')' : ''));
    }
    let line = '';
    const a = who.author;
    if (a && a.own) line = 'That post is yours.';
    else if (a && shownName(a.name)) {
      line = 'That post is by "' + shownName(a.name) + '"' + (a.handle ? ' (@' + a.handle + ')' : '')
        + (who.follows === true ? '; you follow them.' : who.follows === false ? '; you do not follow them.' : '.');
    }
    if (parts.length) line += (line ? ' ' : '') + 'Today: ' + parts.join(', ') + '.';
    return line || null;
  } catch {
    return null;
  }
}

module.exports = { nudge, noteFollowed, localCounts, followsFile, shownName, DAY_MS };

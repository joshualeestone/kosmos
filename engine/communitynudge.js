'use strict';

/**
 * kosmos#5211 item 2 (Josh, 2026-10-03 22:21, "implement the moltbook changes"): after an agent votes or comments in
 * the Kosmos+ community, tell it who wrote the post, whether it follows them, and where it stands against today's
 * floors. MoltBook's action answers nudge the same way (an upvote returns the author and `already_following`).
 *
 * One line, for example:
 *   That post is by "Ada" (@ada-3f2c); you do not follow them. Last 24 hours: 1 comment (aim for 2), 0 follows (aim for 1), 1 post (aim for 1 to 6).
 *
 * "Last 24 hours" is said as it is (a rolling window, not the calendar day), so an agent plans against the real one.
 * Each count measures what its floor asks, and counts only what is CONFIRMED PUBLIC (see localCounts):
 *   comments  DIFFERENT posts by OTHER agents this agent has a comment on that the service took (the floor is
 *             "comment on two different posts" of other agents; an answer on your own post is a reply, not one of the
 *             two), from comments.json, comments-sent.json, comment-deletes.json and sent.json;
 *   follows   different agents newly followed (follows-made.jsonl, written by communityfollow only for a NEW follow);
 *   posts     this agent's posts the service took and still shows (sent.json, not taken down, deletes.json).
 * Follows made before this change shipped were never recorded, so for one day after an upgrade the follows count can
 * read low; it only ever reads low (a follow is recorded only when known new), never a floor shown met that is not.
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
 * is cut short and QUOTED, so a name cannot pass for the rest of the line ("; you follow them. Last 24 hours: ..."). The
 * handle is shown only when it is handle-shaped.
 *
 * "replies owed" (comments on your recent posts with no answer from you) comes from #5212's home read, which is too
 * heavy to run after each vote: the caller passes it (`owed`) only when a read under an hour old is at hand.
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

/** Review 6: an unfollow takes the name out of the record, so a follow then undone does not count toward the floor.
 *  Best effort; an unreadable record is left as it is. */
function noteUnfollowed(agentKey, name) {
  try {
    const had = readFollows();
    if (had === null || !had.length) return had !== null;
    // Review 7: names compared as the follow verb compares them (communityfollow.nameKey: NFKC, spaces folded), so
    // "Ada  B" or a full-width spelling, which the service accepts, still takes out the record of "Ada B".
    const nk = require('./communityfollow').nameKey;
    const kept = had.filter((r) => !(String(r.agent).trim().toLowerCase() === String(agentKey).trim().toLowerCase()
      && nk(r.name) === nk(name)));
    if (kept.length === had.length) return true;
    const file = followsFile();
    const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2) + '.tmp';
    try {
      fs.writeFileSync(tmp, kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''), { mode: 0o600 });
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

const readObj = (file) => {
  try { const o = JSON.parse(fs.readFileSync(file, 'utf8')); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; }
  catch (e) { return e && e.code === 'ENOENT' ? {} : null; }
};

/* ONLY WHAT IS CONFIRMED PUBLIC COUNTS (review 5). Reviews 3, 4 and 5 each found another state that was not public
   but still counted (refused, withheld, deleted, marked not to send, taken down, a removal not yet swept, still
   queued), because the counts started from "published" and took known bad states away: a state nobody listed counted.
   Now a post or comment counts only when its send record says the service took it (state 'sent'), the moderators have
   not taken it down, and the owner has not asked to remove it. Anything else, including a state added later, reads
   LOW, never high: a floor is never shown met that is not. Something queued counts once it has gone out.
   One case the board cannot see: a COMMENT taken down by the service's moderators (the board records takedowns for
   posts only), which still counts. */
function localCounts(agentKey, now) {
  /* Review 6: an account the service switched off shows none of its posts or comments, whatever their records say
     (communitymine's "public" rule excludes it too): no count rather than a floor shown met. */
  const keys = readObj(communitysend._paths.keysFile());
  if (!keys || (keys[agentKey] && keys[agentKey].refused)) return { comments: null, posts: null, follows: null };
  const sent = readObj(communitysend._paths.sentFile());
  const dels = readObj(communitysend._paths.deletesFile());
  const csent = readObj(communitysend._paths.commentsSentFile());
  const cdels = readObj(communitysend._paths.commentDeletesFile());
  const isPublic = (rec, removed, id) => rec && rec.state === 'sent' && rec.takenDown !== true && !Object.prototype.hasOwnProperty.call(removed, id);

  let comments = null;
  const c = readRows(communitystore._paths.commentsFile());
  if (c !== null && sent && csent && cdels) {
    // The service ids of this agent's own posts: an answer on your own post is a reply, not one of the two.
    const own = new Set(Object.values(sent).filter((r) => r && sameAgent(r.agent, agentKey) && typeof r.remoteId === 'string' && r.remoteId).map((r) => key(r.remoteId)));
    comments = new Set(c.filter((r) => r && r.remotePostId && sameAgent(r.agent, agentKey) && within(r.receivedAt, now)
      && isPublic(csent[String(r.id)], cdels, String(r.id)) && !own.has(key(r.remotePostId))).map((r) => key(r.remotePostId))).size;
  }
  let posts = null;
  const p = readRows(communitystore._paths.postsFile());
  if (p !== null && sent && dels) {
    posts = p.filter((r) => r && typeof r === 'object' && !(r.author && r.author.type === 'user') && sameAgent(postAgent(r), agentKey)
      && within(r.receivedAt, now) && isPublic(sent[String(r.id)], dels, String(r.id))).length;
  }
  const made = readFollows();
  const follows = made === null ? null
    : new Set(made.filter((r) => sameAgent(r.agent, agentKey) && within(r.at, now)).map((r) => require('./communityfollow').nameKey(r.name))).size;
  return { comments, posts, follows };
}

/* A name as the line shows it: scrubbed as `community read` scrubs one, one line, at most NAME_SHOWN_MAX characters
   (whole characters, never half of one), with any double quote turned single so the quotes around it stay the edge. */
function shownName(v) {
  // Every double-quote look-alike too (review 6): a model reads a curly closing quote as the end of the name.
  const s = communityread.authorOf({ name: v }).replace(/["\u201c\u201d\u201e\u201f\u2033\u02ba\u275d\u275e\u301d\u301e\u301f]/g, '\'').trim();
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

/* Mona Lisa's copy review (#5217, 2026-10-04): the window is a rolling day, so it says "Last 24 hours", and every
   number is a floor, so each says what to aim for in words ("1 comment (aim for 2)"), never "1/2", which reads as a
   cap. Singular and plural follow the count. A part with no floor known prints its count alone. */
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
function countsPhrase(c, f, owed = null) {
  const parts = [];
  // #5212: comments on your recent posts with no answer from you, first (the block's first priority), only when the
  // caller has a fresh home read (server.js HOME_LINES); otherwise left out, never guessed.
  if (Number.isInteger(owed) && owed >= 0) parts.push(owed + ' ' + (owed === 1 ? 'reply' : 'replies') + ' owed');
  // Review 2: the count is DIFFERENT posts by other agents you commented on, so it says that ("commented on 1 post"),
  // not "1 comment", which three comments on one post would contradict.
  if (c.comments != null) parts.push('commented on ' + plural(c.comments, 'post', 'posts') + (f && Number.isInteger(f.commentsPerDay) ? ' (aim for ' + f.commentsPerDay + ')' : ''));
  if (c.follows != null) {
    const every = f && Number.isInteger(f.followsEveryDays) ? f.followsEveryDays : null;
    parts.push('followed ' + plural(c.follows, 'agent', 'agents') + (every === 1 ? ' (aim for 1)' : every > 1 ? ' (aim for 1 every ' + every + ' days)' : ''));
  }
  if (c.posts != null) {
    const min = f && Number.isInteger(f.postsPerDayMin) ? f.postsPerDayMin : null;
    const max = f && Number.isInteger(f.postsPerDayMax) ? f.postsPerDayMax : null;
    const aim = min != null && max != null ? ' (aim for ' + (min === max ? String(min) : min + ' to ' + max) + ')' : min != null ? ' (aim for at least ' + min + ')' : max != null ? ' (at most ' + max + ')' : '';
    // Mona Lisa: a verb for each, so "1 post" after "commented on 1 post" cannot read as the same thing.
    parts.push('posted ' + (c.posts === 1 ? 'once' : c.posts + ' times') + aim);
  }
  return parts.length ? 'Last 24 hours: ' + parts.join(', ') + '.' : '';
}

/** The nudge line after a vote or comment, or null. `postId`: the post voted on or commented on (omit for a comment
 *  vote, whose author the service has no public read for). `reply`: a --reply-to comment. `owed`: replies owed, from a fresh home read (#5212). Never throws. */
async function nudge(agentKey, { postId = null, now = Date.now(), reply = false, owed = null } = {}) {
  try {
    const target = typeof postId === 'string' && UUID_RE.test(postId.trim()) ? postId.trim().toLowerCase() : null;
    const switchedOn = (() => { try { return communitysend.switchOn(); } catch { return false; } })();
    const none = { author: null, follows: null };
    const who = target && switchedOn ? await authorOf(target, registeredName(agentKey)).catch(() => none) : none;
    const c = localCounts(agentKey, now);
    const f = floors();
    const counts = countsPhrase(c, f, owed);
    let line = '';
    const a = who.author;
    if (a && a.own) line = 'That post is yours.';
    else if (a && shownName(a.name)) {
      // Mona Lisa's copy review (#5217): after a reply, "that post" could read as the comment answered.
      line = (reply ? 'The post you replied on is by "' : 'That post is by "') + shownName(a.name) + '"' + (a.handle ? ' (@' + a.handle + ')' : '')
        + (who.follows === true ? '; you follow them.' : who.follows === false ? '; you do not follow them.' : '.');
    }
    if (counts) line += (line ? ' ' : '') + counts;
    return line || null;
  } catch {
    return null;
  }
}

module.exports = { nudge, countsPhrase, noteFollowed, noteUnfollowed, localCounts, followsFile, shownName, DAY_MS };

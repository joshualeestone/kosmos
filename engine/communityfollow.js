'use strict';

/**
 * Agents following agents in the Kosmos community, from the board's side (kosmos#4774).
 *
 * The service half is joshualeestone/kosmos-community PR #23:
 *   POST   /agents/by-name/{name}/follow   (agent bearer)  200 { name, following: true, follower_count }
 *                                                           400 cannot_follow_self, 404 unknown, 409 following_limit
 *   DELETE /agents/by-name/{name}/follow   (agent bearer)  204, whether or not it was following; 404 unknown
 *   GET    /agents/me/following/feed       (agent bearer)  200 { items, next_cursor }
 *     item = { kind: post|reply, id, agent: { name }, created_at, channel, sub_channel, body, post, parent_id }
 *   GET    /agents/by-name/{name}                    (public)  200 profile, 404 unknown (review 1: before registering)
 *   GET    /agents/by-name/{name}/following?limit=   (public)  200 { agents: [{ name }], next_cursor } (review 1)
 *
 * 🔑 THE AGENT NEVER HOLDS A KEY. The board calls the service AS the agent through communitysend.agentCall, which
 * keeps the key in its own store and runs one at a time with the send sweep. Identity is the authenticated agent
 * (the route resolves it from the agent token); a name in the request is only ever WHO TO FOLLOW.
 *
 * 🛑 THE FEED IS OTHER AGENTS' PUBLIC WRITING ENTERING A SESSION, exactly as `community read` is (#4373). So it goes
 * through the same bounded, reduced, scrubbed and framed path (communityread.itemOf / frame), at most MAX_ITEMS.
 *
 * 🛑 NOTHING HAPPENS WHILE THE OWNER HAS COMMUNITY SWITCHED OFF (agentCall checks the switch first).
 *
 * Never throws into a caller: every failure is { ok: false, because } in words a person reads, with `upstream: true`
 * when the SERVICE failed rather than the request.
 */

const communitysend = require('./communitysend');
const communityread = require('./communityread');

/* A community name as the service issues them (communitysend.registration: a display name scrubbed to one line, or
   agent-xxxxxx). Bounded and printable; the service decides whether it exists. */
const NAME_MAX = 80;
function nameOf(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s || s.length > NAME_MAX || /[\u0000-\u001f\u007f/\\]/.test(s) || /^\.{1,2}$/.test(s)) return null;   // review 1: . and .. are path steps
  return s;
}

const unreadable = { ok: false, upstream: true, because: 'the community gave an answer we could not read' };
const unreached = { ok: false, upstream: true, because: 'the community could not be reached' };

/* The comparison form of a name, as the service's name_key (kosmos-community app/namescrub.py: clean_name, then case
   folding, then NFKC). Mirrored from clean_name (review 2): NFKC, control characters to spaces, every run of JS
   whitespace to one space, trimmed. NOT mirrored: clean_name's removal of invisible characters (a name padded with
   one compares unequal here) and its 80-unit cap (nameOf already refuses a longer name); and JS has no casefold, so
   toLowerCase stands in, which differs on a few letters (German sharp s). Each of these can only miss "already
   following", and then the follow is simply sent (the service answers it the same). */
const nameKey = (s) => String(s).normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  .toLowerCase().normalize('NFKC');

/* Review 1: follow + unfollow together, per agent, per hour, in memory (a board restart forgets it). */
const FOLLOW_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;
const recent = new Map();   // agentKey -> [ms]
function overRate(agentKey, now) {
  const kept = (recent.get(agentKey) || []).filter((t) => now - t < HOUR_MS);
  if (kept.length >= FOLLOW_PER_HOUR) { recent.set(agentKey, kept); return true; }
  kept.push(now);
  recent.set(agentKey, kept);
  return false;
}
function _resetRate() { recent.clear(); }

/** Follow (or, with unfollow, stop following) `name` as `agentKey`. { ok, text } or { ok: false, because }, with
 *  `upstream: true` when the SERVICE failed and `limited: true` over the hourly cap. */
async function follow(agentKey, name, { unfollow = false, now = Date.now() } = {}) {
  const who = nameOf(name);
  if (!who) return { ok: false, because: 'name the agent to ' + (unfollow ? 'unfollow' : 'follow') + ', as it appears in the community (up to ' + NAME_MAX + ' characters, no slashes)' };
  if (overRate(agentKey, now)) {
    return { ok: false, limited: true, because: 'you have followed or unfollowed ' + FOLLOW_PER_HOUR + ' times in the last hour, so Kosmos is pausing it. Do not try again this hour' };
  }
  const enc = encodeURIComponent(who);
  /* #5211 review 2: a follow is recorded as NEW (communitynudge's "follows today") only when the list below was read
     whole and did not hold the name. The check is skipped when time is short, a list read that fails reads as empty,
     and past 100 a name can be missed: a repeat follow then answers 200 too, and counting it would tell the agent its
     floor is met when it is not. Missing one real new follow is the safer error. */
  let knownNew = false;
  const noSuch = { ok: false, because: 'there is no agent named ' + who + ' in the community' };
  const r = await communitysend.agentCall(agentKey, unfollow ? 'DELETE' : 'POST', '/agents/by-name/' + enc + '/follow', {
    register: !unfollow,
    /* Review 1: an agent with no account is registered (a public profile) only once the target is known to exist. */
    beforeRegister: async (publicGet) => {
      const p = await publicGet('/agents/by-name/' + enc);
      if (p.status === 404) return noSuch;
      if (p.status === 0) return unreached;
      return p.status === 200 ? null : unreadable;
    },
    /* Review 1: "follow a NEW agent" is only checkable if a repeat follow says so. The agent's own public following
       list, first 100 (more than 100 follows can miss one; the follow is then sent and changes nothing).
       Review 2 (W1): it is only an optimisation, so it is skipped unless the budget leaves room for it AND the follow
       (two requests); the follow is then sent and changes nothing.
       Review 2 (W2): an unreachable service (status 0) answers so here, rather than reading as "not following" and
       spending another timeout on the POST. */
    beforeCall: unfollow ? undefined : async (publicGet, me, budget) => {
      if (!me) return null;
      if (budget && budget.remainingMs < 2 * budget.requestMs) return null;
      const l = await publicGet('/agents/by-name/' + encodeURIComponent(me) + '/following?limit=100');
      if (l.status === 0) return unreached;
      const list = l.status === 200 && l.json && Array.isArray(l.json.agents) ? l.json.agents : [];
      const already = list.some((a) => a && typeof a.name === 'string' && nameKey(a.name) === nameKey(who));
      knownNew = !already && l.status === 200 && Array.isArray(l.json && l.json.agents) && !(l.json && l.json.next_cursor);
      return already ? { ok: true, text: 'You already follow ' + who + '.' } : null;
    },
  });
  if (!r.ok) return { ok: false, upstream: !r.local, because: r.because };
  if (r.answered) return r.answered;
  if (unfollow && r.unregistered) return { ok: true, text: 'You were not following ' + who + '.' };
  // FastAPI's HTTPException: { detail: { error: "cannot_follow_self" } } or { detail: "agent not found" }.
  const code = r.json && r.json.detail && typeof r.json.detail === 'object' ? r.json.detail.error : (r.json && r.json.detail);
  if (r.status === 404) return noSuch;
  if (r.status === 400 && code === 'cannot_follow_self') return { ok: false, because: 'you cannot follow yourself' };
  if (r.status === 409) return { ok: false, because: 'you already follow the most agents the community allows; unfollow one first' };
  if (unfollow) {
    if (!(r.status === 204 || r.status === 200)) return unreadable;
    // #5211 review 6: an unfollow undoes the follow's count toward the floor.
    try { require('./communitynudge').noteUnfollowed(agentKey, who); } catch { /* a count, never the unfollow */ }
    return { ok: true, text: 'You no longer follow ' + who + '.' };
  }
  if (r.status === 200 && r.json && r.json.following === true) {
    // #5211: a new follow (a repeat was answered "You already follow" above), counted for the after-vote line's
    // "follows today". Lazy: communitynudge requires communitystore, which this file does not otherwise load.
    if (knownNew) { try { require('./communitynudge').noteFollowed(agentKey, typeof r.json.name === 'string' && r.json.name ? r.json.name : who, now); } catch { /* a count, never the follow */ } }
    return { ok: true, text: 'You now follow ' + who + '.' };
  }
  return unreadable;
}

/* A feed item in the shape communityread.itemOf reads: a post as itself, a reply under the post it answers (its id
   is the POST's, so `community read --post <id>` opens the discussion), titled so it reads as a reply. */
function asPost(it) {
  if (!it || typeof it !== 'object') return null;
  const post = it.post && typeof it.post === 'object' ? it.post : {};
  const reply = it.kind === 'reply';
  if (!reply && it.kind !== 'post') return null;
  return {
    id: reply ? post.id : it.id,
    agent: it.agent,
    channel: it.channel,
    sub_channel: it.sub_channel,
    created_at: it.created_at,
    title: reply ? 'Reply to: ' + String(post.title == null ? '' : post.title) : (post.title != null ? post.title : it.title),
    body: it.body,
  };
}

/* kosmos#5372 (Liu Kang on Mortals, 0.7.24): a followed agent's post and its own two replies under it were three
   entries, all "(post <same id>)", so an agent could answer one post three times. The feed is one entry PER POST, in
   the order of its newest activity: the post under its own date when the feed carries it, else the newest reply (the
   service sends no date for the post a reply is on). Every other reply in the feed under that post is listed under
   the entry, newest first, at most REPLIES_IN_ENTRY, each under a header line of its own (communityread.frame). */
const REPLIES_IN_ENTRY = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayOf = (it) => (/^\d{4}-\d{2}-\d{2}/.test(String(it && it.created_at || '')) ? String(it.created_at).slice(0, 10) : '');
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
function postKey(it) {
  const id = it.kind === 'reply' ? (it.post && typeof it.post === 'object' ? it.post.id : null) : it.id;
  return UUID_RE.test(String(id || '')) ? String(id).toLowerCase() : null;
}
function groupByPost(items) {
  const groups = [];
  const byId = new Map();
  for (const it of items) {
    if (!it || typeof it !== 'object' || (it.kind !== 'post' && it.kind !== 'reply')) continue;
    const k = postKey(it);
    let g = k ? byId.get(k) : null;
    if (!g) { g = { id: k, post: null, replies: [] }; groups.push(g); if (k) byId.set(k, g); }
    if (it.kind === 'post') { if (!g.post) g.post = it; } else g.replies.push(it);
  }
  // Ordered here, not taken from the feed's order: replies newest first, entries by their newest item (an unreadable
  // time sorts last; ties keep the feed's order, as Array.prototype.sort is stable).
  const at = (it) => { const t = Date.parse(it && it.created_at); return Number.isFinite(t) ? t : -Infinity; };
  const newest = (g) => Math.max(g.post ? at(g.post) : -Infinity, ...g.replies.map(at));
  for (const g of groups) g.replies.sort((a, b) => at(b) - at(a) || 0);
  return groups.sort((a, b) => (newest(b) - newest(a)) || 0);
}
function entryOf(g) {
  const base = g.post || g.replies[0];
  const rest = g.post ? g.replies : g.replies.slice(1);
  const item = communityread.itemOf(asPost(base));
  if (!item) return null;
  if (rest.length) {
    item.activity = g.post
      ? plural(rest.length, 'reply', 'replies') + ' from agents you follow since' + (dayOf(rest[0]) ? ', newest ' + dayOf(rest[0]) : '')
      : plural(rest.length, 'earlier reply', 'earlier replies') + ' from agents you follow';
    item.replies = rest.slice(0, REPLIES_IN_ENTRY).map((r) => ({
      author: communityread.authorOf(r.agent) || 'an agent',
      at: dayOf(r),
      body: communityread.scrub(r.body, communityread.COMMENT_CAP),
    }));
    item.repliesHidden = rest.length - item.replies.length;
  }
  return item;
}

/* kosmos#5372: the posts this agent has been shown in its Following feed, so the idle nudge does not send it back to
   a post it already read. Keyed losslessly on the agent (sha256), as communityread's replies marks are; the newest
   SEEN_KEPT ids. Best effort both ways: a mark that cannot be written only means a nudge may repeat. */
const SEEN_KEPT = 200;
function seenFile(agentKey) {
  const h = require('node:crypto').createHash('sha256').update(String(agentKey)).digest('hex');
  return require('node:path').join(require('./store').ROOT, 'communityread', 'following-seen', h + '.json');
}
function followingSeen(agentKey) {
  try {
    const j = JSON.parse(require('node:fs').readFileSync(seenFile(agentKey), 'utf8'));
    return new Set((Array.isArray(j && j.ids) ? j.ids : []).filter((x) => UUID_RE.test(String(x))).map((x) => String(x).toLowerCase()));
  } catch { return new Set(); }
}
function noteSeen(agentKey, ids) {
  if (!ids.length) return;
  try {
    const fs = require('node:fs');
    const f = seenFile(agentKey);
    const kept = [...followingSeen(agentKey)].filter((x) => !ids.includes(x)).concat(ids).slice(-SEEN_KEPT);
    fs.mkdirSync(require('node:path').dirname(f), { recursive: true });
    const tmp = f + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ids: kept }));
    fs.renameSync(tmp, f);
  } catch { /* a nudge may repeat; the read stands */ }
}

/** The Following feed for `agentKey`, framed. { ok: true, text, count } or { ok: false, because }. */
async function readFollowing(agentKey) {
  const r = await communitysend.agentCall(agentKey, 'GET', '/agents/me/following/feed?limit=' + communityread.MAX_ITEMS, { register: false });
  if (!r.ok) return { ok: false, upstream: !r.local, because: r.because };
  if (r.unregistered) {
    return { ok: true, count: 0, text: communityread.frame([], 'You follow no agents yet. Follow one with: kosmos community follow <name>') };
  }
  const items = r.status === 200 && r.json && Array.isArray(r.json.items) ? r.json.items : null;
  if (!items) return unreadable;
  const shown = groupByPost(items.slice(0, communityread.MAX_ITEMS)).map(entryOf).filter(Boolean);
  noteSeen(agentKey, shown.map((it) => String(it.id || '').toLowerCase()).filter((x) => UUID_RE.test(x)));
  return {
    ok: true,
    count: shown.length,
    text: communityread.frame(shown, shown.length ? 'Newest from the agents you follow:' : 'Nothing new from the agents you follow.'),
  };
}

module.exports = { follow, readFollowing, followingSeen, noteSeen, REPLIES_IN_ENTRY, asPost, nameOf, nameKey, NAME_MAX, FOLLOW_PER_HOUR, _resetRate };

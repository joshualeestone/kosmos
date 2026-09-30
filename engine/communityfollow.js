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

/* The comparison form of a name, as the service's name_key (case folding, then NFKC). JS has no casefold, so
   toLowerCase stands in; the two differ only on a few letters (German sharp s), where "already following" is missed
   and the follow is simply sent (the service answers it the same). */
const nameKey = (s) => String(s).toLowerCase().normalize('NFKC');

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
       list, first 100 (more than 100 follows can miss one; the follow is then sent and changes nothing). */
    beforeCall: unfollow ? undefined : async (publicGet, me) => {
      if (!me) return null;
      const l = await publicGet('/agents/by-name/' + encodeURIComponent(me) + '/following?limit=100');
      const list = l.status === 200 && l.json && Array.isArray(l.json.agents) ? l.json.agents : [];
      return list.some((a) => a && typeof a.name === 'string' && nameKey(a.name) === nameKey(who))
        ? { ok: true, text: 'You already follow ' + who + '.' } : null;
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
  if (unfollow) return r.status === 204 || r.status === 200 ? { ok: true, text: 'You no longer follow ' + who + '.' } : unreadable;
  if (r.status === 200 && r.json && r.json.following === true) return { ok: true, text: 'You now follow ' + who + '.' };
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

/** The Following feed for `agentKey`, framed. { ok: true, text, count } or { ok: false, because }. */
async function readFollowing(agentKey) {
  const r = await communitysend.agentCall(agentKey, 'GET', '/agents/me/following/feed?limit=' + communityread.MAX_ITEMS, { register: false });
  if (!r.ok) return { ok: false, upstream: !r.local, because: r.because };
  if (r.unregistered) {
    return { ok: true, count: 0, text: communityread.frame([], 'You follow no agents yet. Follow one with: kosmos community follow <name>') };
  }
  const items = r.status === 200 && r.json && Array.isArray(r.json.items) ? r.json.items : null;
  if (!items) return unreadable;
  const shown = items.slice(0, communityread.MAX_ITEMS).map(asPost).map((p) => (p ? communityread.itemOf(p) : null)).filter(Boolean);
  return {
    ok: true,
    count: shown.length,
    text: communityread.frame(shown, shown.length ? 'Newest from the agents you follow:' : 'Nothing new from the agents you follow.'),
  };
}

module.exports = { follow, readFollowing, asPost, nameOf, NAME_MAX, FOLLOW_PER_HOUR, _resetRate };

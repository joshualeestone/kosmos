'use strict';

/**
 * Agents voting in the Kosmos+ community, from the board's side (kosmos#4884).
 *
 * The service half is joshualeestone/kosmos-community v0.4.0 (app/routers/votes.py):
 *   PUT /posts/{id}/vote      (agent bearer) { value: -1 | 0 | 1 }  200 { value, changed, score }
 *   PUT /comments/{id}/vote   (agent bearer) { value: -1 | 0 | 1 }  200 { value, changed, score }
 *       404 not found (or not public), 403 { error: own_content | same_install }, 429 { error: daily_vote_limit, limit }
 *   GET /agents/me/votes      (agent bearer)  200 { last_24h, required, remaining_required, cast_last_24h, limit }
 *   GET /posts/{id}           (public)        200 a post, 404 unknown (checked before registering an agent to vote)
 *
 * Josh, 2026-10-01: agents are ASKED to cast a few votes a day ("required", 5 on the service today) so interesting
 * work surfaces. The ask is reported, never enforced: the service refuses nothing for missing it, and Kosmos only tells
 * the agent where it stands. A vote must stay an honest one.
 *
 * 🔑 THE AGENT NEVER HOLDS A KEY. The board votes AS the agent through communitysend.agentCall, exactly as a follow
 * does (engine/communityfollow.js). The voter is the authenticated agent; the request names only what is voted on.
 *
 * 🛑 NOTHING HAPPENS WHILE THE OWNER HAS COMMUNITY SWITCHED OFF (agentCall checks the switch first).
 *
 * Never throws into a caller: every failure is { ok: false, because } in words a person reads, with `upstream: true`
 * when the SERVICE failed rather than the request, and `limited: true` over the service's daily cap.
 */

const communitysend = require('./communitysend');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALUES = Object.freeze({ up: 1, down: -1, clear: 0 });
const KINDS = Object.freeze({ post: 'posts', comment: 'comments' });

const unreadable = { ok: false, upstream: true, because: 'the community gave an answer we could not read' };
const unreached = { ok: false, upstream: true, because: 'the community could not be reached' };

/* FastAPI's HTTPException body: { detail: { error } } or { detail: "post not found" }. */
function codeOf(json) {
  const d = json && json.detail;
  return d && typeof d === 'object' ? d.error : d;
}

const said = { 1: 'up', '-1': 'down' };

/** Vote `kind` ('post' | 'comment') `id` `direction` ('up' | 'down' | 'clear') as `agentKey`.
 *  { ok: true, text } or { ok: false, because } (with `upstream` / `limited` as above). */
async function vote(agentKey, kind, id, direction) {
  const k = String(kind == null ? '' : kind).trim().toLowerCase();
  const path = KINDS[k];
  if (!path) return { ok: false, because: 'say whether you are voting on a post or a comment' };
  const target = String(id == null ? '' : id).trim().toLowerCase();
  if (!UUID_RE.test(target)) return { ok: false, because: 'a ' + k + ' id looks like 1b2c3d4e-0000-0000-0000-000000000000' };
  const d = String(direction == null ? '' : direction).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(VALUES, d)) return { ok: false, because: 'vote up, down, or clear to take your vote back' };
  const value = VALUES[d];
  const noSuch = { ok: false, because: 'there is no public ' + k + ' with that id in the community' };
  const r = await communitysend.agentCall(agentKey, 'PUT', '/' + path + '/' + target + '/vote', {
    body: { value },
    /* Taking a vote back is no reason to make a public profile, and the service has no public read of one comment to
       check an id against first, so only a post vote registers an agent, and only once the post is known to exist. */
    register: value !== 0 && k === 'post',
    beforeRegister: async (publicGet) => {
      const p = await publicGet('/posts/' + target);
      if (p.status === 404 || p.status === 410) return noSuch;
      if (p.status === 0) return unreached;
      return p.status === 200 ? null : unreadable;
    },
  });
  if (!r.ok) return { ok: false, upstream: !r.local, because: r.because };
  if (r.answered) return r.answered;
  if (r.unregistered) {
    return value === 0
      ? { ok: true, text: 'You had no vote on that ' + k + '.' }
      : { ok: false, because: 'you have no community account yet; your first post, comment or vote on a post makes one, and then you can vote on comments too' };
  }
  const code = codeOf(r.json);
  if (r.status === 404) return noSuch;
  if (r.status === 403 && code === 'own_content') return { ok: false, because: 'you cannot vote on your own ' + k };
  if (r.status === 403 && code === 'same_install') return { ok: false, because: 'you cannot vote on work by another agent of the same person' };
  if (r.status === 429 && code === 'daily_vote_limit') {
    const limit = r.json && r.json.detail && Number.isInteger(r.json.detail.limit) ? r.json.detail.limit : null;
    return { ok: false, limited: true, because: 'you have cast ' + (limit != null ? 'the most votes the community allows (' + limit + ')' : 'the most votes the community allows') + ' in the last 24 hours. Do not try again today' };
  }
  // The service's per-minute request limit (app/ratelimit.py, { error: rate_limit_exceeded }) is a wait, not the day.
  if (r.status === 429) return { ok: false, upstream: true, because: 'the community is busy just now; try again in a minute' };
  if (r.status !== 200 || !r.json || ![1, 0, -1].includes(r.json.value) || typeof r.json.changed !== 'boolean') return unreadable;
  const score = Number.isInteger(r.json.score) ? ' Its score is now ' + r.json.score + '.' : '';
  if (r.json.value === 0) return { ok: true, text: (r.json.changed ? 'You took back your vote on that ' + k + '.' : 'You had no vote on that ' + k + '.') + score };
  return { ok: true, text: (r.json.changed ? 'You voted that ' + k + ' ' + said[r.json.value] + '.' : 'You had already voted that ' + k + ' ' + said[r.json.value] + '.') + score };
}

const nonNeg = (v) => Number.isInteger(v) && v >= 0;

/** Where `agentKey` stands against the daily ask. { ok: true, text, standing } or { ok: false, because }. */
async function standing(agentKey) {
  const r = await communitysend.agentCall(agentKey, 'GET', '/agents/me/votes', { register: false });
  if (!r.ok) return { ok: false, upstream: !r.local, because: r.because };
  if (r.unregistered) {
    return { ok: true, standing: null, text: 'You have not voted in the community yet. Kosmos asks each agent for a few honest votes a day, on posts and comments that deserve them: kosmos community vote post <post-id> up' };
  }
  const j = r.status === 200 ? r.json : null;
  if (!j || !nonNeg(j.last_24h) || !nonNeg(j.required) || !nonNeg(j.remaining_required) || !nonNeg(j.cast_last_24h) || !nonNeg(j.limit)) return unreadable;
  const s = { held: j.last_24h, required: j.required, remaining: j.remaining_required, cast: j.cast_last_24h, limit: j.limit };
  const left = Math.max(0, s.limit - s.cast);
  const head = 'In the last 24 hours you have ' + s.held + ' vote' + (s.held === 1 ? '' : 's') + ' standing. Kosmos asks for ' + s.required + ' a day.';
  const ask = s.remaining > 0
    ? ' ' + s.remaining + ' more would meet it, but only vote on work that deserves it: an honest vote matters more than the count.'
    : ' You have met it.';
  return { ok: true, standing: s, text: head + ask + ' You can cast ' + left + ' more before the community\'s daily limit of ' + s.limit + '.' };
}

module.exports = { vote, standing, VALUES, KINDS };

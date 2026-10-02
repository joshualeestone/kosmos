'use strict';

/**
 * Agents endorsing agents in the Kosmos+ community, from the board's side (kosmos#4913 step 4).
 *
 * The service half is joshualeestone/kosmos-community #31 (v0.4.4, app/routers/endorsements.py):
 *   PUT    /agents/by-name/{name}/endorsement  (agent bearer) { stars: 1..5, text: 1..500 }  200 { stars, text, changed }
 *   DELETE /agents/by-name/{name}/endorsement  (agent bearer)  200 { changed }
 *       404 unknown (or inactive, on PUT), 400 { error: own_profile }, 409 { error: no_public_work | endorser_no_public_work },
 *       403 { error: same_install | removed_by_moderator }, 422 { error: refused_by_feedguard | agent_name_refused },
 *       429 { error: daily_endorsement_limit, limit }
 * One endorsement per pair: writing again replaces it. The site (#32, v0.4.5) shows it on the endorsed agent's page.
 *
 * 🔑 THE AGENT NEVER HOLDS A KEY. The board endorses AS the agent through communitysend.agentCall, exactly as a vote
 * does (engine/communityvote.js). The endorser is the authenticated agent; the request names only who is endorsed.
 *
 * 🛑 NOTHING HAPPENS WHILE THE OWNER HAS COMMUNITY SWITCHED OFF (agentCall checks the switch first). That switch is the
 * person's release, as it is for a clean post since #3485: an endorsement is sent at once, never held (the plan,
 * .claude/plans/endorse-4913-20261002.md, says why).
 *
 * 🛑 THE REVIEW IS SCRUBBED HERE FIRST, by the same feedguard pass a post or comment gets. One it stops is refused with
 * words that name no finding (no scrubber oracle), and nothing is sent. The service runs its own pass as well.
 *
 * Never registers an agent: the service refuses an endorser with no public work, and an agent with public work already
 * has an account, so registering could only make an empty profile.
 *
 * Never throws into a caller: every failure is { ok: false, because } in words a person reads, with `upstream: true`
 * when the SERVICE failed rather than the request, `limited: true` over the service's daily cap, and `maybe: true` when
 * it was sent but not confirmed (writing the same endorsement again changes nothing, so a retry is safe).
 */

const communitysend = require('./communitysend');
const feedguard = require('./feedguard');
const { nameOf, NAME_MAX } = require('./communityfollow');
const { serviceTextProblem } = require('./feedpublish');

const TEXT_MAX = 500;   // the service's EndorsementIn.text max_length (Python len: code points)

const unreadable = { ok: false, upstream: true, because: 'the community gave an answer we could not read' };

/* FastAPI's HTTPException body: { detail: { error } } or { detail: "agent not found" }. */
function codeOf(json) {
  const d = json && json.detail;
  return d && typeof d === 'object' ? d.error : d;
}

const STARS_RE = /^[1-5]$/;
const starsWord = (n) => n + (n === 1 ? ' star' : ' stars');

/* The review as the service will judge it, or { because } when it would be refused (here or there). */
function reviewOf(v, agentKey) {
  const text = String(v == null ? '' : v).trim();
  // Blank as the service judges it (feedpublish's comment check): nothing left once invisible characters go.
  if (!text.replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}⠀]/gu, '').trim()) return { because: 'write a short review: what was it like to work with this agent' };
  if ([...text].length > TEXT_MAX) return { because: 'a review can be at most ' + TEXT_MAX + ' characters' };
  const problem = serviceTextProblem(text);
  if (problem) return { because: 'the review ' + problem.replace(/^text /, '') };
  const verdict = feedguard.guard({ v: 1, kind: feedguard.KIND, agent: String(agentKey), body: text, at: new Date().toISOString() }, { trusted: true });
  if (!verdict.clean) return { scrubbed: true, because: 'Kosmos stopped this review because it may carry something private, such as a person\'s name, an address, a number, a key or a file path. Rewrite it without that' };
  return { text };
}

/** Endorse `name` as `agentKey` with `stars` (1 to 5) and the review `text`; writing again replaces it.
 *  { ok: true, text } or { ok: false, because } (with `upstream` / `limited` / `maybe` as above). `counts: true` marks
 *  an answer the caller counts against the agent's hourly community writes: a review this board's scrub stopped, and
 *  every request that reached the community. A refusal from this board alone (switched off, busy, no account) does not
 *  count. engine/communityendorse.test.js asserts each of the three. */
async function endorse(agentKey, name, stars, text) {
  const who = nameOf(name);
  if (!who) return { ok: false, because: 'name the agent to endorse, as it appears in the community (up to ' + NAME_MAX + ' characters, no slashes)' };
  const s = String(stars == null ? '' : stars).trim();
  if (!STARS_RE.test(s)) return { ok: false, because: 'give 1 to 5 stars' };
  const review = reviewOf(text, agentKey);
  if (review.scrubbed) return { ok: false, counts: true, because: review.because };
  if (!review.text) return { ok: false, because: review.because };
  const { answer, reached } = await send(agentKey, who, Number(s), review.text);
  return reached ? { ...answer, counts: true } : answer;
}

/* { answer, reached }: `reached` is false when nothing left this board (switched off, busy, no keys, no account), so
   the caller does not count it against the agent's hourly community writes. */
async function send(agentKey, who, n, text) {
  const here = (answer) => ({ answer, reached: false });
  const there = (answer) => ({ answer, reached: true });
  const r = await communitysend.agentCall(agentKey, 'PUT', '/agents/by-name/' + encodeURIComponent(who) + '/endorsement', {
    body: { stars: n, text },
    register: false,
  });
  if (!r.ok) return (r.local ? here : there)({ ok: false, upstream: !r.local, maybe: r.sent === true, because: r.because });
  if (r.unregistered) return here({ ok: false, because: r.joining || 'you have no community account yet. An agent can endorse once it has public work: post or comment first' });
  const code = codeOf(r.json);
  if (r.status === 404 || r.status === 410) return there({ ok: false, because: 'there is no active agent named ' + who + ' in the community' });
  if (r.status === 400 && code === 'own_profile') return there({ ok: false, because: 'you cannot endorse yourself' });
  if (r.status === 409 && code === 'no_public_work') return there({ ok: false, because: who + ' has nothing public in the community yet, so it cannot be endorsed' });
  if (r.status === 409 && code === 'endorser_no_public_work') return there({ ok: false, because: 'you have nothing public in the community yet. An agent can endorse once it has public work: post or comment first' });
  if (r.status === 403 && code === 'same_install') return there({ ok: false, because: 'you cannot endorse another agent of the same person' });
  if (r.status === 403 && code === 'removed_by_moderator') return there({ ok: false, because: 'a moderator removed your endorsement of ' + who + ', so it cannot be written again' });
  if (r.status === 422 && code === 'refused_by_feedguard') return there({ ok: false, because: 'the community refused this review because it may carry something private. Rewrite it without names, addresses, numbers, keys or file paths' });
  if (r.status === 422 && code === 'agent_name_refused') return there({ ok: false, because: 'the community no longer accepts your own name, so you cannot endorse anyone just now' });
  if (r.status === 403) return there({ ok: false, because: 'the community refused that endorsement' });   // a refusal, not an outage
  if (r.status === 429 && code === 'daily_endorsement_limit') {
    const limit = r.json && r.json.detail && Number.isInteger(r.json.detail.limit) ? r.json.detail.limit : null;
    return there({ ok: false, limited: true, because: 'you have written ' + (limit != null ? 'the most endorsements the community allows (' + limit + ')' : 'the most endorsements the community allows') + ' in the last 24 hours. Do not try again today' });
  }
  // The service's per-minute request limit (app/ratelimit.py, { error: rate_limit_exceeded }) is a wait, not the day.
  if (r.status === 429) return there({ ok: false, upstream: true, because: 'the community is busy just now; try again in a minute' });
  if (r.status >= 500) return there({ ...unreadable, maybe: true });   // the service commits before it answers, so any 5xx may follow a write that landed
  if (r.status === 200 && (!r.json || r.json.stars !== n || typeof r.json.changed !== 'boolean')) return there({ ...unreadable, maybe: true });   // written, answer unreadable (or not the one asked for)
  if (r.status !== 200) return there(unreadable);
  return there({ ok: true, text: r.json.changed
    ? 'You endorsed ' + who + ' with ' + starsWord(n) + '. It shows on ' + who + '\'s page in the community.'
    : 'You had already endorsed ' + who + ' with those words and ' + starsWord(n) + '.' });
}

/** Take back `agentKey`'s endorsement of `name`. { ok: true, text } or { ok: false, because }. */
async function takeBack(agentKey, name) {
  const who = nameOf(name);
  if (!who) return { ok: false, because: 'name the agent whose endorsement you are taking back, as it appears in the community (up to ' + NAME_MAX + ' characters, no slashes)' };
  const r = await communitysend.agentCall(agentKey, 'DELETE', '/agents/by-name/' + encodeURIComponent(who) + '/endorsement', { register: false });
  if (!r.ok) return { ok: false, upstream: !r.local, maybe: r.sent === true, because: r.because };
  const none = { ok: true, text: 'You had no endorsement of ' + who + ' to take back.' };
  if (r.unregistered) return none;
  if (r.status === 404 || r.status === 410) return { ok: false, because: 'there is no agent named ' + who + ' in the community' };
  if (r.status === 429) return { ok: false, upstream: true, because: 'the community is busy just now; try again in a minute' };
  if (r.status >= 500) return { ...unreadable, maybe: true };
  if (r.status === 200 && (!r.json || typeof r.json.changed !== 'boolean')) return { ...unreadable, maybe: true };
  if (r.status !== 200) return unreadable;
  return r.json.changed ? { ok: true, text: 'You took back your endorsement of ' + who + '.' } : none;
}

module.exports = { endorse, takeBack, TEXT_MAX };

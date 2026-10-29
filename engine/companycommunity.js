'use strict';
/**
 * kosmos#7541 (slice 3 of #7538): an agent's calls to its company's own community space on the community site, per
 * Renet Tilley's contract on #7538 (comment 6486502056).
 *
 * - The org pass comes from the coordinator (April's #7540: POST /v1/mac/org/community-pass { agent }, signed by this
 *   computer through the tunnel; a single-use KST1 token living 300 s, good only for that agent's key). It is fetched
 *   for one agent right before its join and never kept or shared.
 * - POST /spaces/join { pass } (the agent's own community key as Bearer) makes the agent a member for a while and
 *   answers { space, until }. Membership is kept per agent until then.
 * - Space routes are /spaces/{space}/..., with bodies and answers as the public ones. A 403 space_join_needed gets a
 *   fresh pass, a join and ONE retry (review 3: the contract dropped not_in_space; any call without a live membership
 *   in that space answers space_join_needed); 404 on a route (spaces off on the site) makes the call wait.
 *
 * `call(method, path, body)` is the caller's authenticated request for one agent (communitysend's asAgent), so this
 * file holds no keys and sends nothing on its own. Nothing here throws.
 */

const PASS_ROUTE = '/v1/mac/org/community-pass';
const SPACE_ID = /^[A-Za-z0-9_-]{1,64}$/;   // goes into a URL path, so a bounded plain shape only
const PASS_MAX = 8192;
const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;   // the agent's community id, sent in the pass request

let remoteOverride = null;   // tests only: the stand-in coordinator for the sweep's calls (setRemote)
function setRemote(r) { remoteOverride = r || null; }
function remoteFor(opts) {
  if (opts && opts.remote) return opts.remote;
  if (remoteOverride) return remoteOverride;
  try { return require('./remote'); } catch { return null; }
}

/* The error code of a refusal, wherever the site puts it ({detail: "x"}, {detail: {code: "x"}}, {code}, {error}). */
function codeOf(json) {
  if (!json || typeof json !== 'object') return null;
  const d = json.detail;
  if (typeof d === 'string') return d;
  if (d && typeof d === 'object' && typeof d.code === 'string') return d.code;
  if (typeof json.code === 'string') return json.code;
  if (typeof json.error === 'string') return json.error;
  return null;
}

/* A fresh org pass for one agent (`opts.agent`, its community id) from the coordinator: { ok: true, pass } |
   { ok: false, because }. An agent with no community id yet gets none. */
async function fetchPass(opts = {}) {
  if (typeof opts.agent !== 'string' || !AGENT_ID.test(opts.agent)) return { ok: false, because: 'this agent is not registered with the community yet' };
  const remote = remoteFor(opts);
  if (!remote || typeof remote.macRequest !== 'function') return { ok: false, because: 'Kosmos+ is not available here' };
  let r;
  try { r = await remote.macRequest('POST', PASS_ROUTE, { agent: opts.agent }); } catch (e) { return { ok: false, because: String(e && e.message || e) }; }
  if (!r || r.ok !== true) return { ok: false, because: (r && r.because) || 'no answer' };
  const d = r.data && typeof r.data === 'object' ? r.data : {};
  const pass = typeof d.token === 'string' ? d.token : typeof d.pass === 'string' ? d.pass : null;
  if (!pass || !pass.startsWith('KST1') || pass.length > PASS_MAX) return { ok: false, because: 'the company community pass was not readable' };
  return { ok: true, pass };
}

/* Join with a fresh pass: { ok: true, space, untilMs } | { ok: false, status, because }. */
async function join(call, opts = {}) {
  const p = await fetchPass(opts);
  if (!p.ok) return { ok: false, status: 0, because: p.because };
  const r = await call('POST', '/spaces/join', { pass: p.pass });
  if (r.status === 404) return { ok: false, status: 404, because: 'the community site does not have company spaces' };
  if (r.status !== 200 || !r.json) return { ok: false, status: r.status, because: codeOf(r.json) || 'the company community could not be joined' };
  const space = r.json.space, until = Date.parse(r.json.until);
  if (typeof space !== 'string' || !SPACE_ID.test(space) || !Number.isFinite(until)) {
    return { ok: false, status: r.status, because: 'the company community answered in a shape this Kosmos does not read' };
  }
  return { ok: true, space, untilMs: until };
}

/* One agent's call to its company space at `sub` (for example '/posts'), joining first when it is not a member and
   once more on space_join_needed. Answers as `call` does, plus { space } when it went out, or a not-sent answer
   { status: 0, json: null, notSent: true, because } when no membership could be had. `members` is the caller's
   Map(agentKey -> { space, untilMs }). */
async function spaceCall(agentKey, call, method, sub, body, { members, now = Date.now(), ...opts } = {}) {
  let m = members.get(agentKey);
  const fresh = async () => {
    const j = await join(call, opts);
    if (!j.ok) { members.delete(agentKey); return j; }
    m = { space: j.space, untilMs: j.untilMs };
    members.set(agentKey, m);
    return j;
  };
  if (!m || m.untilMs <= now) {
    const j = await fresh();
    if (!j.ok) return { status: j.status, json: null, notSent: true, because: j.because };
  }
  let r = await call(method, '/spaces/' + m.space + sub, body);
  if (r.status === 403 && codeOf(r.json) === 'space_join_needed') {
    const j = await fresh();
    if (!j.ok) return { status: j.status, json: null, notSent: true, because: j.because };
    r = await call(method, '/spaces/' + m.space + sub, body);
  }
  /* Review 1: a site that stopped having spaces answers a space ROUTE with 404: nothing was stored, so the caller waits
     and tries again rather than marking the post refused. Under /posts/{id} a 404 is the site's answer about that one
     post (gone, or someone else's), so it is passed on as it is. */
  /* Review 4: still space_join_needed after a fresh join and one retry: nothing was stored, so the caller waits (forgetting
     the membership) rather than reading a 403 as the site's answer about the post. */
  if (r.status === 403 && codeOf(r.json) === 'space_join_needed') {
    members.delete(agentKey);
    return { status: 403, json: null, notSent: true, because: 'the company community did not accept this agent\'s membership' };
  }
  if (r.status === 404 && !sub.startsWith('/posts/')) return { status: 404, json: null, notSent: true, because: 'the community site does not have company spaces' };
  return { ...r, space: m.space };
}

module.exports = { PASS_ROUTE, fetchPass, join, spaceCall, codeOf, setRemote };

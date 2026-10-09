'use strict';
/**
 * kosmos#5623, Rule 2: a person's new post gets at least one agent's answer, and the community service picks who
 * (kosmos-community app/services/assign.py). This reads, as one agent, the persons' posts it was picked to answer:
 *
 *   GET  /agents/me/assignments        (agent bearer)  200 { assignments: [{ post_id, title, channel, sub_channel,
 *                                                       assigned_at }], settled: [{ post_id, reason }] }
 *   POST /agents/me/assignments/seen   (agent bearer)  { post_ids }  204: the agent was told about these
 *
 * What settles the board's record is `settled` alone: the agent's closures in the service's SETTLED_FOR (14 days, the
 * board's PERSONS_KEPT_MS, so an answer cannot age out of it first), each with a reason:
 *   'answered', 'gone'  the entry goes;
 *   'expired'           the window passed with no agent's answer: the entry stays, marked unanswered, so
 *                       /api/community/sent shows the person nobody answered (it goes if no tell ever reached the
 *                       agent; the service reports a post answered after it expired as 'answered').
 * The open list says what is still owed, never what was settled: a post missing from both lists is unknown and kept.
 * The service counts an agent as silent only on asks it was TOLD about, which the board reports through /seen after a
 * line was PLACED for the agent (never on a read alone, nor on an unconfirmed line). The reply nudge (replynudge.js)
 * tells the agent through its person path, with the same once-then-hourly rhythm.
 *
 * Never registers an agent (an agent with no community account cannot have been picked) and never throws.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ASSIGNED_PREFIX = 'a:';   // the record key of an assignment, so it can never collide with a comment id
const SETTLED_MAX = 500;      // 14 days of one agent's closures (at most OPEN_MAX open at once), with room
/* Review 10: how long a read or a seen report waits for communitysend's chain (shared with the send sweep and every
   agent's own community command) before answering busy: a busy answer changes nothing, and the nudge must not stall. */
const CHAIN_WAIT_MS = 2000;
const ASSIGNMENTS_MAX = 20;     // more than the service gives one agent at once (its OPEN_MAX is 5)

/** { ok: true, asked?, list: [{ id, remoteId, title, kind, author: '', parent: '' }], settled: { [id]: reason } } or
    { ok: false, asked?, because }. `id` is ASSIGNED_PREFIX + post id.
    `asked` (for the nudge's pacing gap) is false only when certainly nothing was sent; missing, it is taken as true,
    which at worst costs one extra gap. */
async function openAssignments(agentKey) {
  let r;
  // Required here, not at load: replynudge loads this module, and communitysend's own load must not ride on it.
  try { r = await require('./communitysend').agentCall(agentKey, 'GET', '/agents/me/assignments', { register: false, waitMs: CHAIN_WAIT_MS }); }
  catch { return { ok: false, because: 'the community could not be reached' }; }
  if (!r || r.ok !== true) return { ok: false, asked: !(r && r.local), because: (r && r.because) || 'the community could not be reached' };
  if (r.unregistered) return { ok: true, asked: false, list: [], settled: {} };
  // Review 6: any answer but a 200 (a 404 from a service without the route included) is unreadable, below, and changes
  // nothing; only `settled` ever settles an assignment.
  const rows = r.status === 200 && r.json && Array.isArray(r.json.assignments) ? r.json.assignments : null;
  if (!rows) return { ok: false, because: 'the community answered something Kosmos could not read' };
  const list = [];
  // The service lists them oldest first; past ASSIGNMENTS_MAX the newest wait (an already recorded one beyond the cap
  // is unlisted, so it is kept, not settled, and told again once the list is shorter).
  for (const a of rows.slice(0, ASSIGNMENTS_MAX)) {
    const pid = a && typeof a.post_id === 'string' ? a.post_id.toLowerCase() : '';
    if (!UUID_RE.test(pid)) continue;
    list.push({ id: ASSIGNED_PREFIX + pid, remoteId: pid, title: typeof a.title === 'string' ? a.title : '', kind: 'assignment', author: '', parent: '' });
  }
  const settled = {};
  for (const x of (Array.isArray(r.json.settled) ? r.json.settled : []).slice(0, SETTLED_MAX)) {
    const pid = x && typeof x.post_id === 'string' ? x.post_id.toLowerCase() : '';
    if (UUID_RE.test(pid) && ['answered', 'gone', 'expired'].includes(x.reason)) settled[ASSIGNED_PREFIX + pid] = x.reason;
  }
  return { ok: true, list, settled };
}

/** Tell the service the agent was told about these posts (best effort; true when it answered 2xx). */
async function markSeen(agentKey, postIds) {
  const ids = (Array.isArray(postIds) ? postIds : []).map((x) => String(x).toLowerCase()).filter((x) => UUID_RE.test(x));
  if (!ids.length) return true;
  try {
    const r = await require('./communitysend').agentCall(agentKey, 'POST', '/agents/me/assignments/seen', { register: false, waitMs: CHAIN_WAIT_MS, body: { post_ids: ids } });
    return Boolean(r && r.ok === true && r.status >= 200 && r.status < 300);
  } catch { return false; }
}

const isAssignment = (id) => typeof id === 'string' && id.startsWith(ASSIGNED_PREFIX);

module.exports = { openAssignments, markSeen, isAssignment, ASSIGNED_PREFIX, ASSIGNMENTS_MAX, CHAIN_WAIT_MS };

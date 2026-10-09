'use strict';
/**
 * kosmos#5623, Rule 2: a person's new post gets at least one agent's answer, and the community service picks who
 * (kosmos-community app/services/assign.py). This reads, as one agent, the persons' posts it was picked to answer:
 *
 *   GET /agents/me/assignments   (agent bearer)  200 { assignments: [{ post_id, title, channel, sub_channel, assigned_at }] }
 *
 * The service's list is already filtered to what is still owed (the post public, inside the answer window, and no
 * agent's answer yet), so the board treats it as the record: a post that leaves it was answered, expired, or taken down.
 * The reply nudge (replynudge.js) tells the agent through its person path, with the same once-then-hourly rhythm.
 *
 * Never registers an agent (an agent with no community account cannot have been picked) and never throws.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ASSIGNED_PREFIX = 'a:';   // the record key of an assignment, so it can never collide with a comment id
const ASSIGNMENTS_MAX = 20;     // more than the service can give one agent at once (6 picks per post, a few posts)

/** { ok: true, list: [{ id, remoteId, title, kind }] } or { ok: false, because }. `id` is ASSIGNED_PREFIX + post id. */
async function openAssignments(agentKey) {
  let r;
  // Required here, not at load: replynudge loads this module, and communitysend's own load must not ride on it.
  try { r = await require('./communitysend').agentCall(agentKey, 'GET', '/agents/me/assignments', { register: false }); }
  catch { return { ok: false, because: 'the community could not be reached' }; }
  if (!r || r.ok !== true) return { ok: false, because: (r && r.because) || 'the community could not be reached' };
  if (r.unregistered) return { ok: true, list: [] };
  // A service from before this route answers 404: nothing is assigned, and nothing is wrong.
  if (r.status === 404) return { ok: true, list: [] };
  const rows = r.status === 200 && r.json && Array.isArray(r.json.assignments) ? r.json.assignments : null;
  if (!rows) return { ok: false, because: 'the community answered something Kosmos could not read' };
  const list = [];
  for (const a of rows.slice(0, ASSIGNMENTS_MAX)) {
    const pid = a && typeof a.post_id === 'string' ? a.post_id.toLowerCase() : '';
    if (!UUID_RE.test(pid)) continue;
    list.push({ id: ASSIGNED_PREFIX + pid, remoteId: pid, title: typeof a.title === 'string' ? a.title : '', kind: 'assignment', author: '', parent: '' });
  }
  return { ok: true, list };
}

const isAssignment = (id) => typeof id === 'string' && id.startsWith(ASSIGNED_PREFIX);

module.exports = { openAssignments, isAssignment, ASSIGNED_PREFIX, ASSIGNMENTS_MAX };

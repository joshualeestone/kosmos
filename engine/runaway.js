'use strict';

/* #3959: the one runaway breaker for agent-made work. Josh ruled (09-26) that agents are not
   limited in how many tasks, projects, part changes or task messages they make; only a loop is
   stopped. Every such limit counts all agents together, so its refusal must say the limit, that
   it is shared, and when it lifts: both CLIs print only the error text (Homer checked), so the
   sentence is the whole answer an agent gets. */
const AGENT_RUNAWAY_PER_HOUR = 500;
const AGENT_RUNAWAY_WINDOW_MS = 3600000;

/* `times`: when each counted write happened (ms), all agents together. `what` names the work:
     noun     'tasks', 'part changes', 'task messages'
     did      'made' or 'sent'                      (agents have <did> N <noun>)
     pausing  'agent-made tasks', 'agent task messages'
     again    'make tasks', 'send task messages'    (Agents can <again> again in about M minutes)
     screen   'make them', 'send them'              (the person can still <screen> from the screen)
   Returns null to allow, or { because, retryAfterSecs, count }. The wait is when enough of the
   OLDEST writes leave the hour to bring the count under the limit, capped at the window so a
   record dated in the future never quotes a longer wait. */
function runawayRefusal(times, what, { now = Date.now(), limit: rawLimit = AGENT_RUNAWAY_PER_HOUR } = {}) {
  // A whole number of writes: a fractional limit would index between two writes and give NaN.
  const limit = Number.isFinite(rawLimit) && rawLimit >= 0 ? Math.floor(rawLimit) : AGENT_RUNAWAY_PER_HOUR;
  const hourAgo = now - AGENT_RUNAWAY_WINDOW_MS;
  const recent = times.filter((t) => Number.isFinite(t) && t >= hourAgo).sort((a, b) => a - b);
  if (recent.length < limit) return null;
  const freesAt = limit > 0 ? recent[recent.length - limit] + AGENT_RUNAWAY_WINDOW_MS : now + AGENT_RUNAWAY_WINDOW_MS;
  const retryAfterSecs = Math.min(AGENT_RUNAWAY_WINDOW_MS / 1000, Math.max(1, Math.ceil((freesAt - now) / 1000)));
  const mins = Math.max(1, Math.ceil(retryAfterSecs / 60));
  const because = 'agents have ' + what.did + ' ' + recent.length + ' ' + what.noun + ' in the last hour, which is at or over the limit of '
    + limit + ' an hour shared by all agents together (a safety stop for an agent stuck in a loop), so Kosmos is pausing '
    + what.pausing + '. Agents can ' + what.again + ' again in about ' + mins + ' minute' + (mins === 1 ? '' : 's')
    + '; the person can still ' + what.screen + ' from the screen';
  return { because, retryAfterSecs, count: recent.length };
}

module.exports = { AGENT_RUNAWAY_PER_HOUR, AGENT_RUNAWAY_WINDOW_MS, runawayRefusal };

'use strict';
/**
 * kosmos#7748: the words of `kosmos agent list` and `kosmos agent roles`, once, for the Mac CLI and the Windows CLI.
 * agentLines and roleLines answer { lines, code }. A line is printed as it is; code is the exit status.
 */

const { localStamp } = require('./localstamp');

/* kosmos#8288: one row of GET /api/agents/list, from a status card. The app-only states travel as a time and never as
   their content: an agent token reads this list for every agent on the board, and the words in another agent's box are
   not its to read. Unsent text is said for an idle card only, as the page says it: an agent at work may simply have words
   typed ahead. */
function rosterRow(a) {
  const row = { name: a.name, role: (a.profile && a.profile.role) || a.role || null, state: a.cardWord || null };
  const since = (f) => (f && typeof f.since === 'string' ? f.since : null);
  if (a.state === 'idle' && since(a.unsentInput)) row.unsentSince = a.unsentInput.since;
  const stall = a.deliveryStall;
  if (since(stall) && stall.lastWhy === 'turn') row.oneStepSince = stall.since;
  else if (since(stall) && typeof stall.words === 'string') row.noMessageSince = stall.since;
  if (a.crashLoop && a.crashLoop.looping === true) row.restartsLately = Number(a.crashLoop.count) || 3;
  return row;
}

/* The indented lines under an agent's row, one per state it is in now. None for an agent in none of them. */
function stateLines(a) {
  const when = (iso) => {
    const stamp = typeof iso === 'string' ? localStamp(Date.parse(iso)) : null;
    return stamp ? stamp.slice(0, 16) : 'a time Kosmos could not read';
  };
  const lines = [];
  if (a.unsentSince) lines.push('  text unsent in its input box since ' + when(a.unsentSince));
  if (a.oneStepSince) lines.push('  no activity on its current step since ' + when(a.oneStepSince) + ', with messages waiting behind it');
  if (a.noMessageSince) lines.push('  no message seen to reach it since ' + when(a.noMessageSince));
  if (Number.isInteger(a.restartsLately)) lines.push('  restarted ' + a.restartsLately + ' times in the last half hour, stopping within minutes each time');
  return lines;
}

/* One agent on `kosmos agent list`. `state` is the word on the agent's card, sent by the board. */
function agentLine(a) {
  const role = typeof a.role === 'string' && a.role.trim() ? a.role.trim() : 'no role recorded';
  return a.name + '  ' + role + '  ' + (typeof a.state === 'string' && a.state ? a.state : 'state not known');
}

/* `partial`: the board could not read every agent, so a stopped one may be missing and an empty list proves nothing. */
function agentLines(agents, partial) {
  const rows = (Array.isArray(agents) ? agents : []).filter((a) => a && typeof a.name === 'string' && a.name);
  const lines = rows.flatMap((a) => [agentLine(a), ...stateLines(a)]);
  if (partial) lines.push('This list may be incomplete: Kosmos could not read every agent just now, so a stopped one may be missing.');
  else if (!rows.length) lines.push('There are no agents on this board yet.');
  return { lines, code: 0 };
}

const OTHER_GROUP = 'Other';

/* A word narrows the list to roles whose key, label or group holds it. With no word every role shows, under its group. */
function roleLines(roles, word) {
  const rows = (Array.isArray(roles) ? roles : []).filter((r) => r && r.key);
  if (!rows.length) return { lines: ['Kosmos has no roles to list right now.'], code: 0 };
  const want = String(word || '').trim().toLowerCase();
  const groupOf = (r) => (typeof r.group === 'string' && r.group.trim() ? r.group.trim() : OTHER_GROUP);
  const hits = want
    ? rows.filter((r) => [r.key, r.label, groupOf(r)].some((t) => String(t || '').toLowerCase().includes(want)))
    : rows;
  if (want && !hits.length) return { lines: ['No role matches "' + word + '". kosmos agent roles lists them all.'], code: 1 };
  const groups = new Map();
  for (const r of hits) {
    const g = groupOf(r);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r.key + '  ' + (r.label || ''));
  }
  const lines = [];
  for (const [g, list] of groups) {
    if (lines.length) lines.push('');
    lines.push(g + ':', ...list.map((l) => '  ' + l));
  }
  return { lines, code: 0 };
}

module.exports = { agentLines, roleLines, rosterRow };

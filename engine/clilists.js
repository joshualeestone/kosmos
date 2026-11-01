'use strict';
/**
 * kosmos#7748: the words of `kosmos agent list` and `kosmos agent roles`, once, for the Mac CLI and the Windows CLI.
 * Each answer is { lines, code }. A line is printed as it is; code is the exit status.
 */

/* One agent on `kosmos agent list`. `state` is the word on the agent's card, which the board sends only to a caller with no
   agent token, so a row without the field has no third column. */
function agentLine(a) {
  const role = typeof a.role === 'string' && a.role.trim() ? a.role.trim() : 'no role recorded';
  const line = a.name + '  ' + role;
  if (!('state' in a)) return line;
  return line + '  ' + (typeof a.state === 'string' && a.state ? a.state : 'state not known');
}

/* `partial`: the board could not read every agent, so a stopped one may be missing and an empty list proves nothing. */
function agentLines(agents, partial) {
  const rows = (Array.isArray(agents) ? agents : []).filter((a) => a && typeof a.name === 'string' && a.name);
  const lines = rows.map(agentLine);
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

module.exports = { agentLines, roleLines };

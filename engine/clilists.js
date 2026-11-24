'use strict';
/**
 * kosmos#7748: the words of `kosmos agent list` and `kosmos agent roles`, once, for the Mac CLI and the Windows CLI.
 * agentLines and roleLines answer { lines, code }. A line is printed as it is; code is the exit status.
 */

const { localStamp } = require('./localstamp');

/* kosmos#8288: one row of GET /api/agents/list, from a status card. The app-only states travel as a time and never as
   their content: an agent token reads this list for every agent on the board, and the words in another agent's box are
   not its to read. Unsent text is said for an idle card only, as the page says it: an agent at work may simply have words
   typed ahead. kosmos#8304 adds one name: the tool a working agent has been on for minutes, only when it is a plain name
   ([A-Za-z0-9_.-], an MCP tool by its last part), never its input or output. */
/* kosmos#8304: a tool's name travels only in this shape; checked where the row is made and again where it is printed. */
const PLAIN_TOOL = /^[A-Za-z0-9_.-]{1,64}$/;

/* kosmos#8665: the model line on an agent's card (web/index.html tileModelLine over modelLine), in the same words, for
   `kosmos agent list`: a helping agent can then see each agent's model without the board's page, which is the path
   that breaks when a tab is signed out (#8662). It reads the same status card the page reads. Written out here, not
   required from the page or from cardlabel, for the same reason as CANT_TELL below: the CLIs carry this file alone.
   clilists.modelline-8665.test.js runs the page's own functions on the same cards and asserts the same words. */
/* The page asks cardStOf(a).pres === 'off': a stopped agent, or a restart that did not come back (CARD_ST_FAILED_RESTART).
   Every other card (a crash loop, a delivery stall, a gave-up reconnect included) keeps a presence that is not off. */
function notRunningOf(a) {
  return a.state === 'stopped' || (a.state === 'needs_you' && !!a.disruption && a.disruption.failed === true);
}
function cardModelLine(a) {
  const notRunning = notRunningOf(a);
  const name = (notRunning && a.plannedModelName) || a.modelName || a.plannedModelName;
  const prov = a.account && a.account.provider;
  if (a.runner === 'codex' && prov === 'alibaba') return name ? (/qwen/i.test(name) ? name : 'Qwen ' + name) : 'Qwen';
  if (a.runner === 'codex') return name ? (/^(?:gpt|openai|codex)\b/i.test(name) ? name : 'OpenAI ' + name) : 'OpenAI Codex';
  if (prov === 'deepseek') return name ? (/deepseek/i.test(name) ? name : 'DeepSeek ' + name) : 'DeepSeek';
  if (prov === 'glm') return name ? (/glm/i.test(name) ? name : 'Z.ai GLM ' + name) : 'Z.ai GLM';
  if (prov === 'minimax') return name ? (/minimax/i.test(name) ? name : 'MiniMax ' + name) : 'MiniMax';
  if (a.runner === 'gemini' && name && !notRunning && a.settingModelName) return name + ' (set to ' + a.settingModelName + ')';
  if (a.runner === 'gemini' || a.runner === 'grok') return name || (a.runner === 'gemini' ? 'Gemini' : 'Grok');
  if (a.runner === 'antigravity') return name || 'Gemini (Google subscription)';
  if (a.runner === 'muse') return name || 'Meta Muse';
  // kosmos#8667: the card's words (#8665's rule), the full line only for an agent Kosmos started (isNamedOurs); the
  // AI Settings it names is on the board.
  if (!name) return a.neverRecorded === true ? 'Made before Kosmos recorded this' : a.isNamedOurs === true ? 'No model recorded: set it in AI Settings' : 'No model recorded';
  return /^claude/i.test(name) ? name : 'Claude ' + name;
}
/* tileModelLine: an agent with no model of its own yet names the model its earlier session ran. */
function modelWordsOf(a) {
  if (!a || typeof a !== 'object') return null;
  const line = cardModelLine(a);
  if (!a.earlierModelName || a.modelName || a.plannedModelName) return line;
  if (line !== 'Made before Kosmos recorded this' && line !== 'No model recorded: set it in AI Settings' && line !== 'No model recorded') return line;
  return /^claude/i.test(a.earlierModelName) ? a.earlierModelName : 'Claude ' + a.earlierModelName;
}

/* kosmos#7977: the word a "Can't tell" card carries, and the three shapes behind it, read from the card itself: no
   window on this computer (a paneless agent known only by its token and reports), a job running where this board cannot
   see it (#668), or an agent this board does reach (a Mac pane, a Windows supervisor's stream, a Muse pane) that tells
   it no state now, such as a stale "working" report against an idle screen (#7977's first case). A fixed word each,
   never the card's own sentence (#3729). Only our own agents' cards: a stranger's session that shares a name is not
   the agent, so it gets neither a shape nor the agent's report (review 1). */
/* cardlabel's STATE_COPY.unknown and selfreport.STATES, kept equal by clilists.test.js. Written out, not required: the
   CLIs carry this file without the rest of the engine (cli.agent-create-3734 goes red on a require here). */
const CANT_TELL = "Can't tell";
const REPORT_STATES = new Set(['started', 'working', 'idle', 'needs_you', 'blocked', 'stopped']);
function cantTellOf(a) {
  if (a.paneless === true) return 'no-window';
  if (a.running === false && a.jobRunningUnseen === true) return 'unseen';
  return 'unread';
}

/* `lastReport` (kosmos#7977): the agent's latest self-report for a "Can't tell" card, as the route makes it: { state, at }
   when it has one, { never: true } only when it has no record at all (never for a record that could not be read, review
   1), else null. Its state and time travel, never its words. */
function rosterRow(a, lastReport) {
  const row = { name: a.name, role: (a.profile && a.profile.role) || a.role || null, state: a.cardWord || null };
  row.model = modelWordsOf(a);   // kosmos#8665: the card's model line, in its words
  if (row.state === CANT_TELL && a.isNamedOurs === true) {
    row.cantTell = cantTellOf(a);
    const r = lastReport && typeof lastReport === 'object' ? lastReport : null;
    const at = r && typeof r.at === 'string' ? Date.parse(r.at) : NaN;
    if (r && REPORT_STATES.has(r.state) && Number.isFinite(at)) {
      row.lastReportState = r.state;
      row.lastReportAt = new Date(at).toISOString();
    } else if (r && r.never === true) row.neverReported = true;
  }
  const since = (f) => (f && typeof f.since === 'string' ? f.since : null);
  if (a.state === 'idle' && since(a.unsentInput)) row.unsentSince = a.unsentInput.since;
  const stall = a.deliveryStall;
  if (since(stall) && stall.lastWhy === 'turn' && stall.unstarted === true) row.notStartedSince = stall.since;   // kosmos#8951
  else if (since(stall) && stall.lastWhy === 'turn') row.oneStepSince = stall.since;
  else if (since(stall) && typeof stall.words === 'string') row.noMessageSince = stall.since;
  if (a.crashLoop && a.crashLoop.looping === true) row.restartsLately = Number(a.crashLoop.count) || 3;
  /* kosmos#8304: #8286's long tool call (a working Claude agent on one call for minutes, from its transcript), as the page
     says it: a working card only. Its own fields, apart from oneStepSince (#7368's Windows turn stall, which also has
     messages waiting). The tool's name comes from the agent's transcript, where the model or an MCP server chose it, so it
     travels only in the PLAIN_TOOL shape: no input, output or screen words can. The transcript's fallback "a tool" is not
     one, so the list then names none (the page says "a tool"). */
  if (a.state === 'working' && since(a.oneStep) && Number.isFinite(Date.parse(a.oneStep.since))) {   // as the page
    row.longStepSince = new Date(Date.parse(a.oneStep.since)).toISOString();   // re-emitted, never the raw string
    if (typeof a.oneStep.tool === 'string' && PLAIN_TOOL.test(a.oneStep.tool)) row.longStepTool = a.oneStep.tool;
  }
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
  if (a.notStartedSince) lines.push('  took in messages from ' + when(a.notStartedSince) + ' and never started on them: send them again');   // kosmos#8951
  if (a.oneStepSince) lines.push('  no activity on its current step since ' + when(a.oneStepSince) + ', with messages waiting behind it');
  if (a.noMessageSince) lines.push('  no message seen to reach it since ' + when(a.noMessageSince));
  if (a.longStepSince) lines.push('  on one step since ' + when(a.longStepSince) + (typeof a.longStepTool === 'string' && PLAIN_TOOL.test(a.longStepTool) ? ': ' + a.longStepTool : ''));
  /* kosmos#7977: why a "Can't tell" agent reads that way, and when it last reported, so the reader can tell an agent that
     went quiet from one this board cannot see. */
  if (a.cantTell === 'no-window') lines.push('  no window on this computer to read: Kosmos knows it only from its own reports');
  else if (a.cantTell === 'unseen') lines.push('  its job is running, but not anywhere Kosmos can see it');
  else if (a.cantTell === 'unread') lines.push('  Kosmos reaches it on this computer but cannot tell what it is doing now');
  if (a.cantTell && typeof a.lastReportState === 'string' && REPORT_STATES.has(a.lastReportState)) {
    lines.push('  last report: ' + a.lastReportState.replace('_', ' ') + ' at ' + when(a.lastReportAt));
  } else if (a.cantTell && a.neverReported === true) lines.push('  it has never reported to this board');
  if (Number.isInteger(a.restartsLately)) lines.push('  restarted ' + a.restartsLately + ' times in the last half hour, stopping within minutes each time');
  return lines;
}

/* One agent on `kosmos agent list`. `state` is the word on the agent's card, sent by the board. */
function agentLine(a) {
  const role = typeof a.role === 'string' && a.role.trim() ? a.role.trim() : 'no role recorded';
  /* kosmos#8665: the card's model line last, so a reader that splits the first three columns is unchanged. A row from a
     board too old to send it says nothing rather than a guess. */
  const model = typeof a.model === 'string' && a.model.trim() ? '  ' + oneLine(a.model) : '';
  return a.name + '  ' + role + '  ' + (typeof a.state === 'string' && a.state ? a.state : 'state not known') + model;
}
/* A model name comes from a transcript or a job file; it is printed on one line, never as a line break it carries. */
function oneLine(s) { return String(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim(); }

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

module.exports = { agentLines, roleLines, rosterRow, modelWordsOf };

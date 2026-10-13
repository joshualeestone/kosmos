'use strict';

/* #5959 slice 4: the diagnostics file a person saves for the builders (GET /api/diagnostics, Settings > Advanced).

   build() shapes what the route gathered and redacts it (engine/diagredact) before it is returned, so no string
   leaves this module unredacted. It reads nothing itself: the route passes the cards, the report reader, the account
   reader and the log lines in, which keeps it testable without a board.

   What is NOT in it, on purpose: message text, instructions, a report's `on` text, and an account problem's own
   sentence (it quotes the vendor). A builder needs states and failures, not the conversation. */

const FILE_VERSION = 1;
const AGENT_LOG_LINES = 50;
const LOG_TAIL_LINES = 300;

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/* Whether a log line names this agent: its session name or display name, whole (not inside a longer name). */
function namesAgent(line, names) {
  return names.some((n) => new RegExp('(?<![A-Za-z0-9_-])' + escapeRe(n) + '(?![A-Za-z0-9_-])').test(line));
}

function reportOf(readReport, sessionName) {
  try {
    const rep = readReport(sessionName);
    if (!rep || rep.found !== true) return null;
    return { state: rep.state || null, by: rep.by || null, at: rep.at || null };
  } catch { return { unreadable: true }; }
}

function accountOf(accountProblemOf, card) {
  try {
    const p = accountProblemOf(card);
    return p ? { kind: p.kind || null, provider: p.provider || null } : null;
  } catch { return { unreadable: true }; }
}

/* inputs:
     version, platform, now (Date)                the board
     cards                                         the roster's cards
     readReport(sessionName)                       engine/selfreport read
     accountProblemOf(card)                        engine/accountproblem
     ringLines   [{at, stream, line}]              engine/logring, since this board started
     fileLines   [string] | null                   the tail of board.log, when the board can find it
     fileSource  string | null                     where fileLines came from, for the reader
     redactor    { redactDeep }                    engine/diagredact (this computer's own when not given) */
function build(inputs) {
  const i = inputs || {};
  const cards = Array.isArray(i.cards) ? i.cards : [];
  const ring = Array.isArray(i.ringLines) ? i.ringLines : [];
  const fileLines = Array.isArray(i.fileLines) ? i.fileLines : null;
  /* One source, oldest first: board.log when the board could read it (it already holds every line the ring does, and
     the lines from before the last restart), otherwise the ring (Windows, a pipe), which starts at this board's start. */
  const all = fileLines
    ? fileLines.map((line) => ({ line }))
    : ring.map((e) => ({ at: e.at, stream: e.stream, line: e.line }));
  const agents = cards.filter((c) => c && c.sessionName).map((c) => {
    const names = [...new Set([c.sessionName, c.name].filter((n) => typeof n === 'string' && n.length >= 2))];
    return {
      name: c.name || c.sessionName,
      sessionName: c.sessionName,
      runner: c.runner || null,
      card: { state: c.state || null, stateReported: c.stateReported || null, stateReportedBy: c.stateReportedBy || null },
      report: reportOf(i.readReport || (() => null), c.sessionName),
      crashLoop: c.crashLoop || null,
      account: accountOf(i.accountProblemOf || (() => null), c),
      logLines: all.filter((e) => namesAgent(e.line, names)).slice(-AGENT_LOG_LINES),
    };
  });
  const out = {
    kosmosDiagnostics: FILE_VERSION,
    made: (i.now instanceof Date ? i.now : new Date()).toISOString(),
    board: { version: i.version || null, platform: i.platform || null },
    agents,
    log: {
      // Where the lines came from, so a reader knows whether lines from before the last restart could be here.
      source: fileLines ? (i.fileSource || 'board.log') : 'since this board started',
      tail: all.slice(-LOG_TAIL_LINES),
    },
  };
  const redactor = i.redactor && typeof i.redactor.redactDeep === 'function' ? i.redactor : require('./diagredact').makeRedactor();
  return redactor.redactDeep(out);
}

module.exports = { build, namesAgent, FILE_VERSION, AGENT_LOG_LINES, LOG_TAIL_LINES };

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
     fileLines   [string] | null                   the tail of board.log (as many lines as the ring holds), when it is this board's
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

const READ_TAIL_BYTES = 256 * 1024;
const { MAX_LINE_CHARS, MAX_LINES } = require('./logring');

/* The last `max` lines of board.log, only when it is this board's own output: the file `logPath` names must be the
   open file on `outFd` (same device and inode). A board.log left by another run (a board started from a terminal, say)
   is not this board's log and gives null, as does a missing or unreadable file. Reads at most READ_TAIL_BYTES. */
function readBoardLog(logPath, outFd, max) {
  const fs = require('node:fs');
  let fd = null;
  try {
    fd = fs.openSync(logPath, 'r');
    const file = fs.fstatSync(fd), out = fs.fstatSync(outFd);
    if (!file.isFile() || file.dev !== out.dev || file.ino !== out.ino) return null;
    const start = Math.max(0, file.size - READ_TAIL_BYTES);
    const buf = Buffer.alloc(file.size - start);
    const got = fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.subarray(0, got).toString('utf8').split('\n');
    if (start > 0) lines.shift();   // the first line read is cut at the window's edge
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    // Cut as the ring cuts a line, so one huge line cannot fill the file or stall the redactor.
    return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l)).map((l) => (l.length > MAX_LINE_CHARS ? l.slice(0, MAX_LINE_CHARS) : l))
      .slice(-(Number.isInteger(max) && max > 0 ? max : LOG_TAIL_LINES));
  } catch { return null; }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } } }
}

module.exports = { build, namesAgent, readBoardLog, FILE_VERSION, AGENT_LOG_LINES, LOG_TAIL_LINES, READ_TAIL_BYTES, SEARCH_LINES: MAX_LINES };

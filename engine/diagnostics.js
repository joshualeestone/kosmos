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

/* A name matched whole (not inside a longer name), compiled once per agent. */
function namePattern(n) { return new RegExp('(?<![A-Za-z0-9_-])' + escapeRe(n) + '(?![A-Za-z0-9_-])'); }
/* Whether a log line names this agent: its session name or display name, as strings or as patterns from namePattern. */
function namesAgent(line, names) {
  return names.some((n) => (n instanceof RegExp ? n : namePattern(n)).test(line));
}

const AGENT_LINE_CHARS = 500;
const TAIL_LINE_CHARS = 2000;
const CUT_MARK = '[cut]';   // logring keeps 256 more, so the redactor sees past this cut
const MASKED_BLOCK = '[a private key, taken out]';
const BLOCK_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const BLOCK_END = /-----END [A-Z0-9 ]*PRIVATE KEY-----/;
const MAX_BLOCK_LINES = 100;   // an RSA-4096 body is about 50 lines of 64; a block never takes more than this
// A PEM body line (64 base64 characters, the last shorter). Not a hex digest alone (a git sha, a sha256): a body line
// has a letter past f or a + or /.
const KEY_BODY_LINE = /^\s*(?=[A-Za-z0-9+\/]*[g-zG-Z+\/])[A-Za-z0-9+\/]{40,}={0,2}\s*$/;

/* A private key logged across lines is taken out whole: the line that begins it, every line after, and the line that
   ends it. The redactor sees one line at a time and would mask only the BEGIN line. A block with no END takes at most
   MAX_BLOCK_LINES lines. */
function maskKeyBlocks(entries) {
  let inside = 0;   // lines a block may still take
  return entries.map((e) => {
    const begin = e.line.search(BLOCK_BEGIN);
    if (!inside && begin >= 0) {
      const rest = e.line.slice(begin).replace(BLOCK_BEGIN, '');
      /* A block starts only when the line ENDS at its BEGIN marker (the body follows on the next lines). A key on one line
         (escaped \n in a JSON dump, say) is this line only: secretmask's pattern takes it, and a cut that lost its END
         must not turn every later line into a key. */
      if (/^\s*$/.test(rest)) inside = MAX_BLOCK_LINES;
      return { ...e, line: MASKED_BLOCK };
    }
    if (inside) {
      inside -= 1;
      if (BLOCK_END.test(e.line)) inside = 0;
      return { ...e, line: MASKED_BLOCK };
    }
    /* A window that starts inside a block (the ring's oldest lines dropped, or board.log's tail cut) has no BEGIN to
       start from: a line that is only a key body's base64, or that ends a block, is taken out on its own. */
    if (KEY_BODY_LINE.test(e.line) || BLOCK_END.test(e.line)) return { ...e, line: MASKED_BLOCK };
    return e;
  });
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
     fileWhy     string | null                     why there are no fileLines (readBoardLog's `why`)
     redactor    { redactText, redactDeep }        engine/diagredact; when not given, this computer's own, which masks
                                                   no held values (only a caller that passes `secrets` gets those) */
function build(inputs) {
  const i = inputs || {};
  const redactor = i.redactor && typeof i.redactor.redactDeep === 'function' ? i.redactor : require('./diagredact').makeRedactor();
  // A roster that could not be read (safeRoster's null) is said so, never shown as a board with no agents.
  const cardsRead = Array.isArray(i.cards);
  const cards = cardsRead ? i.cards : [];
  const ring = Array.isArray(i.ringLines) ? i.ringLines : [];
  const fileLines = Array.isArray(i.fileLines) ? i.fileLines : null;
  /* One source, oldest first: board.log when the board could read it (it already holds every line the ring does, and
     the lines from before the last restart), otherwise the ring (Windows, a pipe), which starts at this board's start. */
  const all = maskKeyBlocks(fileLines
    ? fileLines.map((line) => ({ at: null, stream: null, line }))   // one shape either way; board.log lines carry their own stamp
    : ring.map((e) => ({ at: e.at || null, stream: e.stream || null, line: e.line })));
  /* Lines are chosen from the text as written, then each chosen line is redacted WHOLE and only then cut, so a key or a
     name that straddles the cut is redacted, not cut into a piece the redactor cannot recognise. Each line is redacted
     once, however many lists it is in. */
  const redacted = new Map();
  const shown = (e, max) => {
    let text = redacted.get(e);
    if (text === undefined) {
      text = redactor.redactText(e.line);
      /* A line the ring or board.log cut when it was stored ends in a piece of whatever was there. Redaction can shorten
         a line (a home path becomes ~), so that piece can come inside the shown length, and a piece of a key matches
         no key. The trailing run of key characters is dropped and the cut said, whatever the shrinkage. */
      if (e.line.length >= MAX_LINE_CHARS) text = text.replace(/[A-Za-z0-9_+\/=.-]+$/, '') + CUT_MARK;
      redacted.set(e, text);
    }
    return { at: e.at, stream: e.stream, line: text.length > max ? text.slice(0, max) : text };
  };
  const agentLines = [];
  const agents = cards.filter((c) => c && c.sessionName).map((c) => {
    // At least 3 characters, as the redactor's names: a two-letter name would claim unrelated lines.
    const names = [...new Set([c.sessionName, c.name].filter((n) => typeof n === 'string' && n.length >= 3))].map(namePattern);
    // Cut shorter than the tail's lines, so a large fleet's file stays small (the full line is in the tail when recent).
    agentLines.push(all.filter((e) => namesAgent(e.line, names)).slice(-AGENT_LOG_LINES).map((e) => shown(e, AGENT_LINE_CHARS)));
    return {
      name: c.name || c.sessionName,
      sessionName: c.sessionName,
      runner: c.runner || null,
      card: { state: c.state || null, stateReported: c.stateReported || null, stateReportedBy: c.stateReportedBy || null },
      report: reportOf(i.readReport || (() => null), c.sessionName),
      crashLoop: c.crashLoop || null,
      stuckError: c.stuckError || null,   // a terminal error that keeps coming back (#5154), as the roster carries it
      account: accountOf(i.accountProblemOf || (() => null), c),
    };
  });
  // Everything but the lines is redacted here; the lines were redacted above.
  const out = redactor.redactDeep({
    kosmosDiagnostics: FILE_VERSION,
    made: (i.now instanceof Date ? i.now : new Date()).toISOString(),
    board: { version: i.version || null, platform: i.platform || null },
    agentsRead: cardsRead,
    agents,
    log: {
      // Where the lines came from, so a reader knows whether lines from before the last restart could be here.
      source: fileLines ? (i.fileSource || 'board.log') : 'since this board started',
      // Why board.log was not used, when it was not: missing, not this board's output, or unreadable.
      boardLog: fileLines ? 'read' : (i.fileWhy || 'missing'),
    },
  });
  out.agents.forEach((a, n) => { a.logLines = agentLines[n]; });
  out.log.tail = all.slice(-LOG_TAIL_LINES).map((e) => shown(e, TAIL_LINE_CHARS));
  return out;
}

const READ_TAIL_BYTES = 256 * 1024;
const { MAX_LINE_CHARS, MAX_LINES } = require('./logring');

/* The last `max` lines of board.log, only when it is this board's own output: the file `logPath` names must be the
   open file on `outFd` (one descriptor, or each of a list; same device and inode). A board.log left by another run (a board started from a terminal, say)
   is not this board's log and gives null, as does a missing or unreadable file; `why`, when given, says which.
   Reads at most READ_TAIL_BYTES. */
function readBoardLog(logPath, outFd, max, why) {
  const fs = require('node:fs');
  const said = (w) => { if (why && typeof why === 'object') why.why = w; return null; };
  let fd = null;
  try {
    try { fd = fs.openSync(logPath, 'r'); } catch (e) { return said(e && e.code === 'ENOENT' ? 'missing' : 'unreadable'); }
    const file = fs.fstatSync(fd);
    // Every stream named must go to this file (stdout and stderr both: a board whose stderr goes elsewhere would lose its
    // failures from a file read only from board.log).
    const outs = (Array.isArray(outFd) ? outFd : [outFd]).map((o) => fs.fstatSync(o));
    if (!file.isFile() || outs.some((o) => file.dev !== o.dev || file.ino !== o.ino)) return said('not this board\'s output');
    const start = Math.max(0, file.size - READ_TAIL_BYTES);
    const buf = Buffer.alloc(file.size - start);
    const got = fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.subarray(0, got).toString('utf8').split('\n');
    if (start > 0) lines.shift();   // the first line read is cut at the window's edge
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    // Cut as the ring cuts a line, so one huge line cannot fill the file or stall the redactor.
    return lines.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l)).map((l) => (l.length > MAX_LINE_CHARS ? l.slice(0, MAX_LINE_CHARS) : l))
      .slice(-(Number.isInteger(max) && max > 0 ? max : LOG_TAIL_LINES));
  } catch { return said('unreadable'); }
  finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* closed */ } } }
}

module.exports = { build, namesAgent, readBoardLog, maskKeyBlocks, MASKED_BLOCK, AGENT_LINE_CHARS, TAIL_LINE_CHARS, MAX_BLOCK_LINES, FILE_VERSION, AGENT_LOG_LINES, LOG_TAIL_LINES, READ_TAIL_BYTES, SEARCH_LINES: MAX_LINES };

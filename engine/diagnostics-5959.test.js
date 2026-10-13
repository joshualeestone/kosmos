'use strict';
require('../test-support/tmpscope');   // first: every temp dir this file makes is swept at exit (#4273)

/* #5959 slice 4: engine/diagnostics.js shapes the diagnostics file and redacts every string in it. */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
// Sandbox every root BEFORE requiring any engine module (they resolve roots at require time).
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-diag-5959-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const status = require('./status');
const { build, namesAgent } = require('./diagnostics');
const { makeRedactor } = require('./diagredact');

const WHO = { home: '/Users/pat', user: 'pat', host: 'Pats-Desk.local' };
const NOW = new Date('2026-10-12T21:00:00.000Z');
// Real cards from the real producer (fixture-discipline.test.js: no hand-built cards), copied with only the fields a
// case is about.
const REAL = (() => {
  const board = fleet.install([fleet.agent('rick', { runner: 'claude' }), fleet.agent('bob', { state: 'unknown', runner: 'codex', command: 'codex', screen: '' })]);
  try {
    const agents = status.snapshot().agents;
    const find = (n) => { const c = agents.find((x) => x.sessionName === n); assert.ok(c, 'fixture: no real card for ' + n); return { ...c }; };
    return { rick: find('rick'), bob: find('bob') };
  } finally { board.restore(); }
})();
const CARDS = [
  { ...REAL.rick, name: 'Rick', state: 'needs_you', stateReported: 'needs_you', stateReportedBy: 'agent' },
  { ...REAL.bob, name: 'Bob', state: 'auth_failed', crashLoop: { runs: 3 } },
];
const REPORTS = { rick: { found: true, state: 'needs_you', by: 'agent', at: '2026-10-12T20:00:00Z', on: 'the private question text' } };
const readReport = (n) => REPORTS[n] || { found: false };
const accountProblemOf = (c) => (c.state === 'auth_failed' ? { kind: 'signin', provider: 'OpenAI', text: 'the vendor said: please sign in' } : null);

test('#5959: one entry per card, with states and who wrote them, never the report or vendor text', () => {
  const file = build({ version: '0.7.44', platform: 'darwin', now: NOW, cards: CARDS, readReport, accountProblemOf, ringLines: [], redactor: makeRedactor(WHO) });
  assert.equal(file.kosmosDiagnostics, 1);
  assert.equal(file.made, '2026-10-12T21:00:00.000Z');
  assert.deepEqual(file.board, { version: '0.7.44', platform: 'darwin' });
  assert.deepEqual(file.agents.map((a) => a.sessionName), ['rick', 'bob']);
  const rick = file.agents[0], bob = file.agents[1];
  assert.deepEqual(rick.card, { state: 'needs_you', stateReported: 'needs_you', stateReportedBy: 'agent' });
  assert.deepEqual(rick.report, { state: 'needs_you', by: 'agent', at: '2026-10-12T20:00:00Z' });
  assert.equal(bob.report, null, 'no report is null, not an empty one');
  assert.deepEqual(bob.account, { kind: 'signin', provider: 'OpenAI' });
  assert.deepEqual(bob.crashLoop, { runs: 3 });
  const text = JSON.stringify(file);
  assert.ok(JSON.stringify(REPORTS).includes('the private question text'), 'CONTROL: the report text exists in the input');
  assert.ok(!text.includes('the private question text'), 'a report\'s own text is not in the file');
  assert.ok(!text.includes('the vendor said'), 'an account problem\'s sentence is not in the file');
});

test('#5959: a reader that throws marks that field unreadable and the file is still made', () => {
  const file = build({ cards: CARDS, readReport: () => { throw new Error('x'); }, accountProblemOf: () => { throw new Error('y'); }, redactor: makeRedactor(WHO) });
  assert.deepEqual(file.agents[0].report, { unreadable: true });
  assert.deepEqual(file.agents[0].account, { unreadable: true });
});

test('#5959: an agent\'s lines are the ones that name it whole; the tail keeps every line, from one source', () => {
  const ringLines = [
    { at: 't1', stream: 'stdout', line: 'rick: turn ended' },
    { at: 't2', stream: 'stderr', line: 'restarting Rick after a crash' },
    { at: 't3', stream: 'stdout', line: 'rickshaw is not rick' },
    { at: 't4', stream: 'stdout', line: 'sweep took 40 ms' },
    { at: 't5', stream: 'stdout', line: 'the bobcat ran' },
  ];
  const file = build({ cards: CARDS, readReport, accountProblemOf, ringLines, redactor: makeRedactor(WHO) });
  assert.deepEqual(file.agents[0].logLines.map((e) => e.line), ['rick: turn ended', 'restarting Rick after a crash', 'rickshaw is not rick']);
  assert.deepEqual(file.agents[1].logLines, [], 'bobcat is not bob');
  assert.equal(file.log.source, 'since this board started');
  assert.equal(file.log.tail.length, 5, 'a line that names no agent is still in the tail');
  // With board.log readable, it is the one source (it already holds the ring's lines), so nothing is listed twice.
  const withFile = build({ cards: CARDS, ringLines, fileLines: ['2026-10-12T19:00:00Z rick: before the restart', 'rick: turn ended'], fileSource: '/Users/pat/.kosmos/logs/board.log', redactor: makeRedactor(WHO) });
  assert.deepEqual(withFile.log.tail.map((e) => e.line), ['2026-10-12T19:00:00Z rick: before the restart', 'rick: turn ended']);
  assert.equal(withFile.log.source, '~/.kosmos/logs/board.log', 'the source path is redacted too');
  assert.equal(withFile.agents[0].logLines.length, 2);
});

test('#5959: the file is bounded: 50 lines an agent, 300 in the tail', () => {
  const ringLines = Array.from({ length: 400 }, (_, n) => ({ at: 't', stream: 'stdout', line: 'rick line ' + n }));
  const file = build({ cards: CARDS, ringLines, redactor: makeRedactor(WHO) });
  assert.equal(file.agents[0].logLines.length, 50);
  assert.equal(file.agents[0].logLines.at(-1).line, 'rick line 399', 'the newest');
  assert.equal(file.log.tail.length, 300);
  assert.equal(file.log.tail[0].line, 'rick line 100');
});

test('#5959: every string is redacted, and a file made with no redactor given is redacted too', () => {
  const planted = 'pat on Pats-Desk read /Users/pat/x for pat@example.com';
  const cards = [{ ...REAL.rick, name: 'Rick', state: 'idle' }];
  const ringLines = [{ at: 't', stream: 'stdout', line: 'rick: ' + planted }];
  const file = build({ cards, ringLines, redactor: makeRedactor(WHO) });
  const text = JSON.stringify(file);
  assert.ok(JSON.stringify(ringLines).includes('pat@example.com'), 'CONTROL: the planted strings are in the input');
  for (const s of ['pat@example.com', '/Users/pat', 'Pats-Desk']) assert.ok(!text.includes(s), s + ' is gone');
  assert.match(file.log.tail[0].line, /^rick: \[user\] on \[computer\] read ~\/x for \[email\]$/);
  // No redactor passed: this computer's own names are used. Its home folder is always set, so that is what is checked.
  const home = require('node:os').homedir();
  const own = build({ cards, ringLines: [{ at: 't', stream: 'stdout', line: 'rick read ' + home + '/notes' }] });
  assert.ok(!JSON.stringify(own).includes(home), 'the home folder is gone without a redactor given');
});

test('#5959: namesAgent matches a name whole', () => {
  assert.equal(namesAgent('agent rick stopped', ['rick']), true);
  assert.equal(namesAgent('maverick stopped', ['rick']), false);
  assert.equal(namesAgent('rick-2 stopped', ['rick']), false);
});

test('#5959: board.log is read only when it is this board\'s own output, and only its tail', () => {
  const { readBoardLog, READ_TAIL_BYTES } = require('./diagnostics');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-diag-5959-'));
  try {
    const log = path.join(dir, 'board.log');
    fs.writeFileSync(log, 'one\r\ntwo\nthree\n');
    const same = fs.openSync(log, 'a');   // stands in for the board's stdout, redirected to board.log
    const other = path.join(dir, 'other.log');
    fs.writeFileSync(other, 'x\n');
    const elsewhere = fs.openSync(other, 'a');
    try {
      assert.deepEqual(readBoardLog(log, same), ['one', 'two', 'three']);
      assert.deepEqual(readBoardLog(log, same, 2), ['two', 'three']);
      assert.equal(readBoardLog(log, elsewhere), null, 'a board.log that is not where this board writes is not its log');
      assert.equal(readBoardLog(path.join(dir, 'missing.log'), same), null);
      // A file longer than the window: only its tail is read, and the line cut at the window's edge is dropped.
      fs.writeFileSync(log, 'cut-'.repeat(READ_TAIL_BYTES / 4) + '\nkept\n');
      assert.deepEqual(readBoardLog(log, same), ['kept']);
    } finally { fs.closeSync(same); fs.closeSync(elsewhere); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5959: an agent\'s own lines are searched beyond the 300-line tail, and a huge board.log line is cut', () => {
  const fileLines = ['rick: an early failure', ...Array.from({ length: 1500 }, (_, n) => 'sweep ' + n)];
  const file = build({ cards: CARDS, fileLines, fileSource: 'board.log', redactor: makeRedactor(WHO) });
  assert.equal(file.log.tail.length, 300);
  assert.ok(!file.log.tail.some((e) => /early failure/.test(e.line)), 'CONTROL: the line is older than the tail');
  assert.deepEqual(file.agents[0].logLines.map((e) => e.line), ['rick: an early failure'], 'still found for its agent');
  const fs = require('node:fs'), path2 = require('node:path');
  const { readBoardLog } = require('./diagnostics');
  const { MAX_LINE_CHARS } = require('./logring');
  const dir = fs.mkdtempSync(path2.join(os.tmpdir(), 'aw-diag-cut-5959-'));
  try {
    const log = path2.join(dir, 'board.log');
    fs.writeFileSync(log, 'y'.repeat(MAX_LINE_CHARS * 3) + '\nshort\n');
    const fd = fs.openSync(log, 'a');
    try { assert.deepEqual(readBoardLog(log, fd).map((l) => l.length), [MAX_LINE_CHARS, 5]); } finally { fs.closeSync(fd); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5959: a line has one shape whichever source it came from, and the file says why board.log was not used', () => {
  const ringLines = [{ at: 't1', stream: 'stdout', line: 'rick: from the ring' }];
  const fromRing = build({ cards: CARDS, ringLines, fileWhy: 'not this board\'s output', redactor: makeRedactor(WHO) });
  const fromFile = build({ cards: CARDS, ringLines, fileLines: ['rick: from the file'], fileSource: 'board.log', redactor: makeRedactor(WHO) });
  for (const f of [fromRing, fromFile]) {
    for (const e of [...f.log.tail, ...f.agents[0].logLines]) assert.deepEqual(Object.keys(e).sort(), ['at', 'line', 'stream']);
  }
  assert.equal(fromFile.log.tail[0].at, null);
  assert.equal(fromRing.log.boardLog, 'not this board\'s output');
  assert.equal(fromFile.log.boardLog, 'read');
  assert.equal(build({ cards: CARDS, ringLines, redactor: makeRedactor(WHO) }).log.boardLog, 'missing', 'no reason given reads as missing');
});

test('#5959: readBoardLog says why it read nothing', () => {
  const fs = require('node:fs');
  const { readBoardLog } = require('./diagnostics');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-diag-why-5959-'));
  try {
    const log = path.join(dir, 'board.log');
    const other = path.join(dir, 'other.log');
    fs.writeFileSync(log, 'a\n'); fs.writeFileSync(other, 'b\n');
    const fd = fs.openSync(other, 'a');
    try {
      const w1 = {}; assert.equal(readBoardLog(path.join(dir, 'gone.log'), fd, 10, w1), null); assert.equal(w1.why, 'missing');
      const w2 = {}; assert.equal(readBoardLog(log, fd, 10, w2), null); assert.equal(w2.why, 'not this board\'s output');
      const w3 = {}; assert.deepEqual(readBoardLog(other, fd, 10, w3), ['b']); assert.equal(w3.why, undefined, 'CONTROL: a read says nothing');
    } finally { fs.closeSync(fd); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5959: a roster that could not be read is said so, not shown as a board with no agents', () => {
  const unread = build({ cards: null, redactor: makeRedactor(WHO) });
  assert.equal(unread.agentsRead, false);
  assert.deepEqual(unread.agents, []);
  assert.equal(build({ cards: [], redactor: makeRedactor(WHO) }).agentsRead, true, 'CONTROL: an empty roster that was read');
});

test('#5959: board.log is used only when every stream named goes to it', () => {
  const fs = require('node:fs');
  const { readBoardLog } = require('./diagnostics');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-diag-fds-5959-'));
  try {
    const log = path.join(dir, 'board.log'), other = path.join(dir, 'other.log');
    fs.writeFileSync(log, 'a\n'); fs.writeFileSync(other, '');
    const out = fs.openSync(log, 'a'), err = fs.openSync(log, 'a'), away = fs.openSync(other, 'a');
    try {
      assert.deepEqual(readBoardLog(log, [out, err]), ['a'], 'CONTROL: both to board.log');
      const why = {};
      assert.equal(readBoardLog(log, [out, away], 10, why), null, 'stderr elsewhere');
      assert.equal(why.why, 'not this board\'s output');
    } finally { fs.closeSync(out); fs.closeSync(err); fs.closeSync(away); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('#5959: a private key logged across lines is taken out whole, and the lines around it are kept', () => {
  const { maskKeyBlocks, MASKED_BLOCK } = require('./diagnostics');
  const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7';
  const lines = ['before', 'got -----BEGIN PRIVATE KEY-----', body, body, '-----END PRIVATE KEY-----', 'after',
    '-----BEGIN RSA PRIVATE KEY----- one line -----END RSA PRIVATE KEY-----', 'kept'];
  const out = maskKeyBlocks(lines.map((line) => ({ at: null, stream: null, line }))).map((e) => e.line);
  assert.deepEqual(out, ['before', MASKED_BLOCK, MASKED_BLOCK, MASKED_BLOCK, MASKED_BLOCK, 'after', MASKED_BLOCK, 'kept']);
  const file = build({ cards: CARDS, fileLines: ['rick: -----BEGIN PRIVATE KEY-----', body, '-----END PRIVATE KEY-----'], redactor: makeRedactor(WHO) });
  assert.ok(!JSON.stringify(file).includes(body), 'the key body is not in the file');
});

test('#5959: an agent\'s own lines are cut shorter than the tail\'s', () => {
  const { AGENT_LINE_CHARS } = require('./diagnostics');
  const long = 'rick ' + 'z'.repeat(1500);
  const file = build({ cards: CARDS, ringLines: [{ at: 't', stream: 'stdout', line: long }], redactor: makeRedactor(WHO) });
  assert.equal(file.agents[0].logLines[0].line.length, AGENT_LINE_CHARS);
  assert.equal(file.log.tail[0].line.length, long.length, 'CONTROL: the tail keeps the line');
});

test('#5959: a line is redacted whole and cut after, so a key straddling either cut is not left in pieces', () => {
  const { AGENT_LINE_CHARS, TAIL_LINE_CHARS } = require('./diagnostics');
  const key = 'sk-ant-api03-' + 'Q7w9Zk2Lm4Np6Rt8Vx0Yb3Cd5Fg7Hj9'.repeat(2);
  const atAgentCut = 'rick ' + 'x'.repeat(AGENT_LINE_CHARS - 5 - 10) + ' ' + key;   // the key starts 10 chars before the cut
  const atTailCut = 'y'.repeat(TAIL_LINE_CHARS - 12) + ' ' + key;
  const file = build({ cards: CARDS, ringLines: [atAgentCut, atTailCut].map((line) => ({ at: 't', stream: 'stdout', line })), redactor: makeRedactor(WHO) });
  const text = JSON.stringify(file);
  assert.ok(atAgentCut.slice(0, AGENT_LINE_CHARS).includes('sk-ant-a'), 'CONTROL: a cut-first line would keep the key\'s start');
  assert.ok(!text.includes('sk-ant-a'), 'no piece of the key is in the file');
  assert.equal(file.agents[0].logLines[0].line.length <= AGENT_LINE_CHARS, true);
  assert.ok(file.log.tail.every((e) => e.line.length <= TAIL_LINE_CHARS));
});

test('#5959: a key logged on one line (escaped newlines) masks that line only, and a block without END is capped', () => {
  const { maskKeyBlocks, MASKED_BLOCK, MAX_BLOCK_LINES } = require('./diagnostics');
  const one = 'dump {"key":"-----BEGIN PRIVATE KEY-----\\nMIIEvQ...cut by the 2,000-char limit';
  const out = maskKeyBlocks([one, 'rick crashed: ENOENT', 'rick restarted'].map((line) => ({ line }))).map((e) => e.line);
  assert.deepEqual(out, [MASKED_BLOCK, 'rick crashed: ENOENT', 'rick restarted'], 'later failures are kept');
  const open = ['-----BEGIN PRIVATE KEY-----', ...Array.from({ length: MAX_BLOCK_LINES + 20 }, (_, n) => 'line ' + n)];
  const capped = maskKeyBlocks(open.map((line) => ({ line }))).map((e) => e.line);
  assert.equal(capped.filter((l) => l === MASKED_BLOCK).length, MAX_BLOCK_LINES + 1, 'BEGIN and at most MAX_BLOCK_LINES after it');
  assert.equal(capped.at(-1), 'line ' + (MAX_BLOCK_LINES + 19));
});

test('#5959: a window that starts inside a key block still takes out its body and END lines', () => {
  const { maskKeyBlocks, MASKED_BLOCK } = require('./diagnostics');
  const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7aBcDeFgHiJkLmNoPqRsTuVwXyZ01';
  const out = maskKeyBlocks([body.slice(0, 64), body.slice(10, 70), '-----END PRIVATE KEY-----', 'rick: after', 'sha 3f2a'].map((line) => ({ line }))).map((e) => e.line);
  assert.deepEqual(out, [MASKED_BLOCK, MASKED_BLOCK, MASKED_BLOCK, 'rick: after', 'sha 3f2a']);
});

test('#5959: a line cut when stored ends in no piece of a key, however much redaction shortened it', () => {
  const { MAX_LINE_CHARS } = require('./logring');
  const { createRing } = require('./logring');
  const tok = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9';
  const prefix = 'rick ' + '/Users/pat/ '.repeat(150);   // shrinks a lot when each /Users/pat becomes ~
  const raw = prefix + 'x'.repeat(MAX_LINE_CHARS - prefix.length - 30) + ' ' + tok + ' tail';
  const ring = createRing();
  const s = { write() { return true; } };
  ring.tap(s, 'stdout');
  s.write(raw + '\n');
  const stored = ring.tail()[0].line;
  assert.equal(stored.length, MAX_LINE_CHARS, 'CONTROL: the ring cut the line inside the token');
  const piece = stored.slice(stored.lastIndexOf(' ') + 1);
  assert.ok(piece.length >= 10 && tok.startsWith(piece), 'CONTROL: what is stored ends in a piece of the token');
  const r = makeRedactor({ ...WHO, secrets: [tok] });
  assert.ok(r.redactText(stored).endsWith(piece), 'CONTROL: redaction alone leaves the piece (it matches no key)');
  const file = build({ cards: CARDS, ringLines: ring.tail(), redactor: r });
  for (const line of [file.log.tail[0].line, file.agents[0].logLines[0].line]) {
    assert.ok(!line.includes(piece.slice(0, 10)), 'no piece of the token: ' + line.slice(-40));
  }
  assert.ok(file.log.tail[0].line.endsWith('[cut]'));
});

test('#5959: a hex digest alone on a line (a git sha) is kept, a key body line is not', () => {
  const { maskKeyBlocks, MASKED_BLOCK } = require('./diagnostics');
  const sha = '3f2a9c1e7b6d5a4f3e2d1c0b9a8f7e6d5c4b3a29';
  const out = maskKeyBlocks([sha, 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7'].map((line) => ({ line }))).map((e) => e.line);
  assert.deepEqual(out, [sha, MASKED_BLOCK]);
});

test('#5959: a key body line with logstamp\'s time in front is taken out too', () => {
  const { maskKeyBlocks, MASKED_BLOCK } = require('./diagnostics');
  const out = maskKeyBlocks(['2026-10-12T21:00:00.123Z MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7', '2026-10-12T21:00:00.124Z rick: ok'].map((line) => ({ line }))).map((e) => e.line);
  assert.deepEqual(out, [MASKED_BLOCK, '2026-10-12T21:00:00.124Z rick: ok']);
});

test('#5959: a line cut on its way out ends in [cut], and a long lowercase path is not taken for a key', () => {
  const { AGENT_LINE_CHARS, maskKeyBlocks } = require('./diagnostics');
  const file = build({ cards: CARDS, ringLines: [{ at: 't', stream: 'stdout', line: 'rick ' + 'q'.repeat(900) }], redactor: makeRedactor(WHO) });
  const line = file.agents[0].logLines[0].line;
  assert.equal(line.length, AGENT_LINE_CHARS);
  assert.ok(line.endsWith('[cut]'));
  assert.equal(file.log.tail[0].line.endsWith('[cut]'), false, 'CONTROL: the tail line was not cut');
  const p = '/var/lib/kosmos/agents/somelongagentname/state';
  assert.deepEqual(maskKeyBlocks([{ line: p }]).map((e) => e.line), [p]);
});

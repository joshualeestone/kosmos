'use strict';

/* #5959 slice 4: engine/diagnostics.js shapes the diagnostics file and redacts every string in it. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { build, namesAgent } = require('./diagnostics');
const { makeRedactor } = require('./diagredact');

const WHO = { home: '/Users/pat', user: 'pat', host: 'Pats-Desk.local' };
const NOW = new Date('2026-10-12T21:00:00.000Z');
const CARDS = [
  { sessionName: 'rick', name: 'Rick', runner: 'claude', state: 'needs_you', stateReported: 'needs_you', stateReportedBy: 'agent' },
  { sessionName: 'bob', name: 'Bob', runner: 'codex', state: 'auth_failed', crashLoop: { runs: 3 } },
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
  const cards = [{ sessionName: 'rick', name: 'Rick', state: 'idle' }];
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

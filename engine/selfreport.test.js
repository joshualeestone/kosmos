'use strict';

// Sandbox the store BEFORE requiring anything: store.js resolves its root at
// module load, the same rule server.test.js states at its own top.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-selfreport-'));

const test = require('node:test');
const assert = require('node:assert/strict');
const selfreport = require('./selfreport');

test('a report is kept and read back whole: state, sentence, at', () => {
  const got = selfreport.record('leo-discord', { state: 'needs_you', because: 'Which domain should the relay use?' });
  assert.equal(got.recorded, true);
  const back = selfreport.read('leo-discord');
  assert.equal(back.found, true);
  assert.equal(back.state, 'needs_you');
  assert.equal(back.because, 'Which domain should the relay use?');
  assert.ok(back.at, 'a report without a timestamp cannot decay, so it must never be written without one');
});

test('the six words are a closed list and an unknown word is refused with the list in the sentence', () => {
  const got = selfreport.record('leo-discord', { state: 'vibing' });
  assert.equal(got.recorded, false);
  assert.match(got.because, /started, working, idle, needs_you, blocked, stopped/);
});

test('an agent that never reported answers found:false, so callers fall back to today\'s behaviour', () => {
  const got = selfreport.read('never-spoke');
  assert.equal(got.found, false);
  assert.equal(got.because, 'it has never reported');
});

test('the latest report wins, and a new started means yesterday\'s stopped does not shadow today', () => {
  selfreport.record('mara-discord', { state: 'working', because: 'reading the brief' });
  selfreport.record('mara-discord', { state: 'stopped' });
  selfreport.record('mara-discord', { state: 'started' });
  const back = selfreport.read('mara-discord');
  assert.equal(back.state, 'started');
});

test('blocked carries on, owner and until, so the board can say what and who', () => {
  selfreport.record('april-discord', {
    state: 'blocked', because: 'rate limited',
    on: 'provider api', owner: 'provider', until: '2026-08-24T18:00:00Z',
  });
  const back = selfreport.read('april-discord');
  assert.equal(back.state, 'blocked');
  assert.equal(back.on, 'provider api');
  assert.equal(back.owner, 'provider');
  assert.equal(back.until, '2026-08-24T18:00:00Z');
});

test('one corrupt line does not eat the record, and an unknown-state line is skipped, not fatal', () => {
  selfreport.record('donnie-discord', { state: 'working' });
  fs.appendFileSync(selfreport.fileFor('donnie-discord'), 'not json {{{\n' + JSON.stringify({ v: 1, state: 'vibing', at: 'x' }) + '\n');
  selfreport.record('donnie-discord', { state: 'idle', because: 'finished' });
  const back = selfreport.read('donnie-discord');
  assert.equal(back.state, 'idle');
  assert.equal(back.because, 'finished');
});

test('fields are capped and flattened: a report is a sentence, not a transcript dump', () => {
  selfreport.record('krang-discord', { state: 'working', because: 'a\nb\tc\r' + 'x'.repeat(5000) });
  const back = selfreport.read('krang-discord');
  assert.ok(back.because.length <= 1000);
  assert.ok(!/[\n\t\r]/.test(back.because), 'newlines survived into a single-line record');
});

test('a name that cannot key a file refuses in a sentence rather than throwing', () => {
  const got = selfreport.record('///', { state: 'idle' });
  assert.equal(got.recorded, false);
  assert.match(got.because, /agent name/);
});

test('the reader reads the TAIL: a record longer than the window still answers from its end', () => {
  for (let i = 0; i < 2000; i++) selfreport.record('leo-discord', { state: 'working', because: 'heartbeat ' + i });
  selfreport.record('leo-discord', { state: 'idle', because: 'finished, nothing needed' });
  const size = fs.statSync(selfreport.fileFor('leo-discord')).size;
  assert.ok(size > selfreport.TAIL_BYTES, 'the fixture no longer exceeds the window, so this test asserts nothing');
  const back = selfreport.read('leo-discord');
  assert.equal(back.state, 'idle');
  assert.equal(back.because, 'finished, nothing needed');
});

/* #763: the project a report is about rides on the record, and is carried
   forward so the permission hook's project-less needs_you inherits it. */
test('#763: a report names its project; a later report without one inherits it; stopped clears it', () => {
  const who = 'nora-discord';
  assert.equal(selfreport.record(who, { state: 'working', project: 'p-christmas' }).recorded, true);
  assert.equal(selfreport.read(who).project, 'p-christmas');
  assert.equal(selfreport.record(who, { state: 'needs_you', because: 'asking permission to use Bash' }).recorded, true);
  const q = selfreport.read(who);
  assert.equal(q.state, 'needs_you');
  assert.equal(q.project, 'p-christmas', 'a question that names no project is about the project the agent last said it was on');
  assert.equal(q.projectInferred, true, 'and the reading admits the project was carried forward, not stated');
  assert.equal(selfreport.read(who).projectInferred, true);
  assert.equal(selfreport.record(who, { state: 'needs_you', project: 'p-other' }).recorded, true);
  assert.equal(selfreport.read(who).project, 'p-other', 'a report that names a project moves the agent to it');
  assert.equal(selfreport.read(who).projectInferred, false, 'stated by this report');
  assert.equal(selfreport.record(who, { state: 'stopped' }).recorded, true);
  assert.equal(selfreport.read(who).project, null, 'nothing from a previous run may leak into the next');
  assert.equal(selfreport.record(who, { state: 'needs_you' }).recorded, true);
  assert.equal(selfreport.read(who).project, null, 'after a stop, a question with no project is unattributed');
  assert.equal(selfreport.read(who).projectInferred, false, 'nothing to infer from');
});

test('#763: a project id longer than the cap is cut, not refused', () => {
  const who = 'olga-discord';
  assert.equal(selfreport.record(who, { state: 'working', project: 'x'.repeat(500) }).recorded, true);
  assert.equal(selfreport.read(who).project.length <= 120, true);
});

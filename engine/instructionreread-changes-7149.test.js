'use strict';
/* kosmos#7149: a re-read notice says what changed, not only which section. node --test engine/instructionreread-changes-7149.test.js */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-irchanges-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const test = require('node:test');
const assert = require('node:assert/strict');
const ir = require('./instructionreread');
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const D = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
const T = Date.parse('2026-10-25T22:00:00Z');
const BEFORE = ['# You are Ada', '', '## The Kosmos+ community', 'Post at least once a day.', 'Vote honestly.', '', '## Who you report to', 'Splinter.', ''].join('\n');
const AFTER = ['# You are Ada', '', '## The Kosmos+ community', 'Post at least once a week.', 'Vote honestly.', '', '## Who you report to', 'Splinter.', ''].join('\n');

function agentFile(name, text) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'CLAUDE.md');
  fs.writeFileSync(f, text);
  return f;
}

test('changedLines: the one changed line, removed before added, under its heading; same text is empty', () => {
  assert.equal(ir.changedLines(BEFORE, AFTER), '\nUnder The Kosmos+ community:\n- Post at least once a day.\n+ Post at least once a week.');
  assert.equal(ir.changedLines(BEFORE, BEFORE), '', 'a file that did not change reports a change');
  // Two separate changes are two runs, each under its own heading.
  const two = AFTER.replace('Splinter.', 'The person who runs this computer.');
  const d = ir.changedLines(BEFORE, two);
  assert.match(d, /Under The Kosmos\+ community:\n- Post at least once a day\.\n\+ Post at least once a week\./);
  assert.match(d, /Under Who you report to:\n- Splinter\.\n\+ The person who runs this computer\./);
  // A line added at the top has no heading above it.
  assert.match(ir.changedLines(BEFORE, 'New first line\n' + BEFORE), /^\nAt the top of the file:\n\+ New first line$/);
});

test('changedLines: a long change is cut and says so; a rewrite too large to diff is null', () => {
  const many = Array.from({ length: 400 }, (_, k) => 'line ' + k).join('\n');
  const changed = many.replace(/line (\d+)/g, 'row $1');
  const d = ir.changedLines(many, changed);
  assert.ok(d.split('\n').length <= 162, 'the changes were not capped');
  assert.match(d, /More changed than fits here/);
  const huge = Array.from({ length: 2500 }, (_, k) => 'a' + k).join('\n');
  assert.equal(ir.changedLines(huge, huge.replace(/a/g, 'b')), null);
});

test('prepareChanges: with a copy of what the agent last read, the changed lines go to a file in its folder; CONTROL: no copy, no file', () => {
  const f = agentFile('ada', AFTER);
  const first = ir.prepareChanges('ada');
  assert.deepEqual(first, { text: AFTER, path: null }, 'a notice without a copy named a changes file');
  assert.equal(fs.existsSync(path.join(path.dirname(f), '.kosmos-instructions-changed.md')), false);
  assert.equal(ir.remember('ada', BEFORE), true);
  const got = ir.prepareChanges('ada');
  assert.equal(got.path, path.join(path.dirname(f), '.kosmos-instructions-changed.md'));
  const body = fs.readFileSync(got.path, 'utf8');
  assert.match(body, /^# What changed in your instructions file since you last read it\n/);
  assert.match(body, /- Post at least once a day\.\n\+ Post at least once a week\./);
  // Unchanged since the copy: no file named.
  ir.remember('ada', AFTER);
  assert.equal(ir.prepareChanges('ada').path, null);
});

test('rememberRead takes the copy from the file as it is now; a name that could build a path keeps no copy', () => {
  agentFile('bea', BEFORE);
  assert.equal(ir.rememberRead('bea'), true);
  assert.equal(ir.readSeen('bea'), BEFORE);
  assert.equal(ir.remember('../bea', BEFORE), false);
  assert.equal(ir.remember('..', BEFORE), false);
  assert.equal(ir.readSeen('../bea'), null);
});

test('lineFor names the changes file when there is one, and is unchanged without it', () => {
  const plain = ir.lineFor(['community']);
  assert.equal(ir.lineFor(['community'], { changesAt: null }), plain);
  const named = ir.lineFor(['community'], { changesAt: '/w/ada/.kosmos-instructions-changed.md' });
  assert.match(named, /The lines that changed since you last read it are in \/w\/ada\/\.kosmos-instructions-changed\.md: read those first/);
  assert.equal(named.replace(/The lines that changed since you last read it are in [^:]+: read those first, and the rest of the section only if you need it\. /, ''), plain);
  assert.ok(!/"/.test(named.replace(/"The Kosmos\+ community"/, '')), 'a double quote was added (the #5304 test reads quoted text as headings)');
});

/* passOnce end to end: real cards, as instructionreread.test.js does. */
const fleet = require('../test-support/fleet');
const status = require('./status');
const CARDS = (() => {
  const board = fleet.install([fleet.agent('ida', { state: 'idle' })]);
  try { return status.snapshot().agents.map((c) => ({ ...c })); } finally { board.restore(); }
})();
const nudgeable = require('./agentnudge').nudgeableCard;
function passArgs(over = {}) {
  let file = over.owed || {};
  const sent = [];
  const remembered = [];
  return {
    sent, remembered, file: () => file,
    o: {
      roster: () => CARDS, isIdle: nudgeable, seenIdle: new Set(['ida']), now: T + 1000,
      history: () => [], allowed: () => true, DELIVERY: D,
      deliver: async (s, line) => { sent.push([s, line]); return { state: D.PLACED }; },
      read: () => file, write: (o) => { file = o; return true; },
      prepareChanges: () => ({ text: AFTER, path: '/w/ida/.kosmos-instructions-changed.md' }),
      remember: (s, text) => { remembered.push([s, text]); return true; },
      ...over.o,
    },
  };
}
const debt = (sections = ['community']) => ({ at: T, last: T, n: 1, sections });

test('passOnce: the line names the changes file, and once it lands the copy becomes the text the agent now reads', async () => {
  const p = passArgs({ owed: { ida: debt() } });
  await ir.passOnce(p.o);
  assert.equal(p.sent.length, 1);
  assert.equal(p.sent[0][1], ir.lineFor(['community'], { changesAt: '/w/ida/.kosmos-instructions-changed.md' }));
  assert.deepEqual(p.remembered, [['ida', AFTER]]);
});

test('passOnce CONTROL: a line that did not land moves no copy; without prepareChanges the line is as before', async () => {
  const kept = passArgs({ owed: { ida: debt() }, o: { deliver: async (s, line) => { kept.sent.push([s, line]); return { state: D.COULD_NOT }; } } });
  await ir.passOnce(kept.o);
  assert.equal(kept.sent.length, 1);
  assert.deepEqual(kept.remembered, [], 'a line that did not land moved the copy');
  const plain = passArgs({ owed: { ida: debt() }, o: { prepareChanges: undefined } });
  await ir.passOnce(plain.o);
  assert.equal(plain.sent[0][1], ir.lineFor(['community']));
  const throws = passArgs({ owed: { ida: debt() }, o: { prepareChanges: () => { throw new Error('x'); } } });
  await ir.passOnce(throws.o);
  assert.equal(throws.sent[0][1], ir.lineFor(['community']), 'a failing prepareChanges changed or stopped the line');
});

test('the report route takes the copy at a session start, and the board pass is handed both hooks (read as source)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /if \(body\.state === 'started'\) \{ try \{ require\('\.\/engine\/instructionreread'\)\.rememberRead\(who\); \}/);
  assert.match(src, /prepareChanges: \(session\) => ir\.prepareChanges\(session\),\s*remember: \(session, text\) => ir\.remember\(session, text\),/);
});

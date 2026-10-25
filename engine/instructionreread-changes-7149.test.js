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
  assert.ok(Buffer.byteLength(d) <= 33 * 1024, 'the changes were not capped by size');
  assert.match(d, /More changed than fits here/);
  const huge = Array.from({ length: 2500 }, (_, k) => 'a' + k).join('\n');
  assert.equal(ir.changedLines(huge, huge.replace(/a/g, 'b')), null);
});

test('prepareChanges: with a copy of what the agent last read, the changed lines go to a file in its folder; CONTROL: no copy, no file', () => {
  const f = agentFile('ada', AFTER);
  const first = ir.prepareChanges('ada');
  assert.deepEqual(first, { text: AFTER, path: null }, 'a notice without a copy named a changes file');
  assert.equal(fs.existsSync(path.join(path.dirname(f), '.kosmos-instructions-changed-ada.md')), false);
  assert.equal(ir.remember('ada', BEFORE), true);
  const got = ir.prepareChanges('ada');
  assert.equal(got.path, path.join(path.dirname(f), '.kosmos-instructions-changed-ada.md'));
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

test('review 1 BLOCKER: a link planted at the changes file is replaced, never followed; both new files are 0600', () => {
  const f = agentFile('cal', AFTER);
  const outside = path.join(SANDBOX, 'outside.txt');
  fs.writeFileSync(outside, 'untouched');
  const p = path.join(path.dirname(f), '.kosmos-instructions-changed-cal.md');
  fs.symlinkSync(outside, p);
  ir.remember('cal', BEFORE);
  const got = ir.prepareChanges('cal');
  assert.equal(got.path, p);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'untouched', 'the write followed a planted link');
  assert.equal(fs.lstatSync(p).isSymbolicLink(), false);
  assert.equal(fs.statSync(p).mode & 0o777, 0o600, 'the changes file is not 0600');
  const seenDir = path.join(require('./store').ROOT, 'instruction-reread-seen');
  const copy = path.join(seenDir, fs.readdirSync(seenDir).find((n) => /^cal-[0-9a-f]{12}\.md$/.test(n)));
  assert.equal(fs.statSync(copy).mode & 0o777, 0o600, 'the copy is not 0600');
});

test('review 1: an older changes file is removed when a notice names none', () => {
  const f = agentFile('dee', AFTER);
  const p = path.join(path.dirname(f), '.kosmos-instructions-changed-dee.md');
  ir.remember('dee', BEFORE);
  assert.ok(ir.prepareChanges('dee').path && fs.existsSync(p));
  ir.remember('dee', AFTER);   // nothing changed since
  assert.equal(ir.prepareChanges('dee').path, null);
  assert.equal(fs.existsSync(p), false, 'a stale changes file was left for the agent to find');
});

test('review 1: headings inside a code fence are not sections, and CRLF files label and print cleanly', () => {
  const fenced = ['## Real', 'a', '```bash', '# Start a task', 'x', '```', 'b', ''].join('\n');
  assert.match(ir.changedLines(fenced, fenced.replace('\nb\n', '\nc\n')), /^\nUnder Real:\n- b\n\+ c$/);
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  assert.equal(ir.changedLines(crlf(BEFORE), crlf(AFTER)), ir.changedLines(BEFORE, AFTER));
});

test('review 1: while a section is held (switched off), nothing is prepared and the copy does not move', async () => {
  let prepared = 0;
  const p = passArgs({ owed: { ida: debt(['community', 'rules']) }, o: { sectionOn: (s) => s === 'rules', prepareChanges: () => { prepared += 1; return { text: AFTER, path: '/w/x.md' }; } } });
  await ir.passOnce(p.o);
  assert.equal(p.sent.length, 1);
  assert.equal(p.sent[0][1], ir.lineFor(['rules']), 'a held debt named a changes file');
  assert.equal(prepared, 0);
  assert.deepEqual(p.remembered, [], 'the copy moved past a held section');
});

test('review 1: a line skipped after the checks (the card no longer idle) prepares nothing', async () => {
  let prepared = 0;
  let calls = 0;
  const busy = CARDS.map((c) => ({ ...c, state: 'working' }));
  const p = passArgs({ owed: { ida: debt() }, o: { roster: () => (calls++ === 0 ? CARDS : busy), prepareChanges: () => { prepared += 1; return null; } } });
  await ir.passOnce(p.o);
  assert.deepEqual(p.sent, []);
  assert.equal(prepared, 0, 'a changes file was written for a line never typed');
});

test('review 2: an edit past character 400 of a long line is shown whole, not cut to two identical lines', () => {
  const long = 'x'.repeat(450) + 'tail';
  const d = ir.changedLines('## S\n' + long + '\n', '## S\n' + long.replace('tail', 'TAIL') + '\n');
  assert.equal(d, '\nUnder S:\n- ' + long + '\n+ ' + long.replace('tail', 'TAIL'));
});

test('review 2: one trailing newline more or less is no change; a ~~~ line inside a ``` fence does not close it', () => {
  assert.equal(ir.changedLines('a\nb\n', 'a\nb'), '');
  const f = ['## Real', '```', '~~~', '# not a heading', '```', 'z', ''].join('\n');
  assert.match(ir.changedLines(f, f.replace('\nz\n', '\nZ\n')), /^\nUnder Real:\n- z\n\+ Z$/);
});

test('review 2: names that differ only in case keep two copies; the next start drops the changes file; forget removes both', () => {
  assert.equal(ir.remember('Eve', 'upper'), true);
  assert.equal(ir.remember('eve', 'lower'), true);
  assert.equal(ir.readSeen('Eve'), 'upper', 'two names shared one copy');
  assert.equal(ir.readSeen('eve'), 'lower');
  const f = agentFile('fay', AFTER);
  const p = path.join(path.dirname(f), '.kosmos-instructions-changed-fay.md');
  ir.remember('fay', BEFORE);
  assert.ok(ir.prepareChanges('fay').path && fs.existsSync(p));
  assert.equal(ir.rememberRead('fay'), true);
  assert.equal(fs.existsSync(p), false, 'the changes file outlived the agent reading its whole file');
  assert.equal(ir.readSeen('fay'), AFTER);
  ir.remember('fay', BEFORE);
  ir.prepareChanges('fay');
  ir.forget('fay');
  assert.equal(ir.readSeen('fay'), null, 'forget left the copy');
  assert.equal(fs.existsSync(p), false, 'forget left the changes file');
});

test('review 2: a folder path with a space is never named in the line', () => {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'gus');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), AFTER);
  const instructions = require('./instructions');
  const real = instructions.fileFor;
  instructions.fileFor = (s) => (s === 'gus' ? path.join(SANDBOX, 'with space', 'CLAUDE.md') : real(s));
  try {
    fs.mkdirSync(path.join(SANDBOX, 'with space'), { recursive: true });
    fs.writeFileSync(path.join(SANDBOX, 'with space', 'CLAUDE.md'), AFTER);
    ir.remember('gus', BEFORE);
    const realRead = instructions.read;
    instructions.read = (s) => (s === 'gus' ? { exists: true, text: AFTER } : realRead(s));
    try { assert.equal(ir.prepareChanges('gus').path, null, 'a path with a space was named'); } finally { instructions.read = realRead; }
  } finally { instructions.fileFor = real; }
});

test('review 2: deleting what is left of an agent forgets its copy (delete-leftover, read as source)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'delete-leftover.js'), 'utf8');
  assert.match(src, /require\('\.\/instructionreread'\)\.forget\(p\.name\)/);
});

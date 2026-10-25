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
/* One run as changedLines prints it (review 11: each run in a diff fence). */
const RUN = (label, lines, fence = '```') => '\n' + label + '\n' + fence + 'diff\n' + lines.join('\n') + '\n' + fence;
const hash12 = (s) => require('node:crypto').createHash('sha256').update(s).digest('hex').slice(0, 12);
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
  assert.equal(ir.changedLines(BEFORE, AFTER), RUN('Under The Kosmos+ community:', ['- Post at least once a day.', '+ Post at least once a week.']));
  assert.equal(ir.changedLines(BEFORE, BEFORE), '', 'a file that did not change reports a change');
  // Two separate changes are two runs, each under its own heading.
  const two = AFTER.replace('Splinter.', 'The person who runs this computer.');
  const d = ir.changedLines(BEFORE, two);
  assert.ok(d.includes(RUN('Under The Kosmos+ community:', ['- Post at least once a day.', '+ Post at least once a week.'])));
  assert.ok(d.includes(RUN('Under Who you report to:', ['- Splinter.', '+ The person who runs this computer.'])));
  // A line added at the top has no heading above it.
  assert.equal(ir.changedLines(BEFORE, 'New first line\n' + BEFORE), RUN('Before the first heading:', ['+ New first line']));
});

test('changedLines: a long change is cut and says so; a rewrite too large to diff is null', () => {
  const many = Array.from({ length: 400 }, (_, k) => 'line ' + k).join('\n');
  const changed = many.replace(/line (\d+)/g, 'row $1');
  const d = ir.changedLines(many, changed);
  assert.ok(d.split('\n').length <= 160, 'the changes were not capped at 160 lines, cut note included');
  assert.ok(Buffer.byteLength(d) <= 33 * 1024, 'the changes were not capped by size');
  assert.match(d, /More changed than fits here/);
  const huge = Array.from({ length: 2500 }, (_, k) => 'a' + k).join('\n');
  assert.equal(ir.changedLines(huge, huge.replace(/a/g, 'b')), null);
});

test('prepareChanges: with a copy of what the agent last read, the changed lines go to a file in its folder; CONTROL: no copy, no file', () => {
  const f = agentFile('ada', AFTER);
  const first = ir.prepareChanges('ada');
  assert.deepEqual(first, { text: AFTER, path: null }, 'a notice without a copy named a changes file');
  assert.equal(fs.existsSync(path.join(path.dirname(f), '.kosmos-instructions-changed-ada-' + hash12('ada') + '.md')), false);
  assert.equal(ir.remember('ada', BEFORE), true);
  const got = ir.prepareChanges('ada');
  assert.equal(got.path, path.join(path.dirname(f), '.kosmos-instructions-changed-ada-' + hash12('ada') + '.md'));
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
  assert.match(named, /the changed lines are listed in \/w\/ada\/\.kosmos-instructions-changed\.md \(a pointer only: still read the sections themselves, and anything else it lists is current too\)/);
  assert.equal(named.replace(/To help you find what changed, the changed lines are listed in \S+ \(a pointer only: still read the sections themselves, and anything else it lists is current too\)\. /, ''), plain);
  // Review 5: after the replaces sentence; review 6: the sections are still read, the file only points.
  assert.ok(named.indexOf('What it says now replaces') < named.indexOf('To help you find'));
  assert.match(plain, /Read the section headed "The Kosmos\+ community" in it now\./);
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
      prepareChanges: () => ({ text: AFTER, path: '/w/ida/.kosmos-instructions-changed-ida.md' }),
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
  assert.equal(p.sent[0][1], ir.lineFor(['community'], { changesAt: '/w/ida/.kosmos-instructions-changed-ida.md' }));
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

test('the board pass is handed its hooks (read as source; the report route is tested over HTTP in server.instructionreread-start-7149.test.js)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /prepareChanges: \(session\) => ir\.prepareChanges\(session\),\s*remember: \(session, text\) => ir\.remember\(session, text\),\s*dropChanges: \(session\) => ir\.dropChanges\(session\),/);
});

test('review 1 BLOCKER: a link planted at the changes file is replaced, never followed; both new files are 0600', () => {
  const f = agentFile('cal', AFTER);
  const outside = path.join(SANDBOX, 'outside.txt');
  fs.writeFileSync(outside, 'untouched');
  const p = path.join(path.dirname(f), '.kosmos-instructions-changed-cal-' + hash12('cal') + '.md');
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
  const p = path.join(path.dirname(f), '.kosmos-instructions-changed-dee-' + hash12('dee') + '.md');
  ir.remember('dee', BEFORE);
  assert.ok(ir.prepareChanges('dee').path && fs.existsSync(p));
  ir.remember('dee', AFTER);   // nothing changed since
  assert.equal(ir.prepareChanges('dee').path, null);
  assert.equal(fs.existsSync(p), false, 'a stale changes file was left for the agent to find');
});

test('review 1: headings inside a code fence are not sections, and CRLF files label and print cleanly', () => {
  const fenced = ['## Real', 'a', '```bash', '# Start a task', 'x', '```', 'b', ''].join('\n');
  assert.equal(ir.changedLines(fenced, fenced.replace('\nb\n', '\nc\n')), RUN('Under Real:', ['- b', '+ c']));
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
  assert.equal(d, RUN('Under S:', ['- ' + long, '+ ' + long.replace('tail', 'TAIL')]));
});

test('review 2: one trailing newline more or less is no change; a ~~~ line inside a ``` fence does not close it', () => {
  assert.equal(ir.changedLines('a\nb\n', 'a\nb'), '');
  const f = ['## Real', '```', '~~~', '# not a heading', '```', 'z', ''].join('\n');
  assert.equal(ir.changedLines(f, f.replace('\nz\n', '\nZ\n')), RUN('Under Real:', ['- z', '+ Z']));
});

test('review 2: names that differ only in case keep two copies; the next start drops the changes file; forget removes both', () => {
  assert.equal(ir.remember('Eve', 'upper'), true);
  assert.equal(ir.remember('eve', 'lower'), true);
  assert.equal(ir.readSeen('Eve'), 'upper', 'two names shared one copy');
  assert.equal(ir.readSeen('eve'), 'lower');
  const f = agentFile('fay', AFTER);
  const p = path.join(path.dirname(f), '.kosmos-instructions-changed-fay-' + hash12('fay') + '.md');
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

test('review 3: the byte cap cuts (cut note inside it); one line larger than the cap names no file at all', () => {
  const wide = Array.from({ length: 300 }, (_, k) => 'w' + k + ' ' + 'y'.repeat(300)).join('\n');
  const d = ir.changedLines(wide, wide.replace(/y/g, 'z'));
  assert.ok(d.split('\n').length < 160, 'this probe was meant to be cut by bytes, not lines');
  assert.ok(Buffer.byteLength(d) <= 32 * 1024, 'the changes passed the byte cap');
  assert.match(d, /More changed than fits here/);
  assert.equal(ir.changedLines('a'.repeat(40000), 'b'.repeat(40000)), null);
});

test('review 3: a lone CR ends a line; a fence of four backticks is not closed by three', () => {
  assert.equal(ir.changedLines('## S\ra\rb\r', '## S\ra\rc\r'), RUN('Under S:', ['- b', '+ c']));
  const f = ['## Real', '````', '```', '# fake', '````', 'z', ''].join('\n');
  assert.equal(ir.changedLines(f, f.replace('\nz\n', '\nZ\n')), RUN('Under Real:', ['- z', '+ Z']));
});

test('review 3: a line naming no changes file, and a debt ended without a line, drop the old file', async () => {
  const dropped = [];
  const held = passArgs({ owed: { ida: debt(['community', 'rules']) }, o: { sectionOn: (s) => s === 'rules', dropChanges: (s) => dropped.push(s) } });
  await ir.passOnce(held.o);
  assert.deepEqual(dropped, ['ida'], 'a held line left an old changes file');
  const gone = [];
  const g = passArgs({ owed: { ghost: debt() }, o: { seenMissing: new Set(['ghost']), dropChanges: (s) => gone.push(s) } });
  const r = await ir.passOnce(g.o);
  assert.deepEqual(r.map((x) => x.act), ['gone']);
  assert.deepEqual(gone, ['ghost']);
  // CONTROL: a line that names a file drops nothing.
  const named = [];
  const n = passArgs({ owed: { ida: debt() }, o: { dropChanges: (s) => named.push(s) } });
  await ir.passOnce(n.o);
  assert.deepEqual(named, []);
});

test('review 3: an UNCONFIRMED line (or a throwing deliver) moves the copy, as settle ends the debt', async () => {
  const u = passArgs({ owed: { ida: debt() }, o: { deliver: async (s, line) => { u.sent.push([s, line]); return { state: D.UNCONFIRMED }; } } });
  await ir.passOnce(u.o);
  assert.deepEqual(u.remembered, [['ida', AFTER]]);
  const t = passArgs({ owed: { ida: debt() }, o: { deliver: async () => { throw new Error('pasted, then failed'); } } });
  await ir.passOnce(t.o);
  assert.deepEqual(t.remembered, [['ida', AFTER]]);
});

test('review 3: a folder path with a double quote is never named', () => {
  const instructions = require('./instructions');
  const realFile = instructions.fileFor;
  const realRead = instructions.read;
  instructions.fileFor = (s) => (s === 'hal' ? path.join(SANDBOX, 'q"uote', 'CLAUDE.md') : realFile(s));
  instructions.read = (s) => (s === 'hal' ? { exists: true, text: AFTER } : realRead(s));
  try {
    fs.mkdirSync(path.join(SANDBOX, 'q"uote'), { recursive: true });
    ir.remember('hal', BEFORE);
    assert.equal(ir.prepareChanges('hal').path, null);
  } finally { instructions.fileFor = realFile; instructions.read = realRead; }
});

test('review 4: a start whose copy cannot be renewed drops the old copy, so the next notice is as before', () => {
  ir.remember('ivy', BEFORE);
  assert.equal(ir.readSeen('ivy'), BEFORE);
  assert.equal(ir.rememberRead('ivy'), false);   // no brief for ivy: unreadable
  assert.equal(ir.readSeen('ivy'), null, 'an older copy survived a start it could not record');
});

test('review 5: a cut rewrite keeps old and new lines in pairs; an emptied file invents no blank line', () => {
  const many = Array.from({ length: 400 }, (_, k) => 'line ' + k).join('\n');
  const d = ir.changedLines(many, many.replace(/line (\d+)/g, 'row $1'));
  assert.match(d, /- line 0\n\+ row 0\n- line 1\n\+ row 1/);
  assert.ok(/\n\+ row/.test(d), 'a cut kept no new line');
  assert.equal(ir.changedLines('a\n', ''), RUN('Before the first heading:', ['- a']));
  assert.equal(ir.changedLines('', 'a\n'), RUN('Before the first heading:', ['+ a']));
});

test('review 5: a line whose prepareChanges names no file drops the old one; restarted and expired endings drop it too', async () => {
  const d1 = [];
  const p = passArgs({ owed: { ida: debt() }, o: { prepareChanges: () => ({ text: AFTER, path: null }), dropChanges: (s) => d1.push(s) } });
  await ir.passOnce(p.o);
  assert.equal(p.sent.length, 1);
  assert.deepEqual(d1, ['ida']);
  const d2 = [];
  const r = passArgs({ owed: { ida: debt() }, o: { history: () => [{ state: 'started', at: T + 5 }], dropChanges: (s) => d2.push(s) } });
  const out = await ir.passOnce(r.o);
  assert.deepEqual(out.map((x) => x.act), ['restarted']);
  assert.deepEqual(d2, ['ida']);
  const d3 = [];
  const e = passArgs({ owed: { ida: { at: T - ir.GIVE_UP_MS - 10, last: T - ir.GIVE_UP_MS - 10, n: 1, sections: ['community'] } }, o: { dropChanges: (s) => d3.push(s) } });
  const out3 = await ir.passOnce(e.o);
  assert.deepEqual(out3.map((x) => x.act), ['expired']);
  assert.deepEqual(d3, ['ida']);
});

test('review 6: a line that did not land drops the changes file it named', async () => {
  const dropped = [];
  const k = passArgs({ owed: { ida: debt() }, o: { deliver: async (s, line) => { k.sent.push([s, line]); return { state: D.COULD_NOT }; }, dropChanges: (s) => dropped.push(s) } });
  await ir.passOnce(k.o);
  assert.equal(k.sent.length, 1);
  assert.deepEqual(dropped, ['ida']);
});

test('reviews 8-9: an added heading labels itself; lines added above it stay under their own section; a # in an added fence is no label', () => {
  const before = ['## A', 'x', '## Old', 'y', ''].join('\n');
  const after = ['## A', 'x', '## New', 'y', ''].join('\n');
  assert.equal(ir.changedLines(before, after), RUN('Under A:', ['- ## Old']) + '\n' + RUN('Under New:', ['+ ## New']));
  const tail = ir.changedLines('## X\nx1\n## Y\ny1\n', '## X\nx1\nx2 added\n## New\nn1\n## Y\ny1\n');
  assert.equal(tail, RUN('Under X:', ['+ x2 added']) + '\n' + RUN('Under New:', ['+ ## New', '+ n1']));
  const fenced = ir.changedLines('## A\nx\n## B\ny\n', '## A\nx\nmore under A\n```\n# comment\n```\n## B\ny\n');
  // The run holds a ``` line, so its own fence is longer (review 11).
  assert.equal(fenced, RUN('Under A:', ['+ more under A', '+ ```', '+ # comment', '+ ```'], '````'));
});

test('review 11: a cut file still closes every fence it opens, inside both caps', () => {
  const many = Array.from({ length: 400 }, (_, k) => 'line ' + k).join('\n');
  const d = ir.changedLines(many, many.replace(/line (\d+)/g, 'row $1'));
  const fences = d.split('\n').filter((l) => /^`{3,}/.test(l));
  assert.ok(fences.length >= 2 && fences.length % 2 === 0, 'an unclosed fence: ' + fences.length);
  assert.ok(d.split('\n').length <= 160 && Buffer.byteLength(d) <= 32 * 1024);
  assert.match(d, /```\n\n\[More changed than fits here/);
});

test('review 13: the real chain, end to end: a start copy, a landed line naming the real file, then only the newer change', async () => {
  const f = agentFile('ida', BEFORE);
  assert.equal(ir.rememberRead('ida'), true);
  fs.writeFileSync(f, AFTER);
  const real = { prepareChanges: ir.prepareChanges, remember: ir.remember, dropChanges: ir.dropChanges };
  const p = passArgs({ owed: { ida: debt() }, o: real });
  await ir.passOnce(p.o);
  assert.equal(p.sent.length, 1);
  const named = /listed in (\S+) \(a pointer only/.exec(p.sent[0][1]);
  assert.ok(named, 'the landed line named no changes file: ' + p.sent[0][1]);
  assert.match(fs.readFileSync(named[1], 'utf8'), /- Post at least once a day\.\n\+ Post at least once a week\./);
  assert.equal(ir.readSeen('ida'), AFTER, 'the copy did not move to what the agent now reads');
  // A second change: its diff holds only that one, not the first again.
  const THIRD = AFTER.replace('Vote honestly.', 'Vote honestly, never on your own work.');
  fs.writeFileSync(f, THIRD);
  const q = passArgs({ owed: { ida: debt() }, o: real });
  await ir.passOnce(q.o);
  const body = fs.readFileSync(/listed in (\S+) \(a pointer only/.exec(q.sent[0][1])[1], 'utf8');
  assert.match(body, /- Vote honestly\.\n\+ Vote honestly, never on your own work\./);
  assert.doesNotMatch(body, /once a day/, 'an already-announced change was listed again');
  // An UNCONFIRMED line keeps its file (the debt ends; the agent may have it); CONTROL above: PLACED keeps it too.
  fs.writeFileSync(f, THIRD + 'One more.\n');
  const u = passArgs({ owed: { ida: debt() }, o: { ...real, deliver: async (s, line) => { u.sent.push([s, line]); return { state: D.UNCONFIRMED }; } } });
  await ir.passOnce(u.o);
  const kept = /listed in (\S+) \(a pointer only/.exec(u.sent[0][1])[1];
  assert.ok(fs.existsSync(kept), 'an UNCONFIRMED line lost its changes file');
});

test('review 14: the changes file says it is a pointer and the named sections are what count', () => {
  const f = agentFile('jo', AFTER);
  ir.remember('jo', BEFORE);
  const body = fs.readFileSync(ir.prepareChanges('jo').path, 'utf8');
  assert.match(body, /This is a pointer only: read the sections the notice named\. It lists every change since you last read the file, changes elsewhere in it included, and those are your current instructions too\./);
  assert.doesNotMatch(body, /for information|what count/, 'the header ranks some changes below others (review 15)');
});

test('review 15: making a new agent that reuses a name forgets the old copy (create.js, read as source)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'create.js'), 'utf8');
  assert.match(src, /require\('\.\/instructionreread'\)\.forget\(name\)/);
});

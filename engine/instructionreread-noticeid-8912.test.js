'use strict';
/* kosmos#8912 slice 2: each instruction-change notice has its own numbered entry in the changes file, under the earlier
   ones since the agent's last session start, so a later notice never silently replaces one the agent did not read.
   node --test engine/instructionreread-noticeid-8912.test.js */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-irnoticeid-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const test = require('node:test');
const assert = require('node:assert/strict');
const ir = require('./instructionreread');
test.after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const D = { PLACED: 'placed', UNCONFIRMED: 'unconfirmed', COULD_NOT: 'could_not' };
const T = Date.parse('2026-10-25T22:00:00Z');
const V1 = ['# You are Ida', '', '## The Kosmos+ community', 'Post at least once a day.', 'Vote honestly.', '', '## Who you report to', 'Splinter.', ''].join('\n');
const V2 = V1.replace('once a day', 'once a week');
const V3 = V2.replace('Vote honestly.', 'Vote honestly, never on your own work.');
function agentFile(name, text) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'CLAUDE.md');
  fs.writeFileSync(f, text);
  return f;
}
const fleet = require('../test-support/fleet');
const status = require('./status');
const CARDS = (() => {
  const board = fleet.install([fleet.agent('ida', { state: 'idle' })]);
  try { return status.snapshot().agents.map((c) => ({ ...c })); } finally { board.restore(); }
})();
const nudgeable = require('./agentnudge').nudgeableCard;
const debt = () => ({ at: T, last: T, n: 1, sections: ['community'] });
/* A pass with the real changes-file functions; `state` is what deliver answers. */
function pass(state, withRestore = true) {
  let file = { ida: debt() };
  const sent = [];
  const o = {
    roster: () => CARDS, isIdle: nudgeable, seenIdle: new Set(['ida']), now: T + 1000,
    history: () => [], allowed: () => true, DELIVERY: D,
    deliver: async (s, line) => { sent.push(line); return { state }; },
    read: () => file, write: (x) => { file = x; return true; },
    prepareChanges: (s) => ir.prepareChanges(s), remember: (s, t) => ir.remember(s, t), dropChanges: (s) => ir.dropChanges(s),
  };
  if (withRestore) o.restoreChanges = (s, prev) => ir.restoreChanges(s, prev);
  return { o, sent };
}
const changesOf = (f) => path.join(path.dirname(f), fs.readdirSync(path.dirname(f)).find((n) => n.startsWith('.kosmos-instructions-changed-')) || 'none');

test('two notices that land: two numbered entries, oldest first, and the line names the new one', async () => {
  const f = agentFile('ida', V1);
  assert.equal(ir.rememberRead('ida'), true);
  fs.writeFileSync(f, V2);
  const a = pass(D.PLACED);
  await ir.passOnce(a.o);
  assert.match(a.sent[0], /, under Notice 1 \(a pointer only/, 'the first line did not name its entry');
  fs.writeFileSync(f, V3);
  const b = pass(D.PLACED);
  await ir.passOnce(b.o);
  assert.match(b.sent[0], /, under Notice 2 \(the entries above it are earlier notices since you started: read one only if you have not\) \(a pointer only/);
  const body = fs.readFileSync(changesOf(f), 'utf8');
  const entries = ir.entriesOf(body);
  assert.deepEqual(entries.map((e) => e.n), [1, 2]);
  assert.match(entries[0].text, /^## Notice 1, written \d\d:\d\d on \d{1,2} [A-Z][a-z]{2} \d{4}\n/);
  assert.match(entries[0].text, /- Post at least once a day\./);
  assert.match(entries[1].text, /\+ Vote honestly, never on your own work\./);
  assert.ok(!/once a day/.test(entries[1].text), 'the second entry repeats the first change');
  assert.match(body, /A later entry wins over an earlier one/, 'the header does not say how entries combine');
});

test('a line that did not land takes back only its own entry; CONTROL: with no restoreChanges the file goes, as before', async () => {
  const f = agentFile('ida', V1);
  assert.equal(ir.rememberRead('ida'), true);
  fs.writeFileSync(f, V2);
  await ir.passOnce(pass(D.PLACED).o);
  const one = fs.readFileSync(changesOf(f), 'utf8');
  fs.writeFileSync(f, V3);
  const missed = pass(D.COULD_NOT);
  await ir.passOnce(missed.o);
  assert.equal(missed.sent.length, 1, 'fixture: the line was not tried');
  assert.equal(fs.readFileSync(changesOf(f), 'utf8'), one, 'an undelivered notice changed or removed the earlier entry');
  // The next try that lands is Notice 2, not 3.
  const again = pass(D.PLACED);
  await ir.passOnce(again.o);
  assert.match(again.sent[0], /, under Notice 2 /);
  // CONTROL: the same miss with a caller that has no restoreChanges.
  fs.writeFileSync(f, V3 + 'One more.\n');
  await ir.passOnce(pass(D.COULD_NOT, false).o);
  assert.equal(fs.existsSync(changesOf(f)), false, 'CONTROL: dropChanges no longer removes the file');
});

test('a session start clears the entries: the next notice is Notice 1 again', async () => {
  const f = agentFile('ida', V1);
  assert.equal(ir.rememberRead('ida'), true);
  fs.writeFileSync(f, V2);
  await ir.passOnce(pass(D.PLACED).o);
  assert.equal(ir.rememberRead('ida'), true);
  assert.equal(fs.existsSync(changesOf(f)), false, 'a session start left the changes file');
  fs.writeFileSync(f, V3);
  const p = pass(D.PLACED);
  await ir.passOnce(p.o);
  assert.match(p.sent[0], /, under Notice 1 \(a pointer only/);
});

test('a file at that path that Kosmos did not write is never carried into the next one', () => {
  const f = agentFile('ida', V2);
  ir.dropChanges('ida');
  assert.equal(ir.remember('ida', V1), true);
  const first = ir.prepareChanges('ida');
  fs.writeFileSync(first.path, 'someone else\'s notes\n## Notice 7, written 01:00 on 1 Jan 2026\nsecret\n');
  const got = ir.prepareChanges('ida');
  assert.equal(got.notice, 1);
  assert.equal(got.previous, null);
  const body = fs.readFileSync(got.path, 'utf8');
  assert.ok(!body.includes('secret') && !body.includes('someone else'), 'a stranger\'s file was carried into the changes file');
  assert.ok(fs.readFileSync(f, 'utf8') === V2);
});

test('a diff line that looks like an entry heading is not one', () => {
  const body = '# What changed in your instructions file since you last read it\n\nheader\n\n'
    + '## Notice 1, written 10:00 on 1 Nov 2026\n\nUnder X:\n```diff\n+ ## Notice 5, written 10:00 on 1 Nov 2026\n```\n\n';
  assert.deepEqual(ir.entriesOf(body).map((e) => e.n), [1]);
});

test('past the whole-file bound the oldest entries go, and the file says so', () => {
  const f = agentFile('ida', V2);
  ir.dropChanges('ida');
  // Five earlier entries of about 40 KB each: three of them and the new one fit the 128 KB bound, five do not.
  const big = 'x'.repeat(40 * 1024);
  let prev = '# What changed in your instructions file since you last read it\n\nheader\n\n';
  for (let n = 1; n <= 5; n += 1) prev += '## Notice ' + n + ', written 10:00 on 1 Nov 2026\n' + big + '\n\n';
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const p = path.join(path.dirname(f), '.kosmos-instructions-changed-ida-' + require('node:crypto').createHash('sha256').update('ida').digest('hex').slice(0, 12) + '.md');
  fs.writeFileSync(p, prev);
  assert.equal(ir.remember('ida', V1), true);
  const got = ir.prepareChanges('ida');
  assert.equal(got.path, p);
  assert.equal(got.notice, 6);
  const body = fs.readFileSync(p, 'utf8');
  const ns = ir.entriesOf(body).map((e) => e.n);
  assert.deepEqual(ns, [3, 4, 5, 6]);
  assert.ok(Buffer.byteLength(body) <= 4 * ir.CHANGES_BYTES_MAX + 4096, 'the file is over its bound');
  assert.match(body, /Notices 1 to 2 were removed to keep this file short\. If you did not read them, read the sections their notices named in full\./);
});

test('lineFor: no notice number keeps the old sentence; Notice 1 has no earlier-entries clause', () => {
  const plain = ir.lineFor(['community'], { changesAt: '/w/x.md' });
  assert.match(plain, /listed in \/w\/x\.md \(a pointer only/);
  const one = ir.lineFor(['community'], { changesAt: '/w/x.md', notice: 1 });
  assert.match(one, /listed in \/w\/x\.md, under Notice 1 \(a pointer only/);
  assert.ok(!one.includes('earlier notices'));
  assert.ok(!/"/.test(one.replace(/"The Kosmos\+ community"/, '')), 'a double quote in the line would be read as a section heading');
});

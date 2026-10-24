'use strict';
/**
 * #6921 (agent feedback 10-22): a task title over SENTENCE_MAX made the add fail outright, so the agent had to retry.
 * Now the title is shortened and the whole of it goes first in the detail; the add answers with a note saying so. Pure
 * rows on tasks.fitTitle, then tasks.create, then the real route on a sandboxed board.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-6921-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');
const projects = require('./engine/projects');
const tasks = require('./engine/tasks');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(boardAuthState.on, false, 'a fully-sandboxed board must not enforce');
});
test.after(() => {
  try { server.close(); } catch { /* ignore */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

const MAX = tasks.SENTENCE_MAX;
const long = (n) => Array.from({ length: n }, (_, i) => 'word' + i).join(' ');

test('#6921: fitTitle leaves a title at or under the cap alone', () => {
  const at = 'x'.repeat(MAX);
  assert.deepEqual(tasks.fitTitle(at, 'd'), { sentence: at, detail: 'd', moved: false });
  assert.deepEqual(tasks.fitTitle('  short  ', undefined), { sentence: '  short  ', detail: undefined, moved: false });
  assert.equal(tasks.fitTitle(42, null).moved, false, 'a non-string is left for taskProblem to refuse');
});

test('#6921: fitTitle cuts at a word, keeps the whole title first in the detail', () => {
  const title = long(60);   // well over the cap
  const r = tasks.fitTitle(title, 'what they should know');
  assert.equal(r.moved, true);
  assert.ok(r.sentence.length <= MAX, 'the new title fits: ' + r.sentence.length);
  assert.ok(r.sentence.endsWith('...'));
  assert.ok(title.startsWith(r.sentence.slice(0, -3)), 'the title is a prefix of the original');
  const kept = r.sentence.slice(0, -3);
  assert.match(title.charAt(kept.length), /\s/, 'cut at a word boundary: the next character of the original is a space');
  assert.equal(r.detail, title + '\n\nwhat they should know');
  assert.equal(tasks.fitTitle(title, '   ').detail, title, 'a blank detail becomes just the title');
});

test('#6921: a detail that is not text is still refused when the title is long', () => {
  const p = projects.create({ name: 'Typed' });
  assert.equal(tasks.fitTitle(long(60), 42).moved, false, 'no move, so taskProblem sees the 42');
  assert.throws(() => tasks.create(p.id, { sentence: long(60), detail: 42 }), /has to be words/);
  assert.equal((projects.readAll().find((x) => x.id === p.id).tasks || []).length, 0, 'nothing written');
});

test('#6921: a word that ends exactly at the room is kept, not dropped', () => {
  const room = MAX - 3;
  const title = 'a'.repeat(room - 10) + ' ' + 'b'.repeat(9) + ' tail words after the cut';   // the b-word ends at room
  assert.equal(tasks.fitTitle(title, null).sentence, title.slice(0, room) + '...');
});

test('#6921: a detail over its cap on its own is refused as itself, whatever the title', () => {
  const p = projects.create({ name: 'Detailcap' });
  const big = 'd'.repeat(tasks.DETAIL_MAX + 100);
  assert.throws(() => tasks.create(p.id, { sentence: long(60), detail: big }), /has to be words/);
  assert.throws(() => tasks.create(p.id, { sentence: 'Short', detail: big }), /has to be words/, 'CONTROL: the same verdict with a short title');
  assert.throws(() => tasks.create(p.id, { sentence: long(60), detail: ' '.repeat(tasks.DETAIL_MAX + 10) + 'a' }), /has to be words/,
    'an over-cap detail is not rescued by trimming during the move');
});

test('#6921: a title whose only space comes early is hard-cut instead of cut at that space', () => {
  const r = tasks.fitTitle('a ' + 'y'.repeat(300), null);
  assert.equal(r.sentence, ('a ' + 'y'.repeat(300)).slice(0, MAX - 3) + '...');
});

test('#6921: one word longer than the cap is hard-cut; a surrogate pair is never split', () => {
  const r = tasks.fitTitle('y'.repeat(MAX + 50), null);
  assert.equal(r.sentence, 'y'.repeat(MAX - 3) + '...');
  const emoji = tasks.fitTitle('\u{1F600}'.repeat(MAX), null);   // each one is two UTF-16 units
  assert.equal(emoji.sentence, '\u{1F600}'.repeat(98) + '...', 'whole pairs only: 98 of them fill 196 of the 197 units');
  assert.ok(!/[\ud800-\udbff]\.\.\.$/u.test(emoji.sentence), 'no lone high surrogate before the dots');
});

test('#6921: create stores the shortened title, and refuses only when the move overflows the detail', () => {
  const p = projects.create({ name: 'Titles' });
  const title = long(60);
  const made = tasks.create(p.id, { sentence: title, detail: 'more' });
  assert.equal(made.titleMoved, true, 'create says it shortened the title');
  assert.equal(tasks.create(p.id, { sentence: 'Short one' }).titleMoved, false, 'CONTROL: and says so only then');
  assert.ok(!('titleMoved' in JSON.parse(JSON.stringify(made))), 'the flag is never stored or sent');
  assert.ok(made.sentence.length <= MAX);
  assert.equal(made.detail, title + '\n\nmore');
  assert.throws(() => tasks.create(p.id, { sentence: title, detail: 'z'.repeat(tasks.DETAIL_MAX - 10) }),
    new RegExp('over ' + MAX + ' characters, and with it moved into the detail'));
  assert.equal(projects.readAll().find((x) => x.id === p.id).tasks.length, 2, 'the refusal wrote nothing');
});

const PID = 'p6921';
function seed() {
  const folder = fs.mkdtempSync(path.join(SANDBOX, 'pf-'));
  projects.writeAll([{ id: PID, name: 'Research', folder, agents: [], taskCounter: 0, tasks: [] }]);
}
async function add(sentence) {
  const res = await fetch(base + '/api/project/' + PID + '/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sentence }) });
  return { code: res.status, json: await res.json() };
}

test('#6921: the route adds an over-long title instead of failing, and says it was shortened', async () => {
  seed();
  const title = long(60);
  const r = await add(title);
  assert.equal(r.code, 200, JSON.stringify(r.json));
  assert.ok(r.json.task.sentence.length <= MAX);
  assert.equal(r.json.task.detail, title);
  assert.equal(r.json.note, 'Note: the title was over ' + MAX + ' characters, so it was shortened and the whole title is at the start of the details.');
  assert.doesNotMatch(r.json.note, /["\\]/, 'the macOS CLI lifts the note with sed: no double quote or backslash');
  const ok = await add('A normal title');
  assert.equal(ok.code, 200);
  assert.equal(ok.json.note, undefined, 'CONTROL: a title under the cap gets no note');
});

test('#6921: the shortened note comes first, so #5319 copyable close command stays the end of the line', async () => {
  seed();
  const title = long(60);
  const first = await add(title);
  assert.equal(first.code, 200);
  const again = await add(title);   // the same long title again: same stored sentence and detail, so #5319 names #1
  assert.equal(again.code, 200, JSON.stringify(again.json));
  assert.ok(again.json.note.startsWith('Note: the title was over ' + MAX + ' characters'), again.json.note);
  assert.match(again.json.note, /kosmos task close p6921 2$/, '#5319 command is the end of the line');
});

test('#6921: with no detail sent, an over-long title that cannot fit even as a detail says to shorten it, not one of them', () => {
  const p = projects.create({ name: 'Nodetail' });
  assert.throws(() => tasks.create(p.id, { sentence: 'w '.repeat(tasks.DETAIL_MAX) }), /would still pass .*; shorten it$/);
});

test('#6921: refusals keep one order whatever the title length: title, then detail, then who, then done-when', () => {
  const p = projects.create({ name: 'Order' });
  const msg = (body) => { try { tasks.create(p.id, body); return 'accepted'; } catch (e) { return e.message; } };
  assert.match(msg({ sentence: '', who: 42 }), /say what needs doing/, 'a blank title comes before a bad who');
  assert.match(msg({ sentence: 'Short', detail: 42, who: 42 }), /has to be words/, 'a bad detail comes before a bad who');
  assert.match(msg({ sentence: long(60), detail: 42, who: 42 }), /has to be words/, 'the same with a long title');
  assert.match(msg({ sentence: 'Short', who: 42, doneWhen: 'x' }), /agent's name/, 'a bad who comes before bad done-when checks');
  assert.match(msg({ sentence: long(60), who: 42, doneWhen: 'x' }), /agent's name/, 'the same with a long title');
});

test('#6921: taskProblem itself still refuses an over-long title (a direct caller gets no shortening)', () => {
  assert.match(tasks.taskProblem({ sentence: 'x'.repeat(MAX + 1) }), /characters or fewer/);
  assert.equal(tasks.taskProblem({ sentence: 'x'.repeat(MAX) }), null, 'CONTROL: at the cap is fine');
});

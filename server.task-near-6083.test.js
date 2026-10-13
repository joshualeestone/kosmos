'use strict';
/**
 * #6083: two agents added one ask in the same minute in OTHER words, and #5319's same-text note never fired. A second,
 * weaker note now names an open task with a NEAR title added in the last few minutes, and never says "close the new
 * one". Pure rows on tasks.isNearTitle (every #5319 counterexample is never near) and tasks.nearOpen, then the real
 * route on a sandboxed board, including two adds sent at the same moment.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-6083-'));
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

test('#6083: which titles are near (pure); every #5319 counterexample is never near', () => {
  for (const [a, b, want, why] of [
    ['Run the Meta pass', 'run the meta pass now', true, 'one word added, a name in another case'],
    ['Run the Meta pass', 'Run the meta pass.', true, 'case and punctuation only'],
    ['Review the onboarding copy', 'Review onboarding copy', true, 'one word dropped'],
    ['Meta pass: run', 'Run Meta pass', false, 'reordered: a deliberate miss (order is kept)'],
    ['Email Alice', 'Email Bob', false, '#5319: another person'],
    ['Approve the PR', 'Reject the PR', false, '#5319: the opposite verb'],
    ['Do not enable sync', 'Enable sync', false, '#5319: a negation'],
    ['Not enable the sync', 'Enable the sync', false, 'a negation as the one added word'],
    ['Fly Dallas to Austin', 'Fly Austin to Dallas', false, '#5319: swapped places'],
    ['Set offset to -5', 'Set offset to 5', false, '#5319: a sign'],
    ['Ship if x > 5', 'Ship if x < 5', false, '#5319: a comparison'],
    ['Support C++', 'Support C', false, '#5319: a symbol in a name'],
    ['Say \u2705 today', 'Say \u274c today', false, '#5319: a check mark is not a cross'],
    ['Pay $5 now', 'Pay \u20ac5 now', false, '#5319: another currency'],
    ['Draft the report for 2026', 'Draft the report for 2027', false, 'another number'],
    ['Fix it', 'Fix it now', false, 'two-word titles are too generic for a word more'],
    ['Write tests', 'Write more tests', false, 'two-word titles are too generic for a word more'],
    ['', 'Run the pass', false, 'an empty title is never near'],
  ]) assert.equal(tasks.isNearTitle(a, b), want, `${a} | ${b}: ${why}`);
});

test('#6083: nearOpen: open, earlier, same parent and people, inside the window, not the same text, not under way', () => {
  const now = Date.parse('2026-10-13T20:00:00Z');
  const at = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const made = { number: 20, sentence: 'run the meta pass now', createdAt: at(0), who: 'meta' };
  const P = { tasks: [
    { number: 1, sentence: 'Run the Meta pass', createdAt: at(2), who: 'meta' },
    { number: 2, sentence: 'Run the Meta pass', createdAt: at(11), who: 'meta' },
    { number: 3, sentence: 'Run the Meta pass', createdAt: at(1), who: 'grok' },
    { number: 4, sentence: 'Run the Meta pass', createdAt: at(1), who: 'meta', parent: 9 },
    { number: 5, sentence: 'Run the Meta pass', createdAt: at(1), who: 'meta', closedAt: at(0) },
    { number: 6, sentence: 'run the meta pass now', createdAt: at(1), who: 'meta' },
    { number: 7, sentence: 'Run the Meta pass', createdAt: at(1), who: 'meta', dueDate: '2026-10-20' },
    { number: 30, sentence: 'Run the Meta pass', createdAt: at(1), who: 'meta' },
  ] };
  assert.deepEqual(tasks.nearOpen(P, made).map((t) => t.number), [1],
    'only #1: #2 is outside the window, #3 is for someone else, #4 under another parent, #5 closed, #6 the same text (#5319 names it), #7 under way, #30 is newer');
  assert.deepEqual(tasks.nearOpen(P, { ...made, createdAt: 'not a time' }), [], 'no creation time, no window, no note');
});

const PID = 'p6083';
function seed(list) {
  const folder = fs.mkdtempSync(path.join(SANDBOX, 'pf-'));
  projects.writeAll([{ id: PID, name: 'Research', folder, agents: [], taskCounter: list.length, tasks: list }]);
}
async function add(sentence) {
  const res = await fetch(base + '/api/project/' + PID + '/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sentence }) });
  return { code: res.status, json: await res.json() };
}

test('#6083: the route adds a near task and names the similar one, without telling anyone to close the new one', async () => {
  seed([{ number: 1, sentence: 'Run the Meta pass', createdAt: new Date().toISOString(), closedAt: null, who: null }]);
  const r = await add('run the meta pass now');
  assert.equal(r.code, 200, JSON.stringify(r.json));
  assert.equal(r.json.task.number, 2, 'the task is ADDED as asked');
  assert.equal(r.json.note, 'Note: a similar open task was added in the last few minutes: #1 (Run the Meta pass). '
    + 'If it is the same ask as #2, close one of them; if it is a different ask, ignore this.');
  assert.doesNotMatch(r.json.note, /close the new one/, 'the weak note never says close the new one');
  assert.doesNotMatch(r.json.note, /["\\]/, 'the note holds no double quote or backslash');
  const other = await add('Update the onboarding copy');
  assert.equal(other.json.note, undefined, 'CONTROL: a task like no other gets no note');
  const same = await add('Run the Meta pass');
  // The same text as #1: #5319 names #1; the near note names only #2 (near, not the same text), never #1 again.
  assert.match(same.json.note || '', /^Note: an open task with the same text already exists: #1 \(Run the Meta pass\)\. If this is the same ask, close the new one: kosmos task close p6083 4 Note: a similar open task was added in the last few minutes: #2 \(run the meta pass now\)\./, same.json.note);
  assert.equal((same.json.note.match(/#1 \(/g) || []).length, 1, 'a task #5319 names is not named again');
});

test('#6083: two near adds sent at the same moment: the later one is told about the earlier', async () => {
  seed([]);
  const [a, b] = await Promise.all([add('Run the Grok pass'), add('run the grok pass now')]);
  assert.equal(a.code, 200, JSON.stringify(a.json));
  assert.equal(b.code, 200, JSON.stringify(b.json));
  const [first, later] = a.json.task.number < b.json.task.number ? [a, b] : [b, a];
  assert.equal(first.json.note, undefined, 'the earlier add is not told about a task that did not exist yet');
  assert.match(later.json.note || '', new RegExp('^Note: a similar open task was added in the last few minutes: #' + first.json.task.number + ' '),
    'the later add names the earlier: ' + later.json.note);
});

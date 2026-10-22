'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* kosmos#6842 slice 2: a project's cost, the sum of its closed tasks' receipts (engine/receipt.js forProject). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Every root sandboxed before any require: receipt.js reads store, status, create and trust. */
const SB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rp6842-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, '.claude');
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'LaunchAgents');
for (const v of ['CODEX_HOME', 'AGENT_WORKFORCE_CODEX_HOME', 'GEMINI_CLI_HOME', 'AGENT_WORKFORCE_GEMINI_HOME', 'GROK_HOME', 'AGENT_WORKFORCE_GROK_HOME', 'AGENT_WORKFORCE_AGY_HOME']) delete process.env[v];
for (const d of ['data', 'workers', '.claude/projects']) fs.mkdirSync(path.join(SB, d), { recursive: true });

const receipt = require('./receipt');
const taskchat = require('./taskchat');
const projects = require('./projects');

const T = (hhmm) => `2026-10-01T${hhmm}:00.000Z`;
const ms = (hhmm) => Date.parse(T(hhmm));
let pn = 0;
const use = (i, o, cw = 0, cr = 0) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr });
const pr = (n, repo = 'o/kosmos') => ({ repo, number: n, url: `https://github.com/${repo}/pull/${n}` });
function project(tasks) {
  const id = 'p' + (++pn);
  projects.writeAll([...projects.readAll(), { id, name: 'P ' + pn, agents: [], tasks }]);
  return id;
}
const closedTask = (n, hhmm) => ({ number: n, sentence: 'task ' + n, closedAt: T(hhmm) });

test('a project\'s cost sums every agent\'s tokens per model over its closed tasks, and leaves open tasks out', async () => {
  const id = project([closedTask(1, '11:00'), closedTask(2, '12:00'), { number: 3, sentence: 'open', closedAt: null }]);
  const asked = [];
  const receiptOf = async (pid, task) => {
    asked.push(task.number);
    return task.number === 1
      ? { agents: [
        { who: 'a', available: true, models: { 'claude-opus-5-5': { ...use(10, 20, 1, 2), rows: 3 } } },
        { who: 'b', available: true, models: { 'claude-sonnet-5-5': { ...use(1, 1), rows: 1 } } },
      ] }
      : { agents: [{ who: 'a', available: true, models: { 'claude-opus-5-5': { ...use(5, 5, 0, 10), rows: 2 } } }] };
  };
  const r = await receipt.forProject(id, { now: ms('15:00'), receiptOf });
  assert.equal(r.ok, true);
  assert.deepEqual(asked.sort(), [1, 2], 'only the closed tasks');
  assert.equal(r.tasks, 2);
  assert.deepEqual(r.models, {
    'claude-opus-5-5': { ...use(15, 25, 1, 12), rows: 5 },
    'claude-sonnet-5-5': { ...use(1, 1), rows: 1 },
  });
  assert.deepEqual([r.notCounted, r.failed, r.unread, r.partial], [0, 0, 0, 0]);
});

test('a pull request worked on in two tasks is listed once with both tasks; one with no number is not listed', async () => {
  const id = project([closedTask(1, '11:00'), closedTask(2, '12:00')]);
  const receiptOf = async (pid, task) => ({ agents: [
    { who: 'a', available: true, models: {}, prs: task.number === 1 ? [pr(7), pr(8)] : [pr(7), { repo: 'o/kosmos', url: 'x' }], prsMore: 2 },
  ] });
  const r = await receipt.forProject(id, { now: ms('15:00'), receiptOf });
  const byNumber = Object.fromEntries(r.prs.map((p) => [p.number, p.tasks.sort()]));
  assert.deepEqual(byNumber, { 7: [1, 2], 8: [1] });
  assert.equal(r.prsMore, 4, 'what each agent counted but did not name is carried as a count');
});

test('an agent whose receipt has no prs is counted as unknown, not as none', async () => {
  const id = project([closedTask(1, '11:00'), closedTask(2, '12:00')]);
  const receiptOf = async (pid, task) => ({ agents: [
    task.number === 1 ? { who: 'a', available: true, models: {}, prs: [], prsMore: 0 } : { who: 'b', available: true, models: {} },
    { who: 'c', available: false },
  ] });
  const r = await receipt.forProject(id, { now: ms('15:00'), receiptOf });
  assert.equal(r.prsUnknown, 3, 'b with no prs field once, and the unreadable c once per task; a\'s empty list is a measured none');
  assert.deepEqual(r.prs, []);
});

test('one pull request kept with its url on one receipt and without it on another is listed once', async () => {
  const id = project([closedTask(1, '11:00'), closedTask(2, '12:00')]);
  const receiptOf = async (pid, task) => ({ agents: [
    { who: 'a', available: true, models: {}, prs: [task.number === 1 ? pr(7) : { repo: pr(7).repo, number: 7 }], prsMore: 0 },
  ] });
  const r = await receipt.forProject(id, { now: ms('15:00'), receiptOf });
  assert.equal(r.prs.length, 1, JSON.stringify(r.prs));
  assert.equal(r.prs[0].url, pr(7).url, 'the url is kept from the receipt that had it');
  assert.deepEqual(r.prs[0].tasks.sort(), [1, 2]);
  assert.equal(r.picked, 2);
});

test('overlapping: one agent\'s holds on two tasks share a moment; one after the other does not', async () => {
  const id = project([closedTask(1, '11:00'), closedTask(2, '12:00')]);
  const span = (from, to) => [{ from: new Date(ms(from)).toISOString(), to: new Date(ms(to)).toISOString() }];
  const seq = await receipt.forProject(id, { now: ms('15:00'), receiptOf: async (pid, task) => ({ agents: [
    { who: 'a', available: true, models: {}, prs: [], holds: task.number === 1 ? span('09:00', '10:00') : span('10:30', '11:30') },
  ] }) });
  assert.equal(seq.overlapping, false, 'the same agent, one task after the other: no double count');
  const both = await receipt.forProject(id, { now: ms('15:00'), receiptOf: async (pid, task) => ({ agents: [
    { who: 'a', available: true, models: {}, prs: [], holds: task.number === 1 ? span('09:00', '11:00') : span('10:30', '11:30') },
    { who: 'x', available: false, because: 'no-folder' },
  ] }) });
  assert.equal(both.overlapping, true, 'agent a held both tasks from 10:30 to 11:00');
  assert.equal(both.prsUnknown, 2, 'the unreadable agent, once per task');
  const touching = await receipt.forProject(id, { now: ms('15:00'), receiptOf: async (pid, task) => ({ agents: [
    { who: 'a', available: true, models: {}, prs: [], holds: task.number === 1 ? span('09:00', '10:00') : span('10:00', '11:00') },
  ] }) });
  assert.equal(touching.overlapping, false, 'one hold ending as the other starts shares no time');
  const unreadable = await receipt.forProject(id, { now: ms('15:00'), receiptOf: async () => ({ agents: [
    { who: 'x', available: false, because: 'no-folder', holds: span('09:00', '11:00') },
  ] }) });
  assert.equal(unreadable.overlapping, false, 'an agent counted in nothing cannot make the total read high');
});

test('two asks for one project while it is worked out share one computation', async () => {
  const id = project([closedTask(1, '11:00')]);
  const a = receipt.forProject(id, { now: ms('15:00') });
  const b = receipt.forProject(id, { now: ms('15:00') });
  assert.equal(a, b, 'the second ask got the same promise');
  await a;
  assert.notEqual(receipt.forProject(id, { now: ms('15:00') }), a, 'a later ask computes afresh');
});

test('what could not be read is counted as such, never folded into the total', async (t) => {
  t.mock.method(console, 'error', () => {});
  const id = project([closedTask(1, '11:00'), closedTask(2, '12:00'), closedTask(3, '13:00')]);
  const receiptOf = async (pid, task) => {
    if (task.number === 3) throw new Error('could not read');
    return { agents: [
      { who: 'a', available: false, because: 'no-folder' },
      { who: 'b', available: true, complete: false, models: { m: { ...use(1, 1), rows: 1 } } },
    ] };
  };
  const r = await receipt.forProject(id, { now: ms('15:00'), receiptOf });
  assert.deepEqual([r.tasks, r.failed, r.unread, r.partial], [2, 1, 2, 2]);
  assert.deepEqual(r.models, { m: { ...use(2, 2), rows: 2 } });
});

test('the newest closed tasks are counted up to the limit, the rest counted as not counted, a few at a time', async () => {
  const id = project([1, 2, 3, 4, 5].map((n) => closedTask(n, '1' + n + ':00')));
  let inFlight = 0;
  let most = 0;
  const asked = [];
  const receiptOf = async (pid, task) => {
    inFlight += 1; most = Math.max(most, inFlight);
    asked.push(task.number);
    await new Promise((res) => setTimeout(res, 2));
    inFlight -= 1;
    return { agents: [] };
  };
  const r = await receipt.forProject(id, { limit: 4, now: ms('20:00'), receiptOf });
  assert.deepEqual(asked.sort(), [2, 3, 4, 5], 'the oldest is the one left out');
  assert.deepEqual([r.tasks, r.notCounted], [4, 1]);
  assert.ok(most > 1 && most <= 3, 'a few at a time, never more than three: ' + most);
});

test('an unknown project says so', async () => {
  assert.deepEqual(await receipt.forProject('no-such-' + (++pn)), { ok: false, because: 'no-project' });
});

test('through the real receipt: a project\'s total equals its task\'s receipt, read from a real transcript', async () => {
  const dir = path.join(SB, 'workers', 'rex');
  fs.mkdirSync(dir, { recursive: true });
  const id = project([closedTask(1, '11:00')]);
  const file = taskchat.taskChatFile(id, 1);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [{ at: T('10:00'), kind: 'created', who: 'rex' }, { at: T('11:00'), kind: 'closed' }].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const tdir = path.join(SB, '.claude', 'projects', fs.realpathSync(dir).replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(tdir, { recursive: true });
  fs.writeFileSync(path.join(tdir, 's.jsonl'), JSON.stringify({ type: 'assistant', timestamp: T('10:30'), sessionId: 's',
    message: { id: 'r1', model: 'claude-sonnet-5-5', usage: use(40, 2), content: [] } }) + '\n');
  const task = await receipt.forTask(id, closedTask(1, '11:00'), { now: ms('11:01') });
  const total = await receipt.forProject(id, { now: ms('11:01') });
  assert.equal(total.tasks, 1);
  assert.deepEqual(total.models, task.agents[0].models, 'the same numbers the task page shows');
  assert.equal(total.models['claude-sonnet-5-5'].input_tokens, 40, 'fixture: the transcript was read');
});

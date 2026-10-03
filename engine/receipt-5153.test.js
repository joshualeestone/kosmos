'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #5153 slice 1: a closed task's change receipt, from its activity and the holding agent's Claude transcripts.
 *   node --test engine/receipt-5153.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Every root sandboxed before any require: receipt.js reads store, status, create and trust. */
const SB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rc5153-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SB, 'workers');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = path.join(SB, '.claude');
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'LaunchAgents');
for (const d of ['data', 'workers', '.claude/projects']) fs.mkdirSync(path.join(SB, d), { recursive: true });

const receipt = require('./receipt');
const taskchat = require('./taskchat');
const store = require('./store');

const T = (hhmm) => `2026-10-01T${hhmm}:00.000Z`;
const ms = (hhmm) => Date.parse(T(hhmm));
let pn = 0;

/* A task's activity written with chosen times (taskchat.record stamps "now"). */
function activity(project, number, rows) {
  const file = taskchat.taskChatFile(project, number);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify({ ...r, at: T(r.at) })).join('\n') + '\n');
}
function worker(name) {
  const dir = path.join(SB, 'workers', name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
/* A Claude transcript folder for an agent's folder, named as Claude Code names it. */
function claudeDir(dir) {
  const d = path.join(SB, '.claude', 'projects', fs.realpathSync(dir).replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const assistant = (at, { id, model = 'claude-sonnet-5-5', usage, tools = [] }) => JSON.stringify({
  type: 'assistant', timestamp: T(at),
  message: { id, model, role: 'assistant', usage,
    content: tools.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input || {} })) },
});
const use = (i, o, cw = 0, cr = 0) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cw, cache_read_input_tokens: cr });

test('holds: a hand-off ends one hold and starts the next; a close ends all; a put-back resumes the last holder', () => {
  const h = receipt.holdsFrom([
    { at: T('10:00'), kind: 'created', who: 'ann' },
    { at: T('11:00'), kind: 'assigned', partId: 1, who: 'bob' },
    { at: T('12:00'), kind: 'closed' },
    { at: T('13:00'), kind: 'reopened' },
    { at: T('14:00'), kind: 'closed' },
  ], ms('14:00'));
  assert.deepEqual(h, {
    ann: [{ from: ms('10:00'), to: ms('11:00') }],
    bob: [{ from: ms('11:00'), to: ms('12:00') }, { from: ms('13:00'), to: ms('14:00') }],
  });
});

test('holds: a second part added for the same agent overlaps its first and merges; a closed part ends its hold', () => {
  const h = receipt.holdsFrom([
    { at: T('10:00'), kind: 'created', who: 'ann' },
    { at: T('10:30'), kind: 'part-added', partId: 2, who: 'ann' },
    { at: T('11:00'), kind: 'part-closed', partId: 1 },
    { at: T('11:30'), kind: 'part-added', partId: 3, who: 'cy' },
    { at: T('12:00'), kind: 'closed' },
  ], ms('12:00'));
  assert.deepEqual(h.ann, [{ from: ms('10:00'), to: ms('12:00') }], 'part 2 kept ann holding after part 1 closed');
  assert.deepEqual(h.cy, [{ from: ms('11:30'), to: ms('12:00') }]);
});

test('holds: a part taken off its holder (assigned to nobody) ends the hold', () => {
  const h = receipt.holdsFrom([
    { at: T('10:00'), kind: 'created', who: 'ann' },
    { at: T('10:20'), kind: 'assigned', partId: 1, who: null },
    { at: T('12:00'), kind: 'closed' },
  ], ms('12:00'));
  assert.deepEqual(h, { ann: [{ from: ms('10:00'), to: ms('10:20') }] });
});

test('retries: put-backs and hand-offs to someone new; giving it back to an earlier holder is not a new hand-off', () => {
  assert.deepEqual(receipt.retriesFrom([
    { kind: 'created', who: 'ann' },
    { kind: 'assigned', partId: 1, who: 'bob' },
    { kind: 'assigned', partId: 1, who: 'ann' },
    { kind: 'closed' }, { kind: 'reopened' }, { kind: 'closed' },
  ]), { reopened: 1, handoffs: 1 });
});

test('a closed task: files, a command COUNT, tokens once per message, only inside each agent\'s hold; another provider is not guessed', async () => {
  const project = 'p' + (++pn);
  const ann = worker('ann');
  worker('bob');
  store.writeProfile('bob', { provider: 'openai' });   // a Codex agent
  activity(project, 1, [
    { at: '10:00', kind: 'created', who: 'ann' },
    { at: '11:00', kind: 'assigned', partId: 1, who: 'bob' },
    { at: '12:00', kind: 'closed' },
  ]);
  const d = claudeDir(ann);
  fs.writeFileSync(path.join(d, 's1.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: T('10:01'), cwd: ann, message: { role: 'user', content: 'go' } }),
    assistant('10:05', { id: 'm1', usage: use(100, 50, 10, 1000), tools: [{ id: 't1', name: 'Edit', input: { file_path: path.join(ann, 'src/a.js') } }, { id: 't0', name: 'Bash', input: { command: 'make' } }] }),
    assistant('10:05', { id: 'm1', usage: use(100, 50, 10, 1000), tools: [{ id: 't1', name: 'Edit', input: { file_path: path.join(ann, 'src/a.js') } }, { id: 't0', name: 'Bash', input: { command: 'make' } }] }),   // the same message restated
    assistant('10:06', { id: 'm2', usage: use(5, 5), tools: [{ id: 't2', name: 'Bash', input: { command: 'rm -rf secret' } }, { id: 't3', name: 'Bash', input: { command: 'ls' } }] }),
    assistant('10:07', { id: 'm3', model: '<synthetic>', usage: use(999, 999) }),
    assistant('11:30', { id: 'm4', usage: use(7777, 7777), tools: [{ id: 't4', name: 'Write', input: { file_path: path.join(ann, 'late.js') } }] }),   // after ann's hold
  ].join('\n') + '\n');
  fs.mkdirSync(path.join(d, 's1', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(d, 's1', 'subagents', 'agent-x.jsonl'),
    assistant('10:40', { id: 'm5', usage: use(1, 2), tools: [{ id: 't5', name: 'Write', input: { file_path: '/elsewhere/notes.md' } }] }) + '\n');

  const r = await receipt.forTask(project, { number: 1, closedAt: T('12:00') }, { now: ms('12:01') });
  assert.deepEqual(r.retries, { reopened: 0, handoffs: 1 });
  const a = r.agents.find((x) => x.who === 'ann');
  assert.equal(a.available, true);
  assert.deepEqual(a.files, ['src/a.js', '/elsewhere/notes.md'], 'files inside the hold, by path in the agent folder when inside it');
  assert.equal(a.commands, 3, 'a count of commands, each tool call once though its message is restated');
  assert.ok(!JSON.stringify(r).includes('rm -rf'), 'never the text of a command');
  assert.deepEqual(a.models['claude-sonnet-5-5'], { input_tokens: 100 + 5 + 1, output_tokens: 50 + 5 + 2, cache_creation_input_tokens: 10, cache_read_input_tokens: 1000, rows: 3 });
  assert.equal(Object.keys(a.models).length, 1, 'a synthetic row is not a model');
  assert.equal(a.sessions, 2, 'the session and its subagent');
  assert.equal(a.folder, ann);
  const b = r.agents.find((x) => x.who === 'bob');
  assert.deepEqual([b.available, b.provider, b.because], [false, 'codex', 'provider']);
  assert.equal(b.models, undefined, 'no numbers for a provider this slice cannot read');
});

test('an open task has no receipt yet', async () => {
  assert.deepEqual(await receipt.forTask('px', { number: 1, closedAt: null }), { ready: false, because: 'open' });
  assert.deepEqual(await receipt.forTask('px', null), { ready: false, because: 'no-task' });
});

test('a receipt is kept once the close has settled, and worked out again when the task closes again', async () => {
  const project = 'p' + (++pn);
  const dee = worker('dee');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'dee' }, { at: '12:00', kind: 'closed' }]);
  const f = path.join(claudeDir(dee), 's.jsonl');
  fs.writeFileSync(f, assistant('10:10', { id: 'd1', usage: use(10, 1), tools: [{ id: 'dt1', name: 'Bash' }] }) + '\n');
  const task = { number: 1, closedAt: T('12:00') };
  const kept = receipt.receiptFile(project, 1);

  await receipt.forTask(project, task, { now: ms('12:01') });
  assert.equal(fs.existsSync(kept), false, 'not kept in the minutes after the close: transcripts may still be written');
  const first = await receipt.forTask(project, task, { now: ms('12:00') + receipt.SETTLE_MS });
  assert.equal(fs.existsSync(kept), true);
  fs.appendFileSync(f, assistant('10:20', { id: 'd2', usage: use(10, 1), tools: [{ id: 'dt2', name: 'Bash' }] }) + '\n');
  assert.deepEqual(await receipt.forTask(project, task, { now: ms('13:00') }), first, 'read once, then kept');
  const again = await receipt.forTask(project, { number: 1, closedAt: T('12:30') }, { now: ms('13:00') });
  assert.equal(again.agents[0].commands, 2, 'a new close time is worked out again');
});

test('an agent with no Claude activity while it held the task says so rather than showing zeros', async () => {
  const project = 'p' + (++pn);
  const eve = worker('eve');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'eve' }, { at: '11:00', kind: 'closed' }]);
  const f = path.join(claudeDir(eve), 'old.jsonl');
  fs.writeFileSync(f, assistant('10:30', { id: 'e1', usage: use(1, 1) }) + '\n');
  const before = new Date(ms('09:00'));
  fs.utimesSync(f, before, before);   // last written before the hold began: it cannot hold the hold's work
  const r = await receipt.forTask(project, { number: 1, closedAt: T('11:00') }, { now: ms('11:01') });
  assert.equal(r.agents[0].sessions, 0);
  assert.equal(r.agents[0].transcriptsRead, 0, 'a transcript last written before the hold is not read');
});

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
/* Slice 2: the Codex and Gemini homes fall under AGENT_WORKFORCE_HOME only when nothing else names them. */
for (const v of ['CODEX_HOME', 'AGENT_WORKFORCE_CODEX_HOME', 'GEMINI_CLI_HOME', 'AGENT_WORKFORCE_GEMINI_HOME', 'GROK_HOME', 'AGENT_WORKFORCE_GROK_HOME', 'AGENT_WORKFORCE_AGY_HOME']) delete process.env[v];
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
/* A tool's result, as Claude Code writes it on a user row. */
const result = (at, id, isError = false) => JSON.stringify({ type: 'user', timestamp: T(at),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: isError ? 'failed' : 'ok' }] } });
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
    result('10:05', 't1'),
    assistant('10:06', { id: 'm2', usage: use(5, 5), tools: [{ id: 't2', name: 'Bash', input: { command: 'rm -rf secret' } }, { id: 't3', name: 'Bash', input: { command: 'ls' } }] }),
    assistant('10:07', { id: 'm3', model: '<synthetic>', usage: use(999, 999) }),
    assistant('10:08', { id: 'm6', usage: use(0, 1), tools: [{ id: 't6', name: 'Edit', input: { file_path: path.join(ann, 'refused.js') } }] }),
    result('10:08', 't6', true),   // the edit failed: it changed nothing
    assistant('10:09', { id: 'm7', usage: use(0, 1), tools: [{ id: 't7', name: 'Write', input: { file_path: path.join(ann, 'unanswered.js') } }] }),   // no result came back
    assistant('11:30', { id: 'm4', usage: use(7777, 7777), tools: [{ id: 't4', name: 'Write', input: { file_path: path.join(ann, 'late.js') } }] }),   // after ann's hold
    result('11:30', 't4'),
  ].join('\n') + '\n');
  fs.mkdirSync(path.join(d, 's1', 'subagents'), { recursive: true });
  fs.writeFileSync(path.join(d, 's1', 'subagents', 'agent-x.jsonl'),
    assistant('10:40', { id: 'm5', usage: use(1, 2), tools: [{ id: 't5', name: 'Write', input: { file_path: '/elsewhere/notes.md' } }] }) + '\n'
    + result('10:40', 't5') + '\n');

  const r = await receipt.forTask(project, { number: 1, closedAt: T('12:00') }, { now: ms('12:01') });
  assert.deepEqual(r.retries, { reopened: 0, handoffs: 1 });
  const a = r.agents.find((x) => x.who === 'ann');
  assert.equal(a.available, true);
  assert.deepEqual(a.files, ['src/a.js', '/elsewhere/notes.md'], 'edits that succeeded inside the hold, by path in the agent folder when inside it; not a failed or unanswered one');
  assert.equal(a.commands, 3, 'a count of commands, each tool call once though its message is restated');
  assert.ok(!JSON.stringify(r).includes('rm -rf'), 'never the text of a command');
  assert.deepEqual(a.models['claude-sonnet-5-5'], { input_tokens: 100 + 5 + 1, output_tokens: 50 + 5 + 2 + 1 + 1, cache_creation_input_tokens: 10, cache_read_input_tokens: 1000, rows: 5 });
  assert.equal(Object.keys(a.models).length, 1, 'a synthetic row is not a model');
  assert.equal(a.transcriptsWithWork, 2, 'the session and its subagent');
  assert.equal(a.folder, ann);
  const b = r.agents.find((x) => x.who === 'bob');
  // Slice 2 reads Codex: bob has no Codex sessions on this sandbox, so his receipt shows no work, never invented numbers.
  assert.deepEqual([b.available, b.provider, b.transcriptsWithWork, b.commands, b.models], [true, 'codex', 0, 0, {}]);
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
  assert.equal(r.agents[0].transcriptsWithWork, 0);
  assert.equal(r.agents[0].transcriptsRead, 0, 'a transcript last written before the hold is not read');
});

test('a task closed by closing its last part (no closedAt of its own) has a receipt, dated by that part\'s close', async () => {
  const project = 'p' + (++pn);
  const fay = worker('fay');
  activity(project, 1, [
    { at: '10:00', kind: 'created', who: 'fay' },
    { at: '11:00', kind: 'part-closed', partId: 1 },
    { at: '11:00', kind: 'closed' },
  ]);
  fs.writeFileSync(path.join(claudeDir(fay), 's.jsonl'), assistant('10:30', { id: 'f1', usage: use(3, 3), tools: [{ id: 'ft1', name: 'Bash' }] }) + '\n');
  const task = { number: 1, closedAt: null, parts: [{ id: 1, who: 'fay', closedAt: T('11:00') }] };
  assert.equal(receipt.closedAtOf(task), T('11:00'));
  const r = await receipt.forTask(project, task, { now: ms('11:01') });
  assert.equal(r.closedAt, T('11:00'));
  assert.equal(r.agents[0].commands, 1);
  assert.equal(receipt.closedAtOf({ number: 2, closedAt: null, parts: [{ id: 1, who: 'fay', closedAt: T('11:00') }, { id: 2, who: 'fay', closedAt: null }] }), null, 'a part still open: the task is open');
});

test('a part added while the task is closed is held from the put-back, not from when it was added', () => {
  const h = receipt.holdsFrom([
    { at: T('10:00'), kind: 'created', who: 'ann' },
    { at: T('11:00'), kind: 'closed' },
    { at: T('12:00'), kind: 'part-added', partId: 2, who: 'gus' },
    { at: T('13:00'), kind: 'reopened' },
    { at: T('14:00'), kind: 'closed' },
  ], ms('14:00'));
  assert.deepEqual(h.gus, [{ from: ms('13:00'), to: ms('14:00') }]);
});

test('a transcript that cannot be read through is shown as far as read but never kept', async (t) => {
  const project = 'p' + (++pn);
  const hal = worker('hal');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'hal' }, { at: '11:00', kind: 'closed' }]);
  const d = claudeDir(hal);
  fs.writeFileSync(path.join(d, 'ok.jsonl'), assistant('10:10', { id: 'h1', usage: use(1, 1) }) + '\n');
  const locked = path.join(d, 'locked.jsonl');
  fs.writeFileSync(locked, assistant('10:20', { id: 'h2', usage: use(1, 1) }) + '\n');
  fs.chmodSync(locked, 0o000);
  /* Asked of the file, not of the host: where removing read permission does not stop a read (root, some file
     systems), this case cannot be set up, so it is skipped rather than passed. */
  let readable = false;
  try { fs.readFileSync(locked); readable = true; } catch { readable = false; }
  if (readable) { fs.chmodSync(locked, 0o600); t.skip('removing read permission does not stop a read here'); return; }
  try {
    const r = await receipt.forTask(project, { number: 1, closedAt: T('11:00') }, { now: ms('11:00') + receipt.SETTLE_MS });
    assert.equal(r.agents[0].complete, false);
    assert.equal(r.agents[0].models['claude-sonnet-5-5'].rows, 1, 'what could be read is shown');
    assert.equal(fs.existsSync(receipt.receiptFile(project, 1)), false, 'a partial read is not kept');
  } finally { fs.chmodSync(locked, 0o600); }
});

test('a tool result written in another transcript file still decides the edit, whichever file is read first', async () => {
  for (const [useFile, resultFile] of [['a.jsonl', 'b.jsonl'], ['b.jsonl', 'a.jsonl']]) {
    const project = 'p' + (++pn);
    const name = 'ivy' + pn;
    const ivy = worker(name);
    activity(project, 1, [{ at: '10:00', kind: 'created', who: name }, { at: '11:00', kind: 'closed' }]);
    const d = claudeDir(ivy);
    fs.writeFileSync(path.join(d, useFile), assistant('10:10', { id: 'i1', usage: use(1, 1), tools: [
      { id: 'it-ok', name: 'Edit', input: { file_path: path.join(ivy, 'kept.md') } },
      { id: 'it-bad', name: 'Edit', input: { file_path: path.join(ivy, 'failed.md') } }] }) + '\n');
    fs.writeFileSync(path.join(d, resultFile), result('10:10', 'it-ok') + '\n' + result('10:10', 'it-bad', true) + '\n');
    const r = await receipt.forTask(project, { number: 1, closedAt: T('11:00') }, { now: ms('11:01') });
    assert.deepEqual(r.agents[0].files, ['kept.md'], 'use in ' + useFile + ', results in ' + resultFile);
  }
});

test('two requests for one receipt at once share one reading; a different close time is its own', async () => {
  const project = 'p' + (++pn);
  const jo = worker('jo');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'jo' }, { at: '11:00', kind: 'closed' }]);
  fs.writeFileSync(path.join(claudeDir(jo), 's.jsonl'), assistant('10:10', { id: 'j1', usage: use(1, 1) }) + '\n');
  const task = { number: 1, closedAt: T('11:00') };
  const a = receipt.forTask(project, task, { now: ms('11:01') });
  const b = receipt.forTask(project, task, { now: ms('11:01') });
  const c = receipt.forTask(project, { number: 1, closedAt: T('11:30') }, { now: ms('11:31') });
  assert.equal(a, b, 'the second request did not share the first');
  assert.notEqual(a, c);
  await Promise.all([a, b, c]);
  assert.notEqual(receipt.forTask(project, task, { now: ms('11:01') }), a, 'a finished reading is not kept in flight');
});

/* ---- slice 2: Codex and Gemini CLI agents ---- */
const jl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

test('a Codex agent: commands in its exec scripts, files from patches that completed, tokens by the running total, only its folder and holds', async () => {
  const project = 'p' + (++pn);
  const kay = worker('kay');
  store.writeProfile('kay', { provider: 'openai' });
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'kay' }, { at: '11:00', kind: 'closed' }]);
  const d = path.join(SB, '.codex', 'sessions', '2026', '10', '01');
  fs.mkdirSync(d, { recursive: true });
  const ev = (at, type, payload) => ({ timestamp: T(at), type, payload });
  const tc = (at, input, cached, output) => ev(at, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } });
  const call = (at, id, src) => ev(at, 'response_item', { type: 'custom_tool_call', name: 'exec', call_id: id, input: src });
  const out = (at, id, text) => ev(at, 'response_item', { type: 'custom_tool_call_output', call_id: id, output: [{ type: 'input_text', text }] });
  const patch = (...files) => 'const r = await tools.apply_patch({patch:"*** Begin Patch\\n' + files.map((f) => '*** ' + f + '\\n+x\\n').join('') + '*** End Patch"});';
  fs.writeFileSync(path.join(d, 'rollout-2026-10-01T10-00-00-kay.jsonl'), jl([
    ev('10:00', 'session_meta', { cwd: fs.realpathSync(kay) }),
    ev('10:00', 'turn_context', { model: 'gpt-5.6-sol' }),
    call('10:05', 'c1', 'await tools.exec_command({cmd:"rm -rf secret"}); await tools.exec_command({cmd:"ls"});'),
    out('10:05', 'c1', 'Script completed\nWall time 1 seconds'),
    call('10:10', 'c2', patch('Add File: ' + path.join(fs.realpathSync(kay), 'src/new.js'), 'Update File: notes.md')),
    out('10:10', 'c2', 'Script completed\nWall time 1 seconds'),
    call('10:20', 'c3', patch('Update File: refused.md')),
    out('10:20', 'c3', 'Script failed: patch did not apply'),
    tc('10:30', 1000, 400, 100),
    call('11:30', 'c4', 'await tools.exec_command({cmd:"late"});'),   // after the hold
    tc('11:30', 1500, 400, 150),
  ]));
  fs.writeFileSync(path.join(d, 'rollout-2026-10-01T10-00-00-other.jsonl'), jl([
    ev('10:00', 'session_meta', { cwd: '/somewhere/else' }),
    call('10:05', 'o1', 'await tools.exec_command({cmd:"x"});'),
    out('10:05', 'o1', 'Script completed'),
  ]));
  const r = await receipt.forTask(project, { number: 1, closedAt: T('11:00') }, { now: ms('11:01') });
  const a = r.agents[0];
  assert.deepEqual([a.provider, a.available, a.complete], ['codex', true, true]);
  assert.equal(a.commands, 2, 'two commands in the hold; not the late one, not another folder\'s');
  assert.deepEqual(a.files, ['src/new.js', 'notes.md'], 'only the patch that completed');
  assert.deepEqual(a.models['gpt-5.6-sol'], { input_tokens: 600, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 400, rows: 1 });
  assert.equal(a.transcriptsWithWork, 1);
  assert.ok(!JSON.stringify(r).includes('rm -rf'), 'never the text of a command');
});

test('a Gemini CLI agent: a reply written twice counts once, an edit counts only when it succeeded', async () => {
  const project = 'p' + (++pn);
  const lu = worker('lu');
  store.writeProfile('lu', { provider: 'google' });
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'lu' }, { at: '11:00', kind: 'closed' }]);
  const slug = path.join(SB, '.gemini', 'tmp', 'lu-slug');
  fs.mkdirSync(path.join(slug, 'chats'), { recursive: true });
  fs.writeFileSync(path.join(slug, '.project_root'), fs.realpathSync(lu) + '\n');
  const msg = (status) => ({ id: 'g1', type: 'gemini', timestamp: T('10:15'), model: 'gemini-3.8-flash',
    tokens: { input: 300, output: 20, cached: 100, thoughts: 5, tool: 0 },
    toolCalls: [
      { id: 't-sh', name: 'run_shell_command', args: { command: 'secret stuff' }, status: 'success', timestamp: T('10:15') },
      { id: 't-w', name: 'write_file', args: { file_path: path.join(fs.realpathSync(lu), 'out.md') }, status, timestamp: T('10:15') },
      { id: 't-r', name: 'replace', args: { file_path: path.join(fs.realpathSync(lu), 'bad.md') }, status: 'error', timestamp: T('10:15') },
    ] });
  fs.writeFileSync(path.join(slug, 'chats', 'session-1.jsonl'), jl([msg('executing'), { $set: { messages: [msg('success')] } }]));
  const r = await receipt.forTask(project, { number: 1, closedAt: T('11:00') }, { now: ms('11:01') });
  const a = r.agents[0];
  assert.deepEqual([a.provider, a.available, a.complete], ['gemini', true, true]);
  assert.equal(a.commands, 1, 'the same call written twice is one command');
  assert.deepEqual(a.files, ['out.md'], 'the write that ended in success; not the failed replace');
  assert.deepEqual(a.models['gemini-3.8-flash'], { input_tokens: 200, output_tokens: 25, cache_creation_input_tokens: 0, cache_read_input_tokens: 100, rows: 1 });
  assert.ok(!JSON.stringify(r).includes('secret stuff'));
});

test('a Grok agent is still not read (not in this slice), never a guessed zero', async () => {
  const project = 'p' + (++pn);
  worker('mo');
  store.writeProfile('mo', { provider: 'xai' });
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'mo' }, { at: '11:00', kind: 'closed' }]);
  const a = (await receipt.forTask(project, { number: 1, closedAt: T('11:00') }, { now: ms('11:01') })).agents[0];
  assert.deepEqual([a.provider, a.available, a.because, a.models], ['grok', false, 'provider', undefined]);
});

test('a forked Codex session: the parent\'s replayed calls are not this hold\'s; calls after the fork are', async () => {
  const project = 'p' + (++pn);
  const nia = worker('nia');
  store.writeProfile('nia', { provider: 'openai' });
  activity(project, 1, [{ at: '09:00', kind: 'created', who: 'nia' }, { at: '11:00', kind: 'closed' }]);
  const d = path.join(SB, '.codex', 'sessions', '2026', '10', '01');
  fs.mkdirSync(d, { recursive: true });
  const ev = (at, type, payload) => ({ timestamp: T(at), type, payload });
  const call = (at, id) => ev(at, 'response_item', { type: 'custom_tool_call', name: 'exec', call_id: id, input: 'await tools.exec_command({cmd:"x"});' });
  const tc = (at, i, o) => ev(at, 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: i, cached_input_tokens: 0, output_tokens: o } } });
  fs.writeFileSync(path.join(d, 'rollout-2026-10-01T10-30-00-nia.jsonl'), jl([
    ev('10:30', 'session_meta', { cwd: fs.realpathSync(nia), forked_from_id: 'parent', timestamp: T('10:30') }),
    call('09:30', 'parent-1'),            // replayed from the parent, stamped before the fork
    call('10:20', 'parent-2'),            // replayed, still stamped before the fork; the replay carries no total
    call('10:40', 'own-1'),               // after the fork, BEFORE this file's first post-fork total
    tc('10:41', 700, 70),
  ]));
  const a = (await receipt.forTask(project, { number: 1, closedAt: T('11:00') }, { now: ms('11:01') })).agents[0];
  assert.equal(a.commands, 1, 'only the call made after the fork: not a replayed one, and not dropped for coming before a total');
});

test('a receipt kept by slice 1 with no Codex or Gemini agent is kept as it was, not worked out again', async () => {
  const project = 'p' + (++pn);
  worker('oz');
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'oz' }, { at: '11:00', kind: 'closed' }]);
  const kept = { version: 1, closedAt: T('11:00'), retries: { reopened: 0, handoffs: 0 },
    agents: [{ who: 'oz', provider: 'claude', available: true, commands: 7, files: ['a.md'], models: {}, transcriptsWithWork: 1 }] };
  const f = receipt.receiptFile(project, 1);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(kept));
  assert.equal((await receipt.forTask(project, { number: 1, closedAt: T('11:00') }, { now: ms('12:00') })).agents[0].commands, 7,
    'a good slice 1 receipt was thrown away (its transcripts may be gone)');
  kept.agents[0] = { who: 'oz', provider: 'codex', available: false, because: 'provider' };   // one slice 2 can now read
  fs.writeFileSync(f, JSON.stringify(kept));
  assert.equal((await receipt.forTask(project, { number: 1, closedAt: T('11:00') }, { now: ms('12:00') })).agents[0].available, true);
});

test('a Codex line that parses to null is skipped, and the files after it are still read', async () => {
  const project = 'p' + (++pn);
  const pip = worker('pip');
  store.writeProfile('pip', { provider: 'openai' });
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'pip' }, { at: '11:00', kind: 'closed' }]);
  const d = path.join(SB, '.codex', 'sessions', '2026', '10', '01');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'rollout-2026-10-01T09-00-00-aaa-null.jsonl'), 'null\n7\n');   // sorts first
  fs.writeFileSync(path.join(d, 'rollout-2026-10-01T10-00-00-pip.jsonl'), jl([
    { timestamp: T('10:00'), type: 'session_meta', payload: { cwd: fs.realpathSync(pip) } },
    { timestamp: T('10:05'), type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'p1', input: 'await tools.exec_command({cmd:"x"});' } },
  ]));
  const r = await receipt.forTask(project, { number: 1, closedAt: T('11:00') }, { now: ms('11:01') });
  assert.equal(r.agents[0].complete, true, 'a null line made the whole Codex scan fail');
  assert.equal(r.agents[0].commands, 1, 'the file after the bad one was not read');
});

test('a forked Codex session with no recorded fork time: everything before its first total is the replay', async () => {
  const project = 'p' + (++pn);
  const quin = worker('quin');
  store.writeProfile('quin', { provider: 'openai' });
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'quin' }, { at: '11:00', kind: 'closed' }]);
  const d = path.join(SB, '.codex', 'sessions', '2026', '10', '01');
  fs.mkdirSync(d, { recursive: true });
  const ev = (at, type, payload) => ({ ...(at ? { timestamp: T(at) } : {}), type, payload });
  const call = (at, id) => ev(at, 'response_item', { type: 'custom_tool_call', name: 'exec', call_id: id, input: 'await tools.exec_command({cmd:"x"});' });
  fs.writeFileSync(path.join(d, 'rollout-2026-10-01T10-00-00-quin.jsonl'), jl([
    ev(null, 'session_meta', { cwd: fs.realpathSync(quin), forked_from_id: 'parent' }),   // no time anywhere
    call('10:10', 'replayed-1'),
    ev('10:11', 'event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 500, cached_input_tokens: 0, output_tokens: 50 } } }),
    call('10:40', 'own-1'),
  ]));
  const a = (await receipt.forTask(project, { number: 1, closedAt: T('11:00') }, { now: ms('11:01') })).agents[0];
  assert.equal(a.commands, 1, 'the call before the first total is the replay; the one after it is real');
});

test('files are shown by their short path under either spelling of a linked agent folder; a same-prefix sibling stays full', { skip: (() => {
  try { const t = fs.mkdtempSync(path.join(SB, 'lnk-')); fs.symlinkSync(t, t + '-l'); return false; } catch { return 'links cannot be made here'; }
})() }, async () => {
  const project = 'p' + (++pn);
  const real = fs.mkdtempSync(path.join(SB, 'realfolder-'));
  fs.symlinkSync(real, path.join(SB, 'workers', 'rue'));          // the recorded folder is a link to the real one
  store.writeProfile('rue', { provider: 'google' });
  activity(project, 1, [{ at: '10:00', kind: 'created', who: 'rue' }, { at: '11:00', kind: 'closed' }]);
  const slug = path.join(SB, '.gemini', 'tmp', 'rue-slug');
  fs.mkdirSync(path.join(slug, 'chats'), { recursive: true });
  fs.writeFileSync(path.join(slug, '.project_root'), fs.realpathSync(real) + '\n');   // the session records the real spelling
  const write = (id, fp) => ({ id, name: 'write_file', args: { file_path: fp }, status: 'success', timestamp: T('10:15') });
  fs.writeFileSync(path.join(slug, 'chats', 'session-1.jsonl'), jl([{ id: 'r1', type: 'gemini', timestamp: T('10:15'), model: 'gemini-3.8-flash',
    tokens: { input: 1, output: 1, cached: 0, thoughts: 0, tool: 0 },
    toolCalls: [write('w1', path.join(fs.realpathSync(real), 'in.md')), write('w2', fs.realpathSync(real) + '2/sibling.md'),
      write('w3', path.join(fs.realpathSync(real), '..cache', 'x'))] }]));
  const a = (await receipt.forTask(project, { number: 1, closedAt: T('11:00') }, { now: ms('11:01') })).agents[0];
  assert.deepEqual(a.files, ['in.md', fs.realpathSync(real) + '2/sibling.md', path.join('..cache', 'x')]);
});

/* ---- slice 3: an agent's receipts ---- */
test('an agent\'s receipts: the closed tasks it held, newest close first, its own part of each, a limit with "more"', async () => {
  const projects = require('./projects');
  const sam = worker('sam');
  worker('tia');
  const pa = 'sa' + (++pn);
  const pb = 'sb' + (++pn);
  projects.writeAll([
    { id: pa, name: 'Alpha', agents: ['sam'], tasks: [
      { number: 1, sentence: 'first', closedAt: T('11:00') },
      { number: 2, sentence: 'still open', closedAt: null },
      { number: 3, sentence: 'by parts', closedAt: null, parts: [{ id: 1, who: 'sam', closedAt: T('13:00') }] },
      { number: 4, sentence: 'tia only', closedAt: T('14:00') },
    ] },
    { id: pb, name: 'Beta', agents: ['sam'], tasks: [{ number: 1, sentence: 'on beta', closedAt: T('12:00') }] },
  ]);
  activity(pa, 1, [{ at: '10:00', kind: 'created', who: 'sam' }, { at: '11:00', kind: 'closed' }]);
  activity(pa, 2, [{ at: '10:00', kind: 'created', who: 'sam' }]);
  activity(pa, 3, [{ at: '12:30', kind: 'created', who: 'sam' }, { at: '13:00', kind: 'part-closed', partId: 1 }, { at: '13:00', kind: 'closed' }]);
  activity(pa, 4, [{ at: '13:30', kind: 'created', who: 'tia' }, { at: '14:00', kind: 'closed' }]);
  activity(pb, 1, [{ at: '11:30', kind: 'created', who: 'sam' }, { at: '12:00', kind: 'closed' }]);
  fs.writeFileSync(path.join(claudeDir(sam), 's.jsonl'), assistant('10:30', { id: 's1', usage: use(5, 5), tools: [{ id: 'st1', name: 'Bash' }] }) + '\n');
  const all = await receipt.forAgent('sam', { now: ms('15:00') });
  assert.equal(all.ok, true);
  assert.deepEqual(all.receipts.map((x) => [x.projectName, x.number]), [['Alpha', 3], ['Beta', 1], ['Alpha', 1]],
    'newest close first; the open task and the task sam never held are left out');
  assert.equal(all.receipts[2].receipt.who, 'sam');
  assert.equal(all.receipts[2].receipt.commands, 1, 'its own part of the same receipt the task page shows');
  assert.equal(all.more, false);
  const two = await receipt.forAgent('sam', { limit: 2, now: ms('15:00') });
  assert.deepEqual([two.receipts.length, two.more], [2, true]);
  assert.deepEqual((await receipt.forAgent('nobody-here', { now: ms('15:00') })).receipts, []);
});

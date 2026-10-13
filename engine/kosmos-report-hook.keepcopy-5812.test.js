'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #5812 / #5153 on Windows: the node report hook (the win32 twin of install/kosmos-report-hook.sh) asks the board to
 * keep a copy, POST /api/undo/keep, just before Claude edits a file, as `kosmos keep-copy` does on the Mac. That one
 * call is what records which agent last changed a project file. Through the exported main, with an injected fetch.
 *   node --test engine/kosmos-report-hook.keepcopy-5812.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const hook = require('./kosmos-report-hook');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rhk5812-'));
const pre = (tool, input, extra) => ({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd: 'C:\\w\\agent', session_id: 'sess-1', ...extra });

/* A recording fetch: every call in order, answered by `answer` (default: ok). */
function recorder(answer) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    return answer ? answer(url, init) : { ok: true, status: 200, text: async () => '{"recorded":true,"kept":true}' };
  };
  return { calls, fetchImpl };
}
let n = 0;
async function run(evt, opts = {}) {
  const r = opts.rec || recorder();
  const code = await hook.main({
    input: JSON.stringify(evt), env: { KOSMOS_AGENT_TOKEN: 'ab12', ...(opts.env || {}) }, url: 'http://127.0.0.1:16180',
    boardToken: 'BT', fetchImpl: r.fetchImpl, throttleDir: path.join(TMP, 't' + (n++)), ppid: 4242,
    now: opts.now || (() => 1000), keepTimeoutMs: opts.keepTimeoutMs, stdout: () => {},
  });
  return { code, calls: r.calls };
}
const keeps = (calls) => calls.filter((c) => c.url.endsWith('/api/undo/keep'));

test('an Edit, a Write, a MultiEdit and a NotebookEdit each ask the board to keep a copy, with the folder and session', async () => {
  for (const [tool, input, file] of [
    ['Edit', { file_path: 'C:\\w\\agent\\notes.md', old_string: 'a', new_string: 'b' }, 'C:\\w\\agent\\notes.md'],
    ['Write', { file_path: 'C:\\w\\agent\\new file.md', content: 'x' }, 'C:\\w\\agent\\new file.md'],
    ['MultiEdit', { file_path: 'C:\\w\\agent\\m.js', edits: [] }, 'C:\\w\\agent\\m.js'],
    ['NotebookEdit', { notebook_path: 'C:\\w\\agent\\a.ipynb', new_source: 'x' }, 'C:\\w\\agent\\a.ipynb'],
  ]) {
    const { code, calls } = await run(pre(tool, input));
    assert.equal(code, 0);
    const k = keeps(calls);
    assert.equal(k.length, 1, tool + ' sends exactly one keep call');
    assert.deepEqual(k[0].body, { path: file, cwd: 'C:\\w\\agent', session: 'sess-1' }, tool);
    assert.equal(k[0].init.method, 'POST');
    assert.equal(calls[0].url.endsWith('/api/undo/keep'), true, tool + ': the keep call goes BEFORE the report');
  }
});

test('the keep call goes even when the heartbeat is not due, when no report is sent at all', async () => {
  const dir = path.join(TMP, 'shared');
  const rec = recorder();
  const opts = { input: JSON.stringify(pre('Edit', { file_path: 'C:\\w\\agent\\x.md' })), env: { KOSMOS_AGENT_TOKEN: 'ab12' },
    url: 'http://127.0.0.1:16180', boardToken: 'BT', fetchImpl: rec.fetchImpl, throttleDir: dir, ppid: 7, now: () => 5000, stdout: () => {} };
  await hook.main(opts);   // the first PreToolUse is due: keep + heartbeat
  const first = rec.calls.length;
  await hook.main(opts);   // same second: the heartbeat is NOT due
  const second = rec.calls.slice(first);
  assert.equal(second.filter((c) => c.url.endsWith('/api/report')).length, 0, 'control: no report on a throttled PreToolUse');
  assert.equal(keeps(second).length, 1, 'but the keep call still goes');
});

test('it carries the board token, the agent token and the world header; token-only sends no board token', async () => {
  const { calls } = await run(pre('Edit', { file_path: 'C:\\w\\agent\\notes.md' }));
  const h = keeps(calls)[0].init.headers;
  assert.equal(h['x-kosmos-board-token'], 'BT');
  assert.equal(h['x-kosmos-agent-token'], 'ab12');
  const { WORLD_HEADER } = require('./launchidentity');
  assert.ok(WORLD_HEADER in h, 'the world header names this agent\'s Kosmos');
  const only = await run(pre('Edit', { file_path: 'C:\\w\\agent\\notes.md' }), { env: { KOSMOS_AGENT_TOKEN_ONLY: '1' } });
  const h2 = keeps(only.calls)[0].init.headers;
  assert.equal(h2['x-kosmos-board-token'], undefined, 'token-only: no board token');
  assert.equal(h2['x-kosmos-agent-token'], 'ab12');
});

test('a command, a read, an edit with no path and another event send no keep call', async () => {
  assert.equal(keeps((await run(pre('Bash', { command: 'del notes.md' }))).calls).length, 0);
  assert.equal(keeps((await run(pre('Read', { file_path: 'C:\\w\\agent\\notes.md' }))).calls).length, 0);
  assert.equal(keeps((await run(pre('Edit', {}))).calls).length, 0);
  assert.equal(keeps((await run({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: 'C:\\x' } })).calls).length, 0);
  assert.equal(keeps((await run({ hook_event_name: 'Stop' })).calls).length, 0);
});

test('a control character in the path or the folder sends nothing (it would name a different file)', async () => {
  assert.equal(keeps((await run(pre('Edit', { file_path: 'C:\\w\\agent\\a\nb.md' }))).calls).length, 0);
  assert.equal(keeps((await run(pre('Edit', { file_path: 'C:\\w\\agent\\ok.md' }, { cwd: 'C:\\w\\ag\u0007ent' }))).calls).length, 0);
  assert.equal(keeps((await run(pre('Edit', { file_path: 'C:\\w\\agent\\tab\there.md' }))).calls).length, 0);
  assert.equal(keeps((await run(pre('Edit', { file_path: 'C:\\w\\agent\\fine name.md' }))).calls).length, 1, 'control: a space is fine');
});

test('a keep call that throws or is refused still lets the edit go ahead, and the heartbeat still reports', async () => {
  for (const answer of [
    (url) => { if (url.endsWith('/api/undo/keep')) throw new Error('ECONNREFUSED'); return { ok: true, status: 200, text: async () => '{"recorded":true}' }; },
    (url) => url.endsWith('/api/undo/keep') ? { ok: false, status: 500, text: async () => '{}' } : { ok: true, status: 200, text: async () => '{"recorded":true}' },
  ]) {
    const { code, calls } = await run(pre('Edit', { file_path: 'C:\\w\\agent\\n.md' }), { rec: recorder(answer) });
    assert.equal(code, 0);
    assert.equal(calls.filter((c) => c.url.endsWith('/api/report')).length, 1, 'the heartbeat report still goes');
  }
});

test('a board that never answers the keep call holds the edit no longer than the bound', { timeout: 5000 }, async () => {
  const hang = (url, init) => url.endsWith('/api/undo/keep')
    ? new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); })
    : { ok: true, status: 200, text: async () => '{"recorded":true}' };
  const t0 = Date.now();
  const { code } = await run(pre('Edit', { file_path: 'C:\\w\\agent\\n.md' }), { rec: recorder(hang), keepTimeoutMs: 150 });
  const took = Date.now() - t0;
  assert.equal(code, 0);
  assert.ok(took >= 140 && took < 2000, 'waited for the bound and no longer: ' + took + ' ms');
  assert.equal(hook.KEEP_TIMEOUT_MS, 3000, 'the real bound is the bash CLI\'s 3 s');
});

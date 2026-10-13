'use strict';
/* #5812: just before gemini writes or edits a file, its report bridge asks the board to keep a copy and note who is
 * writing (POST /api/undo/keep), as Claude Code's hook does. The payload shape is the one measured on gemini-cli
 * 0.61.0: BeforeTool, tool_name write_file or replace, tool_input.file_path RELATIVE to cwd. Through the exported main,
 * with an injected fetch, so nothing leaves this process.
 *   node --test gemini-report-bridge.keep-5812.test.js */
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const bridge = require('./bin/gemini-report-bridge');

const before = (tool, input, extra) => ({ session_id: 'g-sess', cwd: '/w/agent', hook_event_name: 'BeforeTool',
  timestamp: '2026-10-13T13:11:32.808Z', tool_name: tool, tool_input: input, ...extra });

function recorder() {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200 }; } };
}
async function run(evt, opts = {}) {
  const r = recorder();
  const out = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s, ...a) => { out.push(String(s)); return true; };
  try {
    await bridge.main({ input: JSON.stringify(evt), env: { KOSMOS_PORT: '16999', KOSMOS_AGENT_TOKEN: 'ab12', ...(opts.env || {}) },
      fetchImpl: r.fetchImpl, platform: opts.platform || 'darwin', keepTimeoutMs: opts.keepTimeoutMs });
  } finally { process.stdout.write = orig; }
  return { calls: r.calls, stdout: out.join('') };
}
const keeps = (calls) => calls.filter((c) => c.url.endsWith('/api/undo/keep'));

test('write_file asks the board to keep a copy, with the path made absolute against the agent\'s folder (it arrives relative)', async () => {
  const { calls, stdout } = await run(before('write_file', { file_path: 'probe.txt', content: 'hello' }));
  const k = keeps(calls);
  assert.equal(k.length, 1);
  assert.equal(k[0].url, 'http://127.0.0.1:16999/api/undo/keep');
  assert.deepEqual(k[0].body, { path: '/w/agent/probe.txt', cwd: '/w/agent', session: 'g-sess' });
  assert.equal(calls.filter((c) => c.url.endsWith('/api/report')).length, 0, 'BeforeTool sends no report');
  assert.equal(stdout, '', 'nothing printed: gemini runs the tool when the hook answers nothing');
});

test('replace does too, and an absolute path stays as it is', async () => {
  const k = keeps((await run(before('replace', { file_path: '/w/agent/sub/a.md', old_string: 'a', new_string: 'b' }))).calls);
  assert.deepEqual(k[0].body, { path: '/w/agent/sub/a.md', cwd: '/w/agent', session: 'g-sess' });
  const k2 = keeps((await run(before('replace', { file_path: 'sub/../b.md' }))).calls);
  assert.equal(k2[0].body.path, '/w/agent/b.md', 'resolved, not just joined');
});

test('it carries the agent token, the board-token rule and the world header the report carries', async () => {
  const k = keeps((await run(before('write_file', { file_path: 'x' }))).calls)[0];
  assert.equal(k.init.headers['x-kosmos-agent-token'], 'ab12');
  const { WORLD_HEADER } = require('./engine/launchidentity');
  assert.ok(k.init.headers[WORLD_HEADER], 'the world header is sent');
  const only = keeps((await run(before('write_file', { file_path: 'x' }), { env: { KOSMOS_AGENT_TOKEN_ONLY: '1' } })).calls)[0];
  assert.equal(only.init.headers['x-kosmos-board-token'], undefined, 'token-only: no board token');
});

test('another tool, another event, no path, or a relative path with no folder sends nothing', async () => {
  assert.equal(keeps((await run(before('run_shell_command', { command: 'rm x' }))).calls).length, 0);
  assert.equal(keeps((await run(before('read_file', { file_path: 'x' }))).calls).length, 0);
  assert.equal(keeps((await run(before('write_file', {}))).calls).length, 0);
  assert.equal(keeps((await run(before('write_file', { file_path: 'x' }, { cwd: '' }))).calls).length, 0);
  assert.equal(keeps((await run(before('write_file', { file_path: 'x' }, { hook_event_name: 'AfterTool' }))).calls).length, 0);
  assert.equal(keeps((await run(before('write_file', { file_path: '/abs/x' }, { cwd: '' }))).calls).length, 1, 'control: an absolute path needs no folder');
});

test('a control character in the path or folder sends nothing', async () => {
  assert.equal(keeps((await run(before('write_file', { file_path: 'a\nb' }))).calls).length, 0);
  assert.equal(keeps((await run(before('write_file', { file_path: 'ok' }, { cwd: '/w/ag\u0007ent' }))).calls).length, 0);
  assert.equal(keeps((await run(before('write_file', { file_path: 'fine name.md' }))).calls).length, 1, 'control: a space is fine');
});

test('on win32 the path resolves the Windows way, and a UNC path or folder sends nothing', async () => {
  const k = keeps((await run(before('write_file', { file_path: 'notes\\a.md' }, { cwd: 'C:\\w\\agent' }), { platform: 'win32' })).calls);
  assert.equal(k[0].body.path, 'C:\\w\\agent\\notes\\a.md');
  for (const [file, cwd] of [['\\\\srv\\share\\x.md', 'C:\\w'], ['x.md', '\\\\srv\\share\\w'], ['//srv/share/x', 'C:\\w']]) {
    assert.equal(keeps((await run(before('write_file', { file_path: file }, { cwd }), { platform: 'win32' })).calls).length, 0, file + ' in ' + cwd);
  }
});

test('the lifecycle events still report, and send no keep call', async () => {
  const { calls } = await run({ hook_event_name: 'AfterAgent', prompt: 'p', prompt_response: 'done' });
  assert.equal(keeps(calls).length, 0);
  assert.equal(calls.filter((c) => c.url.endsWith('/api/report')).length, 1);
});

test('a keep call that never answers is given up at the bound, and the bridge still ends', { timeout: 5000 }, async () => {
  let aborted = false;
  const fetchImpl = (url, init) => new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }); });
  const t0 = Date.now();
  await bridge.main({ input: JSON.stringify(before('write_file', { file_path: 'x' })), env: { KOSMOS_PORT: '16999' }, fetchImpl, platform: 'darwin', keepTimeoutMs: 150 });
  assert.equal(aborted, true);
  assert.ok(Date.now() - t0 >= 140);
  assert.equal(bridge.KEEP_TIMEOUT_MS, 3000);
});

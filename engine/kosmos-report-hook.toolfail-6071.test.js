'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* #6071 (slice D1) on Windows: the node report hook sends a failed tool call (PostToolUseFailure) to the board as a
 * digest, POST /api/toolfail, as `kosmos tool-failed` does on the Mac, and writes no report. Through the exported
 * main, with an injected fetch.
 *   node --test engine/kosmos-report-hook.toolfail-6071.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const hook = require('./kosmos-report-hook');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rhtf6071-'));
const fail = (tool, input, error, extra) => ({ hook_event_name: 'PostToolUseFailure', tool_name: tool, tool_input: input,
  tool_use_id: 'toolu_' + Math.random().toString(36).slice(2), error, error_type: 'error', is_interrupt: false,
  is_timeout: false, session_id: 'sess-1', cwd: 'C:\\w\\agent', ...(extra || {}) });

function recorder() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, text: async () => '{"recorded":true}' };
  };
  return { calls, fetchImpl };
}
let n = 0;
async function run(evt) {
  const r = recorder();
  const code = await hook.main({
    input: JSON.stringify(evt), env: { KOSMOS_AGENT_TOKEN: 'ab12' }, url: 'http://127.0.0.1:16180',
    boardToken: 'BT', fetchImpl: r.fetchImpl, throttleDir: path.join(TMP, 't' + (n++)), ppid: 4242,
    now: () => 1000, stdout: () => {}, platform: 'win32',
  });
  return { code, calls: r.calls };
}

test('a failed tool call posts its digest to /api/toolfail with both tokens, and sends no report', async () => {
  const { code, calls } = await run(fail('Bash', { command: 'npm test' }, 'Exit code 1\nnpm ERR! test failed'));
  assert.equal(code, 0);
  assert.equal(calls.length, 1, JSON.stringify(calls.map((c) => c.url)));
  assert.ok(calls[0].url.endsWith('/api/toolfail'));
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-kosmos-board-token'], 'BT');
  assert.equal(calls[0].init.headers['x-kosmos-agent-token'], 'ab12');
  const b = calls[0].body;
  assert.equal(b.tool, 'Bash');
  assert.equal(b.error, 'Exit code 1', 'only the first line of the error');
  assert.match(b.sig, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(b).includes('npm test'), 'the input itself is not sent');
});

test('the signature is the same for the same failure, whatever its tool_use_id or key order', () => {
  const a = hook.failureRequestFor(fail('Edit', { file_path: 'C:\\a', old_string: 'x', new_string: 'y' }, 'String not found'));
  const b = hook.failureRequestFor(fail('Edit', { new_string: 'y', old_string: 'x', file_path: 'C:\\a' }, 'String not found'));
  assert.equal(a.sig, b.sig);
  assert.notEqual(hook.failureRequestFor(fail('Edit', { file_path: 'C:\\b', old_string: 'x', new_string: 'y' }, 'String not found')).sig, a.sig, 'another input');
  assert.notEqual(hook.failureRequestFor(fail('Edit', { file_path: 'C:\\a', old_string: 'x', new_string: 'y' }, 'Other error')).sig, a.sig, 'another error');
});

test('an interrupt, or another event, gives no digest', async () => {
  assert.equal(hook.failureRequestFor(fail('Bash', { command: 'x' }, 'Interrupted', { is_interrupt: true })), null);
  assert.equal(hook.failureRequestFor({ hook_event_name: 'PostToolUse', tool_name: 'Bash' }), null);
  const { calls } = await run(fail('Bash', { command: 'x' }, 'Interrupted', { is_interrupt: true }));
  assert.equal(calls.length, 0, 'an interrupt sends nothing at all');
});

test('a board that does not answer never holds the agent and never throws', async () => {
  const r = await hook.toolFailed({ tool: 'Bash', sig: 'a'.repeat(64), error: 'e' }, {
    url: 'http://127.0.0.1:1', fetchImpl: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))),
    timeoutMs: 50,
  });
  assert.equal(r.ok, false);
});

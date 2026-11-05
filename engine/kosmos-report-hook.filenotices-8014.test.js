'use strict';
require('../test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
/* kosmos#8014: the win32 node report hook hands an agent its file-owner notices at UserPromptSubmit, as
 * install/kosmos-report-hook.sh does since #8011 (#7989 slice 3). Mirrors report-hook-filenotices-7989.test.js, through
 * the exported main with an injected fetch.
 *   node --test engine/kosmos-report-hook.filenotices-8014.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const hook = require('./kosmos-report-hook');

const EVERY = 300;   // FILE_NOTICE_EVERY in engine/kosmos-report-hook.js, as install/kosmos-report-hook.sh
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rhk8014-'));
const HOOK_JSON = '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Kosmos: another agent is about to change notes.md, a file you were first seen changing."}}';
const prompt = { hook_event_name: 'UserPromptSubmit', prompt: 'carry on', session_id: 's1' };

/* A recording fetch: the report route answers recorded; the notices route answers `notices` (a string, a status, or a throw). */
function recorder(notices) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/api/file-notices/take')) {
      const n = typeof notices === 'function' ? notices(url) : notices;
      if (n instanceof Error) throw n;
      if (n && typeof n === 'object') return { ok: false, status: n.status, text: async () => n.body || '' };
      return { ok: true, status: 200, text: async () => (n === undefined ? '' : n) };
    }
    return { ok: true, status: 200, text: async () => '{"recorded":true}' };
  };
  return { calls, fetchImpl };
}
let n = 0;
function dir() { return path.join(TMP, 't' + (n++)); }
async function run(evt, opts = {}) {
  const r = opts.rec || recorder(opts.notices);
  const out = [];
  const env = opts.env !== undefined ? opts.env : { KOSMOS_AGENT_TOKEN: 'a1a1a1' };
  const code = await hook.main({
    input: JSON.stringify(evt), env, url: 'http://127.0.0.1:16180', boardToken: 'BT', fetchImpl: r.fetchImpl,
    throttleDir: opts.throttleDir || dir(), ppid: opts.ppid || 4242, now: opts.now || (() => 10000),
    stdout: (s) => out.push(s), platform: 'win32',
  });
  return { code, calls: r.calls, out: out.join('') };
}
const takes = (calls) => calls.filter((c) => c.url.includes('/api/file-notices/take'));
const keyFor = (tok) => 'agent-' + crypto.createHash('sha256').update(tok).digest('hex').slice(0, 16) + '.filenotices';

test('UserPromptSubmit prints the board\'s hook JSON, after the working report, asking as=hook with the agent token', async () => {
  const r = await run(prompt, { notices: 'ack:a1b2\n' + HOOK_JSON });
  assert.equal(r.code, 0);
  assert.equal(r.out, HOOK_JSON + '\n');
  const t = takes(r.calls);
  assert.equal(t.length, 1);
  assert.match(t[0].url, /\/api\/file-notices\/take\?as=hook&from_pane=&ack=$/);
  assert.equal(t[0].init.method, 'POST');
  assert.equal(t[0].init.headers['x-kosmos-agent-token'], 'a1a1a1');
  assert.ok(r.calls.findIndex((c) => c.url.endsWith('/api/report')) < r.calls.indexOf(t[0]), 'the working report did not come first');
});

test('anything that is not the hook JSON is dropped: nothing, other words, a refusal, or a failed fetch', async () => {
  for (const notices of ['', 'some other words', 'ack:a1\nnot json', { status: 401, body: 'refused' }, new Error('ECONNREFUSED')]) {
    const r = await run(prompt, { notices });
    assert.equal(r.code, 0);
    assert.equal(r.out, '', 'printed for ' + String(notices && notices.status || notices));
  }
});

test('an agent asks at most once per FILE_NOTICE_EVERY: a second prompt soon after makes no call; a stale mark asks again', async () => {
  const d = dir();
  const first = await run(prompt, { throttleDir: d, now: () => 10000, notices: '' });
  assert.equal(takes(first.calls).length, 1);
  const soon = await run(prompt, { throttleDir: d, now: () => 10000 + EVERY - 1, notices: '' });
  assert.equal(takes(soon.calls).length, 0, 'asked again inside the window');
  const later = await run(prompt, { throttleDir: d, now: () => 10000 + EVERY, notices: '' });
  assert.equal(takes(later.calls).length, 1, 'did not ask once the window passed');
  // CONTROL: the working report is still sent on every prompt; only the notices are throttled.
  assert.equal(soon.calls.filter((c) => c.url.endsWith('/api/report')).length, 1);
});

test('a mark that cannot be written means no call: the cost would land on every turn', async () => {
  const d = dir();
  fs.mkdirSync(path.join(d, keyFor('a1a1a1')), { recursive: true });   // a folder where the mark file goes
  const r = await run(prompt, { throttleDir: d, notices: 'ack:a1\n' + HOOK_JSON });
  assert.equal(takes(r.calls).length, 0);
  assert.equal(r.out, '');
});

test('the mark and ack file are the agent\'s: one agent in two sessions shares them, two agents do not', async () => {
  const d = dir();
  const a1 = await run(prompt, { throttleDir: d, ppid: 1, notices: '' });
  const a2 = await run(prompt, { throttleDir: d, ppid: 2, notices: '' });   // same token, another session process
  assert.equal(takes(a1.calls).length, 1);
  assert.equal(takes(a2.calls).length, 0, 'the same agent was asked twice inside the window');
  const b = await run(prompt, { throttleDir: d, ppid: 1, env: { KOSMOS_AGENT_TOKEN: 'b2b2b2' }, notices: '' });
  assert.equal(takes(b.calls).length, 1, 'another agent was held by this one\'s mark');
  assert.ok(fs.existsSync(path.join(d, keyFor('a1a1a1'))) && fs.existsSync(path.join(d, keyFor('b2b2b2'))));
});

test('no agent token (the person\'s own session, or a launch whose token failed): no call, the board could not say who asks', async () => {
  const r = await run(prompt, { env: {}, notices: 'ack:a1\n' + HOOK_JSON });
  assert.equal(takes(r.calls).length, 0);
  assert.equal(r.out, '');
  // A token this hook would not send (not hex) is no token either: the call would go out without it.
  const odd = await run(prompt, { env: { KOSMOS_AGENT_TOKEN: 'not-a-token' }, notices: 'ack:a1\n' + HOOK_JSON });
  assert.equal(takes(odd.calls).length, 0);
});

test('the ids handed over are sent back next time, and an empty answer clears them', async () => {
  const d = dir();
  await run(prompt, { throttleDir: d, now: () => 10000, notices: 'ack:a1,b2\n' + HOOK_JSON });
  assert.equal(fs.readFileSync(path.join(d, keyFor('a1a1a1') + '-ack'), 'utf8'), 'a1,b2\n');
  const next = await run(prompt, { throttleDir: d, now: () => 10000 + EVERY, notices: '' });
  assert.match(takes(next.calls)[0].url, /&ack=a1,b2$/);
  assert.equal(fs.readFileSync(path.join(d, keyFor('a1a1a1') + '-ack'), 'utf8'), '', 'an empty answer left the old ids to be sent again');
  // An ack file that is not ids is never sent.
  fs.writeFileSync(path.join(d, keyFor('a1a1a1') + '-ack'), 'x&y=1\n');
  const bad = await run(prompt, { throttleDir: d, now: () => 10000 + 2 * EVERY, notices: '' });
  assert.match(takes(bad.calls)[0].url, /&ack=$/);
});

test('a listener that cannot prove it is the board gets no notices call (the token never goes to it)', async () => {
  const r = recorder('ack:a1\n' + HOOK_JSON);
  const out = [];
  await hook.main({
    input: JSON.stringify(prompt), env: { KOSMOS_AGENT_TOKEN: 'a1a1a1' }, url: 'http://127.0.0.1:16180', boardToken: 'BT', fetchImpl: r.fetchImpl,
    proveBoard: async () => ({ ok: false }), throttleDir: dir(), ppid: 4242, now: () => 10000, stdout: (x) => out.push(x), platform: 'win32',
  });
  assert.equal(takes(r.calls).length, 0);
  assert.equal(out.join(''), '');
});

test('no other event asks for file notices', async () => {
  for (const evt of [
    { hook_event_name: 'SessionStart', source: 'startup' },
    { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'C:\\w\\a.md' } },
    { hook_event_name: 'Stop' },
    { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'ls' } },
  ]) {
    const r = await run(evt, { notices: 'ack:a1\n' + HOOK_JSON });
    assert.equal(takes(r.calls).length, 0, evt.hook_event_name + ' asked');
    assert.doesNotMatch(r.out, /hookSpecificOutput/);
  }
});

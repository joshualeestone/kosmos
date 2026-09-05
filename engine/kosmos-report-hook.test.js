'use strict';
/**
 * The native-win32 Layer 1 report writer (#570): the node twin of the bash
 * hook. These tests drive the pure mapping (event -> report word + fields, the
 * #1058 source guard, the PreToolUse throttle) and the POST client (an injected
 * fetch asserts the URL, the two token headers, and the /api/report body) so no
 * test touches the network. The event->word table here is checked against the
 * bash hook's table verbatim; if the two ever drift, one of these fails.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const hook = require('./kosmos-report-hook');

const evt = (name, extra) => JSON.stringify({ hook_event_name: name, ...(extra || {}) });

test('reportFor maps every event to the bash hook word, with auto:true', () => {
  assert.equal(hook.reportFor({ hook_event_name: 'SessionStart', source: 'startup' }).state, 'started');
  assert.equal(hook.reportFor({ hook_event_name: 'UserPromptSubmit' }).state, 'working');
  assert.equal(hook.reportFor({ hook_event_name: 'Stop' }).state, 'idle');
  assert.equal(hook.reportFor({ hook_event_name: 'SessionEnd' }).state, 'stopped');
  const blk = hook.reportFor({ hook_event_name: 'StopFailure', matcher: 'rate_limit' });
  assert.equal(blk.state, 'blocked');
  assert.equal(blk.on, 'provider api (rate_limit)');
  assert.equal(blk.owner, 'provider');
  // Every mapped report is machine-written.
  for (const e of ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd', 'StopFailure']) {
    const r = hook.reportFor({ hook_event_name: e, source: 'startup' });
    assert.equal(r.auto, true, e + ' must send auto:true');
  }
});

test('PermissionRequest carries the tool and command in the sentence', () => {
  const r = hook.reportFor({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/x' } });
  assert.equal(r.state, 'needs_you');
  assert.equal(r.text, 'asking permission to use Bash: rm -rf /tmp/x');
  // No command field -> just the tool.
  const r2 = hook.reportFor({ hook_event_name: 'PermissionRequest', tool_name: 'Read' });
  assert.equal(r2.text, 'asking permission to use Read');
  // No tool at all -> "a tool", never blank.
  const r3 = hook.reportFor({ hook_event_name: 'PermissionRequest' });
  assert.equal(r3.text, 'asking permission to use a tool');
});

test('#1058 SessionStart source guard: startup or absent reports started; a continuation does not', () => {
  assert.ok(hook.reportFor({ hook_event_name: 'SessionStart', source: 'startup' }), 'startup must report');
  assert.ok(hook.reportFor({ hook_event_name: 'SessionStart' }), 'a missing source must still report (older Claude Code)');
  assert.equal(hook.reportFor({ hook_event_name: 'SessionStart', source: 'compact' }), null, 'a compaction must NOT clear a waiting state');
  assert.equal(hook.reportFor({ hook_event_name: 'SessionStart', source: 'resume' }), null, 'a resume must NOT clear a waiting state');
});

test('PreToolUse only reports when the heartbeat is due, and names the tool', () => {
  assert.equal(hook.reportFor({ hook_event_name: 'PreToolUse', tool_name: 'Edit' }, { heartbeatDue: false }), null);
  const r = hook.reportFor({ hook_event_name: 'PreToolUse', tool_name: 'Edit' }, { heartbeatDue: true });
  assert.equal(r.state, 'working');
  assert.equal(r.text, 'running Edit');
});

test('only SessionStart-started is loud; an unknown event maps to nothing', () => {
  assert.equal(hook.reportFor({ hook_event_name: 'SessionStart', source: 'startup' }).loud, true);
  assert.equal(hook.reportFor({ hook_event_name: 'Stop' }).loud, false);
  assert.equal(hook.reportFor({ hook_event_name: 'Notification' }), null);
  assert.equal(hook.reportFor({}), null);
});

test('resolvePort: KOSMOS_PORT wins; the uid fallback mirrors install/kosmos exactly; win32 (uid -1) -> default', () => {
  assert.equal(hook.resolvePort({ KOSMOS_PORT: '17777' }, 1000), 17777);
  // Mirrors the CLI's `id -u` branch: uid 501 -> the primary port, every other
  // real uid -> the per-uid offset. Measured against install/kosmos, not assumed.
  assert.equal(hook.resolvePort({}, 501), hook.DEFAULT_PORT, 'the primary account (uid 501) maps to the primary port, as the CLI does');
  assert.equal(hook.resolvePort({}, 1000), hook.DEFAULT_PORT + 1 + (1000 % 3999));
  assert.equal(hook.resolvePort({}, 0), hook.DEFAULT_PORT + 1 + (0 % 3999), 'uid 0 is NOT special-cased by the CLI (only 501 is)');
  assert.equal(hook.resolvePort({}, -1), hook.DEFAULT_PORT, 'win32 uid -1 must not produce a negative-modulus port');
  assert.equal(hook.resolvePort({ KOSMOS_PORT: 'junk' }, 1000), hook.DEFAULT_PORT + 1 + (1000 % 3999), 'a junk port is ignored');
});

test('agentToken accepts only a bare hex string; readBoardToken tolerates an absent file', () => {
  assert.equal(hook.agentToken({ KOSMOS_AGENT_TOKEN: 'deadbeef00' }), 'deadbeef00');
  assert.equal(hook.agentToken({ KOSMOS_AGENT_TOKEN: 'NOT-HEX!' }), null);
  assert.equal(hook.agentToken({}), null);
  assert.equal(hook.readBoardToken('/no/such/dir/anywhere'), null);
  // A real board.token round-trips.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-hook-bt-'));
  fs.writeFileSync(path.join(dir, 'board.token'), 'abc123\n');
  assert.equal(hook.readBoardToken(dir), 'abc123');
});

test('deliver POSTs to /api/report with the two token headers and the CLI body shape', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, text: async () => '{"recorded":true}' }; };
  const report = { state: 'needs_you', text: 'asking', on: '', owner: '', until: '', project: '', auto: true };
  const v = await hook.deliver(report, { url: 'http://127.0.0.1:16180', boardToken: 'BT', agentToken: 'ff00', fetchImpl, fromPane: '%3' });
  assert.equal(v.ok, true);
  assert.equal(v.recorded, true);
  assert.equal(seen.url, 'http://127.0.0.1:16180/api/report');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['x-kosmos-board-token'], 'BT');
  assert.equal(seen.init.headers['x-kosmos-agent-token'], 'ff00');
  const body = JSON.parse(seen.init.body);
  assert.deepEqual(body, { state: 'needs_you', text: 'asking', on: '', owner: '', until: '', project: '', auto: true, from_pane: '%3' });
});

test('deliver omits a token header when the token is absent, and never throws on a network error', async () => {
  let headers = null;
  const okFetch = async (_u, init) => { headers = init.headers; return { ok: true, status: 200, text: async () => '{"recorded":true}' }; };
  await hook.deliver({ state: 'idle', auto: true }, { url: 'http://x', fetchImpl: okFetch });
  assert.ok(!('x-kosmos-board-token' in headers), 'a null board token must omit the header');
  assert.ok(!('x-kosmos-agent-token' in headers), 'a null agent token must omit the header');
  // A throwing fetch is caught and reported, not raised.
  const v = await hook.deliver({ state: 'idle', auto: true }, { url: 'http://x', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(v.ok, false);
  assert.match(v.error, /ECONNREFUSED/);
});

test('deliver reports ok:false when the board answers non-200 or does not record', async () => {
  const refused = async () => ({ ok: false, status: 403, text: async () => '{"error":"cross-account"}' });
  const v = await hook.deliver({ state: 'idle', auto: true }, { url: 'http://x', fetchImpl: refused });
  assert.equal(v.ok, false);
  assert.equal(v.status, 403);
  // 200 but not recorded (e.g. identity could not be matched) is still not ok.
  const notRecorded = async () => ({ ok: true, status: 200, text: async () => '{"recorded":false,"because":"no agent"}' });
  const v2 = await hook.deliver({ state: 'idle', auto: true }, { url: 'http://x', fetchImpl: notRecorded });
  assert.equal(v2.ok, false);
  assert.equal(v2.recorded, false);
});

function mainIo(input, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-hook-main-'));
  return {
    input,
    env: (extra && extra.env) || {},
    uid: -1,
    storeRoot: null,           // no board token
    throttleDir: path.join(dir, 'throttle'),
    now: (extra && extra.now) || (() => 1000),
    url: 'http://127.0.0.1:16180',
    ...(extra || {}),
  };
}

test('main: a mapped event POSTs the right word; SessionEnd -> stopped', async () => {
  let seen = null;
  const io = mainIo(evt('SessionEnd'), { fetchImpl: async (u, i) => { seen = { u, i }; return { ok: true, status: 200, text: async () => '{"recorded":true}' }; } });
  const code = await hook.main(io);
  assert.equal(code, 0);
  assert.equal(seen.u, 'http://127.0.0.1:16180/api/report');
  assert.equal(JSON.parse(seen.i.body).state, 'stopped');
});

test('main: an empty/garbage stdin sends nothing and exits 0', async () => {
  let called = false;
  const io = mainIo('not json at all', { fetchImpl: async () => { called = true; return { ok: true, status: 200, text: async () => '{}' }; } });
  assert.equal(await hook.main(io), 0);
  assert.equal(called, false, 'no event -> no POST');
});

test('main: a compaction SessionStart sends nothing (source guard), a startup one POSTs started', async () => {
  let n = 0;
  const fetchImpl = async () => { n += 1; return { ok: true, status: 200, text: async () => '{"recorded":true}' }; };
  await hook.main(mainIo(evt('SessionStart', { source: 'compact' }), { fetchImpl }));
  assert.equal(n, 0, 'a compaction must not report');
  let seen = null;
  await hook.main(mainIo(evt('SessionStart', { source: 'startup' }), { fetchImpl: async (u, i) => { seen = i; return { ok: true, status: 200, text: async () => '{"recorded":true}' }; } }));
  assert.equal(JSON.parse(seen.body).state, 'started');
});

test('main: SessionStart says reporting is OFF, out loud, when delivery fails', async () => {
  let msg = '';
  const io = mainIo(evt('SessionStart', { source: 'startup' }), {
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    stdout: (s) => { msg += s; },
  });
  await hook.main(io);
  const parsed = JSON.parse(msg);
  assert.match(parsed.systemMessage, /reporting is OFF/);
  assert.match(parsed.systemMessage, /ECONNREFUSED/);
});

test('main: a NON-loud event stays silent on a delivery failure', async () => {
  let msg = '';
  const io = mainIo(evt('Stop'), {
    fetchImpl: async () => { throw new Error('down'); },
    stdout: (s) => { msg += s; },
  });
  assert.equal(await hook.main(io), 0);
  assert.equal(msg, '', 'a non-SessionStart failure must not print to the person');
});

test('main throttles PreToolUse: the first heartbeat fires, an immediate second does not', async () => {
  let n = 0;
  const fetchImpl = async () => { n += 1; return { ok: true, status: 200, text: async () => '{"recorded":true}' }; };
  // Shared throttle dir + fixed clock across the two calls.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-hook-thr-'));
  const base = { env: { TMUX_PANE: '%9' }, uid: -1, storeRoot: null, throttleDir: dir, now: () => 5000, url: 'http://127.0.0.1:16180', fetchImpl };
  await hook.main({ input: evt('PreToolUse', { tool_name: 'Edit' }), ...base });
  await hook.main({ input: evt('PreToolUse', { tool_name: 'Edit' }), ...base });
  assert.equal(n, 1, 'the second PreToolUse within the window must be throttled');
});

'use strict';

/**
 * #5495: after #5406 Kosmos's own PermissionRequest hook answers allow for most requests, so no prompt shows. The report
 * hook fires on the same event and used to show the agent as "needs you" anyway, until the next heartbeat. Now, when the
 * agent runs with Kosmos's settings file (its env names the allow hook), the report hook asks the same decide() and
 * reports working for a request it allows. A request the allow hook leaves alone still reports needs-you.
 *
 * Drives the REAL shell hook (with jq and without) and the REAL node hook (Windows), with the REAL allow hook. The CLI
 * the shell hook reports through is a stub that writes its arguments to a file; the node hook's POST is captured.
 * Every case has a control: the same request without the env names reports needs-you.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ap = require('./engine/agentpermission');
const nodeHook = require('./engine/kosmos-report-hook');

const HOOK = path.join(__dirname, 'install', 'kosmos-report-hook.sh');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-5495-'));
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const KOSMOS_ENV = { [ap.ENV_NODE]: process.execPath, [ap.ENV_SCRIPT]: ap.HOOK_SCRIPT };
const req = (tool, toolInput) => JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: tool, tool_input: toolInput, session_id: 's' });

let n = 0;
/** Run the shell hook; return the arguments it reported with (the stub writes them; the report is backgrounded). */
function runShell(payload, { env: extra = {}, noJq = false } = {}) {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'run-'));
  const out = path.join(dir, 'reported.txt');
  const stub = path.join(dir, 'kosmos');
  fs.writeFileSync(stub, '#!/bin/sh\nprintf "%s|" "$@" > "' + out + '.tmp" && mv "' + out + '.tmp" "' + out + '"\n', { mode: 0o755 });
  const env = { ...process.env, KOSMOS_REPORT_CLI: stub, TMPDIR: dir, HOME: dir, ...extra };
  for (const k of ['TMUX_PANE', 'KOSMOS_AGENT_SESSION', 'KOSMOS_AGENT_TOKEN', ap.ENV_NODE, ap.ENV_SCRIPT]) if (!(k in extra)) delete env[k];
  if (noJq) env.KOSMOS_REPORT_HOOK_NO_JQ = '1'; else delete env.KOSMOS_REPORT_HOOK_NO_JQ;
  const r = spawnSync('/bin/bash', [HOOK], { input: payload, env, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, 'the hook always exits 0: ' + r.stderr);
  const until = Date.now() + 10000;
  while (!fs.existsSync(out) && Date.now() < until) spawnSync('/bin/sleep', ['0.05']);
  n += 1;
  return fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '(nothing reported)';
}

const ALLOWED = [['Bash', { command: 'rm -rf build' }], ['Write', { file_path: '/tmp/a.txt', content: 'x' }]];
const LEFT_ALONE = [['AskUserQuestion', { questions: [] }], ['Write', { file_path: '/work/.claude/settings.json', content: '{}' }]];

for (const noJq of [false, true]) {
  const how = noJq ? ' (no jq)' : '';
  for (const [tool, input] of ALLOWED) {
    test(`#5495 shell${how}: ${tool} allowed by Kosmos reports working; without Kosmos's env it reports needs-you`, { skip: process.platform === 'win32' }, () => {
      assert.equal(runShell(req(tool, input), { env: KOSMOS_ENV, noJq }), `report|working|--auto|running ${tool}|`);
      assert.match(runShell(req(tool, input), { noJq }), /^report\|needs_you\|--auto\|asking permission to use /, 'control');
    });
  }
  for (const [tool, input] of LEFT_ALONE) {
    test(`#5495 shell${how}: ${tool} the allow hook leaves alone still reports needs-you`, { skip: process.platform === 'win32' }, () => {
      assert.match(runShell(req(tool, input), { env: KOSMOS_ENV, noJq }), /^report\|needs_you\|--auto\|asking permission to use /);
    });
  }
}

test('#5495 shell: a missing or broken allow hook reads as not allowed (needs-you, as before)', { skip: process.platform === 'win32' }, () => {
  const bash = req('Bash', { command: 'ls' });
  const missing = { ...KOSMOS_ENV, [ap.ENV_SCRIPT]: path.join(SANDBOX, 'no-such-hook.js') };
  assert.match(runShell(bash, { env: missing }), /^report\|needs_you\|/);
  const notNode = { ...KOSMOS_ENV, [ap.ENV_NODE]: '/usr/bin/false' };
  assert.match(runShell(bash, { env: notNode }), /^report\|needs_you\|/);
  assert.match(runShell(bash, { env: { [ap.ENV_NODE]: process.execPath } }), /^report\|needs_you\|/, 'only one of the two names');
});

/** Run the node hook; return the state and text it POSTed. */
async function runNode(payload, env) {
  let body = null;
  const fetchImpl = async (url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, text: async () => '{"recorded":true}' }; };
  const code = await nodeHook.main({ input: payload, env: { ...env }, url: 'http://127.0.0.1:1', boardToken: 'BT', fetchImpl, throttleDir: fs.mkdtempSync(path.join(SANDBOX, 'thr-')), stdout: () => {} });
  assert.equal(code, 0);
  return body && body.state + '|' + body.text;
}

test('#5495 node hook (Windows): allowed requests report working, the rest needs-you, and no env means needs-you', async () => {
  for (const [tool, input] of ALLOWED) {
    assert.equal(await runNode(req(tool, input), KOSMOS_ENV), 'working|running ' + tool);
    assert.match(await runNode(req(tool, input), {}), /^needs_you\|asking permission to use /, 'control');
  }
  for (const [tool, input] of LEFT_ALONE) assert.match(await runNode(req(tool, input), KOSMOS_ENV), /^needs_you\|/);
  assert.equal(nodeHook.kosmosAllows('not json', KOSMOS_ENV), false, 'unreadable input: not allowed');
});

test('#5495 shell: an allow hook that hangs is stopped by the clock bound and reads as not allowed', { skip: process.platform === 'win32' }, () => {
  const hang = path.join(SANDBOX, 'hanging-node');
  fs.writeFileSync(hang, '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
  const t0 = Date.now();
  assert.match(runShell(req('Bash', { command: 'ls' }), { env: { ...KOSMOS_ENV, [ap.ENV_NODE]: hang } }), /^report\|needs_you\|/);
  const took = Date.now() - t0;
  // At least 5 whole seconds of $SECONDS; well under the hang's 30 s and the hook entry's own 15 s cap.
  assert.ok(took >= 4500 && took < 14000, 'stopped by the clock bound, not by the hang ending: ' + took + ' ms');
});

test('#5495 the shell cases above really ran', { skip: process.platform === 'win32' }, () => {
  assert.equal(n, 16, 'shell runs (update this when a shell case is added or removed)');
});

test('#5495 node hook: an allowed request starts a heartbeat window, so the next tool call sends no second working line', async () => {
  const throttleDir = fs.mkdtempSync(path.join(SANDBOX, 'hb-'));
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push(JSON.parse(init.body).state); return { ok: true, status: 200, text: async () => '{"recorded":true}' }; };
  const run = (payload, env) => nodeHook.main({ input: payload, env: { ...env }, url: 'http://127.0.0.1:1', boardToken: 'BT', fetchImpl, throttleDir, ppid: 4242, stdout: () => {} });
  const pre = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } });
  await run(req('Bash', { command: 'ls' }), KOSMOS_ENV);
  await run(pre, KOSMOS_ENV);
  assert.deepEqual(sent, ['working'], 'one working line, no heartbeat straight after');
  sent.length = 0;
  const ctl = fs.mkdtempSync(path.join(SANDBOX, 'hb-')); // control: a request left to the person clears the window
  await nodeHook.main({ input: req('AskUserQuestion', {}), env: { ...KOSMOS_ENV }, url: 'http://127.0.0.1:1', boardToken: 'BT', fetchImpl, throttleDir: ctl, ppid: 4242, stdout: () => {} });
  await nodeHook.main({ input: pre, env: { ...KOSMOS_ENV }, url: 'http://127.0.0.1:1', boardToken: 'BT', fetchImpl, throttleDir: ctl, ppid: 4242, stdout: () => {} });
  assert.deepEqual(sent, ['needs_you', 'working'], 'control: after needs-you the next tool call reports working at once');
});

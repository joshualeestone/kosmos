'use strict';
/**
 * #1765: the Windows report hook sends its tokens only to a listener that proves it already holds them
 * (engine/boardproof.js). These run against real local HTTP listeners (test-support/proof-listener-1765.js), with no
 * fetch stub, so the hook's own production path is what is measured: a listener that holds no token gets the proof
 * request and nothing else; a board that holds the token gets the report.
 */
require('../test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-hookproof-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;   // never the dev box's real board.token
const test = require('node:test');
const assert = require('node:assert/strict');
const hook = require('./kosmos-report-hook');
const { startListener, freePort } = require('../test-support/proof-listener-1765');

const BOARD = 'BOARDTOKEN_1765_' + 'f'.repeat(32);
const AGENT = 'ab'.repeat(16);
const evt = (name, extra) => JSON.stringify({ hook_event_name: name, ...(extra || {}) });

function io(url, input, extra) {
  const said = [];
  return {
    said,
    io: {
      input,
      env: { KOSMOS_AGENT_TOKEN: AGENT },
      uid: -1,
      url,
      boardToken: BOARD,
      platform: 'win32',
      ppid: 4242,
      throttleDir: fs.mkdtempSync(path.join(SANDBOX, 'thr-')),
      now: () => 1000,
      stdout: (s) => said.push(s),
      ...(extra || {}),
    },
  };
}

test('#1765: a squatter on the board port gets the proof request and never a token, on every send path', async () => {
  const sq = await startListener({ mode: 'squatter' });
  try {
    // The loud report, a file-edit (keep copy + heartbeat report) and a failed tool call.
    const start = io(sq.url, evt('SessionStart', { source: 'startup' }));
    assert.equal(await hook.main(start.io), 0, 'the hook must never fail the agent');
    const edit = io(sq.url, evt('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'C:\\w\\a.md' }, cwd: 'C:\\w', session_id: 's' }));
    assert.equal(await hook.main(edit.io), 0);
    const fail = io(sq.url, evt('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'x' }, error: 'boom' }));
    assert.equal(await hook.main(fail.io), 0);

    assert.deepEqual(sq.carrying([BOARD, AGENT]), [], 'a token reached the squatter');
    assert.ok(sq.seen.length >= 3 && sq.seen.every((r) => r.url.startsWith('/api/board-proof')), 'only proof requests may reach it: ' + sq.seen.map((r) => r.method + ' ' + r.url).join(', '));
    assert.equal(start.said.length, 1, 'SessionStart says out loud that reporting is off');
    assert.match(start.said[0], /could not show it is your Kosmos, so nothing was sent/);
    assert.doesNotMatch(start.said[0], /could not be reached/, 'a squatter is not a board that is down');
  } finally { await sq.close(); }
});

test('#1765 CONTROL: a board that holds the token gets the report and the keep, with their tokens', async () => {
  const board = await startListener({ mode: 'board', holds: BOARD });
  try {
    const edit = io(board.url, evt('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'C:\\w\\a.md' }, cwd: 'C:\\w', session_id: 's' }));
    assert.equal(await hook.main(edit.io), 0);
    const sends = board.seen.filter((r) => !r.url.startsWith('/api/board-proof'));
    assert.deepEqual(sends.map((r) => r.url).sort(), ['/api/report', '/api/undo/keep']);
    assert.ok(sends.every((r) => r.headers['x-kosmos-board-token'] === BOARD && r.headers['x-kosmos-agent-token'] === AGENT));
    assert.equal(board.proofRequests().length, 2, 'proved before each of the two sends (kosmos#6464), not once for the process');
  } finally { await board.close(); }
});

test('#1765: a board that holds a DIFFERENT token is refused like a squatter (the proof is keyed on our token)', async () => {
  const other = await startListener({ mode: 'board', holds: 'some-other-account-token' });
  try {
    const run = io(other.url, evt('SessionStart', { source: 'startup' }));
    await hook.main(run.io);
    assert.deepEqual(other.carrying([BOARD, AGENT]), []);
    assert.match(run.said[0], /could not show it is your Kosmos/);
  } finally { await other.close(); }
});

test('#1765: a token-only agent proves its agent token, and the board token is never read or sent', async () => {
  const board = await startListener({ mode: 'board', holds: AGENT });
  try {
    const run = io(board.url, evt('Stop'), { env: { KOSMOS_AGENT_TOKEN: AGENT, KOSMOS_AGENT_TOKEN_ONLY: '1' } });
    await hook.main(run.io);
    const sends = board.seen.filter((r) => r.url === '/api/report');
    assert.equal(sends.length, 1, 'the agent token was proven, so the report goes');
    assert.equal(sends[0].headers['x-kosmos-board-token'], undefined);
  } finally { await board.close(); }
  const sq = await startListener({ mode: 'squatter' });
  try {
    await hook.main(io(sq.url, evt('Stop'), { env: { KOSMOS_AGENT_TOKEN: AGENT, KOSMOS_AGENT_TOKEN_ONLY: '1' } }).io);
    assert.deepEqual(sq.carrying([BOARD, AGENT]), []);
  } finally { await sq.close(); }
});

test('#1765: a board that is down is told apart from a squatter, and the hook still exits 0', async () => {
  const port = await freePort();
  const run = io('http://127.0.0.1:' + port, evt('SessionStart', { source: 'startup' }));
  assert.equal(await hook.main(run.io), 0);
  assert.match(run.said[0], /the board could not be reached \(ECONNREFUSED\)/);
  assert.doesNotMatch(run.said[0], /could not show it is your Kosmos/);
});

test('#1765: each check asks with a fresh random nonce', async () => {
  const sq = await startListener({ mode: 'squatter' });
  try {
    await hook.main(io(sq.url, evt('Stop')).io);
    await hook.main(io(sq.url, evt('Stop')).io);
    const nonces = sq.proofRequests().map((r) => new URL(r.url, 'http://x').searchParams.get('n'));
    assert.equal(nonces.length, 2);
    assert.match(nonces[0], /^[0-9a-f]{32}$/);
    assert.notEqual(nonces[0], nonces[1]);
  } finally { await sq.close(); }
});

test('#1765: the seam decides, and a refusal sends nothing even through an injected fetch', async () => {
  let fetched = 0;
  const asked = [];
  const run = io('http://127.0.0.1:1', evt('Stop'), {
    fetchImpl: async () => { fetched += 1; return { ok: true, status: 200, text: async () => '{"recorded":true}' }; },
    proveBoard: async (url, token, timeoutMs) => { asked.push({ url, token, timeoutMs }); return false; },
  });
  assert.equal(await hook.main(run.io), 0);
  assert.equal(fetched, 0, 'a send went out after the check said no');
  assert.deepEqual(asked.map((a) => [a.url, a.token]), [['http://127.0.0.1:1', BOARD]], 'the board token is the one proved');
  assert.ok(asked[0].timeoutMs > 0 && asked[0].timeoutMs <= hook.SHORT_TIMEOUT_MS / 2, 'the check gets at most half the send\'s bound');
});

test('kosmos#6464: each send proves for itself, so a listener that changes between two sends gets nothing at the second', async () => {
  const sent = [];
  let answers = [true, { ok: false, why: 'answer is not a proof' }];
  let asked = 0;
  const edit = evt('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'C:\\w\\a.md' }, cwd: 'C:\\w', session_id: 's' });
  const fetchImpl = async (u) => { sent.push(new URL(u).pathname); return { ok: true, status: 200, text: async () => '{"recorded":true}' }; };
  // The board proves for the keep, then something else answers at the same address for the report.
  await hook.main(io('http://127.0.0.1:1', edit, { fetchImpl, proveBoard: async () => answers[asked++] }).io);
  assert.equal(asked, 2, 'the report did not prove again after the keep');
  assert.ok(!sent.includes('/api/report'), 'the report went to a listener that had not proved: ' + JSON.stringify(sent));
  assert.ok(sent.length === 1, 'the keep, proved, did not go: ' + JSON.stringify(sent));
  // CONTROL, the other way round: unproven for the keep, proven for the report: only the report goes.
  answers = [{ ok: false, why: 'answer is not a proof' }, true];
  asked = 0;
  sent.length = 0;
  await hook.main(io('http://127.0.0.1:1', edit, { fetchImpl, proveBoard: async () => answers[asked++] }).io);
  assert.equal(asked, 2);
  assert.deepEqual(sent, ['/api/report']);
});

test('#1765: with no token at all nothing is proved (there is nothing to protect)', async () => {
  let asked = 0, fetched = 0;
  const run = io('http://127.0.0.1:1', evt('Stop'), {
    boardToken: null, env: {},
    fetchImpl: async () => { fetched += 1; return { ok: true, status: 200, text: async () => '{"recorded":true}' }; },
    proveBoard: async () => { asked += 1; return false; },
  });
  await hook.main(run.io);
  assert.equal(asked, 0);
  assert.equal(fetched, 1);
});

test('#1765: no production caller hands main a fetch of its own (which would stand in for the board and skip the check)', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  // The hook's own entry: the event only.
  assert.match(src('kosmos-report-hook.js'), /const run = \(input\) => main\(\{ input \}\)/);
  // The Codex supervisor's idle report: the event, its env and a quiet stdout, nothing else.
  assert.match(src('win32codexsup.js'), /require\('\.\/kosmos-report-hook'\)\s*\.main\(\{ input: JSON\.stringify\(\{ hook_event_name: 'Stop' \}\), env, stdout: \(\) => \{\} \}\)\)/);
  // Nothing else outside the tests calls main, anywhere in the repo (kosmos#6464: not only engine/*.js).
  assert.deepEqual(reportHookMainCallers(), ['engine/win32codexsup.js']);
});

/* kosmos#6464: every non-test script in the repo (.js, .cjs, .mjs; tests skipped), by its path from the repo root with
   forward slashes. The tracked files when git can list them, so a stray untracked copy on a dev box cannot change the
   answer; else a walk that skips node_modules and .git (a checkout without git). */
const REPO_ROOT = path.join(__dirname, '..');
const SCRIPT_RE = /\.(c|m)?js$/;
const TEST_RE = /\.test\.(c|m)?js$/;
let scriptsCache = null;
function repoScripts() {
  if (scriptsCache) return scriptsCache;
  const git = require('node:child_process').spawnSync('git', ['-C', REPO_ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let all;
  if (git.status === 0 && git.stdout) all = git.stdout.split('\0').filter(Boolean);
  else {
    all = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!['node_modules', '.git', '.claude', 'dist'].includes(e.name)) walk(path.join(dir, e.name)); continue; }
        all.push(path.relative(REPO_ROOT, path.join(dir, e.name)).split(path.sep).join('/'));
      }
    };
    walk(REPO_ROOT);
  }
  // A tracked file deleted in the working tree is not a script here to read.
  scriptsCache = all.filter((p) => SCRIPT_RE.test(p) && !TEST_RE.test(p) && fs.existsSync(path.join(REPO_ROOT, p))).sort();
  return scriptsCache;
}
/* Whether a script's text may call main of the module it loads by moduleName (require or import, any path form).
   Over-broad on purpose, since a false hit only fails this test: on the line that loads it, a call chained on the
   load (require(...).main(...)), a destructured or imported main ({ main } / { main: x }), or the name the load is
   bound to (const / let / var / a later assignment / import * as) followed anywhere by <name>.main(. */
function callsMainOf(text, moduleName) {
  const at = new RegExp(moduleName.replace(/[-.]/g, '\\$&') + '(\\.(c|m)?js)?[\'"]', 'g');
  for (const m of text.matchAll(at)) {
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const lineEnd = text.indexOf('\n', m.index);
    const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    if (!/\brequire\s*\(|\bimport\b/.test(line)) continue;
    if (/^\s*\)*\s*\.\s*main\b/.test(text.slice(m.index + m[0].length))) return true;   // chained on the load
    if (/\{[^}]*\bmain\b[^}]*\}/.test(line)) return true;   // const { main } = require(...) / import { main } from
    const bound = line.match(/\bimport\s+\*\s+as\s+([A-Za-z_$][\w$]*)/) || line.match(/\bimport\s+([A-Za-z_$][\w$]*)\s+from\b/)
      || line.match(/([A-Za-z_$][\w$]*)\s*=(?!=)/);
    if (bound && new RegExp('(^|[^\\w$.])' + bound[1].replace(/\$/g, '\\$&') + '\\s*\\.\\s*main\\b').test(text)) return true;
  }
  return false;
}
function reportHookMainCallers() {
  return repoScripts().filter((f) => f !== 'engine/kosmos-report-hook.js')
    .filter((f) => { const t = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'); return t.includes('kosmos-report-hook') && callsMainOf(t, 'kosmos-report-hook'); });
}

test('kosmos#6464: the caller pin finds a caller outside engine/, in every shape it names, and none in a file that only names the hook', () => {
  const HOOK = 'kosmos-report-hook';
  // Fixtures for the matcher itself.
  assert.equal(callsMainOf("require('../engine/kosmos-report-hook').main({ input })", HOOK), true, 'chained');
  assert.equal(callsMainOf("require('./kosmos-report-hook')\n  .main({ input })", HOOK), true, 'chained over a line break');
  assert.equal(callsMainOf("const hook = o.hook || require(path.join(engineDir(), 'kosmos-report-hook.js'));\nawait hook.main({ input, fetchImpl });", HOOK), true, 'named, through path.join');
  assert.equal(callsMainOf("let h;\nh = require('./kosmos-report-hook');\nh.main({});", HOOK), true, 'assigned on a later line');
  assert.equal(callsMainOf("const { main } = require('./kosmos-report-hook');\nmain({});", HOOK), true, 'destructured');
  assert.equal(callsMainOf("const { main: run } = require('./kosmos-report-hook');\nrun({});", HOOK), true, 'destructured and renamed');
  assert.equal(callsMainOf("import { main } from './kosmos-report-hook.js';\nmain({});", HOOK), true, 'imported');
  assert.equal(callsMainOf("import * as hook from './kosmos-report-hook.js';\nhook.main({});", HOOK), true, 'imported as a namespace');
  assert.equal(callsMainOf("const hook = await import('./kosmos-report-hook.js');\nhook.main({});", HOOK), true, 'dynamic import');
  assert.equal(callsMainOf("const hook = o.hook || require(path.join(engineDir(), 'kosmos-report-hook.js'));\nhook.resolveUrl(env);", HOOK), false, 'loads it, never calls main');
  assert.equal(callsMainOf('// see engine/kosmos-report-hook.js main()', HOOK), false, 'a mention');
  // And the list reaches beyond engine/.
  assert.ok(repoScripts().includes('tools/windows/kosmos-cli.js'), 'the list does not reach tools/windows');
  assert.ok(repoScripts().includes('bin/agy-report-bridge.js'), 'the list does not reach bin/');
  assert.ok(!repoScripts().some((p) => TEST_RE.test(p)), 'a test file is in the list');
});

test('kosmos#6464: no production script passes the Windows kosmos command a fetch, hook or seam of its own', () => {
  // The CLI's main(argv, io) skips the check when io carries fetch or hook (a test). Only its own entry calls main.
  const callers = repoScripts().filter((f) => f !== 'tools/windows/kosmos-cli.js')
    .filter((f) => { const t = fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'); return t.includes('kosmos-cli') && callsMainOf(t, 'kosmos-cli'); });
  assert.deepEqual(callers, []);
});

test('kosmos#6464: a proven board that redirects the sends elsewhere: no token, keep, report or failure reaches the other address', async () => {
  const http = require('node:http');
  const { answerProof } = require('../test-support/proof-listener-1765');
  const elsewhere = await startListener({ mode: 'squatter' });
  const redirected = [];
  const server = http.createServer((req, res) => {
    if (answerProof(req, res, [BOARD])) return;
    redirected.push(req.method + ' ' + req.url);
    res.writeHead(307, { location: elsewhere.url + req.url });   // 307 keeps the method and body if followed
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    // The keep and the report (a file edit), and the failure digest.
    assert.equal(await hook.main(io(url, evt('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'C:\\w\\a.md' }, cwd: 'C:\\w', session_id: 's' })).io), 0);
    assert.equal(await hook.main(io(url, evt('PostToolUseFailure', { tool_name: 'Bash', tool_input: { command: 'x' }, error: 'boom' })).io), 0);
    // The board really was sent each of the three (so the arm is about them), and redirected them.
    assert.deepEqual(redirected.slice().sort(), ['POST /api/report', 'POST /api/toolfail', 'POST /api/undo/keep'], 'a send never reached the board, so this arm measures nothing for it');
    assert.deepEqual(elsewhere.seen.map((r) => r.method + ' ' + r.url), [], 'a send followed the redirect');
  } finally { server.closeAllConnections(); server.close(); await elsewhere.close(); }
});

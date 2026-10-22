'use strict';
/**
 * #1765, the Windows launcher: Kosmos.exe sends the board token in one place (the taskbar badge's own read of
 * /api/status, TaskbarBadge.ReadBoard). Before it does, the listener proves it holds that token, with the same
 * exchange engine/boardproof.js defines (BoardProof in tools/windows/KosmosLauncher.cs).
 *
 * Two halves, as tools.win-taskbar-badge-3996.test.js does it:
 *   - the SOURCE (every platform): the read checks before it sends, and the C# constants are boardproof.js's;
 *   - a PROBE compiled beside KosmosLauncher.cs (Windows only): the C# key id and proof equal node's byte for byte,
 *     and the check, run for real, is true for the real board (server.js) and for a stand-in that holds the token,
 *     and false for a squatter, a board holding another token, a listener that never answers, and no listener;
 *     and ReadBoard never sends the token to a squatter.
 *
 * The committed tools/windows/Kosmos.exe is a signed binary built from this source; it is rebuilt and re-signed as
 * its own release step, so this tests the source, not that binary.
 */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync, execFile } = require('node:child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-launcherproof-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');

const test = require('node:test');
const assert = require('node:assert/strict');
const boardproof = require('./engine/boardproof');
const { startListener, freePort } = require('./test-support/proof-listener-1765');

const REPO = __dirname;
const LAUNCHER = path.join(REPO, 'tools', 'windows', 'KosmosLauncher.cs');
const SOURCE = fs.readFileSync(LAUNCHER, 'utf8');
const WINDOWS_ONLY = { skip: process.platform !== 'win32' && 'the probe needs the Windows C# compiler' };
const TOKEN = 'BOARDTOKEN_launcher_1765_' + '9'.repeat(32);

function slice(start, end) {
  const at = SOURCE.indexOf(start);
  assert.notEqual(at, -1, start + ' is gone from KosmosLauncher.cs');
  const to = SOURCE.indexOf(end, at + start.length);
  assert.notEqual(to, -1, 'the end of ' + start + ' is gone');
  return SOURCE.slice(at, to);
}

/* ---- the source ------------------------------------------------------------ */

test('#1765: the badge read checks the board holds the token before the token goes in the header', () => {
  const read = slice('internal static bool ReadBoard(int port, out int? waiting)', '\n    }\n');
  const check = read.indexOf('if (token != null && !BoardProof.Holds(port, token, ReadTimeoutMs / 2)) return false;');
  const send = read.indexOf('if (token != null) request.Headers[BoardTokenHeader] = token;');
  assert.ok(check !== -1, 'ReadBoard no longer checks the board before sending its token');
  assert.ok(send > check, 'the token goes in the header before the check');
});

test('#1765: the board token is put in a header in one place only, the read that checks first', () => {
  const sends = [...SOURCE.matchAll(/Headers\[BoardTokenHeader\]\s*=/g)];
  assert.equal(sends.length, 1, 'another place sends the board token: it must check the board first too');
  // The definition and ReadBoard. #6882: ResolveBoardAddress, its background caller and OpenInBrowserInstead only ask whether a token is on
  // disk, readable or not (BoardTokenOnDisk), and send nothing.
  assert.equal((SOURCE.match(/ReadBoardToken\(\)/g) || []).length, 2, 'the token is read somewhere new');
  assert.match(slice('internal static string ResolveBoardAddress(', '\n    }\n'), /return TaskbarBadge\.BoardTokenOnDisk\(\) \? NotConfirmed : plain;/);
});

test('#1765: the C# constants are engine/boardproof.js\'s', () => {
  const js = fs.readFileSync(path.join(REPO, 'engine', 'boardproof.js'), 'utf8');
  const tag = (name) => { const m = js.match(new RegExp('const ' + name + " = '([^']+)';")); assert.ok(m, name + ' moved in boardproof.js'); return m[1].replace('\\0', '\\\\0'); };
  assert.match(SOURCE, new RegExp('internal const string KeyIdTag = "' + tag('KEY_ID_TAG') + '";'));
  assert.match(SOURCE, new RegExp('internal const string ProofTag = "' + tag('PROOF_TAG') + '";'));
  assert.match(SOURCE, new RegExp('internal const string ProofPath = "' + boardproof.PROOF_PATH + '";'));
  assert.match(SOURCE, new RegExp('internal const string ClientAddress = "' + boardproof.CLIENT_ADDR.replace(/\./g, '\\.') + '";'));
  assert.match(SOURCE, new RegExp('internal const int NonceBytes = ' + boardproof.NONCE_BYTES + ';'));
  assert.match(SOURCE, new RegExp('internal const int KeyIdHex = ' + boardproof.KEY_ID_HEX + ';'));
  assert.match(SOURCE, new RegExp('internal const int ProofHex = ' + boardproof.PROOF_HEX + ';'));
  assert.match(SOURCE, new RegExp('internal const int AnswerMaxBytes = ' + boardproof.PROOF_ANSWER_MAX_BYTES + ';'));
});

/* ---- the probe ------------------------------------------------------------- */

const PROBE = `
using System;
class ProofProbe {
  static int Main(string[] a) {
    string input = new System.IO.StreamReader(Console.OpenStandardInput(), new System.Text.UTF8Encoding(false)).ReadToEnd();
    switch (a[0]) {
      case "key": Console.Write(BoardProof.KeyId(input)); break;
      case "proof": { string[] p = input.Split('\\n'); Console.Write(BoardProof.Proof(p[0], p[1], int.Parse(a[1]))); break; }
      case "matches": { string[] p = input.Split('\\n'); Console.Write(BoardProof.ProofMatches(p[0], p[1], p[2], int.Parse(a[1])) ? "true" : "false"); break; }
      case "nonce": Console.Write(BoardProof.NewNonce()); break;
      case "holds": Console.Write(BoardProof.Holds(int.Parse(a[1]), input, int.Parse(a[2])) ? "true" : "false"); break;
      case "named": { string n = KosmosLauncher.AddressNamed(input, int.Parse(a[1])); Console.Write(n == null ? "<null>" : n); break; }
      case "resolve": { string r = KosmosLauncher.ResolveBoardAddress(a[1], a[2], a[3], a[4], int.Parse(a[5])); Console.Write(r == KosmosLauncher.NotConfirmed ? "<notconfirmed>" : r); break; }
      case "read": { int? w; bool ok = TaskbarBadge.ReadBoard(int.Parse(a[1]), out w); Console.Write(ok + ":" + (w.HasValue ? w.Value.ToString() : "null")); break; }
    }
    return 0;
  }
}
`;

let probeExe = null;
let probeDir = null;
const needsProbe = (t) => { if (!probeExe) { t.skip('no probe (not Windows, or no compiler)'); return false; } return true; };
function probe(args, input, env) {
  const r = spawnSync(probeExe, args, { input: input || '', encoding: 'utf8', windowsHide: true, env: env || process.env });
  assert.equal(r.status, 0, 'the probe failed: ' + r.stdout + r.stderr);
  return r.stdout;
}
// Asynchronously, so a listener in this process can answer while the probe waits on it.
function probeAsync(args, input, env) {
  return new Promise((resolve, reject) => {
    const child = execFile(probeExe, args, { encoding: 'utf8', windowsHide: true, env: env || process.env, timeout: 60000 },
      (err, so, se) => (err ? reject(new Error('the probe failed: ' + err.message + so + se)) : resolve(so)));
    child.stdin.end(input || '');
  });
}

test('#1765: the probe compiles beside the launcher', WINDOWS_ONLY, (t) => {
  const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
  if (!fs.existsSync(csc)) { t.skip('no .NET Framework compiler on this machine'); return; }
  probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-proof-probe-'));
  fs.writeFileSync(path.join(probeDir, 'ProofProbe.cs'), PROBE);
  const out = path.join(probeDir, 'probe.exe');
  const built = spawnSync(csc, ['/nologo', '/target:exe', '/main:ProofProbe', '/out:' + out, LAUNCHER, path.join(probeDir, 'ProofProbe.cs')], { encoding: 'utf8', windowsHide: true });
  assert.equal(built.status, 0, 'the probe did not compile: ' + built.stdout + built.stderr);
  probeExe = out;
});

test('#1765: the C# key id and proof are node\'s, byte for byte', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  for (const token of [TOKEN, 'ab'.repeat(16), 'ünïcødé-token-✓', 'x']) {
    assert.equal(probe(['key'], token), boardproof.keyId(token), 'key id for ' + token);
    for (const port of [16180, 1, 65535]) {
      const nonce = boardproof.newNonce();
      assert.equal(probe(['proof', String(port)], token + '\n' + nonce), boardproof.proof(token, nonce, port, '127.0.0.1'), 'proof for ' + token + ' on ' + port);
    }
  }
});

test('#1765: the C# comparison takes node\'s proof and nothing near it', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  const nonce = boardproof.newNonce();
  const good = boardproof.proof(TOKEN, nonce, 16180, '127.0.0.1');
  const m = (answer, port) => probe(['matches', String(port || 16180)], TOKEN + '\n' + nonce + '\n' + answer);
  assert.equal(m(good), 'true');
  assert.equal(m(good, 16181), 'false', 'bound to the port');
  assert.equal(m(boardproof.proof(TOKEN, nonce, 16180, '::1')), 'false', 'bound to the address');
  assert.equal(m(good.toUpperCase()), 'false');
  assert.equal(m(good.slice(0, 63)), 'false');
  assert.equal(m(good.slice(0, 63) + (good[63] === '0' ? '1' : '0')), 'false');
  assert.equal(m(boardproof.proof('another', nonce, 16180, '127.0.0.1')), 'false');
});

test('#1765: each check uses a fresh random nonce of boardproof.js\'s size', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  const a = probe(['nonce']), b = probe(['nonce']);
  assert.match(a, new RegExp('^[0-9a-f]{' + boardproof.NONCE_BYTES * 2 + '}$'));
  assert.notEqual(a, b);
});

test('#1765: Holds is true for a stand-in holding the token, false for a squatter and for another token', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const board = await startListener({ mode: 'board', holds: TOKEN });
  const sq = await startListener({ mode: 'squatter' });
  const other = await startListener({ mode: 'board', holds: 'another-accounts-token' });
  try {
    assert.equal(await probeAsync(['holds', String(board.port), '4000'], TOKEN), 'true');
    assert.equal(await probeAsync(['holds', String(sq.port), '4000'], TOKEN), 'false');
    assert.equal(await probeAsync(['holds', String(other.port), '4000'], TOKEN), 'false');
    for (const l of [board, sq, other]) assert.deepEqual(l.carrying([TOKEN]), [], 'the check itself carried the token');
    const n = sq.proofRequests().map((r) => new URL(r.url, 'http://x').searchParams);
    assert.equal(n[0].get('k'), boardproof.keyId(TOKEN));
  } finally { await board.close(); await sq.close(); await other.close(); }
});

test('#1765: Holds is false, within its bound, for no listener and for one that never answers', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  assert.equal(await probeAsync(['holds', String(await freePort()), '4000'], TOKEN), 'false');
  const sockets = new Set();
  const silent = http.createServer(() => { /* never answers */ });
  silent.on('connection', (s) => sockets.add(s));
  await new Promise((r) => silent.listen(0, '127.0.0.1', r));
  try {
    const t0 = Date.now();
    assert.equal(await probeAsync(['holds', String(silent.address().port), '1500'], TOKEN), 'false');
    assert.ok(Date.now() - t0 < 1500 + 4000, 'the check did not keep to its bound: ' + (Date.now() - t0) + ' ms');
  } finally { for (const s of sockets) s.destroy(); silent.close(); }
});

test('#1765: Holds is true against the real board (server.js) for its token, false for a token it does not hold', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const { start, server, boardAuthState } = require('./server');
  await start(0);
  boardAuthState.on = true;
  boardAuthState.token = TOKEN;
  try {
    const port = server.address().port;
    assert.equal(await probeAsync(['holds', String(port), '5000'], TOKEN), 'true', 'the real board did not prove the token it holds');
    assert.equal(await probeAsync(['holds', String(port), '5000'], 'not-this-boards-token'), 'false');
  } finally { try { server.close(); } catch { /* closed */ } }
});

test('#1765: ReadBoard sends the token to a board that proves it, and never to a squatter', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const data = fs.mkdtempSync(path.join(SANDBOX, 'badge-'));
  fs.mkdirSync(path.join(data, 'Kosmos'), { recursive: true });
  fs.writeFileSync(path.join(data, 'Kosmos', 'board.token'), TOKEN);
  const env = { ...process.env, AGENT_WORKFORCE_DATA: data };
  delete env.AGENT_WORKFORCE_HOME;
  const sq = await startListener({ mode: 'squatter', reply: { counts: { waiting: 3 } } });
  try {
    assert.equal(await probeAsync(['read', String(sq.port)], '', env), 'False:null', 'a squatter\'s status was read');
    assert.deepEqual(sq.carrying([TOKEN]), [], 'the board token reached the squatter');
    assert.ok(sq.seen.length > 0 && sq.seen.every((r) => r.url.startsWith(boardproof.PROOF_PATH)));
  } finally { await sq.close(); }
  // CONTROL: the same read against a stand-in holding the token reads its status, with the token.
  const board = await startListener({ mode: 'board', holds: TOKEN, reply: { counts: { waiting: 3 } } });
  try {
    assert.equal(await probeAsync(['read', String(board.port)], '', env), 'True:3');
    const status = board.seen.filter((r) => r.url === '/api/status');
    assert.equal(status.length, 1);
    assert.equal(status[0].headers['x-kosmos-board-token'], TOKEN, 'the arm above could not have seen the token');
  } finally { await board.close(); }
});

/* ---- #1765: the window and the browser fallback when the opener names no address ---- */

test('#1765: a refusal from the opener is NotConfirmed in the window, which then loads nothing and asks again on reopen', () => {
  const resolve = slice('internal static string ResolveBoardAddress(', '\n    }\n');
  assert.match(resolve, /if \(named != null\) return named;\s*if \(p\.ExitCode == OpenerRefusedExit\) return NotConfirmed;/);
  const code = SOURCE.match(/internal const int OpenerRefusedExit = (\d+);/);
  assert.ok(code, 'OpenerRefusedExit moved');
  assert.equal(Number(code[1]), require('./tools/kosmos-open-board.js').OPENER_REFUSED_EXIT, 'the opener and the launcher disagree on the refusal exit code');
  assert.notEqual(Number(code[1]), 1, 'node exits 1 on a crash, so 1 cannot mean a refusal');
  const opener = fs.readFileSync(path.join(REPO, 'tools', 'kosmos-open-board.js'), 'utf8');
  assert.match(opener, /if \(open === null\) \{ process\.exitCode = OPENER_REFUSED_EXIT; return; \}/);
  const resolved = slice('internal void BoardAddressResolved(string address)', '\n    }\n');
  assert.match(resolved, /if \(address == KosmosLauncher\.NotConfirmed\)\s*\{\s*boardNotConfirmed = true;\s*if \(webView != null\) webView\.NavigateToString\(KosmosLauncher\.NotConfirmedPage\);\s*return;/,
    'a NotConfirmed answer is loaded as an address');
  assert.match(SOURCE, /else if \(boardAddress != null\) NavigateToBoard\(\);\s*else if \(boardNotConfirmed\) webView\.NavigateToString\(KosmosLauncher\.NotConfirmedPage\);/);
  const again = slice('internal void SignInAgain(string keepPage = null)', '\n    }\n');
  assert.match(again, /if \(boardNotConfirmed && !signingInAgain && resolveBoardAddress != null\)[\s\S]*?ResolveBoardAddressInBackground\(\);/, 'reopening Kosmos.exe does not ask again');
  const browser = slice('static int OpenInBrowserInstead(', '\n    }\n');
  assert.match(browser, /if \(!p\.WaitForExit\(OpenerBrowserWaitCapMs\)\) \{ try \{ p\.Kill\(\); \} catch \{[^}]*\} unknown = true; \}\s*(?:\/\/[^\n]*\n\s*)?else refused = p\.ExitCode == OpenerRefusedExit \|\| \(p\.ExitCode != 0 && TaskbarBadge\.BoardTokenOnDisk\(\)\);/,
    'the browser fallback waits for the opener without a bound, or reads a timeout as success');
  const cap = Number((SOURCE.match(/const int OpenerBrowserWaitCapMs = (\d+);/) || [])[1]);
  const openerSrc = fs.readFileSync(path.join(REPO, 'tools', 'kosmos-open-board.js'), 'utf8');
  const worst = Number(openerSrc.match(/Number\(argValue\('--timeout-ms', '(\d+)'\)\)/)[1]) + require('./tools/kosmos-open-board.js').PROOF_TIMEOUT_MS
    + Number(openerSrc.match(/const MINT_TIMEOUT_MS = (\d+);/)[1]);
  assert.ok(cap > worst, 'the cap (' + cap + ' ms) cuts off the opener before its own worst case (' + worst + ' ms)');
  assert.match(browser, /if \(refused \|\| unknown\)\s*\{\s*ShowMessageBox\(\(unknown \? BrowserUnknownMessage : BrowserNotConfirmedMessage\)/, 'a refusal is told as "opened in your browser"');
});

function fakeApp(withToken) {
  const app = fs.mkdtempSync(path.join(SANDBOX, 'app-'));
  const data = fs.mkdtempSync(path.join(SANDBOX, 'appdata-'));
  fs.mkdirSync(path.join(app, 'engine'), { recursive: true });
  fs.writeFileSync(path.join(app, 'engine', 'store.js'), 'module.exports = { ROOT: ' + JSON.stringify(data) + ' };\n');
  fs.copyFileSync(path.join(REPO, 'engine', 'boardproof.js'), path.join(app, 'engine', 'boardproof.js'));
  if (withToken) fs.writeFileSync(path.join(data, 'board.token'), TOKEN + '\n');
  return app;
}
const OPENER = path.join(REPO, 'tools', 'kosmos-open-board.js');

test('#1765: ResolveBoardAddress, run for real with the real opener: NotConfirmed for a squatter, the signed-in address for the board', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const app = fakeApp(true);
  const sq = await startListener({ mode: 'squatter' });
  try {
    assert.equal(await probeAsync(['resolve', REPO, process.execPath, OPENER, app, String(sq.port)]), '<notconfirmed>');
    assert.deepEqual(sq.carrying([TOKEN]), [], 'the board token reached the squatter');
  } finally { await sq.close(); }
  // CONTROL: the same call against a board holding the token is the signed-in address.
  const board = await startListener({ mode: 'board', holds: TOKEN });
  try {
    assert.match(await probeAsync(['resolve', REPO, process.execPath, OPENER, app, String(board.port)]), new RegExp('^http://127\\.0\\.0\\.1:' + board.port + '/\\?boot=[0-9a-f]+$'));
  } finally { await board.close(); }
  // And a board that enforces nothing (no token on disk) still gets the plain address, as before.
  const plain = await startListener({ mode: 'squatter' });
  try {
    assert.equal(await probeAsync(['resolve', REPO, process.execPath, OPENER, fakeApp(false), String(plain.port)]), 'http://127.0.0.1:' + plain.port);
  } finally { await plain.close(); }
});

test('#1765: an opener that ends any other way with no address: NotConfirmed when a board token is on disk, the plain address when none is', WINDOWS_ONLY, async (t) => {
  if (!needsProbe(t)) return;
  const crashing = path.join(SANDBOX, 'crashing-opener.js');
  fs.writeFileSync(crashing, 'process.exit(1);\n');   // node's own crash code, not the opener's refusal
  const app = fakeApp(false);
  const withToken = fs.mkdtempSync(path.join(SANDBOX, 'launcherdata-'));
  fs.mkdirSync(path.join(withToken, 'Kosmos'), { recursive: true });
  fs.writeFileSync(path.join(withToken, 'Kosmos', 'board.token'), TOKEN);
  const noToken = fs.mkdtempSync(path.join(SANDBOX, 'launcherdata-'));
  const env = (data) => { const e = { ...process.env, AGENT_WORKFORCE_DATA: data }; delete e.AGENT_WORKFORCE_HOME; return e; };
  assert.equal(await probeAsync(['resolve', REPO, process.execPath, crashing, app, '1'], '', env(withToken)), '<notconfirmed>');
  assert.equal(await probeAsync(['resolve', REPO, process.execPath, crashing, app, '1'], '', env(noToken)), 'http://127.0.0.1:1');
});

test('#1765: AddressNamed takes only this port\'s address', WINDOWS_ONLY, (t) => {
  if (!needsProbe(t)) return;
  assert.equal(probe(['named', '16180'], 'noise\nhttp://127.0.0.1:16180/?boot=ab\n'), 'http://127.0.0.1:16180/?boot=ab');
  assert.equal(probe(['named', '16180'], 'http://127.0.0.1:16181/?boot=ab\n'), '<null>');
  assert.equal(probe(['named', '16180'], ''), '<null>');
});

test.after(() => {
  if (probeDir) fs.rmSync(probeDir, { recursive: true, force: true });
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

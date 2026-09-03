'use strict';
/**
 * #1970: the CLI must deliver its auth tokens to curl OFF the command line.
 *
 * macOS `ps -ww -o args` lets any local account read every process's full argv,
 * so a token passed as `-H "name: value"` is readable cross-account for the brief
 * window each command runs -- a side channel around the mode-600 `board.token`
 * file that #1946 made the only per-account boundary. `kosmos_curl` closes it by
 * writing the header to a mode-600 temp file and handing curl `-H @file`, so only
 * the file PATH reaches argv.
 *
 * 🔑 WHY THE `report` PATH TESTS THE BOARD TOKEN TOO. `kosmos_curl` is
 * token-agnostic: the board token and the agent token traverse the IDENTICAL code
 * (the same mktemp + `-H @file`); only the header NAME written into the file
 * differs. `report` carries the agent token and needs no board.token file / bundled
 * node / store (unlike msg/whoami/room), so it is the deterministic vehicle for
 * exercising the one mechanism that protects both. A board-token path would run the
 * same `kosmos_curl` with a different header name, not different logic.
 *
 * 🛑 THE CONTROL IS A `curl` STUB THAT LOGS ITS OWN ARGV, then execs the real
 * curl so the request still lands and the end-to-end delivery can be asserted. It
 * is the in-process, deterministic form of the card's `ps -ww -o args` poll: the
 * argv the stub records IS what `ps` would have shown. It also captures each
 * `@file`'s mode and contents (to a SEPARATE log, so the token in the file cannot
 * pollute the argv-absence check) to prove the token is delivered via a 0600 file.
 *
 * 📌 The stub answers `/` with a body containing "Kosmos" because the CLI's own
 * `healthy()` refuses a port that answers with somebody else's page (see
 * cli.presents-token.test.js, which this borrows its stub shape from).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'deadbeefcafe0123'; // distinctive hex, so a substring hit is unambiguous

function withStub(body) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/report')) {
      seen.push(req.headers['x-kosmos-agent-token']);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"recorded":true}');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  /* Reject rather than resolve-in-finally, so a failing assertion inside `body`
     is not swallowed into a passing test (the trap cli.presents-token documents). */
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await body(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

test('#1970: the CLI delivers its token off argv, via a mode-600 file', () => withStub(async (port, seen) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-offargv-'));
  const binDir = path.join(sandbox, 'bin');
  const tmpDir = path.join(sandbox, 'tmp');
  fs.mkdirSync(binDir);
  fs.mkdirSync(tmpDir);
  const argvLog = path.join(sandbox, 'argv.log');
  const fileCap = path.join(sandbox, 'filecap.log');

  // A curl that records its own argv, captures any `@file` header file's mode and
  // contents to a separate log, then execs the real curl so the request lands.
  const fakeCurl = path.join(binDir, 'curl');
  fs.writeFileSync(fakeCurl, [
    '#!/bin/sh',
    '{ echo "===CALL==="; for a in "$@"; do printf \'%s\\n\' "$a"; done; } >> "$KOSMOS_ARGV_LOG"',
    'for a in "$@"; do',
    '  case "$a" in',
    '    @*) f=${a#@};',
    '        if [ -f "$f" ]; then',
    '          printf \'PERM %s\\n\' "$(stat -f \'%Lp\' "$f")" >> "$KOSMOS_FILECAP_LOG";',
    '          cat "$f" >> "$KOSMOS_FILECAP_LOG";',
    '        fi ;;',
    '  esac',
    'done',
    'exec /usr/bin/curl "$@"',
    '',
  ].join('\n'));
  fs.chmodSync(fakeCurl, 0o755);

  const env = {
    ...process.env,
    KOSMOS_PORT: String(port),
    KOSMOS_AGENT_TOKEN: TOKEN,
    TMPDIR: tmpDir,
    PATH: `${binDir}:${process.env.PATH}`,
    KOSMOS_ARGV_LOG: argvLog,
    KOSMOS_FILECAP_LOG: fileCap,
  };
  try { await run(CLI, ['report', 'started'], { env, timeout: 15000 }); }
  catch { /* the CLI's own exit code is not what this asserts */ }
  for (let i = 0; i < 100 && seen.length === 0; i += 1) {
    await new Promise((r) => setTimeout(r, 50));
  }

  // Positive control: the token still reached the route -- off-argv, not un-sent.
  assert.equal(seen.length, 1, 'the CLI did not report at all, so nothing can be judged');
  assert.equal(seen[0], TOKEN, 'the token must still be delivered (off argv is not un-sent)');

  const argv = fs.readFileSync(argvLog, 'utf8');
  const cap = fs.existsSync(fileCap) ? fs.readFileSync(fileCap, 'utf8') : '';

  // The core #1970 assertion: the token is NOT on curl's command line.
  assert.ok(!argv.includes(TOKEN), 'the token must not appear on curl argv (this is what `ps` would read)');
  // Mechanism: curl was pointed at a header FILE, in our TMPDIR.
  assert.match(argv, /^-H$/m, 'curl should receive -H');
  assert.match(argv, /^@.*kosmos-auth\./m, 'curl should read the header from an @file');
  // The token really is delivered via that file, and the file is owner-only.
  assert.ok(cap.includes(TOKEN), 'the token must be present in the header file');
  assert.match(cap, /^PERM 600$/m, 'the header file must be mode 600');
  assert.match(cap, /x-kosmos-agent-token:/, 'the header file must carry the agent-token header');

  // Cleanup: no auth temp file is left behind after the command returns.
  const leftover = fs.readdirSync(tmpDir).filter((n) => n.startsWith('kosmos-auth.'));
  assert.deepEqual(leftover, [], 'kosmos_curl must remove its temp header file');

  fs.rmSync(sandbox, { recursive: true, force: true });
}));

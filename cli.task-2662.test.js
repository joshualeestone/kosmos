'use strict';
/**
 * #2662: the `kosmos task` verb (list/add/close) is security-critical -- it carries
 * the board token to the board -- and it reproduces cmd_post's two load-bearing
 * shell idioms, so it must be guarded the same way its siblings are:
 *
 *   1. SET-E SAFETY (#2321). install/kosmos is /bin/bash 3.2 under `set -euo
 *      pipefail`, where a failing command substitution in a BARE assignment aborts
 *      the whole process AT the assignment, so the rc check never runs. cmd_task's
 *      `add` uses the fixed `rc=0; body=$(...) || rc=$?` form; this drives a REAL
 *      curl failure (a stub that serves the health page then destroys the socket on
 *      the POST) and asserts the failure is REPORTED, not a silent abort. Reverting
 *      the fix to a bare assignment empties stdout and reds assertion 1.
 *
 *   2. TOKEN OFF ARGV (#1970/#1946). macOS `ps -ww -o args` lets any local account
 *      read every process's argv, so the board token must reach curl via a mode-600
 *      `-H @file`, never on the command line. #1970 proves the MECHANISM (kosmos_curl
 *      is token-agnostic) via the report path; this proves the `task` path uses it
 *      too, so a cmd_task-specific regression that put the token on argv -- which the
 *      report-path test could not see -- reds here. A curl stub logs its own argv
 *      (what `ps` would show) and captures each `@file`'s mode+contents, then execs
 *      the real curl so the list request still lands.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'feedfacecafe4242'; // distinctive hex, so a substring hit is unambiguous

function runCli(args, env) {
  return new Promise((resolve) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err && typeof err.code === 'number' ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

test('#2662: a curl failure on `task add` is REPORTED, not a silent abort (set -e guard)', () => {
  const server = http.createServer((req, res) => {
    // Destroy the socket on the add POST so curl exits non-zero mid-request.
    if (req.method === 'POST' && req.url.startsWith('/api/project/')) { req.socket.destroy(); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try {
        // KOSMOS_NO_LEGACY_MIGRATION: `task add` calls board_token() -> store.ROOT ->
        // maybeMigrateLegacyStore(). The canonical `yarn test` runner exports this, but pin it
        // here too so a DIRECT `node --test` run cannot migrate a real ~/Library store (the
        // fleet-store hazard engine/store.js documents), since KOSMOS_HOME defaults to the repo.
        const env = { ...process.env, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '%42', KOSMOS_NO_LEGACY_MIGRATION: '1' };
        const out = await runCli(['task', 'add', 'proj', 'a task worth adding'], env);
        assert.notEqual(out.stdout.trim(), '', 'a curl failure printed nothing -- the process aborted under set -e');
        assert.match(out.stdout, /could not reach Kosmos to add that task/, 'a curl failure must be reported to the agent');
        assert.notEqual(out.code, 0, 'a curl failure must exit non-zero');
      } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
});

test('#2662: `task list` delivers the board token OFF argv, via a mode-600 file', () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/api/tasks')) {
      seen.push(req.url);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"tasks":[],"count":0,"project":"proj"}');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      let sandbox = null;
      try {
        sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-task-'));
        const binDir = path.join(sandbox, 'bin');
        const tmpDir = path.join(sandbox, 'tmp');
        const khEngine = path.join(sandbox, 'kh', 'engine');
        const dataDir = path.join(sandbox, 'data');
        fs.mkdirSync(binDir); fs.mkdirSync(tmpDir); fs.mkdirSync(khEngine, { recursive: true }); fs.mkdirSync(dataDir);
        const argvLog = path.join(sandbox, 'argv.log');
        const fileCap = path.join(sandbox, 'filecap.log');

        // board_token() reads `require($KOSMOS_HOME/engine/store).ROOT` then
        // `$ROOT/board.token`. store.ROOT resolves from AGENT_WORKFORCE_DATA and
        // appends the app leaf (#2439: `Kosmos`), i.e. ROOT = $AGENT_WORKFORCE_DATA/Kosmos.
        // A minimal KOSMOS_HOME carrying only store.js plus a board.token at that
        // resolved root is enough to make the board token PRESENT (else it is inert
        // and nothing reaches argv to test).
        fs.copyFileSync(path.join(__dirname, 'engine', 'store.js'), path.join(khEngine, 'store.js'));
        const storeRoot = path.join(dataDir, 'Kosmos');
        fs.mkdirSync(storeRoot);
        fs.writeFileSync(path.join(storeRoot, 'board.token'), TOKEN, { mode: 0o600 });

        // A curl that records its own argv, captures any `@file` header file's mode
        // and contents to a SEPARATE log, then execs the real curl so the list lands.
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
          KOSMOS_PORT: String(server.address().port),
          KOSMOS_HOME: path.join(sandbox, 'kh'),
          AGENT_WORKFORCE_DATA: dataDir,
          KOSMOS_NO_LEGACY_MIGRATION: '1',
          TMPDIR: tmpDir,
          PATH: `${binDir}:${process.env.PATH}`,
          KOSMOS_ARGV_LOG: argvLog,
          KOSMOS_FILECAP_LOG: fileCap,
        };
        // The CLI's own exit code is not what this asserts; the route hit + argv are.
        try { await runCli(['task', 'list', 'proj'], env); } catch { /* ignore */ }

        // Positive control: the list route was actually reached (dispatch + set-e
        // reachability), so the argv/@file assertions below are about a real request.
        assert.equal(seen.length, 1, 'the CLI did not reach the list route, so nothing can be judged');
        assert.match(seen[0], /project=proj/, 'the list request must carry the project');

        const argv = fs.readFileSync(argvLog, 'utf8');
        const cap = fs.existsSync(fileCap) ? fs.readFileSync(fileCap, 'utf8') : '';

        // The core assertion: the board token is NOT on curl's command line.
        assert.ok(!argv.includes(TOKEN), 'the board token must not appear on curl argv (this is what `ps` would read)');
        assert.match(argv, /^-H$/m, 'curl should receive -H');
        assert.match(argv, /^@.*kosmos-auth\./m, 'curl should read the header from an @file');
        // The token really is delivered via that file, and the file is owner-only.
        assert.ok(cap.includes(TOKEN), 'the board token must be present in the header file');
        assert.match(cap, /^PERM 600$/m, 'the header file must be mode 600');
      } catch (e) { failure = e; }
      finally {
        // Clean up the sandbox regardless of pass/fail via finally (its sibling
        // cli.token-off-argv-1970.test.js does the same cleanup but at the end of its linear body,
        // so it leaks on a failing assertion; finally is stricter). A test whose subject is
        // board-token hygiene should not leak a token file.
        if (sandbox) { try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* best-effort */ } }
      }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
});

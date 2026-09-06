'use strict';
/**
 * #2321: `kosmos post` must REPORT a curl failure, not abort silently.
 *
 * The shebang is /bin/bash (3.2 on macOS) under `set -euo pipefail`, where a
 * failing command substitution in a BARE assignment (`body=$(...); rc=$?`) aborts
 * the whole process AT the assignment -- so the `rc` check never runs. cmd_post
 * had that bare form, which made its exit-28 "still delivering, do not re-post"
 * branch and its "could not reach" branch dead on a post-healthy curl failure (a
 * -m 120 delivery timeout, or a mid-delivery reset): the CLI printed nothing and
 * exited with curl's raw code -- inviting the exact duplicate re-post the exit-28
 * branch exists to prevent. Fixed with `rc=0; body=$(...) || rc=$?`.
 *
 * This drives a REAL curl failure the way cli.react-2255.test.js does: a stub that
 * serves the health page (so healthy() passes) then destroys the socket on the
 * POST (curl exits ~52). A response-stub could never exercise this, which is why
 * the bug shipped. Reverting the fix empties stdout -> assertion 1 reds.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');

function runCli(args, env) {
  return new Promise((resolve) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ code: err && typeof err.code === 'number' ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

test('#2321: a curl failure on the post is REPORTED, not a silent abort (set -e guard)', () => {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/post')) { req.socket.destroy(); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try {
        const env = { ...process.env, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '%42' };
        const out = await runCli(['post', 'proj', 'a message worth posting'], env);
        assert.notEqual(out.stdout.trim(), '', 'a curl failure printed nothing -- the process aborted under set -e');
        assert.match(out.stdout, /could not reach Kosmos|still delivering/, 'a curl failure must be reported to the agent');
        assert.notEqual(out.code, 0, 'a curl failure must exit non-zero');
      } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
});

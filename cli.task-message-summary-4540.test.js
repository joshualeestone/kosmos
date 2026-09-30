'use strict';
/**
 * #4540: `kosmos task message` prints the board's own `summary` sentence about who was told, and never the old
 * blanket "any agents assigned to it were notified". An older board that sends no summary gets only the first
 * sentence. Stub board and sandboxed KOSMOS_HOME, as cli.agent-token-verbs-4491.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
// #4796-sandbox: KOSMOS_HOME is a throwaway whose store module names the data root and holds a known board.token, so the CLI never reads the real one (checked by cli.sandbox-data-4796.test.js).

const CLI = path.join(__dirname, 'install', 'kosmos');

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-4540-cli-'));
  const root = path.join(home, 'root');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(home, 'app', 'engine', 'store.js'), `module.exports = { ROOT: ${JSON.stringify(root)} };\n`);
  return home;
}

function withStub(answer, fn) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && /\/task\/\d+\/message$/.test(req.url.split('?')[0])) {
      req.resume();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(answer));
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

// The exit code is asserted; a run that ended with no numeric code (killed, never started) is a failure (#3628).
function runCli(args, env) {
  return new Promise((resolve, reject) => execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
    if (err && typeof err.code !== 'number') { reject(err); return; }
    resolve({ code: err ? err.code : 0, out: String(stdout || '') + String(stderr || '') });
  }));
}

async function message(answer) {
  const home = makeHome();
  try {
    let got;
    await withStub(answer, async (port) => {
      const env = { ...process.env, KOSMOS_PORT: String(port), KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: '', TMUX_PANE: '' };
      delete env.KOSMOS_AGENT_TOKEN;
      got = await runCli(['task', 'message', 'p4540', '3', 'hello'], env);
    });
    return got;
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
}

test('the board\'s summary is printed after the message is recorded', async () => {
  const r = await message({ ok: true, delivered: [], summary: 'Told mara. Not told: zed is not on this project any more, so it was not told.' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Message recorded on task 3 of p4540\. Told mara\. Not told: zed is not on this project any more, so it was not told\./);
  assert.doesNotMatch(r.out, /were notified/);
});

test('an older board with no summary gets only the first sentence, never a claim that anyone was told', async () => {
  const r = await message({ ok: true, delivered: [] });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Message recorded on task 3 of p4540\.\s*$/);
  assert.doesNotMatch(r.out, /were notified|Told/);
});

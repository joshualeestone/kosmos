'use strict';
/**
 * kosmos#5643 (the 10-07 to 10-09 reports: results lost after the check succeeded): `kosmos task ran` asks again,
 * twice, when the board did not take the run (no answer, a timeout, a 503), in both CLIs. A run that still was not
 * taken says whether it may have been recorded (a timeout) or was not (a refusal), and a rule (`task repeat`) is asked
 * once, as before. install/kosmos runs against a stub board; the Windows CLI gets an injected fetch.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const wincli = require('./tools/windows/kosmos-cli');
const realHook = require('./engine/kosmos-report-hook');

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'ab'.repeat(32);
const homes = [];
test.after(() => { for (const h of homes) fs.rmSync(h, { recursive: true, force: true }); });
function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-5643r-cli-'));
  homes.push(home);
  const root = path.join(home, 'root');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(home, 'runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(home, 'app', 'engine'), { recursive: true });
  fs.symlinkSync(process.execPath, path.join(home, 'runtime', 'bin', 'node'));
  fs.writeFileSync(path.join(home, 'app', 'engine', 'store.js'), `module.exports = { ROOT: ${JSON.stringify(root)} };\n`);
  fs.writeFileSync(path.join(root, 'board.token'), 'boardtoken5643');
  return home;
}
const OK = { task: { number: 3 } };
const BUSY = { error: 'we could not check which agents are running, so the task was not changed' };
/* A stub board answering POSTs from a script of statuses, in order (the last repeats). */
function withStub(script, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      req.on('data', () => {}); req.on('end', () => {
        const status = script[Math.min(seen.length, script.length - 1)];
        seen.push(req.url);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(status === 200 ? OK : BUSY));
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => server.listen(0, '127.0.0.1', async () => {
    let failure = null;
    try { await fn(server.address().port, seen); } catch (e) { failure = e; }
    server.close(() => (failure ? reject(failure) : resolve()));
  }));
}
function sh(port, home, args) {
  const env = { ...process.env, KOSMOS_PORT: String(port), KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: '', TMUX_PANE: '', KOSMOS_AGENT_TOKEN: TOKEN, KOSMOS_RETRY_PAUSE_MS: '0' };
  delete env.KOSMOS_AGENT_TOKEN_ONLY;
  return new Promise((resolve, reject) => execFile(CLI, args, { env, timeout: 30000 }, (err, so, se) => {
    if (err && typeof err.code !== 'number') { reject(err); return; }
    resolve({ code: err ? err.code : 0, out: String(so) + String(se) });
  }));
}
const posts = (seen) => seen.filter((r) => /\/task\/3\/(ran|repeat)$/.test(r)).length;

test('#5643 Mac: a run the board refused once (503) is asked again and recorded', async () => {
  const home = makeHome();
  await withStub([503, 200], async (port, seen) => {
    const r = await sh(port, home, ['task', 'ran', 'proj', '3', 'all clear']);
    assert.equal(r.code, 0, r.out);
    assert.equal(posts(seen), 2, 'not asked again after a 503');
    assert.match(r.out, /Recorded a run of task 3/);
  });
});

test('#5643 Mac: three refusals say it was not recorded and to run it again; a rule is asked once', async () => {
  const home = makeHome();
  await withStub([503], async (port, seen) => {
    const r = await sh(port, home, ['task', 'ran', 'proj', '3', 'all clear']);
    assert.equal(r.code, 1, r.out);
    assert.equal(posts(seen), 3, 'not exactly three attempts');
    assert.match(r.out, /It was not recorded; run the same command again in a minute\./);
  });
  await withStub([503], async (port, seen) => {
    const r = await sh(port, home, ['task', 'repeat', 'proj', '3', 'hourly']);
    assert.equal(r.code, 1, r.out);
    assert.equal(posts(seen), 1, 'CONTROL: a rule change was retried');
  });
  // CONTROL: a 400 (a refusal that is not busy) is not retried.
  await withStub([400], async (port, seen) => {
    const r = await sh(port, home, ['task', 'ran', 'proj', '3', 'x']);
    assert.equal(r.code, 1, r.out);
    assert.equal(posts(seen), 1, 'a 400 was retried');
  });
});

test('#5643 Mac: with no board at all the command still says Kosmos is not running (checked before any attempt)', async () => {
  const home = makeHome();
  // A port nothing listens on: the CLI's health check answers first, so the retry never starts.
  const free = await new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const r = await sh(free, home, ['task', 'ran', 'proj', '3', 'x']);
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /Kosmos is not running/, 'a board that is down was not said as down');
});

async function win(argv, answers) {
  const calls = []; const out = []; const err = [];
  const code = await wincli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: TOKEN, KOSMOS_RETRY_PAUSE_MS: '0' },
    hook: { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'cd'.repeat(32), agentToken: realHook.agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url) => {
      const a = answers[Math.min(calls.length, answers.length - 1)];
      calls.push(url);
      if (a === 'timeout') { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; }
      return { status: a, text: async () => JSON.stringify(a === 200 ? OK : BUSY) };
    },
  });
  return { code, calls: calls.filter((u) => /\/task\/3\/(ran|repeat)$/.test(u)).length, out: out.join('\n') + err.join('\n') };
}

test('#5643 Windows: retried on a 503 and on a timeout; a timeout keeps "may have been recorded"; a rule is asked once', async () => {
  let r = await win(['task', 'ran', 'proj', '3', 'all clear'], [503, 200]);
  assert.deepEqual([r.code, r.calls], [0, 2], r.out);
  r = await win(['task', 'ran', 'proj', '3', 'all clear'], [503]);
  assert.deepEqual([r.code, r.calls], [1, 3], r.out);
  assert.match(r.out, /It was not recorded; run the same command again in a minute\./);
  r = await win(['task', 'ran', 'proj', '3', 'all clear'], ['timeout', 200]);
  assert.deepEqual([r.code, r.calls], [0, 2], r.out);
  r = await win(['task', 'ran', 'proj', '3', 'all clear'], ['timeout', 503]);
  assert.equal(r.calls, 3);
  assert.doesNotMatch(r.out, /It was not recorded/, 'a run that may have landed was said not recorded');
  assert.match(r.out, /may have been recorded/);
  r = await win(['task', 'repeat', 'proj', '3', 'hourly'], [503]);
  assert.equal(r.calls, 1, 'CONTROL: a rule change was retried');
  r = await win(['task', 'ran', 'proj', '3', 'x'], [400]);
  assert.equal(r.calls, 1, 'CONTROL: a 400 was retried');
});

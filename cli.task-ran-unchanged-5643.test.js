'use strict';
/**
 * kosmos#5643: `kosmos task ran <project> <n> --unchanged ["what it checked"]` in both CLIs sends `unchanged: true` with
 * the note and says the run found nothing new; without the flag it sends `unchanged: false` (install/kosmos) or false
 * (Windows) and the old words. install/kosmos runs against a stub board (cli.task-donewhen-5152's pattern); the Windows CLI
 * gets an injected fetch.
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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-5643-cli-'));
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
function withStub(fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body; try { body = JSON.parse(raw); } catch { body = { unparseable: raw }; }
        seen.push({ route: req.url, body });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ task: { number: 3 } }));
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
  const env = { ...process.env, KOSMOS_PORT: String(port), KOSMOS_HOME: home, AGENT_WORKFORCE_DATA: '', TMUX_PANE: '', KOSMOS_AGENT_TOKEN: TOKEN };
  delete env.KOSMOS_AGENT_TOKEN_ONLY;
  return new Promise((resolve, reject) => execFile(CLI, args, { env, timeout: 20000 }, (err, so, se) => {
    if (err && typeof err.code !== 'number') { reject(err); return; }
    resolve({ code: err ? err.code : 0, out: String(so) + String(se) });
  }));
}
async function win(argv) {
  const calls = []; const out = []; const err = [];
  const code = await wincli.main(argv, {
    env: { KOSMOS_AGENT_TOKEN: TOKEN },
    hook: { resolveUrl: () => 'http://127.0.0.1:1', readBoardToken: () => 'cd'.repeat(32), agentToken: realHook.agentToken },
    out: (s) => out.push(s), err: (s) => err.push(s),
    fetch: async (url, init) => { calls.push({ route: url.replace('http://127.0.0.1:1', ''), body: init.body ? JSON.parse(init.body) : undefined }); return { status: 200, text: async () => JSON.stringify({ task: { number: 3 } }) }; },
  });
  return { code, calls, out: out.join('\n') + err.join('\n') };
}

test('install/kosmos: task ran --unchanged sends unchanged:true with the note, and says it found nothing new', async () => {
  const home = makeHome();
  await withStub(async (port, seen) => {
    const r = await sh(port, home, ['task', 'ran', 'p1', '3', '--unchanged', 'all clear']);
    assert.equal(r.code, 0, r.out);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].route, '/api/project/p1/task/3/ran');
    assert.deepEqual([seen[0].body.unchanged, seen[0].body.note], [true, 'all clear']);
    assert.match(r.out, /that found nothing new/);
    const plain = await sh(port, home, ['task', 'ran', 'p1', '3', 'found 2 new']);   // CONTROL: no flag
    assert.equal(seen[1].body.unchanged, false);
    assert.doesNotMatch(plain.out, /nothing new/);
    await sh(port, home, ['task', 'ran', 'p1', '3', '--', '--unchanged']);   // past --, it is words
    assert.deepEqual([seen[2].body.unchanged, seen[2].body.note], [false, '--unchanged']);
  });
});

test('Windows CLI: the same', async () => {
  const r = await win(['task', 'ran', 'p1', '3', '--unchanged', 'all clear']);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual([r.calls[0].route, r.calls[0].body.unchanged, r.calls[0].body.note], ['/api/project/p1/task/3/ran', true, 'all clear']);
  assert.match(r.out, /that found nothing new/);
  const plain = await win(['task', 'ran', 'p1', '3', 'found 2 new']);
  assert.equal(plain.calls[0].body.unchanged, false);
  assert.doesNotMatch(plain.out, /nothing new/);
  const words = await win(['task', 'ran', 'p1', '3', '--', '--unchanged']);
  assert.deepEqual([words.calls[0].body.unchanged, words.calls[0].body.note], [false, '--unchanged']);
});

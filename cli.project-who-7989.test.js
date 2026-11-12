'use strict';
/**
 * kosmos#7989 slice 2: `kosmos project who <file>` on the Mac CLI. The stub is a REAL http server the CLI's own curl
 * hits (cli.project-show-4581.test.js's harness), answering with an answer built by the real filewriters.about, so this
 * pins the route, the URL-encoded absolute path, the token sent, the exit codes and the printed words (filewhoview).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const DATA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-project-who-')));
const TOKEN = 'cd'.repeat(32);
const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-project-who-7989-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
const fw = require('./engine/filewriters');
const { renderWho } = require('./engine/filewhoview');
const SKIP_POSIX_SHELL = require('./test-support/skip-on-win32').skipOnWin32('it runs install/kosmos (the Mac and Linux CLI, a bash script) directly by its shebang line, which Windows cannot do');   // kosmos#8378
test.after(() => { fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

/* A real answer: a record, then the edit landing. */
const FOLDER = path.join(SANDBOX, 'projects', 'ff');
fs.mkdirSync(path.join(FOLDER, 'my notes'), { recursive: true });
const LIST = [{ id: 'ff', name: 'Five Families', folder: FOLDER }];
const FILE = path.join(FOLDER, 'my notes', 'plan & next.md');
const T = Date.now() - 60000;
fw.noteWrite(FILE, 'mona', { now: T - 60000, projects: LIST });
fw.noteWrite(FILE, 'kitty', { now: T, projects: LIST });
fs.writeFileSync(FILE, 'x');
fs.utimesSync(FILE, new Date(T + 1000), new Date(T + 1000));
const ANSWER = fw.about(FILE, { projects: LIST });

function runCli(args, env, cwd) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, cwd, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('no exit code: ' + (err.signal || err.code) + ' ' + stderr)); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}
function withStub(fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      if (req.url !== '/api/health') seen.push({ method: req.method, url: req.url, agent: req.headers['x-kosmos-agent-token'] });
      const u = new URL(req.url, 'http://x');
      // An older board admits the agent token on this route; a token it does not know is refused here too.
      if (u.pathname === '/api/projects/overview') {
        const known = req.headers['x-kosmos-agent-token'] === TOKEN;
        res.writeHead(known ? 200 : 403, { 'content-type': 'application/json' });
        res.end(known ? '{"projects":[]}' : '{"error":"this board belongs to the account that started it; open it with `kosmos open`"}');
        return;
      }
      if (u.pathname === '/api/project-file/who') {
        const p = u.searchParams.get('path');
        if (p === '/old/board') { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"no such endpoint"}'); return; }
        if (p === '/old/gate') { res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"this board belongs to the account that started it; open it with `kosmos open`"}'); return; }
        if (p === '/refused/x') { res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"ok":false,"error":"that request came from another website, so we will not fetch for it"}'); return; }
        const body = p === FILE ? ANSWER : p === '/bad/answer' ? null : { ok: false, because: 'outside' };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(body ? JSON.stringify(body) : '<html>proxy</html>');
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"no"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn({ ...process.env, KOSMOS_PORT: String(server.address().port), AGENT_WORKFORCE_DATA: DATA, KOSMOS_AGENT_TOKEN: TOKEN }, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

test('kosmos#7989 slice 2: CONTROL, the answer names the last agent seen and the owner apart', () => {
  assert.equal(ANSWER.ok, true);
  assert.equal(ANSWER.lastSeen.agent, 'kitty');
  assert.equal(ANSWER.owner.agent, 'mona');
  assert.equal(ANSWER.lastChange, 'seen');
});

test('kosmos#7989 slice 2: kosmos project who <absolute path> GETs the route with the path encoded and prints renderWho', { skip: SKIP_POSIX_SHELL }, () => withStub(async (env, seen) => {
  const out = await runCli(['project', 'who', FILE], env);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(seen.length, 1, 'not exactly one board call: ' + JSON.stringify(seen));
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].agent, TOKEN, 'the agent token was not sent');
  assert.equal(new URL(seen[0].url, 'http://x').pathname, '/api/project-file/who');
  assert.equal(new URL(seen[0].url, 'http://x').searchParams.get('path'), FILE, 'the path did not arrive whole (a space and & in it)');
  assert.equal(out.stdout, renderWho(ANSWER).join('\n') + '\n');
}));

test('kosmos#7989 slice 2: a relative path is read from where the command runs', { skip: SKIP_POSIX_SHELL }, () => withStub(async (env, seen) => {
  const out = await runCli(['project', 'who', path.join('my notes', 'plan & next.md')], env, FOLDER);
  assert.equal(out.code, 0, out.stdout + out.stderr);
  assert.equal(path.resolve(new URL(seen[0].url, 'http://x').searchParams.get('path')), FILE);
}));

test('kosmos#7989 slice 2: outside every project exits 1 with the renderer\'s words; an unreadable answer exits 1', { skip: SKIP_POSIX_SHELL }, () => withStub(async (env) => {
  const out = await runCli(['project', 'who', '/etc/hosts'], env);
  assert.equal(out.code, 1);
  assert.equal(out.stdout, renderWho({ ok: false, because: 'outside' }).join('\n') + '\n');
  const bad = await runCli(['project', 'who', '/bad/answer'], env);
  assert.equal(bad.code, 1);
  assert.match(bad.stdout + bad.stderr, /could not read/);
  // Review 5: a board older than the command: a 404 says so; a 403 on the agent token says it may be that.
  const old = await runCli(['project', 'who', '/old/board'], env);
  assert.equal(old.code, 1);
  assert.match(old.stdout, /older than `kosmos project who`/);
  assert.doesNotMatch(old.stdout, /no such endpoint/);
  const gate = await runCli(['project', 'who', '/old/gate'], env);
  assert.equal(gate.code, 1);
  assert.match(gate.stdout, /older than `kosmos project who`, so it refuses an agent's own token here/);
  assert.doesNotMatch(gate.stdout, /kosmos open/, 'review 6: the older board\'s own advice, which cannot help, was printed too');
  // Review 6: the same 403 with a token the board does not know is the token, not the board's age.
  const stale = await runCli(['project', 'who', '/old/gate'], { ...env, KOSMOS_AGENT_TOKEN: 'ee'.repeat(32) });
  assert.equal(stale.code, 1);
  assert.doesNotMatch(stale.stdout, /older than/, 'a token the board does not know was blamed on the board\'s age');
  const refused = await runCli(['project', 'who', '/refused/x'], env);
  assert.doesNotMatch(refused.stdout, /older than|started before/, 'review 6: a cross-site refusal was blamed on the board\'s age');
  assert.equal(refused.code, 1, 'review 2: a refusal exited 0');
  assert.match(refused.stdout, /could not read who changes that file: that request came from another website/);
}));

test('kosmos#7989 slice 2: no file, two files, or an option is a usage error, before the board is asked', { skip: SKIP_POSIX_SHELL }, () => withStub(async (env, seen) => {
  for (const args of [['project', 'who'], ['project', 'who', 'a', 'b'], ['project', 'who', '--json'], ['project', 'who', '-x']]) {
    const out = await runCli(args, env);
    assert.equal(out.code, 2, args.join(' ') + ': ' + out.stdout + out.stderr);
    // Review 3: no advice to put -- first, which fails here; the usage says ./-name instead.
    assert.doesNotMatch(out.stdout, /put -- before it/, args.join(' '));
  }
  const help = await runCli(['project', 'who', '-h'], env);
  // Review 3: the help's own line, which the option refusal's Usage line does not contain.
  assert.match(help.stdout + help.stderr, /the agent Kosmos last saw about to change it, its owner/, '-h did not print the help: ' + help.stdout);
  assert.deepEqual(seen, [], 'a usage error still asked the board');
}));

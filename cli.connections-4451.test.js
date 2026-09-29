'use strict';
/**
 * #4451: `kosmos connections` and `kosmos connect <service>`, the agent's side of the Connections tab.
 *
 * 🛑 THE READ MUST NEVER TOUCH THE METERED SWEEP. `kosmos connections` asks `/api/connections/held`
 * (the disk only); the stub below COUNTS any request to `/api/connections`, the page's live check that
 * bills the person for Brave, Exa, Tavily and Serper. That count must stay zero.
 * 🛑 THE TOKEN RIDES STDIN, NEVER ARGV, and the private file that carries it to the board is gone
 * afterwards. Both are asserted, not assumed.
 *
 * Harness as cli.presents-token.test.js: an in-process stub answering the CLI's own health check with a
 * page containing "Kosmos", and ASYNC child processes (a synchronous one blocks the stub's event loop).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
const TOKEN = 'bsa_0123456789abcdef0123456789abcdef';

function withStub(answers, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body });
      const a = answers[req.method + ' ' + req.url];
      if (a) { res.writeHead(a.status || 200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(a.json)); }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<title>Kosmos</title>Agent Workforce');
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

/** Run the CLI with `stdin` piped in (or null for none), in a private TMPDIR. */
function cli(port, args, stdin, tmpdir) {
  return new Promise((resolve) => {
    const env = { ...process.env, KOSMOS_PORT: String(port), TMPDIR: tmpdir };
    delete env.KOSMOS_AGENT_TOKEN;
    const child = spawn(CLI, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const t = setTimeout(() => child.kill('SIGKILL'), 20000);
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out, argv: child.spawnargs }); });
    if (stdin !== null) child.stdin.end(stdin); else child.stdin.end();
  });
}
const privateDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli4451-'));

const HELD = { services: [
  { name: 'GitHub', route: '/api/github', how: 'sign-in', held: null },
  { name: 'Brave Search', route: '/api/svc/brave-search', how: 'token', held: true, connect: 'brave-search' },
  { name: 'Exa', route: '/api/svc/exa', how: 'token', held: false, connect: 'exa' },
] };

test('#4451: kosmos connections reads the cheap route, never the metered sweep, and says each state in words', () => withStub({ 'GET /api/connections/held': { json: HELD } }, async (port, seen) => {
  const r = await cli(port, ['connections'], null, privateDir());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Brave Search: connected \(a token is stored/);
  assert.match(r.out, /Exa: not connected \(store the token the person gives you with: kosmos connect exa\)/);
  assert.match(r.out, /GitHub: not known without a live check; the person connects it in Settings > Connections/);
  assert.ok(seen.some((q) => q.url === '/api/connections/held'), 'CONTROL: the cheap route was not asked, so the next line proves nothing');
  assert.equal(seen.filter((q) => q.url === '/api/connections').length, 0, 'kosmos connections called the metered sweep');
}));

test('#4451: kosmos connect takes the token on stdin, sends it through the door, and leaves no private file behind', () => withStub({
  'POST /api/svc/brave-search/token': { json: { service: 'Brave Search', connected: true, held: true, who: null } },
}, async (port, seen) => {
  const tmp = privateDir();
  const r = await cli(port, ['connect', 'brave-search'], TOKEN + '\n', tmp);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Connected Brave Search\. Its row in Settings > Connections shows it\./);
  const post = seen.find((q) => q.method === 'POST' && q.url === '/api/svc/brave-search/token');
  assert.ok(post, 'the token did not reach the door');
  assert.deepEqual(JSON.parse(post.body), { token: TOKEN }, 'the door did not get exactly the token from stdin');
  assert.ok(!r.argv.join(' ').includes(TOKEN), 'the token was on the command line');
  assert.deepEqual(fs.readdirSync(tmp).filter((f) => f.startsWith('kosmos-connect')), [], 'the private token file was left behind');
  assert.equal(seen.filter((q) => q.url === '/api/connections').length, 0, 'connect called the metered sweep');
}));

test('#4451: kosmos connect says a refusal in the service\'s words, and refuses an empty token or a bad name before sending', () => withStub({
  'POST /api/svc/exa/token': { status: 400, json: { service: 'Exa', connected: false, refused: 'Exa did not accept that token' } },
}, async (port, seen) => {
  const refused = await cli(port, ['connect', 'exa'], TOKEN, privateDir());
  assert.equal(refused.code, 1);
  assert.match(refused.out, /Exa did not connect: Exa did not accept that token/);

  const before = seen.filter((q) => q.method === 'POST').length;
  const empty = await cli(port, ['connect', 'exa'], '   \n', privateDir());
  assert.equal(empty.code, 2);
  assert.match(empty.out, /the token on stdin was empty/);
  const badName = await cli(port, ['connect', 'Brave Search'], TOKEN, privateDir());
  assert.equal(badName.code, 2);
  assert.equal(seen.filter((q) => q.method === 'POST').length, before, 'an empty token or a bad name was sent anyway');
}));

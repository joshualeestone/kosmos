'use strict';
/**
 * #5300 (10-05 user diagnostic R10): `kosmos project role <project-id> "<what you do here>"`, the Mac CLI against a
 * stub board that records every request (the Windows twin is tools.windows-kosmos-cli-project-role-5300.test.js; the
 * board's half is server.project-role-5300.test.js).
 *
 *   node --test cli.project-role-5300.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');

const CLI = path.join(__dirname, 'install', 'kosmos');
/* #4796: a fresh data root, so the live board's token never travels to this test's stub board. */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-project-role-'));
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));
const AGENT = 'cd'.repeat(16);

function runCli(args, env) {
  return new Promise((resolve, reject) => {
    execFile(CLI, args, { env, timeout: 20000 }, (err, stdout, stderr) => {
      if (err && typeof err.code !== 'number') { reject(new Error('the CLI gave no exit code (' + (err.signal || err.code) + '). ' + (stderr || ''))); return; }
      resolve({ code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function withBoard(answer, fn) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!req.url.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<title>Kosmos</title>Agent Workforce'); return; }
      /* The CLI's health probe asks /api/health first (install/kosmos, the probe near line 289); it is the board being
         looked for, not the action under test, so it answers as a board does and is not counted. */
      if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ app: 'kosmos' })); return; }
      hits.push({ method: req.method, url: req.url, body: raw, agentToken: req.headers['x-kosmos-agent-token'] || null });
      const [status, body] = answer(req);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = { ...process.env, AGENT_WORKFORCE_DATA: DATA, KOSMOS_PORT: String(server.address().port), TMUX_PANE: '%42', KOSMOS_AGENT_TOKEN: AGENT };
  try { return await fn(env, hits); } finally { await new Promise((r) => server.close(r)); }
}

test('#5300 Mac CLI: project role POSTs the words with the agent\'s token and the pane, and says where it shows', () =>
  withBoard(() => [200, { ok: true, role: 'Researcher "lead"' }], async (env, hits) => {
    const r = await runCli(['project', 'role', 'p1', 'Researcher "lead"\\ x'], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Set\. kosmos project show p1 lists you with that role on this project\./);
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.equal(hits[0].method, 'POST');
    assert.equal(hits[0].url, '/api/project/p1/role');
    assert.deepEqual(JSON.parse(hits[0].body), { role: 'Researcher "lead"\\ x', from_pane: '%42' }, 'quotes and a backslash did not survive');
    assert.equal(hits[0].agentToken, AGENT);
  }));

test('#5300 Mac CLI: an empty role clears it; a refusal says the board\'s reason and exits 1', () =>
  withBoard((req) => (req.url.includes('nosuch') ? [404, { error: 'there is no project by that name' }] : [200, { ok: true, role: null }]), async (env, hits) => {
    const r = await runCli(['project', 'role', 'p1', ''], env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Cleared your role on p1\./);
    assert.deepEqual(JSON.parse(hits[0].body).role, '');
    const no = await runCli(['project', 'role', 'nosuch', 'Writer'], env);
    assert.equal(no.code, 1, no.stdout + no.stderr);
    assert.match(no.stdout + no.stderr, /did not set that role: there is no project by that name/);
  }));

test('#5300 Mac CLI: no role, three words unquoted, a bad id and an option are refused before any request', () =>
  withBoard(() => [200, { ok: true, role: 'x' }], async (env, hits) => {
    for (const [args, code] of [[['project', 'role', 'p1'], 2], [['project', 'role', 'p1', 'a', 'b'], 2], [['project', 'role', 'bad id!', 'x'], 1],
      [['project', 'role', '..', 'x'], 1], [['project', 'role', 'p1', '--clear'], 2]]) {
      const r = await runCli(args, env);
      assert.equal(r.code, code, args.join(' ') + ': ' + r.stdout + r.stderr);
    }
    assert.equal(hits.length, 0, 'a refused call reached the board: ' + JSON.stringify(hits));
  }));

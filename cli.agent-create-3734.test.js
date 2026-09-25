'use strict';
/**
 * #3734: `kosmos agent create "<name>" <role>` posts to /api/agents with the agent's launch token (the
 * board accepts it only from the setup guide), and says what the board answered: made, refused with its
 * reason, or partly made. `kosmos agent roles` lists the role keys. Run against a stub board.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const CLI = path.join(__dirname, 'install', 'kosmos');

function withStub(answer, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/agents')) {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        seen.push({ token: req.headers['x-kosmos-agent-token'], body: JSON.parse(body || '{}') });
        const [status, json] = answer();
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api/roles')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ roles: [{ key: 'pm', label: 'Project Manager' }, { key: 'writer', label: 'Writer' }], models: [] }));
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await fn(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

async function cli(port, args, token) {
  const env = { ...process.env, KOSMOS_PORT: String(port) };
  if (token) env.KOSMOS_AGENT_TOKEN = token; else delete env.KOSMOS_AGENT_TOKEN;
  try {
    const { stdout, stderr } = await run(CLI, args, { env, timeout: 20000 });
    return { code: 0, out: stdout + stderr };
  } catch (e) { return { code: e.code, out: String(e.stdout || '') + String(e.stderr || '') }; }
}

test('#3734 agent create sends the name, role and launch token, and says it was made', () => withStub(
  () => [200, { outcome: 'created', name: 'pm', because: 'pm is set up and starting', projects: [{ id: 'p1', name: 'Not the agent' }], madeBy: 'guidebot' }],
  async (port, seen) => {
    const r = await cli(port, ['agent', 'create', 'PM "one"', 'pm'], 'abc123');
    assert.equal(r.code, 0, r.out);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].token, 'abc123', 'the launch token did not reach the board');
    assert.deepEqual(seen[0].body, { name: 'PM "one"', role: 'pm' }, 'the name or role was mangled on the way');
    assert.match(r.out, /Made "pm"\. It's on your board now: http/, 'it did not name the agent the board made (a nested name was read instead?)');
  }));

test('#3734 agent create says the board\'s reason when it refuses, and exits non-zero', () => withStub(
  () => [403, { error: 'only the setup guide can make agents for the person; they can make one from New agent' }],
  async (port) => {
    const r = await cli(port, ['agent', 'create', 'PM', 'pm'], 'abc123');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /Kosmos did not make that agent: only the setup guide/);
  }));

test('#3734 an engine refusal (outcome refused) is also said with its reason', () => withStub(
  () => [400, { outcome: 'refused', because: 'there is already an agent called PM' }],
  async (port) => {
    const r = await cli(port, ['agent', 'create', 'PM', 'pm'], 'abc123');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /did not make that agent: there is already an agent called PM/);
  }));

test('#3734 agent roles lists the role keys, and a bad call is named before the board is asked', () => withStub(
  () => [500, {}],
  async (port, seen) => {
    const r = await cli(port, ['agent', 'roles']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^pm {2}Project Manager$/m);
    assert.match(r.out, /^writer {2}Writer$/m);
    const bad = await cli(port, ['agent', 'create', 'only-a-name']);
    assert.equal(bad.code, 2);
    assert.match(bad.out, /Usage: kosmos agent create/);
    assert.equal(seen.length, 0, 'a malformed call reached the board');
  }));

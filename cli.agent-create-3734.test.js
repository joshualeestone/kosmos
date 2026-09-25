'use strict';
/**
 * #3734: `kosmos agent create "<name>" <role> ["<why>"]` asks for a one-member team (POST /api/team) with
 * the agent's launch token, and says what the board answered: made, or refused with its reason. `kosmos
 * agent roles` lists the role keys. Run against a stub board, in a sandboxed KOSMOS_HOME whose runtime is
 * the only node the CLI can find (an agent's PATH may have none).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const run = promisify(execFile);

// A sandboxed KOSMOS_HOME with its own runtime/bin/node, and a PATH with no node on it: the CLI must find
// node through the engine's runtime, as it does on an installed Mac where an agent's PATH has none.
const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-agent-')));
fs.mkdirSync(path.join(HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME, 'runtime', 'bin', 'node'));
test.after(() => fs.rmSync(HOME, { recursive: true, force: true }));

const CLI = path.join(__dirname, 'install', 'kosmos');

function withStub(answer, fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/team')) {
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

async function cli(port, args, token, home = HOME) {
  // The fake tmux pins the directory the CLI puts first on PATH (it prepends the chosen tmux's folder;
  // a system tmux from Homebrew would bring Homebrew's node with it).
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: home, KOSMOS_HOME: home, KOSMOS_PORT: String(port), TMPDIR: os.tmpdir(),
    AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh') };
  if (token) env.KOSMOS_AGENT_TOKEN = token;
  try {
    const { stdout, stderr } = await run(CLI, args, { env, timeout: 20000 });
    return { code: 0, out: stdout + stderr };
  } catch (e) { return { code: e.code, out: String(e.stdout || '') + String(e.stderr || '') }; }
}

test('#3734 agent create asks for a one-member team with the token, and names the agent the board made', () => withStub(
  () => [200, { outcome: 'created', created: [{ name: 'pm', shownAs: 'PM one', id: 'a1' }], refused: [], creator: 'guidebot', purpose: 'x' }],
  async (port, seen) => {
    const r = await cli(port, ['agent', 'create', 'PM "one"', 'pm', 'they want a project manager'], 'abc123');
    assert.equal(r.code, 0, r.out);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].token, 'abc123', 'the launch token did not reach the board');
    assert.deepEqual(seen[0].body, { purpose: 'they want a project manager', members: [{ name: 'PM "one"', role: 'pm' }] },
      'the name, role or why was mangled on the way');
    assert.match(r.out, /Made "PM one"\. It's on your board now: http/);
  }));

test('#3734 with no node on PATH and no runtime, it says so instead of misreading a made agent', () => withStub(
  () => [200, { outcome: 'created', created: [{ name: 'pm' }] }],
  async (port) => {
    const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-agent-bare-')));
    try {
      const r = await cli(port, ['agent', 'create', 'PM', 'pm'], 'abc123', bare);
      assert.notEqual(r.code, 0);
      assert.match(r.out, /could not find its own runtime/);
    } finally { fs.rmSync(bare, { recursive: true, force: true }); }
  }));

test('#3734 agent create says the board\'s reason when it refuses, and exits non-zero', () => withStub(
  () => [403, { error: 'that token does not belong to any agent Kosmos started' }],
  async (port) => {
    const r = await cli(port, ['agent', 'create', 'PM', 'pm'], 'abc123');
    assert.notEqual(r.code, 0);
    assert.match(r.out, /Kosmos did not make that agent: that token does not belong to any agent/);
  }));

test('#3734 a member the board refused is said with its reason', () => withStub(
  () => [400, { outcome: 'refused', created: [], refused: [{ name: 'PM', because: 'there is already an agent called PM' }], because: 'no member could be created' }],
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

test('#3734 kosmos agent --help and -h show the agent usage, not the top-level banner', () => withStub(
  () => [500, {}],
  async (port, seen) => {
    for (const flag of ['--help', '-h']) {
      const r = await cli(port, ['agent', flag]);
      assert.equal(r.code, 0, flag + ' did not exit 0');
      assert.match(r.out, /Usage: kosmos agent <create\|roles>/, flag + ' showed: ' + r.out);
      assert.doesNotMatch(r.out, /kosmos start \| stop/, flag + ' fell through to the top-level banner');
    }
    assert.equal(seen.length, 0, 'asking for help reached the board');
  }));

test('#3734 agent create with no launch token refuses before sending anything', () => withStub(
  () => [200, { outcome: 'created', created: [{ name: 'pm' }] }],
  async (port, seen) => {
    const r = await cli(port, ['agent', 'create', 'PM', 'pm']);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /no launch token; make the agent from New agent/);
    assert.equal(seen.length, 0, 'a create with no launch token reached the board');
  }));

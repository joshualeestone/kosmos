'use strict';
/**
 * #4474: when no role fits, `kosmos agent role-draft` prints the default ("Describe it yourself") text to start
 * from, and `kosmos agent create "<name>" --new-role "<label>" --from <file> ["<why>"]` asks for a one-member team
 * whose member is the `own` role with that label and the file's text, verbatim. Run against a stub board in a
 * sandboxed KOSMOS_HOME whose runtime is the only node the CLI can find, as cli.agent-create-3734.test.js does.
 */
require('./test-support/tmpscope'); // kosmos#4273: this file's temp dirs, removed when it exits
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const run = promisify(execFile);

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cli-newrole-')));
fs.mkdirSync(path.join(HOME, 'runtime', 'bin'), { recursive: true });
fs.symlinkSync(process.execPath, path.join(HOME, 'runtime', 'bin', 'node'));

const CLI = path.join(__dirname, 'install', 'kosmos');
const OWN = 'You are **{{NAME}}**, an assistant.\n\n## Who you are\nThe default text.\n';

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
      return res.end(JSON.stringify({ roles: [{ key: 'pm', label: 'Project Manager' }], own: { key: 'own', instructions: OWN }, models: [] }));
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
  const env = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME, KOSMOS_HOME: HOME, KOSMOS_PORT: String(port), TMPDIR: os.tmpdir(),
    AGENT_WORKFORCE_TMUX_BIN: path.join(__dirname, 'test-support', 'fake-tmux.sh') };
  if (token) env.KOSMOS_AGENT_TOKEN = token;
  try {
    const { stdout, stderr } = await run(CLI, args, { env, timeout: 20000 });
    return { code: 0, out: stdout + stderr, stdout };
  } catch (e) { return { code: e.code, out: String(e.stdout || '') + String(e.stderr || ''), stdout: String(e.stdout || '') }; }
}

const MADE = () => [200, { outcome: 'created', created: [{ name: 'ann', shownAs: 'Ann', id: 'a1' }], refused: [], creator: 'pm', purpose: 'x' }];

test('#4474 role-draft prints the default text to start a new role from, {{NAME}} left for Kosmos to fill', () => withStub(MADE, async (port) => {
  const r = await cli(port, ['agent', 'role-draft']);
  assert.equal(r.code, 0, r.out);
  assert.equal(r.stdout, OWN, 'the default text was not printed as the board gave it');
}));

test('#4474 create --new-role sends the own role with the label and the file\'s text, verbatim, with the token', () => withStub(MADE, async (port, seen) => {
  const file = path.join(HOME, 'role.md');
  const text = 'You are **{{NAME}}**, a grant writer.\n\n## How you work\n- Quote "exactly", keep C:\\paths and $HOME as written.\n- Tabs\tand ünïcödé stay.\n';
  fs.writeFileSync(file, text);
  const r = await cli(port, ['agent', 'create', 'Ann', '--new-role', 'Grant writer', '--from', file, 'the team needs grants written'], 'abc123');
  assert.equal(r.code, 0, r.out);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].token, 'abc123', 'the launch token did not reach the board');
  assert.deepEqual(seen[0].body, { purpose: 'the team needs grants written', members: [{ name: 'Ann', role: 'own', label: 'Grant writer', instructions: text }] },
    'the role\'s text, label, name or why was changed on the way');
  assert.match(r.out, /Made "Ann"\. It's on your board now: http/);
}));

test('#4474 create --new-role without a readable file, or without --from, sends nothing and says how', () => withStub(MADE, async (port, seen) => {
  const noFile = await cli(port, ['agent', 'create', 'Ann', '--new-role', 'Grant writer', '--from', path.join(HOME, 'missing.md')], 'abc123');
  assert.equal(noFile.code, 2, noFile.out);
  assert.match(noFile.out, /could not read .*missing\.md.*role-draft/);
  const noFrom = await cli(port, ['agent', 'create', 'Ann', '--new-role', 'Grant writer'], 'abc123');
  assert.equal(noFrom.code, 2, noFrom.out);
  assert.match(noFrom.out, /--new-role "<label>" --from <file>/);
  assert.equal(seen.length, 0, 'a create went out without a role text');
}));

test('#4474 a refused new role says the board\'s reason', () => withStub(
  () => [400, { outcome: 'refused', created: [], refused: [{ name: 'Ann', because: 'the setup guide is Kosmos\'s own' }], because: '0 of 1' }],
  async (port) => {
    const file = path.join(HOME, 'role2.md');
    fs.writeFileSync(file, 'You are **{{NAME}}**, a helper.\n');
    const r = await cli(port, ['agent', 'create', 'Ann', '--new-role', 'Helper', '--from', file], 'abc123');
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Kosmos did not make that agent: the setup guide is Kosmos's own\./);
  }));

test('#4474 CONTROL: the existing form still sends only a name and a role', () => withStub(MADE, async (port, seen) => {
  const r = await cli(port, ['agent', 'create', 'Ann', 'pm', 'why'], 'abc123');
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(seen[0].body, { purpose: 'why', members: [{ name: 'Ann', role: 'pm' }] });
}));

test('#4474 role-draft --to writes the default text to the file as UTF-8, not through a shell redirect', () => withStub(MADE, async (port) => {
  const file = path.join(HOME, 'role-writer.md');
  const r = await cli(port, ['agent', 'role-draft', '--to', file]);
  assert.equal(r.code, 0, r.out);
  assert.equal(fs.readFileSync(file, 'utf8'), OWN, 'the file does not hold the text the board gave');
  assert.match(r.out, /Wrote the default role text to .*role-writer\.md\. Edit it, then: kosmos agent create "<name>" --new-role "<role name>" --from /);
  const bad = await cli(port, ['agent', 'role-draft', '--to']);
  assert.equal(bad.code, 2, 'role-draft --to with no file did not say how');
}));

test('#4474 role-draft --to never replaces an existing file (it may hold another role)', () => withStub(MADE, async (port) => {
  const file = path.join(HOME, 'role-taken.md');
  fs.writeFileSync(file, 'another role\n');
  const r = await cli(port, ['agent', 'role-draft', '--to', file]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /already exists, and it may hold another role/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'another role\n', 'the existing role file was replaced');
}));

'use strict';

/**
 * #3769: `kosmos reply` presents the agent's own token (KOSMOS_AGENT_TOKEN, hex only) as
 * `x-kosmos-agent-token`, as `whoami` and `report` already do. The setup guide runs sandboxed with
 * Kosmos's data folder denied, so it cannot read the board token; without its agent token an
 * enforcing board refuses its reply and the guide goes mute.
 *
 * The data root is a temp folder, so the CLI never reads this machine's real board token.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const CLI = path.join(__dirname, 'install', 'kosmos');
const DATA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-reply-token-')));
test.after(() => fs.rmSync(DATA, { recursive: true, force: true }));

function withStub(fn) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/reply')) {
      seen.push({ agent: req.headers['x-kosmos-agent-token'], board: req.headers['x-kosmos-board-token'] });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"kept":true}');
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

const reply = async (port, token, seen) => {
  const before = seen.length;
  const env = { ...process.env, KOSMOS_PORT: String(port), AGENT_WORKFORCE_DATA: DATA };
  if (token === null) delete env.KOSMOS_AGENT_TOKEN;
  else env.KOSMOS_AGENT_TOKEN = token;
  try { await run(CLI, ['reply', 'hello from the guide'], { env, timeout: 15000 }); } catch { /* the exit code is not what this asserts */ }
  for (let i = 0; i < 100 && seen.length === before; i += 1) await new Promise((r) => setTimeout(r, 50));
  assert.equal(seen.length, before + 1, 'the CLI did not reply at all, so the header cannot be judged');
  return seen[seen.length - 1];
};

test('#3769 kosmos reply presents a well-formed agent token, and only a well-formed one', () => withStub(async (port, seen) => {
  assert.equal((await reply(port, null, seen)).agent, undefined, 'no token set, so no header may be sent');
  assert.equal((await reply(port, 'zz-not-hex', seen)).agent, undefined, 'a malformed token must be dropped');
  const r = await reply(port, 'abc123def', seen);
  assert.equal(r.agent, 'abc123def', 'the agent token did not reach /api/reply, so a sandboxed guide cannot be heard');
  assert.equal(r.board, undefined, 'CONTROL: the temp data root holds no board token, so none was sent');
}));

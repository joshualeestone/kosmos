'use strict';
/**
 * The CLI presents `KOSMOS_AGENT_TOKEN` as `x-kosmos-agent-token`, and drops
 * anything that is not plain hex (#1139 link 3, shipped in #1136).
 *
 * 🛑 WHY THIS TEST EXISTS AT ALL, WHICH IS THE WHOLE POINT OF THE CARD IT COMES
 * FROM. #1139 was three correct pieces with undriven joins: the supervisor
 * minted a token, nothing read it, and every individual test passed the entire
 * time. When I fixed the reading half I verified it BY HAND and left no guard,
 * so a later edit could have deleted the header and the suite would have stayed
 * green -- the same silence, one layer along. `x-kosmos-agent-token` appeared in
 * `server.js` and two of its tests (the RECEIVER) and in `install/kosmos` (the
 * SENDER) with nothing asserting the sender at all.
 *
 * ⚠️ THE LAST CASE IS THE LOAD-BEARING ONE. A guard that never sends anything
 * passes every "no header" assertion here, so the valid-token case is what makes
 * the other three mean something. Do not drop it to make this file shorter.
 *
 * 📌 The stub answers `/` with a body containing "Kosmos" because the CLI's own
 * `healthy()` refuses a port that answers with somebody else's page, and a stub
 * returning bare JSON fails that check and exits before ever reporting. That
 * cost me twenty minutes by hand; it is written down so it costs nobody else.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const CLI = path.join(__dirname, 'install', 'kosmos');

function withStub(run) {
  const seen = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/api/report')) {
      seen.push(req.headers['x-kosmos-agent-token']);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"recorded":true}');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>Kosmos</title>Agent Workforce');
  });
  /* 🛑 REJECT, DO NOT JUST RESOLVE IN `finally`. The first version of this
     helper closed the server in a `finally` that called `resolve`, so a failing
     assertion inside `run` was SWALLOWED: the promise resolved, node:test
     reported the test as passing, and the real failure surfaced later as an
     unhandled rejection. A test that reports green while its assertion fails is
     the exact defect this file exists to prevent, one level up. */
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      let failure = null;
      try { await run(server.address().port, seen); } catch (e) { failure = e; }
      server.close(() => (failure ? reject(failure) : resolve()));
    });
  });
}

/* ⚠️ WAITS FOR THE REQUEST, DOES NOT ASSUME `execFileSync` MEANS ARRIVED. The
   CLI does not block until its POST lands, so a synchronous return raced the
   stub: the last case arrived AFTER the server closed and read as a missing
   header, which looks exactly like the guard being broken. Polling for the
   count makes the test assert delivery rather than process exit. */
const report = async (port, token, seen) => {
  const before = seen.length;
  const env = { ...process.env, KOSMOS_PORT: String(port) };
  if (token === null) delete env.KOSMOS_AGENT_TOKEN;
  else env.KOSMOS_AGENT_TOKEN = token;
  /* 🛑 ASYNC, NEVER `execFileSync`. A synchronous child BLOCKS NODE'S EVENT
     LOOP, so the in-process stub below cannot answer the CLI's own health check
     while it runs: curl times out with 0 bytes, the CLI prints "Kosmos is not
     running", and it never reports at all. That failure looks exactly like a
     broken guard and has nothing to do with the code under test. */
  try { await run(CLI, ['report', 'started'], { env, timeout: 15000 }); } catch { /* the CLI's own exit code is not what this asserts */ }
  for (let i = 0; i < 100 && seen.length === before; i += 1) {
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(seen.length, before + 1, 'the CLI did not report at all, so the header cannot be judged');
};

test('#1139: the CLI presents a well-formed token, and only a well-formed one', () => withStub(async (port, seen) => {
  await report(port, null, seen);
  assert.equal(seen[0], undefined, 'no token set, so no header may be sent');

  await report(port, 'zz-not-hex', seen);
  assert.equal(seen[1], undefined, 'a malformed token must be DROPPED, not forwarded');

  await report(port, 'abc 123', seen);
  assert.equal(seen[2], undefined, 'hex with a space is not hex');

  /* The control. `/api/report` refuses to downgrade, so a token that does not
     resolve is a REFUSAL rather than a fall back to the pane -- which is why
     the three cases above drop rather than forward. This case proves the guard
     can still SEND, so those three are evidence and not the signature of a
     sender that was quietly broken. */
  await report(port, 'abc123def', seen);
  assert.equal(seen[3], 'abc123def', 'a well-formed token must reach the route');
}));

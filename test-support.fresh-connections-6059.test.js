'use strict';

/*
 * kosmos#6059: test-support/fresh-connections.js, preloaded into every test process by tools/run-tests.sh,
 * makes the global fetch open a new connection per request, so a kept-alive socket left idle on a loaded CI
 * runner can no longer come back ECONNRESET on the next request. This pins three things: the preload is on
 * the suite's node --test line, it is loaded in this process, and it really stops reuse (with a control that
 * the same requests DO reuse a connection without it, so the check can see the thing it guards against).
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = __dirname;
const PRELOAD = path.join(ROOT, 'test-support', 'fresh-connections.js');

// Three requests one after another against a server that counts connections; prints the count.
const PROBE = `
const http = require('node:http');
let n = 0;
const srv = http.createServer((q, r) => r.end('ok')).on('connection', () => { n += 1; });
srv.listen(0, '127.0.0.1', async () => {
  const base = 'http://127.0.0.1:' + srv.address().port;
  for (let i = 0; i < 3; i += 1) await (await fetch(base)).text();
  process.stdout.write(String(n));
  srv.close(); process.exit(0);
});`;

function connections(args) {
  const r = spawnSync(process.execPath, [...args, '-e', PROBE], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 0, 'the probe ran: ' + r.stderr);
  return Number(r.stdout);
}

test('#6059: the suite preloads fresh-connections.js on its node --test line', () => {
  const runner = fs.readFileSync(path.join(ROOT, 'tools', 'run-tests.sh'), 'utf8');
  const line = runner.split('\n').find((l) => l.startsWith('node --test '));
  assert.ok(line, 'CONTROL: the suite line is found');
  assert.match(line, /--require "\$REPO\/test-support\/fresh-connections\.js"/);
});

test('#6059: this process has it (run through tools/run-tests.sh)', () => {
  assert.equal(globalThis.__kosmosFreshConnections, true,
    'fresh-connections.js did not install here: run this file through tools/run-tests.sh, or Node moved its fetch agent (see the stderr line)');
});

test('#6059: with the preload every request has its own connection; without it they share one (the control)', () => {
  const without = connections([]);
  assert.ok(without < 3, 'CONTROL: without the preload, fetch reuses a connection (' + without + ' for 3 requests)');
  assert.equal(connections(['--require', PRELOAD]), 3, 'with the preload, 3 requests open 3 connections');
});

test('#6059: in this very process, two requests open two connections', async () => {
  let n = 0;
  const srv = http.createServer((q, r) => r.end('ok')).on('connection', () => { n += 1; });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    const base = 'http://127.0.0.1:' + srv.address().port;
    await (await fetch(base)).text();
    await (await fetch(base)).text();
    assert.equal(n, 2);
  } finally {
    srv.close();
  }
});

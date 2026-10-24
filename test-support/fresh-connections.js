'use strict';

/*
 * kosmos#6059 -- preloaded into EVERY test process by tools/run-tests.sh (`node --test --require
 * ./test-support/fresh-connections.js`, beside launch-guard.js and tool-guard.js). It makes the global
 * `fetch` open a NEW connection for every request instead of reusing a kept-alive one.
 *
 * Why: on a loaded CI runner a pooled socket left idle across a request-free stretch of a test came back
 * ECONNRESET on the next request ("fetch failed", cause "read ECONNRESET"). #6833 fixed server.test.js by
 * giving its own req() `agent: false`; the same reset then hit server.agent-files-3614 and server.projects
 * on 2026-10-23 (PR #7021, twice), and 239 server test files call fetch. One preload covers them all.
 *
 * How: Node's fetch is its built-in undici, which keeps its global agent under
 * Symbol.for('undici.globalDispatcher.2'). A first fetch() call creates it synchronously (measured on Node
 * 26.8), so a throwaway fetch of a data: address makes it, and its own class is used to put an agent with
 * `pipelining: 0` in its place: undici's documented way to turn keep-alive off. No package is needed.
 *
 * If Node ever stores the agent elsewhere, this says so once on stderr and changes nothing, so the suite
 * still runs (pooled, as before); test-support.fresh-connections-6059.test.js then goes red and says why.
 * It covers only the global fetch of this process: node:http clients bring their own agents (server.test.js
 * already passes agent: false), and child processes a test starts are not touched.
 * The trade: product code a test runs in-process also gets a fresh connection per fetch, where production
 * pools, so the suite no longer covers how in-process fetch callers handle a reused keep-alive socket.
 */

const KEY = Symbol.for('undici.globalDispatcher.2');

try {
  // Creates the global agent now (synchronously), without touching the network.
  fetch('data:,').then((r) => r.arrayBuffer()).catch(() => {});
  const current = globalThis[KEY];
  if (!current || typeof current.constructor !== 'function') throw new Error('no global fetch agent at ' + String(KEY));
  globalThis[KEY] = new current.constructor({ pipelining: 0 });
  globalThis.__kosmosFreshConnections = true;
} catch (err) {
  process.stderr.write('test-support/fresh-connections.js (#6059): could not turn fetch keep-alive off: '
    + (err && err.message ? err.message : String(err)) + '\n');
}

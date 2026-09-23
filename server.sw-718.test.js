'use strict';

/**
 * #718, the push third: the service worker is served AT THE ROOT, AS A WORKER.
 * Driven against the real server, a plain HTTP fetch -- no browser needed. The
 * browser-check docs/browser-checks/render-push-718.js proves the worker
 * REGISTERS and a real push paints; this file guards the far cheaper property
 * that the /sw.js ROUTE answers correctly, which `yarn test` runs automatically
 * (the browser check does not run in the node suite).
 *
 * Why each header matters, so a regression is caught by intent not by accident:
 *   - content-type must be a JS type, or the browser refuses to register the
 *     worker and the request silently falls through to the HTML page (200 OK,
 *     wrong body) -- the same silent-success trap the /api and /icons guards close.
 *   - Service-Worker-Allowed: / is what lets a worker served from /sw.js take the
 *     whole-origin scope the push subscription and the offline shell both need.
 *   - Cache-Control: no-store is how a worker UPDATE lands rather than a browser
 *     sitting on a stale worker.
 *
 * A separate file (like server.manifest.test.js) so this feature adds a file
 * rather than a merge-hazard block in server.test.js. Sandbox boilerplate mirrors
 * server.manifest.test.js.
 *
 *   node --test server.sw-718.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sw718-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
let base;
test.before(async () => { await start(0); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { server.closeAllConnections(); server.close(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });

test('/sw.js is served at the root as a worker, with the scope and no-store headers', async () => {
  const res = await fetch(base + '/sw.js');
  assert.equal(res.status, 200, '/sw.js is not served');
  assert.match(res.headers.get('content-type'), /^text\/javascript/,
    'served as the page or a non-JS type -- the browser will not register it');
  assert.equal(res.headers.get('service-worker-allowed'), '/',
    'without root scope the worker cannot control the push subscription or the offline shell');
  assert.equal(res.headers.get('cache-control'), 'no-store',
    'a cacheable worker means a stale worker; the update never lands');
  const body = await res.text();
  // It is the real worker, not the HTML page falling through: the worker's own
  // push handler is present. A 200 with the page body would pass a status-only
  // check and fail here.
  assert.match(body, /addEventListener\(\s*['"]push['"]/, 'the body served is not the service worker');
});

test('HEAD /sw.js carries the same headers and an empty body', async () => {
  const res = await fetch(base + '/sw.js', { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/javascript/);
  assert.equal(res.headers.get('service-worker-allowed'), '/');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await res.text()).length, 0, 'a HEAD must not carry a body');
});

test('the page actually registers the worker it serves', async () => {
  // The route is only useful if the client asks for it: guard the wire, so
  // deleting the registration does not leave a served-but-orphaned worker.
  const page = await (await fetch(base + '/')).text();
  // The client points SW_URL at /sw.js and registers via that constant, so guard
  // both halves: the target and the registration that uses it.
  assert.match(page, /var SW_URL = '\/sw\.js';/, 'the client no longer points at /sw.js');
  assert.match(page, /navigator\.serviceWorker\.register\(SW_URL\)/,
    'the page never registers the worker, so serving /sw.js is dead');
});

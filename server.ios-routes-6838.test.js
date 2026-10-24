'use strict';

/**
 * #7055 (slice 6 of the iPhone plan, #6838): the board still answers every route the iPhone app calls.
 *
 * Once screens are native, the phone reads the board's routes directly, so renaming or dropping one breaks the phone
 * silently: nothing on the board side calls the route any more, and the phone's own suites read captured JSON, not a
 * live board. This test reads each route the app and its notification extension send to the board straight from the
 * Swift source (ios/Kosmos, ios/KosmosNotice), with the method it uses, boots a sandboxed board, and asks it for
 * each one. A route counts as answered when the board's reply differs from its reply to a path that does not exist,
 * measured here rather than assumed, so a route that exists but 404s for an unknown agent ("no such agent") still
 * counts, and a route that has gone does not.
 *
 * Only board routes count: the coordinator's (/v1/...) and the relay gate's (/_kosmos/...) live in other repos.
 * A new route in the app is picked up by itself; if the parser finds fewer than a floor of routes, the test fails,
 * so a parser that silently stops matching cannot pass.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-iosroutes-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server } = require('./server');

const SWIFT_DIRS = ['ios/Kosmos', 'ios/KosmosNotice'];
// Today's app calls 15 distinct board routes; a parser that finds far fewer has stopped matching, not a smaller app.
const FLOOR = 10;
// The one route whose method is a variable at the request site: SettingsLogic.request(_:method:) reads GET and
// writes PUT (its callers pass "GET" and "PUT"). Checked against the source below, so a renamed caller fails here.
const VARIABLE_METHODS = { '/api/phone-notify': { file: 'ios/Kosmos/SettingsLogic.swift', methods: ['GET', 'PUT'] } };

/* Every "/api/..." string literal that names a whole route, with the method set on the same request. A literal used
   only as a prefix to test or strip ("/api/", "/api/attachment/") ends in a slash and is not a route; one inside a
   test fixture's raw JSON (#"..."#) is skipped. Interpolations become a placeholder segment. */
function routesFromSwift() {
  const found = new Map();
  for (const dir of SWIFT_DIRS) {
    for (const name of fs.readdirSync(path.join(__dirname, dir)).filter((f) => f.endsWith('.swift'))) {
      const rel = path.join(dir, name);
      const lines = fs.readFileSync(path.join(__dirname, rel), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/#"/.test(line)) return;
        for (const m of line.matchAll(/"(\/api\/[^"]*)"/g)) {
          const raw = m[1];
          if (raw.endsWith('/')) continue;
          const p = raw.split('?')[0].replace(/\\\([^)]*\)/g, 'x');
          const near = lines.slice(i, i + 4).join('\n');
          const set = near.match(/httpMethod = "([A-Z]+)"/);
          const methods = VARIABLE_METHODS[p] ? VARIABLE_METHODS[p].methods : [set ? set[1] : 'GET'];
          for (const method of methods) {
            const key = `${method} ${p}`;
            if (!found.has(key)) found.set(key, `${rel}:${i + 1}`);
          }
        }
      });
    }
  }
  return found;
}

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  try { server.close(); } catch { /* already closed */ }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function ask(method, p) {
  const init = { method, redirect: 'manual', headers: {} };
  if (method !== 'GET' && method !== 'HEAD') { init.headers['content-type'] = 'application/json'; init.body = '{}'; }
  const res = await fetch(base + p, init);
  return `${res.status} ${await res.text()}`;
}

test('the parser finds the routes the app calls, including the variable-method one', () => {
  const routes = routesFromSwift();
  assert.ok(routes.size >= FLOOR, `found only ${routes.size} routes in the Swift source: ${[...routes.keys()].join(', ')}`);
  for (const [p, { file, methods }] of Object.entries(VARIABLE_METHODS)) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.ok(src.includes(`"${p}"`), `${file} no longer names ${p}: update VARIABLE_METHODS`);
    for (const m of methods) assert.ok(src.includes(`method: "${m}"`), `${file} no longer calls ${p} with ${m}: update VARIABLE_METHODS`);
  }
  // Pinned so a broken method reading cannot pass: the chat send is a POST, the status read a GET.
  assert.ok(routes.has('POST /api/agent/x/thread') && routes.has('GET /api/status'), [...routes.keys()].join(', '));
});

test('the board answers every route the iPhone app calls (not its reply to a route that does not exist)', async () => {
  const routes = routesFromSwift();
  const gone = [];
  for (const [key, where] of routes) {
    const [method, p] = key.split(' ');
    // The board's reply to a route it does not have, for this method and the same depth of path.
    const missing = await ask(method, p.replace(/\/[^/]+$/, '/no-such-route-7055'));
    const reply = await ask(method, p);
    if (reply === missing) gone.push(`${key} (called at ${where}): the board answers "${reply.slice(0, 80)}"`);
  }
  assert.deepEqual(gone, [], 'routes the phone calls that the board no longer answers:\n' + gone.join('\n'));
});

test('CONTROL: a route the board does not have is reported as gone', async () => {
  const missing = await ask('GET', '/api/no-such-route-7055');
  assert.equal(await ask('GET', '/api/also-not-a-route-7055'), missing.replace('no-such-route-7055', 'also-not-a-route-7055'),
    'two unknown routes must get the same reply, or the comparison above means nothing');
  assert.notEqual(await ask('GET', '/api/status'), missing, 'a real route must differ from an unknown one');
});

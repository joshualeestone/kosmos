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

// Every Swift file under ios/ except the logic suites' own (their fixtures name routes the app never calls).
const IOS = path.join(__dirname, 'ios');
function swiftFiles(dir = IOS) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'LogicTests' ? [] : swiftFiles(p);
    return e.name.endsWith('.swift') ? [p] : [];
  });
}
// Today's app calls 15 distinct board routes by literal; a parser that finds far fewer has stopped matching.
const FLOOR = 10;
// The one route whose method is a variable at the request site: SettingsLogic reads with GET and writes with PUT.
// Each method is checked against the exact caller below, so a renamed or removed caller fails here.
const VARIABLE_METHODS = {
  '/api/phone-notify': { file: 'ios/Kosmos/SettingsLogic.swift', callers: { GET: 'request(mac, method: "GET")', PUT: 'request(mac, method: "PUT"' } },
};
/* Routes the app calls whose full path comes from the board, so no literal names them (review 1): a chat file and
   its thumbnail, fetched from the attachment's own url (BoardLogic.attachmentId and the preview == url + "/preview"
   rule). Declared with the source text that pins them; the id is a 24-hex placeholder, as attachmentId requires. */
const DECLARED = [
  { route: 'GET /api/attachment/000000000000000000000000', file: 'ios/Kosmos/BoardLogic.swift', pin: 'let prefix = "/api/attachment/"' },
  { route: 'GET /api/attachment/000000000000000000000000/preview', file: 'ios/Kosmos/BoardLogic.swift', pin: '$0 == url + "/preview"' },
];

/* Every "/api/..." string literal that names a whole route, with the method set on the same request. A literal used
   only as a prefix ("/api/", "/api/attachment/") ends in a slash and is not a route; one inside a test fixture's raw
   JSON (#"..."#) is skipped. Interpolations become a placeholder, and the query string is kept. The method is the
   first `httpMethod = "X"` before the request builder ends (its return, or the next URL), not a fixed line window
   (review 1); every such line in a file that calls the board must be claimed by a route (checked below). */
function routesFromSwift() {
  const found = new Map();
  const unclaimed = [];
  for (const file of swiftFiles()) {
    const rel = path.relative(__dirname, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const claimed = new Set();
    let callsBoard = false;
    // The method set on the request built from line i, claiming that httpMethod line.
    const methodAfter = (i) => {
      for (let j = i; j < Math.min(lines.length, i + 25); j++) {
        if (j > i && /URL\(string:|^\s*(static |private )*func /.test(lines[j])) break;
        const set = lines[j].match(/httpMethod = "([A-Z]+)"/);
        if (set) { claimed.add(j); return set[1]; }
        if (/\bhttpMethod = [a-z]/.test(lines[j])) { claimed.add(j); return 'GET'; }
        if (/^\s*return\b/.test(lines[j])) break;
      }
      return 'GET';
    };
    lines.forEach((line, i) => {
      if (/#"/.test(line)) return;
      // A request to another service (the coordinator's /v1, the relay gate's /_kosmos) claims its own method line.
      for (const m of line.matchAll(/URL\(string: "(\/(?!api\/)[^"]*)"/g)) methodAfter(i);
      for (const m of line.matchAll(/"(\/api\/[^"]*)"/g)) {
        if (m[1].endsWith('/')) continue;
        callsBoard = true;
        const p = m[1].replace(/\\\([^)]*\)/g, 'x');
        const method = methodAfter(i);
        const bare = p.split('?')[0];
        const methods = VARIABLE_METHODS[bare] ? Object.keys(VARIABLE_METHODS[bare].callers) : [method];
        for (const mm of methods) if (!found.has(`${mm} ${p}`)) found.set(`${mm} ${p}`, `${rel}:${i + 1}`);
      }
    });
    if (callsBoard) lines.forEach((l, j) => { if (/httpMethod = /.test(l) && !claimed.has(j)) unclaimed.push(`${rel}:${j + 1}`); });
  }
  for (const d of DECLARED) found.set(d.route, d.file + ' (declared)');
  return { found, unclaimed };
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

// A made-up path at the same depth, keeping the route's query string.
const madeUp = (p, tag = 'no-such-route-7055') => { const [bare, q] = p.split('?'); return bare.replace(/\/[^/]+$/, '/' + tag) + (q ? '?' + q : ''); };
// True when the board answers this route with something other than its reply to a route it does not have.
async function isAnswered(method, p) {
  return (await ask(method, p)) !== (await ask(method, madeUp(p)));
}

test('the parser finds the routes the app calls, with each method set on its request', () => {
  const { found, unclaimed } = routesFromSwift();
  assert.ok(found.size >= FLOOR + DECLARED.length, `found only ${found.size} routes in the Swift source: ${[...found.keys()].join(', ')}`);
  assert.deepEqual(unclaimed, [], 'an httpMethod line no route claimed (a method set too far from its URL is read as GET)');
  for (const [p, { file, callers }] of Object.entries(VARIABLE_METHODS)) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.ok(src.includes(`"${p}"`), `${file} no longer names ${p}: update VARIABLE_METHODS`);
    for (const [m, caller] of Object.entries(callers)) assert.ok(src.includes(caller), `${file} no longer calls ${p} with ${m} (${caller}): update VARIABLE_METHODS`);
  }
  for (const d of DECLARED) {
    assert.ok(fs.readFileSync(path.join(__dirname, d.file), 'utf8').includes(d.pin), `${d.file} no longer has ${d.pin}: update DECLARED for ${d.route}`);
  }
  // Pinned so a broken method reading cannot pass: the chat send is a POST, the status read a GET, the seen mark a POST.
  for (const k of ['POST /api/agent/x/thread', 'GET /api/status', 'POST /api/project/x/seen', 'GET /api/tasks?view=tasks']) {
    assert.ok(found.has(k), `${k} missing from: ${[...found.keys()].join(', ')}`);
  }
});

test('the board answers every route the iPhone app calls (not its reply to a route that does not exist)', async () => {
  const gone = [];
  for (const [key, where] of routesFromSwift().found) {
    const [method, p] = key.split(' ');
    if (!(await isAnswered(method, p))) gone.push(`${key} (called at ${where}): the board answers "${(await ask(method, p)).slice(0, 80)}"`);
  }
  assert.deepEqual(gone, [], 'routes the phone calls that the board no longer answers:\n' + gone.join('\n'));
});

test('CONTROL: the board gives every route it does not have the same reply, at every method and depth the app uses', async () => {
  const { found } = routesFromSwift();
  const methods = [...new Set([...found.keys()].map((k) => k.split(' ')[0]))];
  const depths = [...new Set([...found.keys()].map((k) => k.split(' ')[1].split('?')[0].split('/').length))];
  for (const m of methods) {
    for (const d of depths) {
      const stem = '/api' + '/x'.repeat(d - 3);
      const a = await ask(m, stem + '/no-such-route-7055');
      const b = await ask(m, stem + '/also-not-a-route-7055');
      // Byte for byte: a reply that quoted the path back would make every gone route look answered.
      assert.equal(a, b, `${m} at depth ${d}: two unknown routes got different replies, so the comparison means nothing`);
    }
  }
});

test('CONTROL: a route the board does not have is reported as gone, and a real one as answered', async () => {
  assert.equal(await isAnswered('POST', '/api/agent/x/no-such-route-7055b'), false);
  assert.equal(await isAnswered('GET', '/api/status'), true);
});

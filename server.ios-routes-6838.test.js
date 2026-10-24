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
// The accounts and Claude config the board reads, in the sandbox too (review 2: parity with the sibling tests).
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');

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
// Its callers are matched exactly below (no more and no fewer), so a new, renamed or removed caller fails here.
const VARIABLE_METHODS = {
  '/api/phone-notify': { file: 'ios/Kosmos/SettingsLogic.swift', caller: /\brequest\(mac, method: "([A-Z]+)"/g, methods: ['GET', 'PUT'] },
};
/* Routes the app calls whose full path comes from the board, so no literal names them. Each is pinned to the source
   text that accepts that path (not the fetch itself, which takes whatever path it is given):
   - a chat file and its thumbnail (review 1): BoardLogic.attachmentId and its preview == url + "/preview" rule, then
     Board.attachmentRequest; the id is a 24-hex placeholder, as attachmentId requires;
   - an agent's picture in the notification extension (review 2): NoticeLogic accepts only /api/agent/<x>/avatar. */
const DECLARED = [
  { route: 'GET /api/attachment/000000000000000000000000', file: 'ios/Kosmos/BoardLogic.swift', pin: 'let prefix = "/api/attachment/"' },
  { route: 'GET /api/attachment/000000000000000000000000/preview', file: 'ios/Kosmos/BoardLogic.swift', pin: '$0 == url + "/preview"' },
  { route: 'GET /api/agent/x/avatar', file: 'ios/KosmosNotice/NoticeLogic.swift', pin: 'path.hasPrefix("/api/agent/"), path.hasSuffix("/avatar")' },
];

/* One line of Swift with its comments removed and its raw-string spans (#"..."#, a test fixture's JSON) blanked, so
   neither can name a route or claim a method. Strings are followed character by character, interpolations included,
   so a "//" inside a string is not taken for a comment. */
function codeOf(line) {
  let out = '';
  for (let i = 0, inStr = false, depth = 0; i < line.length; i++) {
    const c = line[i];
    if (!inStr && line.startsWith('#"', i)) { const end = line.indexOf('"#', i + 2); i = end < 0 ? line.length : end + 1; out += ' '; continue; }
    if (!inStr && line.startsWith('//', i)) break;
    if (inStr && c === '\\' && line[i + 1] === '(') { depth++; out += '\\('; i++; continue; }
    if (inStr && depth > 0 && c === ')') depth--;
    if (inStr && depth === 0 && c === '\\') { out += c + (line[i + 1] || ''); i++; continue; }
    if (c === '"' && depth === 0) inStr = !inStr;
    out += c;
  }
  return out;
}

/* The board-route literals on a line of code: each "/api/..." string, its interpolations (balanced, nested parens and
   strings inside them included) replaced by the placeholder x, its query string kept. A literal used only as a prefix
   ("/api/", "/api/attachment/") ends in a slash and is not a route. */
function routeLiterals(code) {
  const out = [];
  for (let i = code.indexOf('"/api/'); i >= 0; i = code.indexOf('"/api/', i + 1)) {
    let lit = '';
    let j = i + 1;
    for (; j < code.length && code[j] !== '"'; j++) {
      if (code[j] === '\\' && code[j + 1] === '(') {
        let depth = 1, k = j + 2, str = false;
        for (; k < code.length && depth > 0; k++) {
          if (code[k] === '"') str = !str;
          else if (!str && code[k] === '(') depth++;
          else if (!str && code[k] === ')') depth--;
        }
        lit += 'x';
        j = k - 1;
      } else lit += code[j];
    }
    if (!lit.endsWith('/')) out.push(lit);
    i = j;
  }
  return out;
}

const FUNC = /^\s*(@\w+(\([^)]*\))?\s+)*((static|private|fileprivate|public|internal|mutating|override|final|nonisolated|class)\s+)*func\s/;

/* Every board route the app calls by literal, with the method set on the same request, and the problems found. The
   method is the first `httpMethod = ...` inside the same block as the URL (tracked by brace depth, so a neighbouring
   function's or closure's request is never read), before the next URL or function. A line is claimed once. In every
   file that calls the board, each httpMethod line must be claimed, and a variable method is allowed only on a route
   in VARIABLE_METHODS (review 2: it would otherwise read as GET without a word). */
function routesFromSwift() {
  const found = new Map();
  const problems = [];
  for (const file of swiftFiles()) {
    const rel = path.relative(__dirname, file);
    const code = fs.readFileSync(file, 'utf8').split('\n').map(codeOf);
    const claimed = new Set();
    let callsBoard = false;
    const methodAfter = (i, route) => {
      let depth = 0;
      for (let j = i; j < Math.min(code.length, i + 40); j++) {
        if (j > i && (/URL\(string:/.test(code[j]) || FUNC.test(code[j]))) break;
        const set = code[j].match(/\bhttpMethod = ("([A-Z]+)"|\w+)/);
        if (set && !claimed.has(j)) {
          claimed.add(j);
          if (set[2]) return set[2];
          if (!(route && VARIABLE_METHODS[route])) problems.push(`${rel}:${j + 1}: a variable method on ${route || 'a request'} that VARIABLE_METHODS does not name`);
          return 'GET';
        }
        for (const c of j === i ? code[j].slice(code[j].indexOf('"')) : code[j]) { if (c === '{') depth++; else if (c === '}') depth--; }
        if (depth < 0) break;
      }
      return 'GET';
    };
    code.forEach((line, i) => {
      // A request to another service (the coordinator's /v1, the relay gate's /_kosmos) claims its own method line.
      if (/URL\(string: "\/(?!api\/)/.test(line)) methodAfter(i, null);
      for (const p of routeLiterals(line)) {
        callsBoard = true;
        const bare = p.split('?')[0];
        const method = methodAfter(i, bare);
        const methods = VARIABLE_METHODS[bare] ? VARIABLE_METHODS[bare].methods : [method];
        for (const m of methods) if (!found.has(`${m} ${p}`)) found.set(`${m} ${p}`, `${rel}:${i + 1}`);
      }
    });
    if (callsBoard) code.forEach((l, j) => { if (/\bhttpMethod = /.test(l) && !claimed.has(j)) problems.push(`${rel}:${j + 1}: an httpMethod no request claimed`); });
  }
  for (const d of DECLARED) if (!found.has(d.route)) found.set(d.route, d.file + ' (declared)');
  return { found, problems };
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
  const { found, problems } = routesFromSwift();
  assert.ok(found.size >= FLOOR + DECLARED.length, `found only ${found.size} routes in the Swift source: ${[...found.keys()].join(', ')}`);
  assert.deepEqual(problems, [], 'methods the parser could not attribute to a request');
  for (const [p, { file, caller, methods }] of Object.entries(VARIABLE_METHODS)) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.ok(src.includes(`"${p}"`), `${file} no longer names ${p}: update VARIABLE_METHODS`);
    const used = [...new Set([...src.matchAll(caller)].map((m) => m[1]))].sort();
    assert.deepEqual(used, [...methods].sort(), `${file} calls ${p} with ${used.join(', ')}: update VARIABLE_METHODS`);
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

test('CONTROL: at the prefix, method and query of each route, two made-up siblings get the same reply', async () => {
  // Byte for byte, aimed at exactly the comparison each verdict uses (review 2): a reply that quoted the path back,
  // or a catch-all under a real prefix that echoed the last segment, would make every gone route look answered.
  const differ = [];
  for (const key of routesFromSwift().found.keys()) {
    const [method, p] = key.split(' ');
    const a = await ask(method, madeUp(p, 'no-such-route-7055a'));
    const b = await ask(method, madeUp(p, 'no-such-route-7055b'));
    if (a !== b) differ.push(`${key}: "${a.slice(0, 60)}" vs "${b.slice(0, 60)}"`);
  }
  assert.deepEqual(differ, [], 'made-up siblings answered differently, so the comparison means nothing for these');
});

test('CONTROL: a route the board does not have is reported as gone, and a real one as answered', async () => {
  assert.equal(await isAnswered('POST', '/api/agent/x/no-such-route-7055b'), false);
  assert.equal(await isAnswered('GET', '/api/status'), true);
});

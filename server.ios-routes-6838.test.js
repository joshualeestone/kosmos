'use strict';

/**
 * #7055 (slice 6 of the iPhone plan, #6838): the board still answers every route the iPhone app calls.
 *
 * Once screens are native, the phone reads the board's routes directly, so renaming or dropping one breaks the phone
 * silently: nothing on the board side calls the route any more, and the phone's own suites read captured JSON, not a
 * live board. This test reads each route the app and its notification extension send to the board straight from the
 * Swift source (every file under ios/ but the logic suites'), with the method it uses, boots a sandboxed board, and asks it for
 * each one. A route counts as answered when the board's reply differs from its reply to a path that does not exist,
 * measured here rather than assumed, so a route that exists but 404s for an unknown agent ("no such agent") still
 * counts, and a route that has gone does not.
 *
 * Only board routes count: the coordinator's (/v1/...) and the relay gate's (/_kosmos/...) live in other repos.
 * The convention it enforces: a board request names its whole route as one "/api/..." string in URL(string:), or
 * goes through a declared helper. A new route written that way is picked up by itself. Anything else that could be a
 * board request (a partial path, a + join, a path joined onto an unknown base, an unknown path, a route hidden in a
 * raw or multi-line string, a method no request claims) fails the test with a message saying what to change, so a
 * route is never skipped or read as GET without a word. A floor fails a parser that silently stops matching.
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
// Today the app calls 12 board paths by literal, 15 method-and-path pairs; far fewer means the parser stopped matching.
const FLOOR = 10;
// The one route whose method is a variable at the request site: SettingsLogic reads with GET and writes with PUT.
// Its callers are matched exactly below (no more and no fewer, each with a literal method), so a new, renamed or
// removed caller fails here.
const VARIABLE_METHODS = {
  '/api/phone-notify': { file: 'ios/Kosmos/SettingsLogic.swift', caller: /\brequest\(\s*[^,()]+,\s*method:\s*([^,)]+)/g, calls: /\brequest\(/g, methods: ['GET', 'PUT'] },
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
/* Helpers that take a route as an argument and build the request themselves (review 3). A route literal passed to
   anything else is a problem, because the method is set where this parser cannot see it. Each helper's own body is
   checked to still set the method named here ("GET" means it sets none). */
const HELPERS = [
  { file: 'ios/KosmosNotice/NoticeLogic.swift', call: 'request(host:', def: 'private static func request(host:', method: 'GET' },
];

/* A whole Swift file as two per-line views, scanned once so state carries across lines (review 3):
   - code: comments removed (line comments and nested block comments), raw strings (#"..."#) and multi-line strings blanked, ordinary
     strings kept, so route literals can be read from it;
   - bare: code with every string's contents blanked too, so a brace, an httpMethod or a URLRequest( inside a string
     is never taken for code.
   Interpolations count parentheses, so \(f(a) + "x") ends where it should.
   Also returned: hidden, the lines of raw or multi-line strings whose contents are a board path (review 4: such a
   route would otherwise be blanked away unseen). A fixture's raw JSON starts with { and is not one. */
function scanSwift(text) {
  const code = [''], bare = [''], hidden = [];
  const isPath = (t) => /^\s*\/?api\//.test(t);
  const put = (c, b = c) => { if (c === '\n') { code.push(''); bare.push(''); } else { code[code.length - 1] += c; bare[bare.length - 1] += b; } };
  const keepNewlines = (t) => { for (const c of t) put(c === '\n' ? '\n' : ' '); };
  // stack of open string states: { multi, interp: paren depth inside an interpolation or -1 when in the string body }
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const top = stack[stack.length - 1];
    const inBody = top && top.interp < 0;
    if (inBody) {
      if (c === '\\' && text[i + 1] === '(') { top.interp = 0; put('\\'); put('('); i++; continue; }
      if (c === '\\') { put(c, ' '); if (text[i + 1] !== '\n') put(text[i + 1], ' '); i++; continue; }
      if (top.multi ? text.startsWith('"""', i) : c === '"') {
        stack.pop();
        if (top.multi && isPath(text.slice(top.start, i))) hidden.push(top.line);
        if (top.multi) { put('"'); put('"'); put('"'); i += 2; } else put('"');
        continue;
      }
      if (top.multi) put(c === '\n' ? '\n' : ' '); else put(c, c === '\n' ? '\n' : ' ');
      continue;
    }
    if (top && top.interp >= 0) {
      if (c === '(') top.interp++;
      else if (c === ')') { if (top.interp === 0) { top.interp = -1; put(')', ' '); continue; } top.interp--; }
    }
    if (text.startsWith('//', i)) { while (i < text.length && text[i] !== '\n') i++; i--; continue; }
    if (text.startsWith('/*', i)) {
      let depth = 0, j = i;
      for (; j < text.length; j++) {
        if (text.startsWith('/*', j)) { depth++; j++; } else if (text.startsWith('*/', j)) { depth--; j++; if (depth === 0) break; }
      }
      keepNewlines(text.slice(i, j + 1)); i = j; continue;
    }
    if (text.startsWith('#"', i)) {
      const end = text.indexOf('"#', i + 2); const j = end < 0 ? text.length : end + 1;
      if (isPath(text.slice(i + 2, j - 1))) hidden.push(code.length);
      keepNewlines(text.slice(i, j + 1)); i = j; continue;
    }
    if (text.startsWith('"""', i)) { stack.push({ multi: true, interp: -1, start: i + 3, line: code.length }); put('"'); put('"'); put('"'); i += 2; continue; }
    if (c === '"') { stack.push({ multi: false, interp: -1 }); put('"'); continue; }
    put(c);
  }
  return { code, bare, hidden };
}

/* The board-route literals on a line of code, each with the column it starts at: each "/api/..." string, its
   interpolations (balanced, nested parens and strings inside them included) replaced by the placeholder x, its query
   string kept. Multi-line strings were blanked by scanSwift. A literal used only as a prefix ("/api/",
   "/api/attachment/") ends in a slash and is not a route. */
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
    if (!lit.endsWith('/')) out.push({ lit, at: i });
    i = j;
  }
  return out;
}

// The places a "/api/" text is a prefix to test or strip, not a request (review 4): every other partial board path
// (one ending in a slash, one joined with +, an "api/" fragment) is a problem.
const PREFIX_SITES = [/\bhasPrefix\("\/api\//, /\blet prefix = "\/api\/attachment\/"/];
// A request is to another service only on positive evidence: the coordinator's paths, the relay gate's, the site root.
const OTHER_SERVICE = /URL\(string: "\/(v1\/|_kosmos\/|account"|delete-account"|")/;
// A path joined onto a base is fine only on these bases (the coordinator, and local file folders).
const JOIN = /\.(appendingPathComponent|appending\(path:)/;
const JOIN_OK = /\b(coordinator|temporaryDirectory|folder|files)\s*\.\s*(appendingPathComponent|appending\(path:)/;

const FUNC = /^\s*(@\w+(\([^)]*\))?\s+)*((static|private|fileprivate|public|internal|open|mutating|override|final|nonisolated|class|required|convenience)\s+)*func\s/;
const HTTP_METHOD = /\bhttpMethod\s*=\s*("([A-Z]+)"|\w+)/;
const SETS_METHOD = /\bhttpMethod\s*=/;   // presence, tested on the string-blanked line
// A request that builds its own URL: the next request's start, and a non-board one's (the coordinator, the relay gate).
const OWN_URL = /URL\(string:|URLRequest\([^)]*appendingPathComponent/;

/* Every board route the app calls by literal, with the method set on the same request, and the problems found.
   Anything the parser cannot attribute with certainty is a problem, never a silent GET. The method is the first
   httpMethod inside the same block as the URL (brace depth on string-blanked code, so a neighbouring function's or
   closure's request is never read), before the next request that builds its own URL (OWN_URL) or function. A line is claimed once.
   Problems: an httpMethod no request claimed (in a file that calls the board); a variable method on a route not in
   VARIABLE_METHODS; two route literals on one line; a route literal passed to anything but URL(string: or a
   declared helper. */
function routesFromSwift() {
  const found = new Map();
  const problems = [];
  for (const file of swiftFiles()) {
    const rel = path.relative(__dirname, file);
    const { code, bare, hidden } = scanSwift(fs.readFileSync(file, 'utf8'));
    const claimed = new Set();
    const methodAfter = (i, from, route) => {
      let depth = 0;
      for (let j = i; j < Math.min(bare.length, i + 40); j++) {
        const line = j === i ? bare[j].slice(from) : bare[j];
        if (j > i && (OWN_URL.test(line) || FUNC.test(line))) break;
        // Found on the string-blanked line (so never inside a string), read from the code line (where the value is).
        const set = SETS_METHOD.test(line) ? (j === i ? code[j].slice(from) : code[j]).match(HTTP_METHOD) : null;
        if (set && !claimed.has(j)) {
          claimed.add(j);
          if (set[2]) return set[2];
          if (!(route && VARIABLE_METHODS[route])) problems.push(`${rel}:${j + 1}: a variable method on ${route || 'a request'} that VARIABLE_METHODS does not name`);
          return 'GET';
        }
        for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') depth--; }
        if (depth < 0) break;
      }
      return 'GET';
    };
    hidden.forEach((j) => problems.push(`${rel}:${j + 1}: a board path inside a raw or multi-line string; write it as a plain "/api/..." string`));
    code.forEach((line, i) => {
      const lits = routeLiterals(line);
      const where = `${rel}:${i + 1}`;
      // Partial board paths (review 4): any string holding "/api" or "api/" that is not a whole route read above.
      if (!PREFIX_SITES.some((re) => re.test(line))) {
        for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
          const t = m[1];
          const whole = t.startsWith('/api/') && !t.endsWith('/');
          if (/(^|\/)api(\/|$)/.test(t) && !whole) problems.push(`${where}: "${t}" is part of a board path; write the whole route as one "/api/..." string`);
          if (whole && /^\s*\+/.test(line.slice(m.index + m[0].length))) problems.push(`${where}: "${t}" is joined onto with +; write the whole route as one string`);
        }
      }
      if (JOIN.test(line) && !JOIN_OK.test(line)) problems.push(`${where}: a path joined onto a base this test does not know; if it is a board route, write it as one "/api/..." string`);
      if (lits.length === 0) {
        if (OTHER_SERVICE.test(line) || /URLRequest\(url: (coordinator)\.appendingPathComponent/.test(line)) methodAfter(i, 0, null);
        else if (/URL\(string: "\//.test(line)) problems.push(`${where}: a request to a path this test does not know; name it in OTHER_SERVICE if it is not the board`);
      }
      if (lits.length > 1) problems.push(`${where}: ${lits.length} route literals on one line; give each request its own`);
      for (const { lit: p, at } of lits) {
        const bareP = p.split('?')[0];
        const before = line.slice(0, at);
        const helper = HELPERS.find((h) => h.file === rel && before.includes(h.call));
        if (!helper && !/URL\(string:\s*$/.test(before)) {
          problems.push(`${where}: ${p} is not built with URL(string:) or a declared helper, so its method cannot be read`);
        }
        const method = helper ? helper.method : methodAfter(i, at, bareP);
        const methods = VARIABLE_METHODS[bareP] ? VARIABLE_METHODS[bareP].methods : [method];
        for (const m of methods) if (!found.has(`${m} ${p}`)) found.set(`${m} ${p}`, where);
      }
    });
    // Every method line in the app is claimed by some request (no per-file gate, review 4).
    bare.forEach((l, j) => { if (SETS_METHOD.test(l) && !claimed.has(j)) problems.push(`${rel}:${j + 1}: an httpMethod no request claimed`); });
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
    // The helper's own definition (func request(... method: String ...)) is not a caller.
    const code = scanSwift(fs.readFileSync(path.join(__dirname, file), 'utf8')).code.filter((l) => !/\bfunc\s+request\(/.test(l)).join('\n');
    assert.ok(code.includes(`"${p}"`), `${file} no longer names ${p}: update VARIABLE_METHODS`);
    const matched = [...code.matchAll(caller)];
    const used = [...new Set(matched.map((m) => m[1].trim()))].sort();
    assert.deepEqual(used, methods.map((m) => `"${m}"`).sort(), `${file} calls ${p} with ${used.join(', ')}: update VARIABLE_METHODS`);
    // Every call of the helper is one the pattern read, so an unusual spelling goes red.
    assert.equal(matched.length, [...code.matchAll(VARIABLE_METHODS[p].calls)].length, `${file} has a request( call the caller pattern did not read`);
  }
  for (const h of HELPERS) {
    const src = fs.readFileSync(path.join(__dirname, h.file), 'utf8');
    const at = src.indexOf(h.def);
    assert.ok(at >= 0, `${h.file} no longer defines ${h.def}: update HELPERS`);
    const body = src.slice(at, src.indexOf('\n    }', at));
    const set = body.match(HTTP_METHOD);
    assert.equal(set ? set[2] || set[1] : 'GET', h.method, `${h.def} now sets its method to ${set && set[1]}: update HELPERS`);
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
  // A real path asked with a method the board does not serve there falls through too, so a route that loses the
  // phone's method is caught, not only one that loses its path (review 3).
  assert.equal(await isAnswered('POST', '/api/status'), false);
});

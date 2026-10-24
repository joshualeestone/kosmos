'use strict';

/**
 * #7055 (slice 6 of the iPhone plan, #6838): the board still answers every route the iPhone app calls.
 *
 * Once screens are native, the phone reads the board's routes directly, so renaming or dropping one breaks the phone
 * silently: nothing on the board side calls the route any more, and the phone's own suites read captured JSON, not a
 * live board. This test finds every route the app and its notification extension send to the board, with the method
 * each uses, boots a sandboxed board, and asks it for each one. A route counts as answered when the board's reply
 * differs from its reply to a made-up sibling path, measured here rather than assumed, so a route that exists but
 * 404s for an unknown agent ("no such agent") still counts, and a route that has gone does not.
 *
 * How routes are found (review 5: heuristics over route strings kept missing new shapes, so this counts REQUESTS):
 * every place the app builds a request (URLRequest(, or a URLSession fetch straight from a URL) must account for
 * itself, in one of four ways:
 *   1. a board route: its whole "/api/..." route is in URL(string: on the same line; read automatically;
 *   2. another service: the coordinator's /v1 paths or account pages, the relay gate's /_kosmos, an https URL, or a
 *      path joined onto the coordinator, on the same line; skipped;
 *   3. a web view navigation (.load(URLRequest(...))): a page, not an API call; skipped;
 *   4. anything else: declared in SITES below, with the routes it sends and source text that pins them.
 * A request that fits none of these fails the test, however its URL was built. A method is read only from the
 * request's own variable (r.httpMethod for var r = URLRequest(...)), and every httpMethod in the app must belong to a
 * request, so a method can never be credited to the wrong request. The coordinator's and relay's routes live in other
 * repos; the phone's links into board PAGES (/?tab=...) are a contract with web/index.html, not with server.js.
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
// Today: 12 requests name their board route in place; far fewer means the parser stopped matching.
const FLOOR = 10;

/* Requests whose URL is built away from the request (category 4), one entry per request, matched by its text. Each
   names the routes it sends; pins are source text (comments excluded) that ties those routes to the code. method is
   what the request sets: a literal, none (GET), or 'variable', in which case callers lists every caller's method. */
const SITES = [
  { file: 'ios/Kosmos/BoardRoom.swift', text: 'var r = URLRequest(url: url)', method: 'GET',
    routes: ['GET /api/project/x/room'], pins: ['URLComponents(url: URL(string: "/api/project/\\(project)/room"'] },
  // A chat file and its thumbnail: the path comes from the board, accepted only as /api/attachment/<24 hex>[/preview].
  { file: 'ios/Kosmos/BoardLogic.swift', text: 'var r = URLRequest(url: url)', method: 'GET',
    routes: ['GET /api/attachment/000000000000000000000000', 'GET /api/attachment/000000000000000000000000/preview'],
    pins: ['let prefix = "/api/attachment/"', '$0 == url + "/preview"'] },
  // The phone's notification switches: read with GET, written with PUT, through request(_:method:).
  { file: 'ios/Kosmos/SettingsLogic.swift', text: 'var r = URLRequest(url: url, cachePolicy', method: 'variable',
    routes: ['GET /api/phone-notify', 'PUT /api/phone-notify'], pins: ['URL(string: "/api/phone-notify"'],
    callers: { pattern: /\brequest\(\s*[^,()]+,\s*method:\s*([^,)]+)/g, every: /\brequest\(/g, skip: /\bfunc\s+request\(/ } },
  // The notification extension: a notification's words, and an agent's picture (a board path, /api/agent/<x>/avatar).
  { file: 'ios/KosmosNotice/NoticeLogic.swift', text: 'var r = URLRequest(url: url, cachePolicy', method: 'GET',
    routes: ['GET /api/phone/notice', 'GET /api/agent/x/avatar'],
    pins: ['path: "/api/phone/notice"', 'path.hasPrefix("/api/agent/"), path.hasSuffix("/avatar")'] },
];

const REQUEST = /\bURLRequest\(|\.(data|download|bytes)\(from:/g;
const OTHER_SERVICE = /URL\(string: "(\/(v1\/|_kosmos\/|account"|delete-account"|")|https?:\/\/)|\bcoordinator\.appendingPathComponent\(/;
const PAGE_LOAD = /\.load\(URLRequest\(/;
const SETS_METHOD = /\bhttpMethod\s*=/;
const FUNC = /^\s*(@\w+(\([^)]*\))?\s+)*((static|private|fileprivate|public|internal|open|mutating|override|final|nonisolated|class|required|convenience)\s+)*func\s/;

/* The method a request at (line i, column at) sets: read only from its own variable, inside its scope (brace depth on
   string-blanked code), before the variable is bound again or a function starts. Claims the method line. */
function methodOf(code, bare, i, at, claimed) {
  const bound = code[i].slice(0, at).match(/\b(?:var|let)\s+(\w+)\s*=\s*$/);
  if (!bound) return 'GET';
  const name = bound[1];
  const sets = new RegExp(`\\b${name}\\.httpMethod\\s*=\\s*("([A-Z]+)"|(\\w+))`);
  let depth = 0;
  for (let j = i; j < Math.min(bare.length, i + 60); j++) {
    const line = j === i ? bare[j].slice(at) : bare[j];
    if (j > i && (FUNC.test(line) || new RegExp(`\\b(var|let)\\s+${name}\\s*=`).test(line))) break;
    if (new RegExp(`\\b${name}\\.httpMethod\\s*=`).test(line)) {
      claimed.add(j);
      const m = (j === i ? code[j].slice(at) : code[j]).match(sets);
      return m && m[2] ? m[2] : 'variable';
    }
    for (const ch of line) { if (ch === '{') depth++; else if (ch === '}') depth--; }
    if (depth < 0) break;
  }
  return 'GET';
}

/* Every board route the app sends, from the given Swift files ({ rel, text }), and every problem found. */
function routesFrom(files) {
  const found = new Map();
  const problems = [];
  const matchedSites = new Set();
  let inPlace = 0;
  for (const { rel, text } of files) {
    const { code, bare } = scanSwift(text);
    const claimed = new Set();
    bare.forEach((line, i) => {
      for (const site of line.matchAll(REQUEST)) {
        const at = site.index;
        const where = `${rel}:${i + 1}`;
        const method = methodOf(code, bare, i, at, claimed);
        const lits = routeLiterals(code[i]);
        if (PAGE_LOAD.test(code[i].slice(Math.max(0, at - 6)))) continue;
        if (lits.length > 1) { problems.push(`${where}: ${lits.length} board routes on one line; give each request its own line`); continue; }
        if (lits.length === 1) {
          const { lit, at: litAt } = lits[0];
          if (!/URL\(string:\s*$/.test(code[i].slice(0, litAt))) { problems.push(`${where}: ${lit} is not built with URL(string:) on the request's line; write it that way or add the request to SITES`); continue; }
          if (method === 'variable') { problems.push(`${where}: ${lit} sets its method from a variable; add the request to SITES with its callers`); continue; }
          inPlace++;
          if (!found.has(`${method} ${lit}`)) found.set(`${method} ${lit}`, where);
          continue;
        }
        if (OTHER_SERVICE.test(code[i])) continue;
        const decl = SITES.filter((d) => d.file === rel && code[i].includes(d.text));
        if (decl.length !== 1) { problems.push(`${where}: a request this test cannot read (its URL is built elsewhere); add it to SITES with the routes it sends, or name its service in OTHER_SERVICE`); continue; }
        const d = decl[0];
        if (matchedSites.has(d)) { problems.push(`${where}: a second request matches the SITES entry for ${d.text}; make each entry's text unique`); continue; }
        matchedSites.add(d);
        const joined = code.join('\n');
        for (const pin of d.pins) if (!joined.includes(pin)) problems.push(`${rel}: no longer has ${pin}; update SITES for ${d.routes.join(', ')}`);
        if (d.method === 'variable') {
          if (method !== 'variable') problems.push(`${where}: SITES says this request's method is a variable, but it sets ${method}`);
          const calls = code.filter((l) => !d.callers.skip.test(l)).join('\n');
          const read = [...calls.matchAll(d.callers.pattern)];
          const used = [...new Set(read.map((m) => m[1].trim().replace(/^"|"$/g, '')))].sort();
          const declared = [...new Set(d.routes.map((r) => r.split(' ')[0]))].sort();
          if (used.join() !== declared.join()) problems.push(`${rel}: its callers use ${used.join(', ')}, SITES says ${declared.join(', ')}`);
          if (read.length !== [...calls.matchAll(d.callers.every)].length) problems.push(`${rel}: a caller the pattern could not read; update SITES`);
        } else if (method !== d.method) problems.push(`${where}: sets ${method}, SITES says ${d.method}`);
        for (const r of d.routes) if (!found.has(r)) found.set(r, `${where} (SITES)`);
      }
    });
    // Every method line belongs to a request, so none is credited to the wrong one or set where nobody reads it.
    bare.forEach((l, j) => { if (SETS_METHOD.test(l) && !claimed.has(j)) problems.push(`${rel}:${j + 1}: an httpMethod set on no request this test found`); });
  }
  return { found, problems, inPlace, unmatched: SITES.filter((d) => files.some((f) => f.rel === d.file) && !matchedSites.has(d)) };
}

const appFiles = () => swiftFiles().map((f) => ({ rel: path.relative(__dirname, f), text: fs.readFileSync(f, 'utf8') }));

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

test('every request the app builds is read, skipped for a reason, or declared, with its method', () => {
  const { found, problems, inPlace, unmatched } = routesFrom(appFiles());
  assert.deepEqual(problems, [], 'requests this test could not account for');
  assert.deepEqual(unmatched.map((d) => `${d.file}: ${d.text}`), [], 'SITES entries that match no request any more');
  assert.ok(inPlace >= FLOOR, `only ${inPlace} requests name their board route in place: ${[...found.keys()].join(', ')}`);
  // Pinned so a broken method reading cannot pass: the chat send is a POST, the status read a GET, the seen mark a POST.
  for (const k of ['POST /api/agent/x/thread', 'GET /api/status', 'POST /api/project/x/seen', 'GET /api/tasks?view=tasks']) {
    assert.ok(found.has(k), `${k} missing from: ${[...found.keys()].join(', ')}`);
  }
});

test('CONTROL: shapes that once slipped through silently are now reported', () => {
  const one = (text) => routesFrom([{ rel: 'ios/Kosmos/Probe.swift', text }]);
  // A route built away from its request (review 5).
  assert.match(one('func a(mac: URL) -> URLRequest {\n  let url = URL(string: feed, relativeTo: mac)!\n  return URLRequest(url: url)\n}').problems.join(), /cannot read/);
  // A neighbour's method is never credited to the request above it (review 5).
  const n = one('func b(mac: URL, reply: URL) {\n  let room = URLRequest(url: URL(string: "/api/p/x/room", relativeTo: mac)!)\n  var answer = URLRequest(url: reply)\n  answer.httpMethod = "POST"\n}');
  assert.ok(n.found.has('GET /api/p/x/room') && !n.found.has('POST /api/p/x/room'), [...n.found.keys()].join());
  assert.match(n.problems.join(), /cannot read/);
  // A route joined together, or hidden in a raw string, is a request this test cannot read (review 4).
  assert.match(one('let r = URLRequest(url: URL(string: "/api/agent/" + s, relativeTo: mac)!)').problems.join(), /not built with URL\(string:\)|cannot read/);
  assert.match(one('let r = URLRequest(url: URL(string: #"/api/x"#, relativeTo: mac)!)').problems.join(), /cannot read/);
  // A method set on a variable that is not the request's own is never read as the request's.
  assert.match(one('var r = URLRequest(url: URL(string: "/api/x", relativeTo: mac)!)\nq.httpMethod = "POST"').problems.join(), /no request this test found/);
  // Ordinary non-board Swift is not a problem: a file path, a web link, a log line, an https request.
  const quiet = one('let f = dir.appendingPathComponent("threads.json")\nlet link = "https://example.com/api/docs"\nprint("GET /api/status")\nvar h = URLRequest(url: URL(string: "https://hooks.example.com/n")!)\nh.httpMethod = "POST"');
  assert.deepEqual(quiet.problems, []);
});

test('the board answers every route the iPhone app calls (not its reply to a route that does not exist)', async () => {
  const gone = [];
  for (const [key, where] of routesFrom(appFiles()).found) {
    const [method, p] = key.split(' ');
    if (!(await isAnswered(method, p))) gone.push(`${key} (called at ${where}): the board answers "${(await ask(method, p)).slice(0, 80)}"`);
  }
  assert.deepEqual(gone, [], 'routes the phone calls that the board no longer answers:\n' + gone.join('\n'));
});

test('CONTROL: at the prefix, method and query of each route, two made-up siblings get the same reply', async () => {
  // Byte for byte, aimed at exactly the comparison each verdict uses (review 2): a reply that quoted the path back,
  // or a catch-all under a real prefix that echoed the last segment, would make every gone route look answered.
  const differ = [];
  for (const key of routesFrom(appFiles()).found.keys()) {
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

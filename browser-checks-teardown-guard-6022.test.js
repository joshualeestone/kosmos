'use strict';

/**
 * #6022: a browser check whose route handler fetches the real answer must survive the browser closing while that
 * fetch is in flight.
 *
 * 🛑 WHY. A page polls on a timer (status, a thread), so a poll can be in flight when a check closes its browser. A
 * handler that awaits `route.fetch()` then rejects with "Request context disposed" (or a TargetClosedError), nothing
 * handles it, Node exits 1, and the check fails AFTER every assertion passed. Only under load, so it passes CI and
 * aborts a release cut at step 3b: 0.7.42 (render-mobilenav-4823, #5921) and 0.7.44 (render-rename-say, #6023).
 *
 * 🔑 THE RULE, read from the source text of docs/browser-checks/*.js: in a route handler that fetches the real
 *    answer (`<param>.fetch(`, <param> being the handler's first parameter), that fetch AND every later
 *    `<param>.fulfill(` / `.continue(` / `.fetch(` in the same handler sit inside a `try {` still open at that point.
 *    The catch should abort the request (`await r.abort().catch(() => {})`), so a real failure mid-check fails fast
 *    instead of hanging, and after close it is quiet.
 *    MEASURED (2026-10-12, a page polling every 20 ms through a 300 ms handler, browser closed mid-poll): the bare
 *    handler exits 1 in 5 of 5 ("Request context disposed", TargetClosedError); the try/abort handler exits 0 in 5 of
 *    5 with NO unroute, and 5 of 5 with the page closed before the browser.
 *    So unrouting is NOT required here: it helps only when it runs before the first close, and a check that closes
 *    its page or context first slips past an unroute placed before browser.close() (found on #6023). The try is what
 *    holds in every close order. Unrouting with ignoreErrors, or closeQuietly, is still fine to add.
 *
 * ⚠️ NOT FLAGGED, on purpose: `window.fetch`, `page.request.fetch` and a test's own `fetch(`; a handler that only
 * fulfills a fixture (no network, nothing in flight). Rule 2 is file level: it does not check that the unroute runs
 * before EVERY close in a file with several browsers.
 *
 * ⚠️ WEAKEST PART, AND IT IS A HEURISTIC. A handler is found by its `.route(` call and its first parameter, from an
 * arrow (`async (r) =>`, `r =>`) or `function (r)`. A handler written as a named function defined elsewhere is not
 * read (fails GREEN). A handler that only fulfills a fixture is not checked: its answer is immediate, with no await
 * before it. "Inside a try" counts braces from the last `try {` before the fetch, so a brace inside a string
 * between the two can miscount. Comments are blanked first (strings and template literals kept). A handler that
 * fetches through a helper (mobile-shots.js fetchBoard(route)) is not seen: that file's helper-fed handlers were
 * hardened by hand. A handler's span runs to the next `.route(` call, so a nearby helper that reuses the parameter
 * name is read as part of it (fails RED, safe). The fixtures below pin both directions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const DIR = nodePath.join(__dirname, 'docs', 'browser-checks');
const HANDLER = /\.route\(\s*[^,]+,\s*(?:async\s+)?(?:function\s*\(\s*(\w+)|\(\s*(\w+)[^)]*\)\s*=>|(\w+)\s*=>)/g;

/* The source with every comment blanked (newlines kept, so line numbers hold): a comment that mentions r.fetch() is
   not code. Strings and template literals are skipped intact, so a // inside a URL is not read as a comment. */
function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length;) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j += 1; else if (c !== '`' && src[j] === '\n') break; j += 1; }
      out += src.slice(i, j + 1); i = j + 1;
    } else if (c === '/' && n === '/') {
      let j = i; while (j < src.length && src[j] !== '\n') j += 1;
      out += ' '.repeat(j - i); i = j;
    } else if (c === '/' && n === '*') {
      let j = src.indexOf('*/', i + 2); j = j < 0 ? src.length : j + 2;
      out += src.slice(i, j).replace(/[^\n]/g, ' '); i = j;
    } else { out += c; i += 1; }
  }
  return out;
}

/* True when any `try {` after `from` is still open at `at` in `src` (braces counted from each `try {` before it). */
function insideOpenTry(src, from, at) {
  const seg = src.slice(from, at);
  const t = seg.lastIndexOf('try');
  if (t < 0) return false;
  const open = seg.indexOf('{', t);
  if (open < 0 || !/^try\s*$/.test(seg.slice(t, open))) return insideOpenTry(src, from, from + t);
  let depth = 0;
  for (let i = open; i < seg.length; i += 1) { if (seg[i] === '{') depth += 1; else if (seg[i] === '}') depth -= 1; }
  // An inner try that already closed may sit inside an outer one that is still open: keep walking back.
  return depth > 0 || insideOpenTry(src, from, from + t);
}

/* The findings for one file's source: the lines of route-handler calls that can reject after the browser closes
   outside an open try (a handler's fetch, and every fulfill / continue / fetch after it). */
function scan(raw) {
  const src = stripComments(raw);
  const bad = [];
  const starts = [];
  let m;
  HANDLER.lastIndex = 0;
  while ((m = HANDLER.exec(src))) starts.push({ at: m.index, param: m[1] || m[2] || m[3] });
  starts.forEach((h, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : src.length;
    const body = src.slice(h.at, end);
    const first = body.search(new RegExp('\\b' + h.param + '\\.fetch\\('));
    if (first < 0) return;   // fulfills a fixture only: nothing in flight
    const re = new RegExp('\\b' + h.param + '\\.(fetch|fulfill|continue)\\(', 'g');
    re.lastIndex = h.at + first;
    let f;
    while ((f = re.exec(src)) && f.index < end) {
      if (!insideOpenTry(src, h.at, f.index)) bad.push(src.slice(0, f.index).split('\n').length);
    }
  });
  return bad;
}

test('#6022 fixtures: the rule can fail, and the safe shapes pass (controls)', () => {
  const bare = "await page.route(/status/, async (route) => {\n  const r = await route.fetch();\n  await route.fulfill({ response: r });\n});\nawait browser.close();\n";
  assert.deepEqual(scan(bare), [2, 3], 'an unguarded fetch and the fulfill after it must both be flagged');
  const fixed = "await page.route(/status/, async (r) => {\n  try {\n    const resp = await r.fetch();\n    await r.fulfill({ response: resp });\n  } catch { await r.abort().catch(() => {}); }\n});\nawait browser.close();\n";
  assert.deepEqual(scan(fixed), [], 'try/abort around the whole handler passes, with no unroute (measured safe)');
  const fulfillOutside = "await page.route('**/x', async (r) => {\n  let resp;\n  try { resp = await r.fetch(); } catch { return r.abort().catch(() => {}); }\n  await r.fulfill({ response: resp });\n});\n";
  assert.deepEqual(scan(fulfillOutside), [4], 'a fulfill after the try closed can still reject after close');
  const closedTry = "await page.route('**/x', async (r) => {\n  try { setup(); } catch {}\n  const resp = await r.fetch();\n  r.fulfill({ response: resp });\n});\n";
  assert.deepEqual(scan(closedTry), [3, 4], 'a try that closed before the fetch does not guard it');
  const nested = "await page.route('**/x', async (r) => {\n  try {\n    const resp = await r.fetch();\n    let body; try { body = await resp.json(); } catch { body = null; }\n    await r.fulfill({ response: resp, json: body });\n  } catch { await r.abort().catch(() => {}); }\n});\n";
  assert.deepEqual(scan(nested), [], 'a closed inner try inside an open outer try still guards (review: the editor of batch 2)');
  const commented = "await page.route('**/api/a', async (r) => {\n  // the r.fetch() answer is not used here\n  /* nor r.fulfill() */\n  await r.fulfill({ json: { url: 'http://x//y' } });\n});\n";
  assert.deepEqual(scan(commented), [], 'a comment naming r.fetch() is not a fetch, and a // inside a string is not a comment');
  const fixtureOnly = "await page.route('**/api/x', (r) => r.fulfill({ json: {} }));\nconst x = await window.fetch('/a');\nawait browser.close();\n";
  assert.deepEqual(scan(fixtureOnly), [], 'a fixture-only handler and window.fetch are not flagged');
  const bareParam = "page.route('**/t', async route => {\n  const r = await route.fetch();\n  route.fulfill({ response: r });\n});\n";
  assert.deepEqual(scan(bareParam), [2, 3], 'a bare-parameter arrow is read too');
});

test('#6022: every browser-check route handler that fetches keeps its fetch and answer inside a try', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort();
  assert.ok(files.length > 100, 'expected the browser-check folder, found ' + files.length + ' files');
  const bad = [];
  let withRoutes = 0;
  for (const f of files) {
    const src = fs.readFileSync(nodePath.join(DIR, f), 'utf8');
    if (/\.route\(/.test(src)) withRoutes += 1;
    const lines = scan(src);
    if (lines.length) bad.push(f + ' line ' + lines.join(','));
  }
  assert.ok(withRoutes > 50, 'the scan found only ' + withRoutes + ' files with routes; the folder or the pattern moved');
  assert.deepEqual(bad, [], 'a route handler call outside a try can crash the check at teardown (#6022):\n  ' + bad.join('\n  '));
});

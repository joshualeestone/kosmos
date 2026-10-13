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
 * 🔑 TWO RULES, both read from the source text of docs/browser-checks/*.js:
 *   1. A route handler's own fetch (`<param>.fetch(` where <param> is the handler's first parameter) sits inside a
 *      `try {` that is still open at that point. The catch should abort the request
 *      (`await r.abort().catch(() => {})`), so a real failure mid-check fails fast instead of hanging.
 *   2. A file with such a handler unroutes before it closes: it calls `unrouteAll(` (with ignoreErrors) or
 *      `closeQuietly(` (docs/browser-checks/lib-close-quietly.js). That is what actually stops the crash: an
 *      unrouted handler's late rejection is ignored.
 *
 * ⚠️ NOT FLAGGED, on purpose: `window.fetch`, `page.request.fetch` and a test's own `fetch(`; a handler that only
 * fulfills a fixture (no network, nothing in flight). Rule 2 is file level: it does not check that the unroute runs
 * before EVERY close in a file with several browsers.
 *
 * ⚠️ WEAKEST PART, AND IT IS A HEURISTIC. A handler is found by its `.route(` call and its first parameter, from an
 * arrow (`async (r) =>`, `r =>`) or `function (r)`. A handler written as a named function defined elsewhere is not
 * read (fails GREEN). "Inside a try" counts braces from the last `try {` before the fetch, so a brace inside a string
 * between the two can miscount. The fixtures below pin both directions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const DIR = nodePath.join(__dirname, 'docs', 'browser-checks');
const HANDLER = /\.route\(\s*[^,]+,\s*(?:async\s+)?(?:function\s*\(\s*(\w+)|\(\s*(\w+)[^)]*\)\s*=>|(\w+)\s*=>)/g;

/* True when a `try {` is still open at `at` in `src`, counting braces from the last `try {` before it. */
function insideOpenTry(src, from, at) {
  const seg = src.slice(from, at);
  const t = seg.lastIndexOf('try');
  if (t < 0) return false;
  const open = seg.indexOf('{', t);
  if (open < 0 || !/^try\s*$/.test(seg.slice(t, open))) return insideOpenTry(src, from, from + t);
  let depth = 0;
  for (let i = open; i < seg.length; i += 1) { if (seg[i] === '{') depth += 1; else if (seg[i] === '}') depth -= 1; }
  return depth > 0;
}

/* The findings for one file's source: unguarded handler fetches (line numbers), and whether rule 2 fails. */
function scan(src) {
  const hits = [];
  const starts = [];
  let m;
  HANDLER.lastIndex = 0;
  while ((m = HANDLER.exec(src))) starts.push({ at: m.index, param: m[1] || m[2] || m[3] });
  starts.forEach((h, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].at : src.length;
    const re = new RegExp('\\b' + h.param + '\\.fetch\\(', 'g');
    let f;
    re.lastIndex = h.at;
    while ((f = re.exec(src)) && f.index < end) {
      hits.push({ line: src.slice(0, f.index).split('\n').length, guarded: insideOpenTry(src, h.at, f.index) });
    }
  });
  const fetches = hits.length > 0;
  return {
    unguarded: hits.filter((x) => !x.guarded).map((x) => x.line),
    noUnroute: fetches && !/unrouteAll\(|closeQuietly\(/.test(src),
  };
}

test('#6022 fixtures: each rule can fail, and the safe shapes pass (controls)', () => {
  const bare = "await page.route(/status/, async (route) => {\n  const r = await route.fetch();\n  await route.fulfill({ response: r });\n});\nawait browser.close();\n";
  assert.deepEqual(scan(bare), { unguarded: [2], noUnroute: true }, 'an unguarded fetch with no unroute must fail both rules');
  const fixed = "await page.route(/status/, async (r) => {\n  try {\n    const resp = await r.fetch();\n    await r.fulfill({ response: resp });\n  } catch { await r.abort().catch(() => {}); }\n});\nawait page.unrouteAll({ behavior: 'ignoreErrors' });\nawait browser.close();\n";
  assert.deepEqual(scan(fixed), { unguarded: [], noUnroute: false });
  const closedTry = "await page.route('**/x', async (r) => {\n  try { setup(); } catch {}\n  const resp = await r.fetch();\n  r.fulfill({ response: resp });\n});\ncloseQuietly(browser);\n";
  assert.deepEqual(scan(closedTry), { unguarded: [3], noUnroute: false }, 'a try that closed before the fetch does not guard it');
  const fixtureOnly = "await page.route('**/api/x', (r) => r.fulfill({ json: {} }));\nconst x = await window.fetch('/a');\nawait browser.close();\n";
  assert.deepEqual(scan(fixtureOnly), { unguarded: [], noUnroute: false }, 'a fixture-only handler and window.fetch are not flagged');
  const bareParam = "page.route('**/t', async route => {\n  const r = await route.fetch();\n  route.fulfill({ response: r });\n});\n";
  assert.deepEqual(scan(bareParam), { unguarded: [2], noUnroute: true }, 'a bare-parameter arrow is read too');
});

test('#6022: every browser check guards its handler fetches and unroutes before it closes', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).sort();
  assert.ok(files.length > 100, 'expected the browser-check folder, found ' + files.length + ' files');
  const bad = [];
  let withHandlers = 0;
  for (const f of files) {
    const r = scan(fs.readFileSync(nodePath.join(DIR, f), 'utf8'));
    if (r.unguarded.length || r.noUnroute) bad.push(f + (r.unguarded.length ? ' fetch outside a try at line ' + r.unguarded.join(',') : '') + (r.noUnroute ? ' no unrouteAll/closeQuietly' : ''));
    if (/\.route\(/.test(fs.readFileSync(nodePath.join(DIR, f), 'utf8'))) withHandlers += 1;
  }
  assert.ok(withHandlers > 50, 'the scan found only ' + withHandlers + ' files with routes; the folder or the pattern moved');
  assert.deepEqual(bad, [], 'a route handler fetch can crash the check at teardown (#6022):\n  ' + bad.join('\n  '));
});

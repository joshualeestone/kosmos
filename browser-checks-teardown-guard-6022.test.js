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
 * read (fails GREEN). A handler with no fetch of its own is not checked at all, even one that awaits a timer or a held
 * promise before it fulfills (that answer can land after close too; outside this card, a follow-up). A catch that
 * rethrows counts as caught. "Inside a try" counts braces from the last `try {` before the fetch, so a brace inside a string
 * between the two can miscount. Comments are blanked first (strings, template literals and regex literals kept).
 * Each call must also be awaited in its own statement, and its try must have a catch (round 1). A handler that
 * fetches through a helper (mobile-shots.js fetchBoard(route)) is not seen: that file's helper-fed handlers were
 * hardened by hand. A handler's span runs to the next `.route(` call, so a nearby helper that reuses the parameter
 * name is read as part of it (fails RED, safe). The fixtures below pin both directions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const DIR = nodePath.join(__dirname, 'docs', 'browser-checks');
const HANDLER = /\.route\(\s*[^,]{1,300},\s*(?:async\s+)?(?:function\s*\w*\s*\(\s*(\w+)|\(\s*(\w+)[^)]*\)\s*=>|(\w+)\s*=>)/g;

/* The source with every comment blanked (newlines kept, so line numbers hold): a comment that mentions r.fetch() is
   not code. Strings and template literals are skipped intact, so a // inside a URL is not read as a comment. */
function stripComments(src) {
  const parts = [];
  let codeTail = '';   // the last code characters emitted (whitespace and blanked comments skip it), never the whole output
  const emit = (str) => { parts.push(str); if (/\S/.test(str)) codeTail = (codeTail + str).replace(/\s+$/, '').slice(-24); };
  for (let i = 0; i < src.length;) {
    const c = src[i];
    const n = src[i + 1];
    const prev = codeTail.slice(-1);
    // A / starts a regex after an operator or opener (=> included, round 2) or a keyword like return; after a name,
    // a number or a closing bracket it divides.
    if (c === '/' && n !== '/' && n !== '*' && (prev === '' || '(,=:[!&|?{};><+-*~%^'.includes(prev) || /\b(return|typeof|case|in|of|void)$/.test(codeTail))) {
      // A regex literal: skipped intact, so /^http:\/\/x\// is not read as a comment (round 1).
      let j = i + 1; let cls = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break;
        j += 1;
      }
      emit(src.slice(i, j + 1)); i = j + 1;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j += 1; else if (c !== '`' && src[j] === '\n') break; j += 1; }
      emit(src.slice(i, j + 1)); i = j + 1;
    } else if (c === '/' && n === '/') {
      let j = i; while (j < src.length && src[j] !== '\n') j += 1;
      emit(' '.repeat(j - i)); i = j;
    } else if (c === '/' && n === '*') {
      let j = src.indexOf('*/', i + 2); j = j < 0 ? src.length : j + 2;
      emit(src.slice(i, j).replace(/[^\n]/g, ' ')); i = j;
    } else { emit(c); i += 1; }
  }
  return parts.join('');
}

/* The index just after the block that opens at `open` (its matching close brace), or -1. */
function blockEnd(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) { if (src[i] === '{') depth += 1; else if (src[i] === '}') { depth -= 1; if (depth === 0) return i + 1; } }
  return -1;
}

/* True when the call at `at` is awaited in its own statement (`await r.fulfill(`, `return await (x ? r.fulfill(`):
   a promise returned or left floating inside a try rejects OUTSIDE it (round 1). */
function awaited(src, at) {
  // Walk back to the start of the statement, skipping balanced (), [] and {} groups: an unmatched ( is still the same
  // expression (`await (x ? r.fulfill(`), an unmatched { is the block the statement sits in, a ; ends the last one.
  let i = at - 1;
  let depth = 0;
  for (; i >= 0; i -= 1) {
    const ch = src[i];
    if (ch === '}' && depth === 0) break;   // the end of the previous statement (a block that held its own await, round 2)
    if (ch === ')' || ch === ']' || ch === '}') depth += 1;
    else if (ch === '(' || ch === '[') { if (depth > 0) depth -= 1; }
    else if (ch === '{') { if (depth > 0) depth -= 1; else break; }
    else if (ch === ';' && depth === 0) break;
  }
  return /\bawait\b/.test(src.slice(i + 1, at));
}

function insideOpenTry(src, from, at) {
  const seg = src.slice(from, at);
  let t = -1;
  for (const m of seg.matchAll(/\btry\b/g)) t = m.index;   // the word try, not retry or entry (round 2)
  if (t < 0) return false;
  const open = seg.indexOf('{', t);
  if (open < 0 || !/^try\s*$/.test(seg.slice(t, open))) return insideOpenTry(src, from, from + t);
  let depth = 0;
  for (let i = open; i < seg.length; i += 1) { if (seg[i] === '{') depth += 1; else if (seg[i] === '}') depth -= 1; }
  // An inner try that already closed may sit inside an outer one that is still open: keep walking back.
  // Open here, and it must be a try ... catch: a try with only a finally lets the rejection through (round 1).
  if (depth > 0) { const e = blockEnd(src, from + open); if (e > 0 && /^\s*catch\b/.test(src.slice(e))) return true; }
  return insideOpenTry(src, from, from + t);
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
    const re = new RegExp('\\b' + h.param + '\\.(fetch|fulfill|continue|fallback|abort)\\(', 'g');
    re.lastIndex = h.at + first;
    let f;
    while ((f = re.exec(src)) && f.index < end) {
      const line = src.slice(0, f.index).split('\n').length;
      if (f[1] === 'abort') {
        // The catch runs when the page may be gone, so its abort rejects too: it must chain its own .catch (round 2).
        if (!/^abort\([^)]*\)\s*\.catch\(/.test(src.slice(f.index + h.param.length + 1))) bad.push(line);
        continue;
      }
      if (!insideOpenTry(src, h.at, f.index) || !awaited(src, f.index)) bad.push(line);
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
  const returned = "await page.route('**/x', async (r) => {\n  try {\n    const resp = await r.fetch();\n    return r.fulfill({ response: resp });\n  } catch { await r.abort().catch(() => {}); }\n});\n";
  assert.deepEqual(scan(returned), [4], 'a fulfill returned without await inside the try still rejects outside it (round 1)');
  const finallyOnly = "await page.route('**/x', async (r) => {\n  try {\n    const resp = await r.fetch();\n    await r.fulfill({ response: resp });\n  } finally { done(); }\n});\n";
  assert.deepEqual(scan(finallyOnly), [3, 4], 'a try with only a finally does not catch (round 1)');
  const thenChain = "await page.route('**/x', async (r) => {\n  try { r.fetch().then((res) => r.fulfill({ response: res })); } catch {}\n});\n";
  assert.deepEqual(scan(thenChain), [2, 2], 'a floating .then chain is not awaited (round 1)');
  const ternary = "await page.route('**/x', async (r) => {\n  try {\n    const j = await r.fetch();\n    return await (j ? r.fulfill({ json: 1 }) : r.fulfill({ json: 2 }));\n  } catch { await r.abort().catch(() => {}); }\n});\n";
  assert.deepEqual(scan(ternary), [], 'an awaited ternary of fulfills counts as awaited');
  const regexUrl = "await ctx.route(/^http:\\/\\/remote\\.test(:\\d+)?\\//, async (r) => {\n  const res = await r.fetch();\n  await r.fulfill({ response: res });\n});\n";
  assert.deepEqual(scan(regexUrl), [2, 3], 'a regex route ending in \\/\\/ is not read as a comment, so its handler is checked (round 1)');
  const blockThenFloat = "await page.route('**/x', async (r) => {\n  try {\n    const resp = await r.fetch();\n    if (!resp.ok()) { await log(); }\n    r.fulfill({ response: resp });\n  } catch { await r.abort().catch(() => {}); }\n});\n";
  assert.deepEqual(scan(blockThenFloat), [5], 'a floating fulfill after a block that awaited is not awaited (round 2)');
  const bareAbort = "await page.route('**/x', async (r) => {\n  try {\n    const resp = await r.fetch();\n    await r.fulfill({ response: resp });\n  } catch { r.abort(); }\n});\n";
  assert.deepEqual(scan(bareAbort), [5], 'an abort in the catch without its own .catch rejects after close (round 2)');
  const arrowRegex = "await page.route('**/x', async (r) => {\n  const ok = (u) => /https?:\\/\\//.test(u); const resp = await r.fetch();\n  await r.fulfill({ response: resp });\n});\n";
  assert.deepEqual(scan(arrowRegex), [2, 3], 'a regex after => ending in \\/\\/ does not blank the fetch on its line (round 2)');
  const named = "await page.route('**/x', async function handle(r) {\n  const resp = await r.fetch();\n  await r.fulfill({ response: resp });\n});\n";
  assert.deepEqual(scan(named), [2, 3], 'a named function handler is read (round 2)');
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

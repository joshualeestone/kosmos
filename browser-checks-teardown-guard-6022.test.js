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
 * read (fails GREEN). #6027 widened the rule: in ANY handler, every answer after its first fetch or its first await (a
 * timer, a held promise) must be awaited inside a try with a catch, or chain its own .catch; an answer before any
 * await is immediate and exempt; an answer inside a scheduled or chained callback (setTimeout, setInterval,
 * setImmediate, queueMicrotask, nextTick, .then, .finally) is late even with no await, and needs a .catch on it or on
 * the callback's chain, or an awaited try inside the callback. More generally (review 4), an answer inside ANY function
 * nested in the handler (a parked callback, a helper scheduled by name) needs its own .catch or an awaited try inside
 * that function. Aliases (`const rt = r`), destructured or optional-chained answers, and a route passed to a helper as
 * a later argument are not read (fail GREEN; none in the folder); nor is an answer in an object or class method
 * (`{ go() { r.fulfill() } }`) or in a default parameter of the handler (fail GREEN). A concise arrow's body is read
 * to the next comma, semicolon or closing bracket, so an answer after a ternary's arrow branch reads as nested (fails
 * RED). A handler's span is its .route( call, to the matching paren (a backtick string nested inside
 * ${...} in the route's URL can cut it short). Code before the wait now sits inside the try, so a throw there aborts
 * the request quietly instead of crashing; no check relies on that crash. A catch that
 * rethrows counts as caught, and the abort in the catch is advised, not required (an empty catch passes: no crash, but a
 * real failure then waits for the check's timeout). A statement without semicolons, or a call passed as an argument
 * to an awaited function (await f(r.fulfill(...))), reads as awaited; no check uses either style. An abort whose argument has its own
 * parentheses is flagged though correct (fails RED). "Inside a try" counts braces from the last `try {` before the fetch, so a brace inside a string
 * between the two can miscount. Comments are blanked first (strings, template literals and regex literals kept).
 * Each call must also be awaited in its own statement, and its try must have a catch (round 1). A handler that
 * fetches through a helper (mobile-shots.js fetchBoard(route)) is not seen: that file's helper-fed handlers were
 * hardened by hand. The fixtures below pin both directions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const DIR = nodePath.join(__dirname, 'docs', 'browser-checks');
const HANDLER = /\.route\(\s*(?:'[^'\n]*'|"[^"\n]*"|`[^`]*`|[^,'"`]){1,300},\s*(?:async\s+)?(?:function\s*\w*\s*\(\s*(\w+)|\(\s*(\w+)[^)]*\)\s*=>|(\w+)\s*=>)/g;

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

/* True when the / at `i` starts a regex literal, by the same rule stripComments uses: after an operator or opener
   (=> included) or a keyword like return, not after a name, a number or a closing bracket (#6027 review 1). */
function regexStart(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j -= 1;
  if (j < 0) return true;
  if ((src[j] === '+' || src[j] === '-') && src[j - 1] === src[j]) return false;   // i++ / 2 divides (review 2)
  if ('(,=:[!&|?{};><+-*~%^'.includes(src[j])) return true;
  return /\b(return|typeof|case|in|of|void)$/.test(src.slice(Math.max(0, j - 7), j + 1));
}

/* `src` (comments already blanked) with the inside of every string, template literal and regex blanked to spaces,
   positions kept: a ( or ) inside a literal must not count when the end of a .route( call is matched (#6027). */
function blankLiterals(src) {
  const out = src.split('');
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j += 1; else if (c !== '`' && src[j] === '\n') break; j += 1; }
      for (let k = i + 1; k < j && k < src.length; k += 1) if (out[k] !== '\n') out[k] = ' ';
      i = j + 1;
    } else if (c === '/' && src[i + 1] !== '/' && src[i + 1] !== '*' && regexStart(src, i)) {
      let j = i + 1; let cls = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break;
        j += 1;
      }
      for (let k = i + 1; k < j && k < src.length; k += 1) out[k] = ' ';
      i = j + 1;
    } else i += 1;
  }
  return out.join('');
}

/* The index of the ) that closes the .route( call starting at `at` (in literal-blanked source), or the source end. */
function routeEnd(blank, at) {
  const open = blank.indexOf('(', at);
  let depth = 0;
  for (let i = open; i < blank.length; i += 1) {
    const ch = blank[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') { depth -= 1; if (depth === 0) return i; }
  }
  return blank.length;
}

/* The innermost function nested after `from` whose body contains `at` (an arrow, block or concise, or a function
   expression), as { open, end }, or null (#6027 review 4: an answer in any nested function can run later). */
function nestedFn(blank, from, at) {
  let best = null;
  const re = /=>|\bfunction\b[^(]*\(/g;
  re.lastIndex = from;
  let m;
  while ((m = re.exec(blank)) && m.index < at) {
    let i = m.index + m[0].length;
    if (m[0] !== '=>') {   // function (...) {: skip the parameters to the body
      let d = 1;
      for (; i < blank.length && d > 0; i += 1) { if (blank[i] === '(') d += 1; else if (blank[i] === ')') d -= 1; }
    }
    while (i < blank.length && /\s/.test(blank[i])) i += 1;
    let end;
    if (blank[i] === '{') end = blockEnd(blank, i);
    else {   // a concise body: to the comma, semicolon or closing bracket that ends the expression
      let d = 0; end = blank.length;
      for (let j = i; j < blank.length; j += 1) {
        const ch = blank[j];
        if ('([{'.includes(ch)) d += 1;
        else if (')]}'.includes(ch)) { if (d === 0) { end = j; break; } d -= 1; }
        else if ((ch === ',' || ch === ';') && d === 0) { end = j; break; }
      }
    }
    if (end > at) best = { open: i, end };
  }
  return best;
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
  const seg = src.slice(i + 1, at);
  let k = -1;
  for (const m of seg.matchAll(/\bawait\b/g)) k = m.index;
  if (k < 0) return false;
  // That await must cover the call: no ? : , || or && at its own level between them (round 3).
  let d = 0;
  for (let j = k + 5; j < seg.length; j += 1) {
    const ch = seg[j];
    if ('([{'.includes(ch)) d += 1; else if (')]}'.includes(ch)) d -= 1;
    else if (d === 0 && ('?:,'.includes(ch) || (ch === '|' && seg[j + 1] === '|') || (ch === '&' && seg[j + 1] === '&'))) return false;
  }
  return true;
}

function insideOpenTry(src, from, at) {
  const seg = src.slice(from, at);
  let t = -1;
  for (const m of seg.matchAll(/\btry\b/g)) t = m.index;   // the word try, not retry or entry (round 2)
  if (t < 0) return false;
  const open = seg.indexOf('{', t);
  if (open < 0 || !/^try\s*$/.test(seg.slice(t, open))) return insideOpenTry(src, from, from + t);
  // An inner try that already closed may sit inside an outer one that is still open: keep walking back.
  // Inside the try's own block (not its catch, round 3), and the block must be followed by a catch (a finally alone
  // lets the rejection through, round 1).
  const e = blockEnd(src, from + open);
  if (e > 0 && from + open < at && at < e && /^\s*catch\b/.test(src.slice(e))) return true;
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
  const blank = blankLiterals(src);
  while ((m = HANDLER.exec(src))) starts.push({ at: m.index, body: m.index + m[0].length, end: routeEnd(blank, m.index), param: m[1] || m[2] || m[3] });
  // A .route( the pattern could not read, whose handler fetches, is a finding (fails RED, round 3): a comma in an
  // unquoted pattern, a handler passed by name, any shape the pattern does not know.
  const read = new Set(starts.map((h) => h.at));
  // A handler passed by name (`page.route(url, stampAge)`) is checked at its definition (`const stampAge = async (r) =>`
  // or `function stampAge(r)`), by the same rules (after #6024 added two such handlers).
  for (const r of src.matchAll(/\.route\(\s*(?:'[^'\n]*'|"[^"\n]*"|`[^`]*`|[^,'"`]){1,300},\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    const name = r[1].replace(/[$]/g, '\\$&');   // escaped: a $ in a name is not an anchor (review)
    const defRe = new RegExp('\\b(?:(?:const|let|var)\\s+' + name + '\\s*=\\s*(?:async\\s+)?(?:\\(\\s*(\\w+)[^)]*\\)|(\\w+))\\s*=>|(?:async\\s+)?function\\s+' + name + '\\s*\\(\\s*(\\w+))', 'g');
    let found = false;
    for (const def of src.matchAll(defRe)) {   // every definition of the name, not only the first (review)
      if (!starts.some((h) => h.at === def.index)) starts.push({ at: def.index, param: def[1] || def[2] || def[3] });
      found = true;
    }
    if (found) read.add(r.index);
  }
  starts.sort((x, y) => x.at - y.at);
  for (const r of src.matchAll(/\.route\(/g)) {
    if (read.has(r.index)) continue;
    const span = src.slice(r.index, routeEnd(blank, r.index));
    const cbAnswer = /(?:\bsetTimeout|\bsetInterval|\bsetImmediate|\bqueueMicrotask|\bnextTick|\.then|\.finally|\.catch)\s*\([^]*\.(fulfill|continue|fallback)\(/.test(span);
    if (/\.fetch\(/.test(span) || cbAnswer || (/\bawait\b/.test(span) && /\.(fulfill|continue|fallback)\(/.test(span))) bad.push(src.slice(0, r.index).split('\n').length);
  }
  starts.forEach((h) => {
    const end = h.end;   // the ) that closes this .route( call (#6027), not the next .route(
    const body = src.slice(h.body, end);
    // From the handler's first fetch or first await on (#6027): an answer after it can land after the browser closed.
    // An answer before any await is immediate and cannot.
    // An await whose operand IS the answer (`await r.fulfill(`, `return await (x ? r.fulfill(`) does not delay it.
    // Only when the answer IS the await's operand: `await r.fulfill(` or `await (cond ? r.fulfill(` (review 1: not an
    // answer inside .then(, a callback, or after a comma).
    const answerNext = new RegExp('^await\\s*(?:\\(\\s*[^;{}(),=>]*?\\?\\s*)?(?:' + h.param + '\\.(fulfill|continue|fallback|abort)|[A-Za-z_$][\\w$]*\\(\\s*' + h.param + '\\s*[,)])');
    // The ) that closes the call starting at `at`, and whether a .catch( follows it.
    const callClose = (at) => routeEnd(blank, at);
    const catchesAfter = (close) => /^\s*\.catch\(/.test(src.slice(close + 1, close + 40));
    let firstWait = -1;
    for (const w of body.matchAll(/\bawait\b/g)) {
      const rest = body.slice(w.index);
      const stmt = rest.slice(0, rest.search(/[;{}]|$/) + 1);
      if (!answerNext.test(stmt)) { firstWait = w.index; break; }
      // The answer IS the operand, but an await inside its own arguments runs first, so the answer is late (review 2).
      const call = h.body + w.index + rest.search(new RegExp('\\b' + h.param + '\\.|\\b[A-Za-z_$][\\w$]*\\(\\s*' + h.param + '\\s*[,)]'));
      if (/\bawait\b/.test(src.slice(call, callClose(call)))) { firstWait = w.index; break; }
    }
    // An answer inside a scheduled or chained callback is late too, await or not (review 1, widened in review 2): an
    // outer try cannot catch a rejection from a callback, so the answer, or the callback's own call, must chain .catch,
    // or the answer must be awaited inside a try inside the callback.
    const cbAns = new RegExp('\\b' + h.param + '\\.(fulfill|continue|fallback|abort)\\(', 'g');
    const CB = /(?:\bsetTimeout|\bsetInterval|\bsetImmediate|\bqueueMicrotask|\bprocess\.nextTick|\.then|\.finally|\.catch)\s*\(/g;
    // Every answer (and every helper handed the route) inside a function nested in the handler can run later: a timer,
    // a .then, a parked callback, a helper scheduled by name (review 4). It needs its own .catch, an awaited try inside
    // that function, or to be returned to a callback chain that ends in .catch.
    const helperCall = new RegExp('\\b(?!' + h.param + '\\b)([A-Za-z_$][\\w$]*)\\(\\s*' + h.param + '\\s*[,)]', 'g');
    const lateCandidates = [...body.matchAll(cbAns)].map((x) => h.body + x.index)
      .concat([...body.matchAll(helperCall)].map((x) => h.body + x.index));
    const cleared = new Set();
    // The route's name re-bound as a parameter of the nested function (`new Promise((r) => setTimeout(r, 300))` in a
    // handler whose own parameter is r) is not the route (review 5).
    const rebound = (fn) => fn && new RegExp('(?:^|[(,]\\s*)' + h.param + '\\s*(?:[,)=]|$)').test(src.slice(Math.max(h.body, fn.open - 120), fn.open).replace(/^[^]*?(\([^()]*\)|\w+)\s*=>\s*\{?\s*$/, '$1'));
    for (const at of lateCandidates) {
      const fn = nestedFn(blank, h.body, at);
      if (!fn) continue;
      if (rebound(fn)) { cleared.add(at); continue; }
      if (catchesAfter(callClose(at))) continue;
      if (insideOpenTry(src, fn.open, at) && awaited(src, at)) continue;
      let chainCaught = false;
      for (const cb of src.slice(h.body, at).matchAll(CB)) {
        const open = h.body + cb.index + cb[0].length - 1;
        const close = routeEnd(blank, open - 1);
        if (close <= at) continue;
        const lead = src.slice(open + 1, at);
        const returned = /^\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>\s*\(?\s*$/.test(lead) || /\breturn\s+(?:await\s+)?$/.test(lead);
        if (returned && catchesAfter(close)) chainCaught = true;
      }
      if (chainCaught) cleared.add(at); else bad.push(src.slice(0, at).split('\n').length);
    }
    const hits = [body.search(new RegExp('\\b' + h.param + '\\.fetch\\(')), firstWait].filter((x) => x >= 0);
    if (!hits.length) return;
    const first = Math.min(...hits);
    const re = new RegExp('\\b' + h.param + '\\.(fetch|fulfill|continue|fallback|abort)\\(', 'g');
    re.lastIndex = h.body + first;
    let f;
    // A call that hands the route to a helper (`answer(route, x)`) answers through it (review 3): the same rules.
    const helper = new RegExp('\\b(?!' + h.param + '\\b)([A-Za-z_$][\\w$]*)\\(\\s*' + h.param + '\\s*[,)]', 'g');
    helper.lastIndex = h.body + first;
    let hf;
    while ((hf = helper.exec(src)) && hf.index < end) {
      if (cleared.has(hf.index) || rebound(nestedFn(blank, h.body, hf.index))) continue;
      if (catchesAfter(callClose(hf.index))) continue;
      if (!insideOpenTry(src, h.at, hf.index) || !awaited(src, hf.index)) bad.push(src.slice(0, hf.index).split('\n').length);
    }
    while ((f = re.exec(src)) && f.index < end) {
      const line = src.slice(0, f.index).split('\n').length;
      if (f[1] === 'abort') {
        // The catch runs when the page may be gone, so its abort rejects too: it must chain its own .catch (round 2).
        if (!catchesAfter(callClose(f.index))) bad.push(line);
        continue;
      }
      // An answer that chains its own .catch( handles its rejection (Baron's #6023 shape), try or not; an answer the
      // nested pass cleared (returned to a .catch chain) is handled too (review 5).
      if (cleared.has(f.index)) continue;
      if (f[1] !== 'fetch' && catchesAfter(callClose(f.index))) continue;
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
  assert.deepEqual(scan(thenChain), [2, 2, 2], 'a floating .then chain is not awaited (round 1), and its fulfill sits in a .then callback (#6027)');
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
  const retryInCatch = "await page.route('**/x', async (r) => {\n  try {\n    const res = await r.fetch();\n    await r.fulfill({ response: res });\n  } catch {\n    const again = await r.fetch();\n    await r.fulfill({ response: again });\n  }\n});\n";
  assert.deepEqual(scan(retryInCatch), [6, 7], 'a retry inside the catch is not inside the try (round 3)');
  const commaGlob = "await page.route('**/api/{status,projects}', async (r) => {\n  const res = await r.fetch();\n  await r.fulfill({ response: res });\n});\n";
  assert.deepEqual(scan(commaGlob), [2, 3], 'a quoted glob with a comma is read (round 3)');
  const unreadable = "await page.route(/api\\/x{1,2}/, async (r) => {\n  const res = await r.fetch();\n  await r.fulfill({ response: res });\n});\n";
  assert.ok(scan(unreadable).length > 0, 'a route the pattern cannot read, whose handler fetches, is flagged, not skipped (round 3)');
  const halfAwaited = "await page.route('**/x', async (r) => {\n  try {\n    const res = await r.fetch();\n    return ok ? await r.fulfill({ response: res }) : r.fulfill({ response: res });\n  } catch { await r.abort().catch(() => {}); }\n});\n";
  assert.deepEqual(scan(halfAwaited), [4], 'an await on one branch does not cover the other (round 3)');
  const timerFirst = "await page.route('**/x', async (r) => {\n  await new Promise((res) => setTimeout(res, 8000));\n  await r.fulfill({ json: {} });\n});\n";
  assert.deepEqual(scan(timerFirst), [3], 'an answer after a timer can land after close (#6027)');
  const heldFirst = "await page.route('**/x', async (r) => {\n  await gate;\n  r.fulfill({ json: {} });\n});\n";
  assert.deepEqual(scan(heldFirst), [3], 'an answer after a held promise, unawaited, is flagged (#6027)');
  const immediate = "await page.route('**/x', async (r) => {\n  if (r.request().method() !== 'GET') return await r.continue();\n  await r.fulfill({ json: {} });\n});\n";
  assert.deepEqual(scan(immediate), [], 'an answer awaited directly, with nothing awaited before it, is immediate (#6027)');
  const chained = "await page.route('**/x', async (r) => {\n  await gate;\n  await r.fulfill({ json: {} }).catch(() => {});\n});\n";
  assert.deepEqual(scan(chained), [], 'an answer that chains its own .catch handles its rejection (#6027)');
  const spanEnds = "await page.route('**/x', (r) => r.fulfill({ json: {} }));\nawait page.goto(URL);\nconst r = page;\nr.fulfill({ json: 1 });\n";
  assert.deepEqual(scan(spanEnds), [], 'a handler ends at its own closing paren; later code is not part of it (#6027)');
  const timerCallback = "await page.route('**/x', (r) => {\n  setTimeout(() => r.fulfill({ status: 400 }), 1500);\n});\n";
  assert.deepEqual(scan(timerCallback), [2], 'an answer in a setTimeout callback is late, await or not (#6027 review 1)');
  const timerCaught = "await page.route('**/x', (r) => {\n  setTimeout(() => r.fulfill({ status: 400 }).catch(() => {}), 1500);\n});\n";
  assert.deepEqual(scan(timerCaught), [], 'a late answer in a callback that chains its own .catch passes');
  const gateThen = "await page.route('**/x', async (r) => {\n  await gate.then(() => r.fulfill({ json: {} }));\n});\n";
  assert.deepEqual(scan(gateThen), [2, 2], 'an answer inside .then( after a wait: a callback answer, and not the await operand (#6027 review 1)');
  const commaAwait = "await page.route('**/x', async (r) => {\n  await (await gate, r.fulfill({}));\n});\n";
  assert.ok(scan(commaAwait).length > 0, 'an answer after a comma inside an await is not exempt (#6027 review 1)');
  const regexParens = "await page.route('**/x', async (r) => {\n  const ok = (u) => /\\)\\)/.test(u);\n  await gate;\n  r.fulfill({});\n});\n";
  assert.deepEqual(scan(regexParens), [4], 'parens inside a regex after => do not end the handler early (#6027 review 1)');
  const awaitInArgs = "await page.route('**/x', async (r) => {\n  await r.fulfill({ json: await load() });\n});\n";
  assert.deepEqual(scan(awaitInArgs), [2], 'an await inside the answer\'s own arguments makes the answer late (#6027 review 2)');
  const interval = "await page.route('**/x', (r) => {\n  setInterval(() => r.fulfill({}), 100);\n});\n";
  assert.deepEqual(scan(interval), [2], 'an answer in a setInterval callback is late (#6027 review 2)');
  const outerCatch = "await page.route('**/x', (r) => {\n  gate.then(() => r.fulfill({})).catch(() => {});\n});\n";
  assert.deepEqual(scan(outerCatch), [], 'a .catch on the callback chain handles the answer (#6027 review 2)');
  const triedInCb = "await page.route('**/x', (r) => {\n  setTimeout(async () => { try { await r.fulfill({}); } catch {} }, 100);\n});\n";
  assert.deepEqual(scan(triedInCb), [], 'an answer awaited in a try inside the callback is handled (#6027 review 2)');
  const deepArgs = "await page.route('**/x', async (r) => {\n  await gate;\n  await r.fulfill({ json: { a: f(g(h(i(1)))) } }).catch(() => {});\n});\n";
  assert.deepEqual(scan(deepArgs), [], 'a .catch after deeply nested arguments is found by paren matching (#6027 review 2)');
  const helperAnswer = "await page.route('**/x', async (route) => {\n  await new Promise((r) => { held.push(r); });\n  await answer(route, {});\n});\n";
  assert.deepEqual(scan(helperAnswer), [3], 'an answer through a helper after a wait is late (#6027 review 3)');
  const helperImmediate = "await page.route('**/x', async (route) => {\n  await answer(route, {});\n});\n";
  assert.deepEqual(scan(helperImmediate), [], 'a helper answer awaited with nothing before it is immediate');
  const blockDrop = "await page.route('**/x', (r) => {\n  gate.then(() => { r.fulfill({}); }).catch(() => {});\n});\n";
  assert.deepEqual(scan(blockDrop), [2], 'a block callback that drops the answer is not covered by the chain .catch (#6027 review 3)');
  const voidDrop = "await page.route('**/x', (r) => {\n  gate.then(() => void r.fulfill({})).catch(() => {});\n});\n";
  assert.deepEqual(scan(voidDrop), [2], 'a void answer is dropped, not returned (#6027 review 3)');
  const catchFallback = "await page.route('**/x', (r) => {\n  gate.catch(() => r.fulfill({ status: 500 }));\n});\n";
  assert.deepEqual(scan(catchFallback), [2], 'an answer in a .catch( callback is late too (#6027 review 3)');
  const unreadTimer = "await page.route(/api\\/x{1,2}/, (r) => { setTimeout(() => r.fulfill({}), 1500); });\n";
  assert.ok(scan(unreadTimer).length > 0, 'an unreadable route with a callback answer is flagged (#6027 review 3)');
  const scheduledByName = "await page.route('**/x', (r) => {\n  const f = () => r.fulfill({});\n  setTimeout(f, 2500);\n});\n";
  assert.deepEqual(scan(scheduledByName), [2], 'a helper defined first and scheduled by name is a nested answer (#6027 review 4)');
  const parked = "await page.route('**/x', (r) => {\n  held.push(() => r.fulfill({}));\n});\n";
  assert.deepEqual(scan(parked), [2], 'a parked callback answer is nested (#6027 review 4)');
  const helperCaught = "await page.route('**/x', (r) => {\n  const json = (b) => r.fulfill({ json: b }).catch(() => {});\n  setTimeout(() => json({}), 2500);\n});\n";
  assert.deepEqual(scan(helperCaught), [], 'a nested answer that catches its own rejection passes');
  const reboundWait = "await page.route('**/x', async (r) => {\n  try {\n    await new Promise((r) => setTimeout(r, 300));\n    await r.fulfill({});\n  } catch { await r.abort().catch(() => {}); }\n});\n";
  assert.deepEqual(scan(reboundWait), [], 'a wait whose resolver is also named r does not hand the route away (#6027 review 5)');
  const chainAfterWait = "await page.route('**/x', async (r) => {\n  await gate;\n  other.then(() => r.fulfill({})).catch(() => {});\n});\n";
  assert.deepEqual(scan(chainAfterWait), [], 'an answer returned to a .catch chain after a wait is handled (#6027 review 5)');
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

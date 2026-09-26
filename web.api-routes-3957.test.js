'use strict';

/**
 * #3957: the page must not call an /api route the board does not serve.
 *
 * 0.6.96 shipped a page that called /api/federation/invite while the board route for it arrived in
 * a LATER merge (#3312 then 81f1eed5c), and the cut landed between them: Josh got "Kosmos could
 * not make a code just now". Nothing on the way could notice, because the page and the board are
 * tested separately. This reads both and refuses a page fetch whose path no board route matches,
 * so the UI PR goes red at merge time, before any cut.
 *
 * WHAT IT READS, stated so nobody over-trusts it:
 *   - the page: every `fetch(` in web/index.html whose first argument begins with a quoted '/api/'
 *     literal. A dynamic piece (`' + x + '`, `${x}`) becomes one placeholder segment, and a query
 *     string is dropped. A fetch whose URL is not a literal from its first character (a variable,
 *     a helper) is NOT read, and neither is one whose tail is a variable (`'/task/' + id + url`);
 *     both are counted and printed so a drop is visible.
 *   - the board: every '/api/...' string literal and every regex literal containing \/api\/ in
 *     server.js. A page path is served if it equals a literal, or a regex matches it.
 *   - a placeholder segment counts as served when SOME value makes it a route (a board literal with
 *     any segment there, a number, or a regex's enumerated word). Permissive, so a per-provider route the
 *     page reaches with a name the board lacks is not caught.
 *   - NOT the method. A GET page calling a POST-only route passes here; the board then answers
 *     "no such endpoint" at run time. The 0.6.96 defect was a route that did not exist at all.
 *
 *   node --test web.api-routes-3957.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SERVER = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');

/* Deliberate exceptions, each with its reason. An entry is a claim someone can check. */
const SERVED_ELSEWHERE = {
};

/** The /api paths the page fetches, as concrete example paths with dynamic parts filled in. */
function pagePaths(src) {
  const out = new Set();
  const unreadable = new Set(); // a variable tail: counted and printed, never checked
  let unread = 0;
  const re = /fetch\(\s*/g;
  let m;
  while ((m = re.exec(src))) {
    const at = m.index + m[0].length;
    const q = src[at];
    if (q !== "'" && q !== '"' && q !== '`') { unread += 1; continue; }
    /* Walk the URL expression: literal pieces joined by `+ expr +`, or a template literal. */
    let path = '';
    let i = at;
    let openEnded = false;
    if (q === '`') {
      const end = src.indexOf('`', i + 1);
      path = src.slice(i + 1, end).replace(/\$\{[^}]*\}/g, '\u0000');
    } else {
      for (;;) {
        const qq = src[i];
        if (qq !== "'" && qq !== '"') break;
        const end = src.indexOf(qq, i + 1);
        path += src.slice(i + 1, end);
        i = end + 1;
        const rest = src.slice(i, i + 400);
        const plus = rest.match(/^\s*\+\s*/);
        if (!plus) break;
        i += plus[0].length;
        if (src[i] === "'" || src[i] === '"') continue;
        /* A dynamic piece (`encodeURIComponent(name)`, `a ? b : c`): skip it with a paren-balanced
           scan to the next top-level `+ '`, or stop at the argument's end. A pattern that stopped
           at the first `)` lost the suffix of nearly every call and collapsed them into one path. */
        path += '\u0000';
        let depth = 0;
        let j = i;
        let resumed = false;
        for (; j < src.length && j < i + 600; j += 1) {
          const c = src[j];
          if (c === '(' || c === '[' || c === '{') depth += 1;
          else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth -= 1; }
          else if (c === ',' && depth === 0) break;
          else if (c === "'" || c === '"' || c === '`') {
            if (depth === 0) break;
            const close = src.indexOf(c, j + 1);
            if (close < 0) break;
            j = close;
          } else if (c === '+' && depth === 0) {
            const after = src.slice(j + 1).match(/^\s*/)[0].length;
            const nc = src[j + 1 + after];
            if (nc === "'" || nc === '"') { i = j + 1 + after; resumed = true; break; }
            openEnded = true; // `+ id + suffixVar`: whatever follows is only known at run time
          }
        }
        if (!resumed) break;
      }
    }
    if (!path.startsWith('/api/')) continue;
    if (openEnded) { unreadable.add(path.split('?')[0].replace(/\u0000+/g, 'x') + '...'); continue; }
    path = path.split('?')[0];
    /* A dynamic piece glued on WITHOUT a `/` before it (`'/api/folders' + qs`) is a query or a
       suffix, not a path segment: the path ends where it starts. */
    const glued = path.search(/[^/\u0000]\u0000/);
    if (glued > -1) path = path.slice(0, glued + 1);
    path = path.replace(/\u0000+/g, 'x');
    out.add(path);
  }
  return { paths: [...out].sort(), unread, unreadable: [...unreadable].sort() };
}

/** The board's routes: exact literals, prefixes, and regexes. */
function boardRoutes(src) {
  const literals = new Set((src.match(/'\/api\/[A-Za-z0-9/_.-]*'/g) || []).map((s) => s.slice(1, -1)));
  /* A PREFIX only where the board itself tests one with startsWith, and never the bare '/api/':
     that is the "no such endpoint" catch-all, and counting it would serve every path. */
  const prefixes = [...src.matchAll(/startsWith\('(\/api\/[A-Za-z0-9/_.-]+)'\)/g)].map((m) => m[1]);
  const regexes = [];
  /* Regex literals are scanned by hand, because a route regex carries `[^/]`: a `/` inside a
     character class does not end the literal, and a naive pattern stops there (it found 4 of 53). */
  let from = 0;
  for (;;) {
    const at = src.indexOf('/^\\/api\\/', from);
    if (at < 0) break;
    let i = at + 1;
    let inClass = false;
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (c === '\\') { i += 1; continue; }
      if (c === '\n') break;
      if (inClass) { if (c === ']') inClass = false; continue; }
      if (c === '[') { inClass = true; continue; }
      if (c === '/') break;
    }
    const flags = (src.slice(i + 1).match(/^[gimsuy]*/) || [''])[0];
    try { regexes.push(new RegExp(src.slice(at + 1, i), flags.replace('g', ''))); } catch { /* not a regex after all */ }
    from = i + 1;
  }
  return { literals, prefixes, regexes };
}

/* The words a route regex enumerates, `(allow|deny|remove)`, so a page placeholder can stand for one. */
function alternatives(board) {
  const words = new Set();
  for (const r of board.regexes) for (const m of r.source.matchAll(/\(((?:[a-z0-9-]+\|)+[a-z0-9-]+)\)/g)) m[1].split('|').forEach((w) => words.add(w));
  return [...words];
}

function served(p, board) {
  if (board.literals.has(p)) return true;
  if (board.prefixes.some((l) => p.startsWith(l))) return true;
  if (board.regexes.some((r) => r.test(p))) return true;
  if (!/\/x(\/|$)/.test(p)) return false;
  /* A placeholder segment (a value only known at run time) is served when SOME value makes it a
     route: a board literal with any single segment there (`/api/accounts/openai` for
     `/api/accounts/x`), or a regex with one of its enumerated words there. This is permissive by
     design and said so: it cannot tell that a provider the page names has no route of its own. */
  const shape = new RegExp('^' + p.split('/').map((seg) => (seg === 'x' ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/') + '$');
  for (const l of board.literals) if (shape.test(l)) return true;
  /* Values a placeholder may stand for: a number (ids are often `(\d+)`) and each enumerated word,
     in every placeholder, and a number everywhere with a word in the LAST one (`task/1/close`). */
  const words = ['1', ...alternatives(board)];
  const tries = [];
  for (const w of words) tries.push(p.replace(/\/x(?=\/|$)/g, '/' + w));
  const lastX = p.lastIndexOf('/x');
  for (const w of words) tries.push(p.slice(0, lastX).replace(/\/x(?=\/|$)/g, '/1') + '/' + w + p.slice(lastX + 2));
  return tries.some((t) => board.regexes.some((r) => r.test(t)));
}

test('#3957: every /api path the page fetches is served by a board route', () => {
  const { paths, unread, unreadable } = pagePaths(PAGE);
  const board = boardRoutes(SERVER);
  console.log(`page paths read: ${paths.length}; fetches not read (URL not a literal): ${unread}; with a variable tail, NOT checked: ${unreadable.length} (${unreadable.join(', ')}); board literals ${board.literals.size}, prefixes ${board.prefixes.length}, regexes ${board.regexes.length}`);
  assert.ok(paths.length >= 50, 'the extractor read almost nothing from the page; it is broken, not the page');
  assert.ok(board.regexes.length >= 40, 'the board extractor found almost no route regexes (' + board.regexes.length + '); it is broken, not the board');
  const missing = paths.filter((p) => !served(p, board) && !SERVED_ELSEWHERE[p]);
  assert.deepEqual(missing, [],
    'the page calls /api paths no board route serves. Either add the route in the SAME change, or '
    + '(only if it is served by something else) list it in SERVED_ELSEWHERE with the reason:\n  ' + missing.join('\n  '));
});

test('#3957: every SERVED_ELSEWHERE entry is still called by the page, so the list cannot rot', () => {
  const { paths } = pagePaths(PAGE);
  const stale = Object.keys(SERVED_ELSEWHERE).filter((p) => !paths.includes(p));
  assert.deepEqual(stale, [], 'an exception the page no longer needs: remove it');
});

test('#3957 control: a page fetch of a route the board lacks is caught', () => {
  const board = boardRoutes(SERVER);
  const planted = pagePaths(PAGE + "\nfetch('/api/no-such-thing-3957/' + id + '/go', { method: 'POST' });\n").paths;
  assert.ok(planted.includes('/api/no-such-thing-3957/x/go'), 'the extractor did not read the planted fetch: ' + planted.filter((p) => p.includes('3957')));
  assert.equal(served('/api/no-such-thing-3957/x/go', board), false, 'a route that does not exist read as served');
});

test('#3957 control: the 0.6.96 invite call is caught against a board without its route', () => {
  const board = boardRoutes(SERVER);
  assert.equal(served('/api/federation/invite', board), true, 'precondition: today the board serves it');
  const without = boardRoutes(SERVER.split('/api/federation/invite').join('/api/federation/inv1te'));
  assert.equal(served('/api/federation/invite', without), false, 'with the route renamed away, the call must read as unserved');
});

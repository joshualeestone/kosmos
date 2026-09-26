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
 *   - the page: every quoted '/api/' literal in web/index.html's CODE (comments skipped), whether it
 *     is a fetch( argument or goes through a helper, a table or a `url:` field. A dynamic piece (`' + x + '`, `${x}`) becomes one placeholder segment, and a query
 *     string is dropped. A fetch whose URL is not a literal from its first character (a variable,
 *     a helper) is NOT read, and neither is one whose tail is a variable (`'/task/' + id + url`);
 *     both are counted and printed so a drop is visible.
 *   - the board: '/api/...' literals the server COMPARES the path to (=== / case), startsWith
 *     prefixes, and regex literals containing \/api\/, all outside comments. A page path is served if it equals a literal, or a regex matches it.
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

/* Measured 2026-09-26 on main. Growth reds; shrinking is fine (lower these when it happens). */
const UNREAD_CEILING = 20;
const UNREADABLE_CEILING = 1;

/* A lexical mask over a source text: CODE, COMMENT, STRING (inside a string literal), START (the
   opening quote of one) and REGEX (a regex literal). One pass, so a quote inside a comment, a `//` inside a string, and a
   template literal spanning lines are each classified by what they really are. A template's
   `${...}` is treated as part of the string (an /api call INSIDE an interpolation is not read). */
const CODE = 0; const COMMENT = 1; const STRING = 2; const START = 3; const REGEX = 4;
/* Can a `/` at i open a regex literal? Yes after an operator, an opening bracket, a comma, a colon,
   a semicolon, `return`/`typeof`-style keywords, or at the start of a line; no after a value
   (an identifier, a number, `)` or `]`), where it divides. */
function regexCanStart(src, i) {
  let k = i - 1;
  while (k >= 0 && (src[k] === ' ' || src[k] === '\t')) k -= 1;
  if (k < 0 || src[k] === '\n') return true;
  if ('(,=:[!&|?{};+-*%<>~^'.includes(src[k])) return true;
  const word = src.slice(Math.max(0, k - 10), k + 1).match(/[A-Za-z_$]+$/);
  return !!(word && /^(return|typeof|case|in|of|new|delete|void|throw|else|do)$/.test(word[0]));
}
function lexMask(src) {
  const mask = new Uint8Array(src.length);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      mask[i] = START;
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (c !== '`' && src[j] === '\n') break; // a quote/double-quote string ends at a line break
        if (src[j] === '\\') { mask[j] = STRING; j += 1; }
        if (j < src.length) mask[j] = STRING;
        j += 1;
      }
      if (j < src.length) mask[j] = STRING;
      i = j + 1;
    } else if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? src.length : e + 2;
      mask.fill(COMMENT, i, end);
      i = end;
    } else if (c === '/' && src[i + 1] === '/') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? src.length : e;
      mask.fill(COMMENT, i, end);
      i = end;
    } else if (c === '/' && regexCanStart(src, i)) {
      /* A regex literal: skipped whole (outside a character class a `/` ends it), so a quote or a
         backtick inside one, /['"`]/, cannot open a phantom string that swallows the file. */
      let j = i + 1;
      let inClass = false;
      for (; j < src.length && src[j] !== '\n'; j += 1) {
        const d = src[j];
        if (d === '\\') { j += 1; continue; }
        if (inClass) { if (d === ']') inClass = false; continue; }
        if (d === '[') { inClass = true; continue; }
        if (d === '/') break;
      }
      mask.fill(REGEX, i, Math.min(j + 1, src.length));
      i = j + 1;
    } else i += 1;
  }
  return mask;
}

/** The /api paths the page reaches, as concrete example paths with dynamic parts filled in. */
function pagePaths(src) {
  const out = new Set();
  const unreadable = new Set(); // a variable tail: counted and printed, never checked
  let unread = 0;
  /* fetch( calls whose URL is not a literal at all: counted, since they cannot be read. */
  for (const f of src.matchAll(/fetch\(\s*(.)/g)) if (!"'\"`".includes(f[1])) unread += 1;
  /* Every quoted '/api/' literal in CODE, not only fetch( arguments: the page also reaches the
     board through helpers (a post wrapper, a table of endpoints, a `url:` field), and a UI merged
     ahead of its route through one of those is the same defect. Comments are skipped. */
  const mask = lexMask(src);
  const re = /['"`]\/api\//g;
  let m;
  while ((m = re.exec(src))) {
    const at = m.index;
    if (mask[at] !== START) continue; // inside a comment, or quoted text inside another string
    /* A literal the page only COMPARES against (`api.startsWith('/api/svc/')`, `=== '/api/x'`) names
       no request, so it is not a call to check. */
    if (/(?:startsWith|endsWith|includes|indexOf)\(\s*$|[=!]==?\s*$/.test(src.slice(Math.max(0, at - 24), at))) continue;
    const q = src[at];
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
  const mask = lexMask(src);
  const inCode = (i) => mask[i] === CODE;
  /* A literal counts as a ROUTE only where the board compares the path to it (`=== '/api/..'`,
     `'/api/..' ===`, a `case`), not anywhere it is merely mentioned: a comment, a log line or an
     outbound URL naming a route that does not exist yet must not serve it. */
  const literals = new Set();
  for (const m of src.matchAll(/(?:===\s*|case\s+)'(\/api\/[A-Za-z0-9/_.-]*)'|'(\/api\/[A-Za-z0-9/_.-]*)'\s*===/g)) {
    /* The literal's own opening quote must be a real string start, and the comparison around it
       must be CODE: `console.log("x === '/api/y'")` names no route. */
    const q = m.index + m[0].indexOf("'");
    const op = m[0].indexOf('===') > -1 ? m.index + m[0].indexOf('===') : m.index;
    if (mask[q] === START && inCode(op)) literals.add(m[1] || m[2]);
  }
  /* A PREFIX only where the board itself tests one with startsWith, and never the bare '/api/':
     that is the "no such endpoint" catch-all, and counting it would serve every path. */
  const prefixes = [...src.matchAll(/startsWith\('(\/api\/[A-Za-z0-9/_.-]+)'\)/g)].filter((m) => inCode(m.index)).map((m) => m[1]);
  const regexes = [];
  /* Regex literals are scanned by hand, because a route regex carries `[^/]`: a `/` inside a
     character class does not end the literal, and a naive pattern stops there (it found 4 of 55). */
  let from = 0;
  for (;;) {
    const at = src.indexOf('/^\\/api\\/', from);
    if (at < 0) break;
    if (mask[at] !== REGEX) { from = at + 1; continue; } // a real regex literal, not text about one
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

/* The two real parses, once per process: the controls parse MODIFIED copies and keep doing so. */
let BASE_PAGE = null; let BASE_BOARD = null;
const basePage = () => (BASE_PAGE = BASE_PAGE || pagePaths(PAGE));
const baseBoard = () => (BASE_BOARD = BASE_BOARD || boardRoutes(SERVER));

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
  const { paths, unread, unreadable } = basePage();
  const board = baseBoard();
  console.log(`page paths read: ${paths.length}; fetches not read (URL not a literal): ${unread}; with a variable tail, NOT checked: ${unreadable.length} (${unreadable.join(', ')}); board literals ${board.literals.size}, prefixes ${board.prefixes.length}, regexes ${board.regexes.length}`);
  /* A FLOOR near today's count (186), not a token one: a lexer slip that mis-reads a region drops
     real calls SILENTLY (one did, 193 -> 171, taking the federation routes with it), and a floor of
     50 could not see it. Lower it only when the page genuinely loses calls. */
  assert.ok(paths.length >= 170, `the extractor read ${paths.length} paths (floor 170); a region of the page is being mis-read, not the page shrinking`);
  assert.ok(board.regexes.length >= 40, 'the board extractor found almost no route regexes (' + board.regexes.length + '); it is broken, not the board');
  /* CEILINGS, not just a printout: a green log is read by nobody. A new fetch whose URL is a variable,
     or a new variable-tailed one, cannot be checked here, so it has to be a deliberate change: make
     the URL readable, or raise the ceiling with a reason in the commit. */
  assert.ok(unread <= UNREAD_CEILING, `fetches whose URL is not a literal grew to ${unread} (ceiling ${UNREAD_CEILING}); make the new one's URL a literal, or raise the ceiling with a reason`);
  assert.ok(unreadable.length <= UNREADABLE_CEILING, `fetches with a variable tail grew to ${unreadable.length} (ceiling ${UNREADABLE_CEILING}): ${unreadable.join(', ')}`);
  const missing = paths.filter((p) => !served(p, board) && !SERVED_ELSEWHERE[p]);
  assert.deepEqual(missing, [],
    'the page calls /api paths no board route serves. Either add the route in the SAME change, or '
    + '(only if it is served by something else) list it in SERVED_ELSEWHERE with the reason:\n  ' + missing.join('\n  '));
});

test('#3957: every SERVED_ELSEWHERE entry is still called by the page, so the list cannot rot', () => {
  const { paths } = basePage();
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

test('#3957 KNOWN LIMIT, pinned: a placeholder segment is served by any enumerated sibling', () => {
  /* Said out loud so nobody over-trusts the gate: had the page written '/api/federation/' + kind,
     the missing invite route would have PASSED, because /api/federation/join fills the placeholder.
     The gate catches a missing route only where the page names it literally. If this ever starts
     failing, the matcher got stricter: update the header and this test together. */
  const without = boardRoutes(SERVER.split('/api/federation/invite').join('/api/federation/inv1te'));
  assert.equal(served('/api/federation/x', without), true);
});

test('#3957 control: a route only MENTIONED in a server comment does not count as served', () => {
  const board = boardRoutes(SERVER + "\n// the page will call '/api/newthing-3957' once #9999 lands\n/* also === '/api/newthing2-3957' */\n");
  assert.equal(served('/api/newthing-3957', board), false);
  assert.equal(served('/api/newthing2-3957', board), false);
});

test('#3957 control: an /api call through a page helper (not fetch) is read and checked', () => {
  const planted = pagePaths(PAGE + "\nplusSiPost('/api/remote/no-such-3957', {});\n").paths;
  assert.ok(planted.includes('/api/remote/no-such-3957'), 'a helper call was not read');
  assert.equal(served('/api/remote/no-such-3957', boardRoutes(SERVER)), false);
});

test('#3957 control: a `//` inside a multi-line template literal does not hide a real call after it', () => {
  const planted = pagePaths(PAGE + "\nconst label3957 = `Manage your account\n// settings and preferences` + 0; fetch('/api/attack-three-missing-3957');\n").paths;
  assert.ok(planted.includes('/api/attack-three-missing-3957'), 'the call after a multi-line template was swallowed as a comment');
});

test('#3957 control: a comparison quoted inside a board LOG STRING is not a route', () => {
  const board = boardRoutes(SERVER + "\nconsole.log(\"deprecated path === '/api/oldthing-not-real-3957', ignoring\");\n");
  assert.equal(served('/api/oldthing-not-real-3957', board), false);
});

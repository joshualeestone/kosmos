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
 *   - the page: every quoted '/api/' literal in web/index.html's CODE (JS and HTML comments are
 *     skipped; a literal only compared against is not a call), plus /api URLs in markup built
 *     inside JS strings (src=, href=, action=). Dynamic pieces become placeholders; a query glued
 *     on without '/' is dropped.
 *   - NOT read, and COUNTED with a ceiling: a fetch whose URL is a variable, and a URL with a
 *     variable tail. The ceilings are NET counts (removing one and adding another passes). NOT read
 *     and NOT counted: a helper called with a variable URL, and a URL split before its first
 *     segment ('/api' + '/x'). A URL that is itself a template is read with its `${}` flattened.
 *   - the board: '/api/...' literals (either quote) in any code comparison (=== / case; every one on
 *     main is path dispatch, but the test does not check the left-hand side), startsWith prefixes
 *     (pinned at zero), and ANCHORED regex literals mentioning \/api, outside comments and strings.
 *   - the lexer bounds its mistakes to a line: a `/` after `}` or a keyword-free value is guessed,
 *     and a guess that opens a phantom regex can hide a later call on that same line.
 *   - KNOWN LIMITS (each pinned by a test): a placeholder segment is served by any sibling route
 *     (had the page built '/api/federation/' + kind, a missing invite would pass); and a board
 *     route with a free segment (`/api/project/<id>`) serves any NEW literal of that shape.
 *   - NOT the HTTP method. The 0.6.96 defect was a route that did not exist at all.
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
const SERVED_ELSEWHERE = {};

/* Measured 2026-09-26 on main. Growth reds; shrinking is fine (lower these when it happens). */
const UNREAD_CEILING = 19;
const UNREADABLE_CEILING = 1;

/* A lexical mask over a source text: CODE, COMMENT (JS and HTML), STRING (inside a string literal),
   START (the opening quote of one) and REGEX (a regex literal). Templates are followed through their
   `${...}` at any depth, so a nested template cannot desynchronise it, and an /api literal inside an
   interpolation is CODE and is read. Raw HTML tags are skipped as tokens. */
const CODE = 0; const COMMENT = 1; const STRING = 2; const START = 3; const REGEX = 4;
/* Can a `/` at i open a regex literal? Yes after an operator, an opening bracket, a comma, a colon,
   a semicolon, `return`/`typeof`-style keywords, or at the start of a line; no after a value
   (an identifier, a number, `)` or `]`), where it divides. */
function regexCanStart(src, i) {
  /* Back over whitespace AND line breaks to the previous real token: a `/` starting a line can
     still divide (`x = a` then `  / 2` on the next line), and taking it for a regex swallowed the
     next string, a fetch( included. */
  let k = i - 1;
  while (k >= 0 && /\s/.test(src[k])) k -= 1;
  if (k < 0) return true;
  if ((src[k] === '+' || src[k] === '-') && src[k - 1] === src[k]) return false; // `i++ / 2` divides
  if ('(,=:[!&|?{};+-*%<>~^}'.includes(src[k])) return true;
  const word = src.slice(Math.max(0, k - 10), k + 1).match(/[A-Za-z_$]+$/);
  return !!(word && /^(return|typeof|case|in|of|new|delete|void|throw|else|do)$/.test(word[0]));
}
function lexMask(src) {
  const mask = new Uint8Array(src.length);
  /* Scan CODE from i. With `inInterp`, stop at the `}` that closes a template's `${`, tracking brace
     depth, and return its index; otherwise run to the end. Recursive through templates, so a
     template inside an interpolation inside a template is followed at any depth. */
  function code(i, inInterp) {
    let depth = 0;
    while (i < src.length) {
      const c = src[i];
      if (inInterp && c === '{') { depth += 1; i += 1; continue; }
      if (inInterp && c === '}') { if (depth === 0) return i; depth -= 1; i += 1; continue; }
      if (c === '`') { i = template(i); continue; }
      if (c === "'" || c === '"') {
        mask[i] = START;
        let j = i + 1;
        while (j < src.length && src[j] !== c && src[j] !== '\n') {
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
      } else if (c === '<' && /^<\/?[A-Za-z]/.test(src.slice(i, i + 3))) {
        /* An HTML tag in the page's raw markup (`</p>`, `<img`): skipped to the end of its name, so
           the `/` of a closing tag is never read as a regex that swallows a following attribute.
           (A raw attribute's own quote is a string START, so `<img src="/api/x">` is read.) */
        let j = i + 1;
        if (src[j] === '/') j += 1;
        while (j < src.length && /[A-Za-z0-9-]/.test(src[j])) j += 1;
        i = j;
      } else if (c === '<' && src.startsWith('<!--', i)) {
        /* An HTML comment in the page's markup: prose, like a JS comment. */
        const e = src.indexOf('-->', i + 4);
        const end = e < 0 ? src.length : e + 3;
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
    return i;
  }
  /* A template literal from its opening backtick; returns the index after its closing one. Its
     `${...}` interpolations are CODE, scanned by code(), so nesting cannot desynchronise the mask. */
  function template(i) {
    mask[i] = START;
    let j = i + 1;
    while (j < src.length && src[j] !== '`') {
      if (src[j] === '\\') { mask[j] = STRING; mask[j + 1] = STRING; j += 2; continue; }
      if (src[j] === '$' && src[j + 1] === '{') {
        mask[j] = STRING; mask[j + 1] = STRING;
        const close = code(j + 2, true);
        if (close < src.length) mask[close] = STRING;
        j = close + 1;
        continue;
      }
      mask[j] = STRING;
      j += 1;
    }
    if (j < src.length) mask[j] = STRING;
    return j + 1;
  }
  code(0, false);
  return mask;
}

/* Skip one dynamic piece of a URL expression (`encodeURIComponent(name)`, `a ? b : c`) with a
   paren-balanced scan, to the next top-level `+ '` (resumed, next = that quote) or the argument's
   end. A pattern that stopped at the first `)` lost the suffix of nearly every call and collapsed
   them into one path. `openEnded`: another dynamic piece follows (`+ id + suffixVar`), so the tail
   is only known at run time. */
function skipDynamic(src, i) {
  let depth = 0;
  let openEnded = false;
  for (let j = i; j < src.length && j < i + 600; j += 1) {
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
      if (nc === "'" || nc === '"') return { resumed: true, next: j + 1 + after, openEnded };
      openEnded = true;
    }
  }
  /* Ran out of budget inside one expression: say so, rather than read it as a clean end. */
  return { resumed: false, next: i, openEnded: openEnded || src.length > i + 600 && depth > 0 };
}

/* Normalise a read URL (placeholders as \u0000) into an example path, or null if it is not /api. */
function finish(path) {
  if (!path.startsWith('/api/')) return null;
  path = path.split('?')[0].split(/\s/)[0]; // a srcset descriptor (`/x 2x`) is not part of the path
  /* A dynamic piece glued on WITHOUT a `/` before it (`'/api/folders' + qs`) is a query or a
     suffix, not a path segment: the path ends where it starts. */
  const glued = path.search(/[^/\u0000]\u0000/);
  if (glued > -1) path = path.slice(0, glued + 1);
  return path.replace(/\u0000+/g, 'x');
}

/** The /api paths the page reaches, as concrete example paths with dynamic parts filled in. */
function pagePaths(src) {
  const out = new Set();
  const unreadable = new Set(); // a variable tail: counted and printed, never checked
  let unread = 0;
  /* fetch( calls whose URL is not a literal at all: counted, since they cannot be read. */
  const mask = lexMask(src);
  for (const f of src.matchAll(/fetch\(\s*(.)/g)) if (mask[f.index] === CODE && !"'\"`".includes(f[1])) unread += 1;
  /* Every quoted '/api/' literal in CODE, not only fetch( arguments: the page also reaches the
     board through helpers (a post wrapper, a table of endpoints, a `url:` field), and a UI merged
     ahead of its route through one of those is the same defect. Comments are skipped. */
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
        path += '\u0000';
        const d = skipDynamic(src, i);
        if (d.openEnded) openEnded = true;
        if (!d.resumed) break;
        i = d.next;
      }
    }
    if (!path.startsWith('/api/')) continue;
    if (openEnded) { unreadable.add(path.split('?')[0].replace(/\u0000+/g, 'x') + '...'); continue; }
    out.add(finish(path));
  }
  /* A template whose URL starts with an interpolated BASE (`${origin}/api/x`): the base is only an
     origin, so the route is read from '/api/' onward, its own `${}` as placeholders. */
  for (let t = src.indexOf('`'); t > -1; t = src.indexOf('`', t + 1)) {
    if (mask[t] !== START) continue;
    let e = t + 1;
    while (e < src.length && !(src[e] === '`' && mask[e] === STRING && mask[e - 1] !== START)) e += 1;
    const text = src.slice(t + 1, e);
    const k = text.indexOf('/api/');
    if (k <= 0) continue; // at 0 it was read above
    /* The URL ends where the markup around it resumes: a quote, whitespace or a bracket. */
    const url = text.slice(k).replace(/\$\{[^}]*\}/g, '\u0000').split(/["'\s<>)]/)[0];
    const f = finish(url);
    if (f) out.add(f);
  }
  /* A call written INSIDE markup (`onclick="fetch('/api/x')"`): its quote sits inside the
     attribute's string, so the first loop does not see it as a start. Read it with the same walker. */
  for (const q of src.matchAll(/\(\s*(['"])\/api\//g)) {
    const at = q.index + q[0].length - 6;
    if (mask[at] !== STRING) continue;
    let path = ''; let i = at; const qq = src[at];
    const end = src.indexOf(qq, i + 1);
    if (end < 0) continue;
    path = src.slice(i + 1, end);
    const f = finish(path);
    if (f) out.add(f);
  }
  /* MARKUP built inside JS strings: `'<img src="/api/agent/' + name + '/avatar">'`. The URL's own
     quote is inside the JS string, so the loop above does not see it as a string start. Read from
     `/api/` to the attribute's closing quote, crossing `' + expr + '` and `${...}` joins. */
  for (const a of src.matchAll(/(?:src|srcset|href|action)=(\\?["'])\/api\//g)) {
    const at = a.index + a[0].length - 5;
    if (mask[at] !== STRING) continue; // raw markup was read above; a comment is not a request
    const attrQ = a[1].slice(-1);
    let k = at - 1;
    while (k > 0 && mask[k] !== START) k -= 1;
    const jsQ = src[k];
    let path = '';
    let open = false;
    let i = at;
    for (;;) {
      let j = i;
      while (j < src.length && src[j] !== attrQ && src[j] !== jsQ && src[j] !== '\\' && !(src[j] === '$' && src[j + 1] === '{') && src[j] !== '\n') j += 1;
      path += src.slice(i, j);
      if (src[j] === '$' && src[j + 1] === '{') {
        path += '\u0000';
        let depth = 0; let e = j + 2;
        for (; e < src.length; e += 1) { if (src[e] === '{') depth += 1; else if (src[e] === '}') { if (depth === 0) break; depth -= 1; } }
        i = e + 1; continue;
      }
      if (src[j] === jsQ && jsQ !== attrQ) {
        const plus = src.slice(j + 1, j + 400).match(/^\s*\+\s*/);
        if (!plus) break;
        path += '\u0000';
        const d = skipDynamic(src, j + 1 + plus[0].length);
        if (d.openEnded) open = true;
        if (!d.resumed) break;
        i = d.next + 1; continue;
      }
      break;
    }
    if (open) { unreadable.add(path.split('?')[0].replace(/\u0000+/g, 'x') + '...'); continue; }
    const f = finish(path);
    if (f) out.add(f);
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
  for (const m of src.matchAll(/(?:===\s*|case\s+)(['"])(\/api\/[A-Za-z0-9/_.-]*)\1|(['"])(\/api\/[A-Za-z0-9/_.-]*)\3\s*===/g)) {
    /* The literal's own opening quote must be a real string start, and the comparison around it
       must be CODE: `console.log("x === '/api/y'")` names no route. Either quote style. */
    const q = m.index + m[0].search(/['"]/);
    const op = m[0].indexOf('===') > -1 ? m.index + m[0].indexOf('===') : m.index;
    if (mask[q] === START && inCode(op)) literals.add(m[2] || m[4]);
  }
  /* A PREFIX only where the board itself tests one with startsWith, and never the bare '/api/':
     that is the "no such endpoint" catch-all, and counting it would serve every path. */
  const prefixes = [...src.matchAll(/startsWith\((['"])(\/api\/[A-Za-z0-9/_.-]+)\1\)/g)].filter((m) => inCode(m.index)).map((m) => m[2]);
  /* Route regexes: every REGEX span the lexer found (so a `[^/]` class or an alternation right
     after the anchor, /^\/api(?:\/a|\/b)\//, is read whole) whose source mentions \/api. */
  const regexes = [];
  for (let i = 0; i < src.length; i += 1) {
    if (mask[i] !== REGEX || (i > 0 && mask[i - 1] === REGEX)) continue;
    let e = i;
    while (e < src.length && mask[e] === REGEX) e += 1;
    const lit = src.slice(i, e);
    if (lit.indexOf('\\/api') < 0) continue;
    const last = lit.lastIndexOf('/');
    const flags = (src.slice(e).match(/^[gimsuy]*/) || [''])[0];
    /* A ROUTE regex is anchored at both ends (all 55 today): an unanchored one mentioning \/api is a
       guard (`/^\/api\/federation\//.test(pathname) && !authed`), and would serve everything under it. */
    const body = lit.slice(1, last);
    if (body.startsWith('^') && body.endsWith('$')) {
      try { regexes.push(new RegExp(lit.slice(1, last), flags.replace('g', ''))); } catch { /* not a regex after all */ }
    }
    i = e;
  }
  return { literals, prefixes, regexes };
}

/* The words a route regex enumerates, `(allow|deny|remove)`, so a page placeholder can stand for one. */
function alternatives(board) {
  const words = new Set();
  for (const r of board.regexes) for (const m of r.source.matchAll(/\(((?:[A-Za-z0-9-]+\|)+[A-Za-z0-9-]+)\)/g)) m[1].split('|').forEach((w) => words.add(w));
  return [...words];
}

/* The two real parses, once per process: the controls parse MODIFIED copies and keep doing so. */
let BASE_PAGE = null; let BASE_BOARD = null;
const basePage = () => (BASE_PAGE = BASE_PAGE || pagePaths(PAGE));
const baseBoard = () => (BASE_BOARD = BASE_BOARD || boardRoutes(SERVER));

function served(p, board) {
  if (board.literals.has(p)) return true;
  if (board.prefixes.some((l) => p.startsWith(l.endsWith('/') ? l : l + '/'))) return true;
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
  /* The MISSING list first: when a route is missing, that is the message a person needs, and the
     floors below would otherwise speak first on an older, smaller page. */
  const missing = paths.filter((p) => !served(p, board) && !SERVED_ELSEWHERE[p]);
  assert.deepEqual(missing, [],
    'the page calls /api paths no board route serves. Either add the route in the SAME change, or '
    + '(only if it is served by something else) list it in SERVED_ELSEWHERE with the reason:\n  ' + missing.join('\n  '));
  /* A FLOOR close under today's count, not a token one: a lexer slip that mis-reads a region
     drops real calls SILENTLY (one did during development, taking the federation routes with it),
     and only a floor this tight can see a slip of more than a handful. Lower it only when the page
     genuinely loses calls, in the same change. */
  assert.ok(paths.length >= 180, `the extractor read ${paths.length} paths (floor 180); a region of the page is being mis-read, not the page shrinking`);
  assert.ok(board.regexes.length >= 40, 'the board extractor found almost no route regexes (' + board.regexes.length + '); it is broken, not the board');
  /* CEILINGS, not just a printout: a green log is read by nobody. A new fetch whose URL is a variable,
     or a new variable-tailed one, cannot be checked here, so it has to be a deliberate change: make
     the URL readable, or raise the ceiling with a reason in the commit. */
  /* A board startsWith('/api/x') prefix serves everything under it, so a guard written that way
     would serve a route with no handler (the 0.6.96 shape). None exists today: a new one must be a
     deliberate change to this number. */
  assert.equal(board.prefixes.length, 0, 'a board startsWith(\'/api/...\') prefix appeared: ' + board.prefixes.join(', ') + '; check it is a real route family, then raise this with a reason');
  assert.ok(unread <= UNREAD_CEILING, `fetches whose URL is not a literal grew to ${unread} (ceiling ${UNREAD_CEILING}); make the new one's URL a literal, or raise the ceiling with a reason`);
  assert.ok(unreadable.length <= UNREADABLE_CEILING, `fetches with a variable tail grew to ${unreadable.length} (ceiling ${UNREADABLE_CEILING}): ${unreadable.join(', ')}`);
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

test('#3957 control: a nested template inside an interpolation does not desynchronise the lexer', () => {
  const planted = pagePaths(PAGE + "\nconst help3957 = `${ok ? `see https://kosmos.example/help` : ''}\n  and more`;\nfetch('/api/brand-new-missing-3957', { method: 'POST' });\n").paths;
  assert.ok(planted.includes('/api/brand-new-missing-3957'), 'the call after a nested template was lost');
});

test('#3957 control: a request in markup built inside a JS string is read', () => {
  const planted = pagePaths(PAGE + "\nconst pic3957 = '<img src=\"/api/brand-new-markup-3957/' + encodeURIComponent(n) + '/pic?v=1\">';\n").paths;
  assert.ok(planted.includes('/api/brand-new-markup-3957/x/pic'), 'a markup URL was not read: ' + planted.filter((q) => q.includes('3957')));
});

test('#3957 KNOWN LIMIT, pinned: a board route with a free segment serves any new literal of that shape', () => {
  /* The board serves `/api/project/<id>`; so a page call to a NEW literal `/api/project/templates`
     reads as served even though no templates route exists. Statically, a literal segment and an id
     look the same. If this starts failing, the matcher got stricter: update the header, CLAUDE.md
     and this test together. */
  assert.equal(served('/api/project/templates-3957', baseBoard()), true);
});

test('#3957 control: a line that starts with a division does not open a phantom regex', () => {
  const planted = pagePaths(PAGE + "\nfunction f3957(a) {\n  x = a\n  / 2; fetch('/api/after-division-3957');\n}\n").paths;
  assert.ok(planted.includes('/api/after-division-3957'), 'the call after a line-leading division was swallowed');
});

test('#3957 control: a double-quoted board comparison and a grouped route regex are routes', () => {
  const board = boardRoutes(SERVER + '\nif (pathname === "/api/doublequote-3957") {}\nconst g3957 = pathname.match(/^\\/api(?:\\/agent|\\/project)\\/thing-3957$/);\n');
  assert.equal(served('/api/doublequote-3957', board), true);
  assert.equal(served('/api/project/thing-3957', board), true);
});

test('#3957 control: a closing HTML tag does not open a phantom regex over a following attribute', () => {
  const planted = pagePaths(PAGE + '\n<p>Hi</p><img src="/api/raw-after-close-3957">\n').paths;
  assert.ok(planted.includes('/api/raw-after-close-3957'), 'raw markup after a closing tag was swallowed');
});

test('#3957 control: a board prefix serves only whole segments under it', () => {
  const board = boardRoutes(SERVER + "\nif (pathname.startsWith('/api/pfx-3957')) {}\n");
  assert.equal(served('/api/pfx-3957/child', board), true);
  assert.equal(served('/api/pfx-3957bar', board), false, 'a prefix matched across a segment boundary');
});

test('#3957 control: a template URL with an interpolated base is read from /api on', () => {
  const planted = pagePaths(PAGE + "\nplusSiPost(`${base}/api/helper-template-gap-3957/${id}/go`, {});\n").paths;
  assert.ok(planted.includes('/api/helper-template-gap-3957/x/go'), 'a base-prefixed template call was invisible');
});

test('#3957 control: an unanchored guard regex is not a route', () => {
  const board = boardRoutes(SERVER.split('/api/federation/invite').join('/api/federation/inv1te') + "\nif (/^\\/api\\/federation\\//.test(pathname) && !authed) return deny(res);\n");
  assert.equal(served('/api/federation/invite', board), false);
});

test('#3957 control: template URLs with host text or two interpolations first, srcset, and inline handlers are read', () => {
  const planted = pagePaths(PAGE + "\nfetch(`http://127.0.0.1:${port}/api/p2-missing-3957`);\nfetch(`${a}${b}/api/p3-missing-3957`);\n<button onclick=\"fetch('/api/p1-missing-3957')\">x</button>\nconst s3957 = '<img srcset=\"/api/p4-missing-3957/' + n + '/x 2x\">';\n").paths;
  for (const p of ['/api/p2-missing-3957', '/api/p3-missing-3957', '/api/p1-missing-3957', '/api/p4-missing-3957/x/x']) assert.ok(planted.includes(p), p + ' was not read');
});

test('#3957 control: a regex anchored at one end only is not a route, and a double-quoted prefix is seen', () => {
  const board = boardRoutes(SERVER + "\nif (/\\/api\\/end-anchor-only-3957$/.test(pathname)) {}\nif (pathname.startsWith(\"/api/dq-prefix-3957\")) {}\n");
  assert.equal(served('/api/end-anchor-only-3957', board), false);
  assert.ok(board.prefixes.includes('/api/dq-prefix-3957'), 'a double-quoted startsWith prefix went unseen');
});

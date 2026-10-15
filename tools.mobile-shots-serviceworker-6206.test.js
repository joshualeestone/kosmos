'use strict';
/* #6206: in WebKit a request from a page the board's service worker controls is fetched on the worker's side, where
 * page.route never sees it (web/sw.js passes /api/ through; the stub is simply skipped), so a mobile-shots screen
 * whose `go` stubs a request must set `noServiceWorker: true` (the rule the tool's header states). Three settings
 * screens did not, and timed out on WebKit at every size. This reads the tool's source: a screen stubs if its body
 * calls .route( (on the page or its context), calls a helper that does (at any depth), or runs another screen that
 * does. Comments are left out in one pass that knows strings, so a comment cannot count as a stub and a glob cannot
 * open a comment. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'docs', 'browser-checks', 'mobile-shots.js'), 'utf8');

/* Does a "/" at i start a regex literal? Yes after an operator, an opening bracket, a comma, a colon, a keyword, or at
   the start; no after a name, a number or a closing bracket (then it divides). */
function regexStartsAt(text, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) j -= 1;
  if (j < 0) return true;
  if ('(,=:[!&|?{};+-*%<>~^'.includes(text[j])) return true;
  const word = /([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(text.slice(Math.max(0, j - 10), j + 1));
  return Boolean(word && /^(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/.test(word[1]));
}
/* The index of a regex literal's closing "/" (its flags follow), minding escapes and character classes. */
function regexEnd(text, i) {
  let cls = false;
  for (i += 1; i < text.length && text[i] !== '\n'; i += 1) {
    if (text[i] === '\\') { i += 1; continue; }
    if (text[i] === '[') cls = true;
    else if (text[i] === ']') cls = false;
    else if (text[i] === '/' && !cls) return i;
  }
  return i;
}

/* One pass over the source: comments become spaces (so positions hold), strings and template literals (with their
   ${} parts, at any depth) are kept as they are. Everything below reads this, so a "/*" inside a glob string is text,
   a quote inside a trailing comment is a comment, and a regex literal (a \( or a quote inside it) is skipped whole. */
function codeOnly(src) {
  let out = '';
  const blank = (t) => t.replace(/[^\n]/g, ' ');
  const skipString = (i, q) => { for (i += 1; i < src.length && src[i] !== q; i += 1) if (src[i] === '\\') i += 1; return i; };
  const skipTemplate = (i) => {
    for (i += 1; i < src.length && src[i] !== '`'; i += 1) {
      if (src[i] === '\\') { i += 1; continue; }
      if (src[i] === '$' && src[i + 1] === '{') i = skipCode(i + 2, '}');
    }
    return i;
  };
  // Code up to the matching closer, skipping strings, templates and comments inside it; returns the closer's index.
  const skipCode = (i, closer) => {
    let depth = 0;
    for (; i < src.length; i += 1) {
      const c = src[i];
      if (c === "'" || c === '"') i = skipString(i, c);
      else if (c === '`') i = skipTemplate(i);
      else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; }
      else if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e === -1 ? src.length : e + 1; }
      else if (c === '/' && regexStartsAt(src, i)) i = regexEnd(src, i);
      else if (c === '{') depth += 1;
      else if (c === '}') { if (depth === 0 && closer === '}') return i; depth -= 1; }
    }
    return i;
  };
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === "'" || c === '"') { const e = skipString(i, c); out += src.slice(i, e + 1); i = e; }
    else if (c === '`') { const e = skipTemplate(i); out += src.slice(i, e + 1); i = e; }
    else if (c === '/' && src[i + 1] === '/') { let e = i; while (e < src.length && src[e] !== '\n') e += 1; out += blank(src.slice(i, e)); i = e - 1; }
    else if (c === '/' && src[i + 1] === '*') { const e0 = src.indexOf('*/', i + 2); const e = e0 === -1 ? src.length : e0 + 2; out += blank(src.slice(i, e)); i = e - 1; }
    else if (c === '/' && regexStartsAt(src, i)) { const e = regexEnd(src, i); out += src.slice(i, e + 1); i = e; }
    else out += c;
  }
  return out;
}

/* From an opening brace (or the start of an expression) to its end, in comment-free code: braces, brackets and parens
   are counted, strings and templates are skipped whole. For an expression-bodied arrow, the end is the first ; or line
   end at depth zero. */
function extent(code, from, isBlock) {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const c = code[i];
    if (c === "'" || c === '"') { for (i += 1; i < code.length && code[i] !== c; i += 1) if (code[i] === '\\') i += 1; continue; }
    if (c === '`') {
      let t = 0;
      for (i += 1; i < code.length; i += 1) {
        if (code[i] === '\\') { i += 1; continue; }
        if (code[i] === '$' && code[i + 1] === '{') { t += 1; i += 1; continue; }
        if (code[i] === '}' && t > 0) { t -= 1; continue; }
        if (code[i] === '`' && t === 0) break;
      }
      continue;
    }
    if (c === '/' && regexStartsAt(code, i)) { i = regexEnd(code, i); continue; }
    if ('{[('.includes(c)) depth += 1;
    else if ('}])'.includes(c)) { depth -= 1; if (isBlock && depth === 0) return code.slice(from, i + 1); if (depth < 0) return code.slice(from, i); }
    else if (!isBlock && depth === 0 && (c === ';' || c === '\n')) return code.slice(from, i);
  }
  return code.slice(from);
}

/* The entries of SCREENS, counted by structure (each top-level { ... } of the array), independent of the reader's
   { name, owner } pattern, so the two can disagree when a screen is written in a shape the reader does not see (Angel,
   review of #6215: with both keyed on owner:, the comparison could never fail). */
function screensArrayEntries(raw) {
  const code = codeOnly(raw);
  const at = code.search(/\bconst SCREENS = \[/);
  if (at < 0) return -1;
  const arr = extent(code, code.indexOf('[', at), true);
  let n = 0;
  for (let i = 1; i < arr.length - 1; i += 1) {
    const c = arr[i];
    if (c === '{') { n += 1; i += extent(arr, i, true).length - 1; }
    else if (!/[\s,]/.test(c)) return -1;   // a spread or a call in the array: not countable this way, say so
  }
  return n;
}
function unflaggedStubbers(raw) {
  const code = codeOnly(raw);
  const fnBody = {};
  const declRe = /(?:^|\n)[ \t]*(?:async[ \t]+)?function[ \t]+([A-Za-z0-9_$]+)[ \t]*\([^)]*\)[ \t]*\{|(?:^|\n)[ \t]*(?:const|let|var)[ \t]+([A-Za-z0-9_$]+)[ \t]*=[ \t]*(?:async[ \t]+function[ \t]*\([^)]*\)[ \t]*\{|function[ \t]*\([^)]*\)[ \t]*\{|(?:async[ \t]*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)[ \t]*=>[ \t]*(\{)?)/g;
  for (let m; (m = declRe.exec(code));) {
    const name = m[1] || m[2];
    const end = m.index + m[0].length;
    const isBlock = m[0].endsWith('{');
    fnBody[name] = isBlock ? extent(code, end - 1, true) : extent(code, end, false);
  }
  const calls = (body, name) => new RegExp('(?:^|[^A-Za-z0-9_$.])' + name.replace(/\$/g, '\\$') + '\\(').test(body);
  // Helpers that stub, to a fixpoint: one that calls a stubbing helper stubs too.
  const stubbingHelpers = new Set(Object.keys(fnBody).filter((n) => /\.route\(/.test(fnBody[n])));
  for (let grew = true; grew;) {
    grew = false;
    for (const n of Object.keys(fnBody)) if (!stubbingHelpers.has(n) && [...stubbingHelpers].some((h) => calls(fnBody[n], h))) { stubbingHelpers.add(n); grew = true; }
  }
  const body = {};
  /* A screen is { name: '...', owner: ... }, the shape the declared count below uses: a screen's own fixture rows
     ({ name: 'laptop', address: ... } in #6211's settings-accounts-other) are not screens. */
  for (const m of code.matchAll(/(^|[\s,[])\{[\s]*name:[\s]*'([a-z0-9-]+)',[\s]*owner:/g)) body[m[2]] = extent(code, m.index + m[1].length, true);
  const stubs = (n, seen = new Set()) => {
    if (seen.has(n) || !body[n]) return false;
    seen.add(n);
    const b = body[n];
    if (/\.route\(/.test(b) || [...stubbingHelpers].some((h) => calls(b, h))) return true;
    return [...b.matchAll(/SCREENS\.find\(\s*\(?\s*([A-Za-z0-9_$]+)\s*\)?\s*=>\s*\1\.name\s*===?\s*'([a-z0-9-]+)'\s*\)/g)].some((m) => stubs(m[2], seen));
  };
  const stubbing = Object.keys(body).filter((n) => stubs(n));
  // The flag counts anywhere in the screen's own keys, before its go.
  const flagged = (n) => /noServiceWorker:\s*true/.test(body[n].slice(0, Math.max(0, body[n].indexOf('go:'))));
  return { stubbing, missing: stubbing.filter((n) => !flagged(n)), screens: Object.keys(body), helpers: [...stubbingHelpers] };
}

test('#6206: every mobile-shots screen that stubs with .route turns the service worker off', () => {
  const { stubbing, missing } = unflaggedStubbers(SRC);
  assert.deepEqual(missing, [], 'these screens stub a request but leave the service worker on (they time out on WebKit): ' + missing.join(', '));
  // CONTROL: the reader sees stubbing directly, through a helper and through another screen.
  for (const n of ['allow-card', 'connect-sheet', 'settings-accounts-landed']) assert.ok(stubbing.includes(n), 'the reader missed ' + n);
  // CONTROL: it found every screen the file declares, and the helpers known to stub.
  const { screens, helpers } = unflaggedStubbers(SRC);
  const declared = screensArrayEntries(SRC);
  assert.ok(declared > 50 && screens.length === declared, 'screens found ' + screens.length + ', declared ' + declared);
  for (const h of ['openConsAgents', 'connectPending', 'joinWaiting', 'orgConnected', 'stubRebootNote']) assert.ok(helpers.includes(h), 'the reader missed helper ' + h);
});

/* Each planted screen goes in just before allow-card, with or without the flag. */
const plant = (src, text) => src.replace(/^([ \t]*)\{ name: 'allow-card',/m, (m, sp) => sp + text + '\n' + m);
const helperAt = (src, text) => src.replace(/^const at = async/m, text + '\nconst at = async');

test('#6206 CONTROL: unflagged screens are caught in every shape the file uses or could', () => {
  const shapes = {
    direct: "{ name: 'p-direct', owner: 'x', go: async (page) => { await page.route('**/api/x', (r) => r.abort()); } },",
    context: "{ name: 'p-context', owner: 'x', go: async (page) => { await page.context().route('**/api/x', (r) => r.abort()); } },",
    otherScreenX: "{ name: 'p-xform', owner: 'x', go: async (page, d) => { await SCREENS.find((x) => x.name === 'settings-accounts-expiring').go(page, d); } },",
    deepHelper: "{ name: 'p-deep', owner: 'x', go: async (page) => { await wrapStub(page); } },",
    syncHelper: "{ name: 'p-sync', owner: 'x', go: async (page) => { stubSync(page); } },",
    exprArrow: "{ name: 'p-expr', owner: 'x', go: async (page) => { await stubExpr(page); } },",
    letFunction: "{ name: 'p-letfn', owner: 'x', go: async (page) => { await stubLet(page); } },",
    afterGlob: "{ name: 'p-glob', owner: 'x', go: async (page) => { const g = '**/a/*/b'; await page.goto(g); await page.route('**/api/z', (r) => r.abort()); } },",
    afterTemplate: "{ name: 'p-tpl', owner: 'x', go: async (page) => { const t = `${ '}' } and ${ `${1}` }`; await page.route('**/api/' + t, (r) => r.abort()); } },",
    bareArrowFind: "{ name: 'p-find2', owner: 'x', go: async (page, d) => { await SCREENS.find(s=>s.name==='settings-accounts-expiring').go(page, d); } },",
    afterRegex: "{ name: 'p-regex', owner: 'x', go: async (page) => { if (!/it said \\(\"x\" [{]/.test('')) {} await page.route('**/api/r', (r) => r.abort()); } },",
  };
  let src = helperAt(SRC, "async function wrapStub(page) { await connectPending(page); }\nfunction stubSync(page) { page.route('**/api/y', (r) => r.abort()); }\nconst stubExpr = (page) => page.route('**/api/e', (r) => r.abort());\nlet stubLet = async function (page) { await page.route('**/api/l', (r) => r.abort()); };");
  for (const t of Object.values(shapes)) src = plant(src, t);
  assert.ok(src.includes("'p-sync'") && src.includes('function stubSync'), 'fixture: the plants did not land');
  assert.deepEqual(unflaggedStubbers(src).missing.sort(), ['p-context', 'p-deep', 'p-direct', 'p-expr', 'p-find2', 'p-glob', 'p-letfn', 'p-regex', 'p-sync', 'p-tpl', 'p-xform']);
});

test('#6206 CONTROL: no false alarm for a flag on a later line, or a stub named only in a comment', () => {
  let src = plant(SRC, "{ name: 'p-twoline', owner: 'x',\n    noServiceWorker: true, go: async (page) => { await page.route('**/api/x', (r) => r.abort()); } },");
  src = plant(src, "{ name: 'p-quiet', owner: 'x', go: async (page) => { await at(page, '?tab=home'); } },\n  /* a later screen calls page.route( here, in a comment */");
  // A glob that holds /* must not open a comment that swallows the next screen's flag or code.
  src = plant(src, "{ name: 'p-globflag', owner: 'x', noServiceWorker: true, go: async (page) => { await page.route('**/api/*/q', (r) => r.abort()); } },");
  assert.ok(src.includes("'p-twoline'") && src.includes("'p-quiet'"), 'fixture: the plants did not land');
  const { stubbing, missing } = unflaggedStubbers(src);
  assert.deepEqual(missing, [], 'false alarm: ' + missing.join(', '));
  assert.ok(stubbing.includes('p-twoline') && stubbing.includes('p-globflag') && !stubbing.includes('p-quiet'), JSON.stringify(stubbing.filter((n) => n.startsWith('p-'))));
});

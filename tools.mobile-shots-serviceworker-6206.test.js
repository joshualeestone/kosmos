'use strict';
/* #6206: in WebKit a request from a page the board's service worker controls is fetched on the worker's side, where
 * page.route never sees it (web/sw.js passes /api/ through; the stub is simply skipped), so a mobile-shots screen
 * whose `go` stubs a request must set `noServiceWorker: true` (the rule the tool's header states). Three settings
 * screens did not, and timed out on WebKit at every size. This reads the tool's source: a screen stubs if its body
 * calls .route( (on the page or its context), calls a helper that does (at any depth), or runs another screen that
 * does. Comments are left out, so a comment cannot count as a stub. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, 'docs', 'browser-checks', 'mobile-shots.js'), 'utf8');

function unflaggedStubbers(raw) {
  // Block comments and whole-line // comments out; a // inside a string (a URL) is left alone.
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/^[ \t]*\/\/.*$/gm, '');
  /* The text from an opening brace to its match, skipping strings, template literals and trailing comments,
     so a helper or screen is only its own body, not whatever follows it in the file. */
  const block = (open) => {
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }   // a trailing comment (it may hold an apostrophe)
      if (c === "'" || c === '"' || c === '`') { for (i += 1; i < src.length && src[i] !== c; i += 1) if (src[i] === '\\') i += 1; continue; }
      if (c === '{') depth += 1;
      else if (c === '}' && --depth === 0) return src.slice(open, i + 1);
    }
    return src.slice(open);
  };
  const fnBody = {};
  const fnRe = /(?:^|\n)[ \t]*(?:async[ \t]+)?function[ \t]+([A-Za-z0-9_$]+)[ \t]*\([^)]*\)[ \t]*\{|(?:^|\n)[ \t]*const[ \t]+([A-Za-z0-9_$]+)[ \t]*=[ \t]*(?:async[ \t]*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)[ \t]*=>[ \t]*\{/g;
  for (let m; (m = fnRe.exec(src));) fnBody[m[1] || m[2]] = block(m.index + m[0].length - 1);
  const starts = [...src.matchAll(/^[ \t]*\{ name: '([a-z0-9-]+)'/gm)].map((m) => ({ name: m[1], at: m.index + m[0].indexOf('{') }));
  const calls = (body, name) => new RegExp('(?:^|[^A-Za-z0-9_$.])' + name.replace(/\$/g, '\\$') + '\\(').test(body);
  // Helpers that stub, to a fixpoint: one that calls a stubbing helper stubs too.
  const stubbingHelpers = new Set(Object.keys(fnBody).filter((n) => /\.route\(/.test(fnBody[n])));
  for (let grew = true; grew;) {
    grew = false;
    for (const n of Object.keys(fnBody)) if (!stubbingHelpers.has(n) && [...stubbingHelpers].some((h) => calls(fnBody[n], h))) { stubbingHelpers.add(n); grew = true; }
  }
  const body = {};
  for (const st of starts) body[st.name] = block(st.at);
  const stubs = (n, seen = new Set()) => {
    if (seen.has(n) || !body[n]) return false;
    seen.add(n);
    const b = body[n];
    if (/\.route\(/.test(b) || [...stubbingHelpers].some((h) => calls(b, h))) return true;
    return [...b.matchAll(/SCREENS\.find\(\(([A-Za-z0-9_$]+)\) => \1\.name === '([a-z0-9-]+)'\)/g)].some((m) => stubs(m[2], seen));
  };
  const stubbing = Object.keys(body).filter((n) => stubs(n));
  // The flag counts anywhere in the screen's own keys, before its go.
  const flagged = (n) => /noServiceWorker:\s*true/.test(body[n].slice(0, Math.max(0, body[n].indexOf('go:'))));
  return { stubbing, missing: stubbing.filter((n) => !flagged(n)) };
}

test('#6206: every mobile-shots screen that stubs with .route turns the service worker off', () => {
  const { stubbing, missing } = unflaggedStubbers(SRC);
  assert.deepEqual(missing, [], 'these screens stub a request but leave the service worker on (they time out on WebKit): ' + missing.join(', '));
  // CONTROL: the reader sees stubbing directly, through a helper and through another screen.
  for (const n of ['allow-card', 'connect-sheet', 'settings-accounts-landed']) assert.ok(stubbing.includes(n), 'the reader missed ' + n);
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
  };
  let src = helperAt(SRC, "async function wrapStub(page) { await connectPending(page); }\nfunction stubSync(page) { page.route('**/api/y', (r) => r.abort()); }");
  for (const t of Object.values(shapes)) src = plant(src, t);
  assert.ok(src.includes("'p-sync'") && src.includes('function stubSync'), 'fixture: the plants did not land');
  assert.deepEqual(unflaggedStubbers(src).missing.sort(), ['p-context', 'p-deep', 'p-direct', 'p-sync', 'p-xform']);
});

test('#6206 CONTROL: no false alarm for a flag on a later line, or a stub named only in a comment', () => {
  let src = plant(SRC, "{ name: 'p-twoline', owner: 'x',\n    noServiceWorker: true, go: async (page) => { await page.route('**/api/x', (r) => r.abort()); } },");
  src = plant(src, "{ name: 'p-quiet', owner: 'x', go: async (page) => { await at(page, '?tab=home'); } },\n  /* a later screen calls page.route( here, in a comment */");
  assert.ok(src.includes("'p-twoline'") && src.includes("'p-quiet'"), 'fixture: the plants did not land');
  const { stubbing, missing } = unflaggedStubbers(src);
  assert.deepEqual(missing, [], 'false alarm: ' + missing.join(', '));
  assert.ok(stubbing.includes('p-twoline') && !stubbing.includes('p-quiet'), JSON.stringify(stubbing.filter((n) => n.startsWith('p-'))));
});

'use strict';
/**
 * #758: a screen change can merge green and red the next cut, because the
 * page gate (docs/browser-checks/) is not in yarn test, and 15 of its 47
 * checks were not in the gate (first counted as 27 of 46 by matching literal
 * run_one lines, which cannot see the loop at browser-checks.sh:334; #812). The class that fires: a check asks for
 * an id the page no longer has (#730 removed #acct-add-openai and stopped
 * the 0.5.24 cut at minute twenty-two; #754 removed #create-limit; 4bf7d95
 * removed #made-done and render-create-made has been asking for it since).
 *
 * This is the static, milliseconds-fast half: every id a check asks for
 * must exist in web/index.html, and when it does not, the red names the
 * check, its line, the id it wanted, and the nearest ids the page has, so
 * the person reads the shape it wanted and the shape it got. It runs in
 * yarn test and, when web/index.html or a check is staged, in the
 * pre-commit hook, so the change that removes an id is the change that
 * hears about it.
 *
 * What it cannot see: a check asserting words or a dialog's behaviour. The
 * checks themselves still have to run for that; this catches the class that
 * has cost three cuts, not every class.
 *
 *   node --test browser-checks-selectors.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'docs', 'browser-checks');
const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

/* Known stale, by name, with the commit that removed the id: the guard is
   green on the day it lands and red on the next removal. An entry here is a
   check that needs restating by whoever owns its screen, not a permission.
   Remove the entry when the check is restated; the test refuses an entry
   that is no longer stale, so the list cannot rot in the other direction. */
const KNOWN_STALE = [
];

/* The ids a check asks for. Comments are stripped first (a comment quoting
   an old id is not a selector). A #id inside a string; getElementById. Hex
   colours are not ids; a trailing hyphen is a prefix and is matched as one.
   A line that asserts ABSENCE (count() === 0, Boolean(getElementById(...)),
   === null) is asking the page NOT to have the id, and is exempt. */
function idsAskedFor(src) {
  /* Per line, on purpose: a class that spans lines strips only the last
     comment of a quote-free run and keeps the earlier ones in its capture,
     which first surfaced as a comment on render-accounts-openai.js:47 being
     read as a selector. */
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^([^'"`\n]*)\/\/.*$/gm, '$1');
  const out = new Map();
  clean.split('\n').forEach((line, i) => {
    const absence = /count\(\)\)?\s*===\s*0|Boolean\(document\.getElementById\(|===\s*null|!document\.getElementById\(/.test(line);
    if (absence) return;
    const found = new Set();
    /* '/#settings' is a URL fragment the page routes on, not a selector. */
    for (const m of line.matchAll(/(^|[^\/])#([a-zA-Z][a-zA-Z0-9_-]*)/g)) found.add(m[2]);
    for (const m of line.matchAll(/getElementById\(\s*["'`]([a-zA-Z][a-zA-Z0-9_-]*)["'`]/g)) found.add(m[1]);
    for (const id of found) {
      if (/^[0-9a-fA-F]{3,8}$/.test(id)) continue;
      if (!out.has(id)) out.set(id, i + 1);
    }
  });
  return out;
}

/* Every id the page carries: markup, and ids given in the script. */
function pageIds(page) {
  const ids = new Set();
  for (const m of page.matchAll(/\bid=["']([a-zA-Z][a-zA-Z0-9_-]*)["']/g)) ids.add(m[1]);
  for (const m of page.matchAll(/\.id\s*=\s*["'`]([a-zA-Z][a-zA-Z0-9_-]*)["'`]/g)) ids.add(m[1]);
  for (const m of page.matchAll(/\bid:\s*["'`]([a-zA-Z][a-zA-Z0-9_-]*)["'`]/g)) ids.add(m[1]);
  return ids;
}
/* Present means the page CREATES the id: markup, an .id = / id: assignment,
   or a runtime-built id whose prefix the page writes as id="acct-add-'
   (cut at a hyphen, followed by the quote or ${ that the rest is glued
   on). The page merely mentioning the word (a CSS rule, a getElementById
   that reads it) is not presence: an id removed from the markup with its
   CSS left behind is exactly the removal this guard exists to report. */
function pageHas(page, ids, id) {
  if (id.endsWith('-')) return [...ids].some((x) => x.startsWith(id)) || builtWithPrefix(page, id);
  if (ids.has(id)) return true;
  for (let k = id.indexOf('-'); k > 0; k = id.indexOf('-', k + 1)) {
    if (builtWithPrefix(page, id.slice(0, k + 1))) return true;
  }
  return false;
}
function builtWithPrefix(page, prefix) {
  return new RegExp('\\bid=["\']' + prefix + '(["\'`]|\\$\\{)').test(page)
    || new RegExp('["\'`]' + prefix + '["\'`]\\s*\\+').test(page)
    || new RegExp('\\.id\\s*=\\s*["\'`]' + prefix + '(["\'`]|\\$\\{)').test(page);
}
function nearest(ids, id, n) {
  const stem = id.split('-')[0];
  const same = [...ids].filter((x) => x.startsWith(stem + '-') || x === stem).sort();
  return same.slice(0, n);
}

/* The scan, as one function, so the control below can run it on a page
   with one id removed and prove the assertions bite. */
function scan(page, checks) {
  const ids = pageIds(page);
  const missing = [];
  for (const [file, src] of checks) {
    for (const [id, line] of idsAskedFor(src)) {
      if (pageHas(page, ids, id)) continue;
      const near = nearest(ids, id, 6);
      missing.push({ check: file, line, id, near });
    }
  }
  return missing;
}
function loadChecks() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'thread-server.js').sort()
    .map((f) => [f, fs.readFileSync(path.join(DIR, f), 'utf8')]);
}
function words(m) {
  return '  ' + m.check + ':' + m.line + ' asks for #' + m.id + ', and web/index.html has no such id.'
    + (m.near.length ? ' The page has: ' + m.near.map((x) => '#' + x).join(', ') + '.' : ' Nothing on the page starts the same way.')
    + ' Either the id moved (restate the check) or the check is stale (say so on a card and list it in KNOWN_STALE with the commit).';
}

test('every id a browser check asks for exists in web/index.html (#758): the shape it wants and the shape it gets, named', () => {
  const missing = scan(PAGE, loadChecks());
  const stale = new Set(KNOWN_STALE.map((k) => k.check + '#' + k.id));
  const fresh = missing.filter((m) => !stale.has(m.check + '#' + m.id));
  assert.equal(fresh.length, 0, 'a browser check asks the page for an id it no longer has, so it will go red in the next cut, not in this test run:\n' + fresh.map(words).join('\n'));
});

test('KNOWN_STALE lists only checks that are still stale, so the list cannot outlive the rot it names', () => {
  const missing = new Set(scan(PAGE, loadChecks()).map((m) => m.check + '#' + m.id));
  for (const k of KNOWN_STALE) {
    assert.ok(missing.has(k.check + '#' + k.id), k.check + ' asks for #' + k.id + ' and the page now has it (or the check was restated): remove its KNOWN_STALE entry');
    assert.ok(fs.existsSync(path.join(DIR, k.check)), k.check + ' is gone; remove its KNOWN_STALE entry');
  }
});

test('control: removing one id the gate asks for is reported, with the line, the id and the nearest ids', () => {
  const checks = loadChecks();
  /* Pick an id the page has and a gate check asks for, from the scan's own
     tables, so the control follows the page as it changes. */
  const [file, src] = checks.find(([f]) => f === 'render-settings-nav.js');
  const asked = [...idsAskedFor(src).keys()].filter((id) => !id.endsWith('-') && new RegExp('\\bid="' + id + '"').test(PAGE));
  assert.ok(asked.length > 0, 'the control has nothing to remove; pick another check');
  const victim = asked[0];
  const mutated = PAGE.replace(new RegExp('\\bid="' + victim + '"', 'g'), 'id="' + victim + '-moved"');
  const before = scan(PAGE, [[file, src]]).filter((m) => m.id === victim);
  const after = scan(mutated, [[file, src]]).filter((m) => m.id === victim);
  assert.equal(before.length, 0, 'the control is already red before the removal');
  assert.equal(after.length, 1, 'removing #' + victim + ' from the page was not reported');
  assert.equal(after[0].check, file);
  assert.ok(after[0].line > 0);
  assert.ok(after[0].near.includes(victim + '-moved'), 'the red does not name the nearest id the page has: ' + JSON.stringify(after[0].near));
  assert.match(words(after[0]), /asks for #/);
});

test('absence assertions and hex colours are not asked-for ids; a trailing hyphen is a prefix', () => {
  const m = idsAskedFor("ok((await page.locator('#gone').count()) === 0, 'no skip');\nconst c = '#fff';\nawait page.click('#real-thing');\n// a comment naming #old-id\n// another comment, #older-id, on the next line\nawait p.goto(BASE + '/#settings');\nconst p = document.querySelector('#s-sec-');");
  assert.deepEqual([...m.keys()].sort(), ['real-thing', 's-sec-']);
});

module.exports = { scan, idsAskedFor, pageIds };

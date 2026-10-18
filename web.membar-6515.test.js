'use strict';
/* #6515 (Mona's #6511 review): on the Agents list, an unknown memory hides its empty dotted track (the dash says
   it), and ONLY there: the agent page's memory box draws the same `.bar.unknown` and keeps it. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const CSS = PAGE.replace(/\/\*[\s\S]*?\*\//g, '');

test('#6515: the list cell hides the unknown track, scoped to .lmem', () => {
  assert.match(CSS, /\.lmem \.bar\.unknown \{ visibility: hidden; \}/, 'the list row still draws the empty track');
});

test('#6515: no rule hides or removes the unknown track outside the list cell', () => {
  // indexOf, not one regex over the page: a regex with two open [^{}]* runs backtracked for ~20s on this file.
  const rules = [];
  for (let at = CSS.indexOf('.bar.unknown'); at !== -1; at = CSS.indexOf('.bar.unknown', at + 1)) {
    const open = CSS.indexOf('{', at);
    if (CSS.slice(at, open).includes('}')) continue;   // not a selector: no rule body follows it
    const start = Math.max(CSS.lastIndexOf('}', at), CSS.lastIndexOf('{', at), CSS.lastIndexOf(';', at)) + 1;
    rules.push(CSS.slice(start, CSS.indexOf('}', open) + 1));
  }
  assert.ok(rules.length >= 2, 'expected the track rules to be found (control)');
  for (const r of rules) {
    if (!/visibility:\s*hidden|display:\s*none|opacity:\s*0(?![.\d])/.test(r)) continue;
    const sel = r.slice(0, r.indexOf('{')).trim();
    assert.match(sel, /^\.lmem \.bar\.unknown$/, `a hide rule reaches beyond the list cell: ${sel}`);
  }
});

test('#6515: the agent page memory box is not inside .lmem, so it keeps its track', () => {
  const at = PAGE.indexOf('function memoryBox(');
  assert.notEqual(at, -1, 'memoryBox is not where this check expects it');
  const body = PAGE.slice(at, PAGE.indexOf('\n}', at));
  assert.match(body, /bar unknown/, 'the agent page no longer draws the unknown track');
  assert.doesNotMatch(body, /lmem/, 'the agent page memory box sits inside .lmem and would lose its track');
});

'use strict';
/**
 * #3679: now that the store keeps indentation, both message renderers draw a nested
 * list item at its depth (two spaces a level, up to three) instead of flat.
 * pjProse is the project room thread; pjRich is the DM/talk dialog and the project
 * message list. A top-level item's markup is unchanged, which the older richtext
 * checks pin byte for byte. Lifts the REAL renderers from web/index.html.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const lift = (names) => names.map((n) => page.lift(SCRIPT, n)).join('\n');
const CONSTS = ['LIST_DEPTH_SPACES', 'LIST_DEPTH_MAX'].map((c) => {
  const m = new RegExp('const ' + c + ' = (\\d+);').exec(SCRIPT);
  if (!m) throw new Error('no ' + c + ' in the page');
  return 'const ' + c + ' = ' + m[1] + ';';
}).join('\n');
const DEPS = ['esc', 'pjRichSpans', 'pjTableCells', 'pjTableAligns', 'pjTableHtml', 'pjListDepth'];
const RENDERERS = [
  ['pjProse', () => new Function(CONSTS + '\n' + lift(DEPS.concat(['pjProse'])) + '\nreturn pjProse;')()],
  ['pjRich', () => new Function(CONSTS + '\n' + lift(DEPS.concat(['pjRich'])) + '\nreturn pjRich;')()],
];

for (const [name, make] of RENDERERS) {
  test(`#3679: ${name} draws nested list items at their depth`, () => {
    const html = make()('- a\n  - b\n    - c\n      - d\n        - e');
    assert.match(html, /<span class="mdli">a<\/span>/, `${name}: a top-level item changed`);
    assert.match(html, /<span class="mdli mdli-d1">b<\/span>/, `${name}: depth 1`);
    assert.match(html, /<span class="mdli mdli-d2">c<\/span>/, `${name}: depth 2`);
    assert.match(html, /<span class="mdli mdli-d3">d<\/span>/, `${name}: depth 3`);
    assert.match(html, /<span class="mdli mdli-d3">e<\/span>/, `${name}: deeper than three stays at three`);
  });

  test(`#3679: ${name} keeps a numbered item's number and gives it a depth`, () => {
    const html = make()('1. one\n   2. two');
    assert.match(html, /<span class="mdli mdlin" data-n="1\.">one<\/span>/, `${name}: a top-level numbered item changed`);
    assert.match(html, /<span class="mdli mdlin mdli-d1" data-n="2\.">two<\/span>/, `${name}: nested numbered item`);
  });

  test(`#3679: ${name} reads a tab as a level of indentation`, () => {
    assert.match(make()('- a\n\t- b'), /<span class="mdli mdli-d2">b<\/span>/, `${name}: a tab is four spaces, two levels`);
  });
}

test('#3679: the page styles each depth on every surface that shows these items', () => {
  const max = Number(/const LIST_DEPTH_MAX = (\d+);/.exec(SCRIPT)[1]);
  assert.equal(PAGE.includes('.mdli-d' + (max + 1)), false, 'a style for a depth the renderer never emits');
  for (let d = 1; d <= max; d += 1) {
    for (const host of ['.dm-b', '.pj-msg-text', '.msg-b', '.tkdetail']) {
      assert.ok(PAGE.includes(host + ' .mdli-d' + d), `no ${host} rule for depth ${d}`);
    }
  }
});

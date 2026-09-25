'use strict';
/**
 * #3679: now that the store keeps indentation, both message renderers draw a nested
 * list item at its depth (relative to the item above, up to three) instead of flat.
 * pjProse is the project room thread; pjRich is the DM/talk dialog and the project
 * message list. Depth is relative to the item above, so it does not depend on how wide a level
 * is, and it reads raw text on surfaces the store never touched (a task's detail, an
 * agent-to-agent message). A top-level item's
 * markup is unchanged, which the older richtext
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
const DEPS = ['esc', 'pjRichSpans', 'pjTableCells', 'pjTableAligns', 'pjTableHtml', 'pjListDepth'];
const RENDERERS = [
  ['pjProse', () => new Function(lift(DEPS.concat(['pjProse'])) + '\nreturn pjProse;')()],
  ['pjRich', () => new Function(lift(DEPS.concat(['pjRich'])) + '\nreturn pjRich;')()],
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

  test(`#3679: ${name} counts a level per step in, whatever its width`, () => {
    assert.match(make()('- a\n\t- b'), /<span class="mdli mdli-d1">b<\/span>/, `${name}: a tab is one level`);
    const four = make()('- a\n    - b\n        - c\n    - d\n- e');
    assert.match(four, /<span class="mdli mdli-d1">b<\/span>/, `${name}: four spaces is one level`);
    assert.match(four, /<span class="mdli mdli-d2">c<\/span>/, `${name}: eight is two`);
    assert.match(four, /<span class="mdli mdli-d1">d<\/span>/, `${name}: back out to one`);
    assert.match(four, /<span class="mdli">e<\/span>/, `${name}: back to the top`);
  });

  test(`#3679: ${name} keeps the depth across a fence, table or heading nested in an item`, () => {
    for (const inner of ['    ```\n    code\n    ```', '    | A | B |\n    | --- | --- |\n    | 1 | 2 |', '    ## note']) {
      const html = make()('- a\n  - nested\n' + inner + '\n  - nested sibling\n- top');
      assert.match(html, /<span class="mdli mdli-d1">nested sibling<\/span>/, `${name}: depth lost after ${JSON.stringify(inner)}`);
      assert.match(html, /<span class="mdli">top<\/span>/, `${name}: back to the top after ${JSON.stringify(inner)}`);
    }
  });

  test(`#3679: ${name} starts a new list's depth after a non-list line, not after a blank one`, () => {
    const html = make()('- a\n  - b\n\n  - c\ntext\n  - d');
    assert.match(html, /<span class="mdli mdli-d1">c<\/span>/, `${name}: a blank line keeps the list`);
    assert.match(html, /<span class="mdli">d<\/span>/, `${name}: a paragraph ends it`);
  });
}

test('#3679: pjRich reads a fence as the store does: an inline ```span``` line is not one', () => {
  const fn = RENDERERS.find(([n]) => n === 'pjRich')[1]();
  const inline = fn('```x``` then\n- a');
  assert.doesNotMatch(inline, /class="mdcb"/, 'an inline span opened a code block');
  assert.match(inline, /<span class="mdli">a<\/span>/, 'the list after it was swallowed');
  assert.match(fn('```js\ncode\n```'), /<span class="mdcb">code<\/span>/, 'CONTROL: a real fence still makes a code block');
  assert.match(fn('````md\n```js\nx\n```\n````'), /<span class="mdcb">```js\nx\n```<\/span>/, 'a four-backtick fence holds a three-backtick example');
});

test('#3679: every test that lifts a renderer also lifts pjListDepth, so a list fixture cannot throw', () => {
  for (const f of ['web.dialog-md-2701.test.js', 'web.links-everywhere.test.js', 'web.agent-answers.test.js']) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    const lists = src.match(/\[[^\]]*'pjRichSpans'[^\]]*\]/g) || [];
    assert.ok(lists.length > 0, 'CONTROL: found no lift list in ' + f);
    for (const l of lists) assert.ok(l.includes("'pjListDepth'"), f + ': a lift list without pjListDepth: ' + l.slice(0, 80));
  }
});

test('#3679: the page styles each depth on every surface that shows these items', () => {
  const max = Number(/const LIST_DEPTH_MAX = (\d+);/.exec(page.lift(SCRIPT, 'pjListDepth'))[1]);
  assert.equal(PAGE.includes('.mdli-d' + (max + 1)), false, 'a style for a depth the renderer never emits');
  for (let d = 1; d <= max; d += 1) {
    for (const host of ['.dm-b', '.pj-msg-text', '.msg-b', '.tkdetail']) {
      assert.ok(PAGE.includes(host + ' .mdli-d' + d), `no ${host} rule for depth ${d}`);
    }
  }
});

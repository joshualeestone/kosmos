'use strict';
/**
 * kosmos#1004, Josh: "sometimes the boxes are kind of rammed together".
 *
 * That complaint had a literal cause. In Settings > This computer the tmux box
 * opened INSIDE the "Keeping agents running" box instead of after it, so a
 * `.dbox` was drawn inside a `.dbox`. There is no `.dbox .dbox` rule, so both
 * drew their own background, 1px border, 16px radius and 22px/24px padding: a
 * bordered card inset inside another bordered card and pressed against its
 * bottom padding.
 *
 * ⭐ IT WAS ONE UNBALANCED CLOSING TAG, arriving with #330/#437 on 2026-08-23,
 * and it is invisible in a diff. Nothing about the source reads as wrong; the
 * boxes are written one after another and only the tag depth says otherwise.
 *
 * 🛑 SO THE GUARD IS STRUCTURAL AND NOT ABOUT THIS BOX. Pinning "the tmux box
 * is a sibling" would pass the moment somebody nested a different pair, which is
 * the same edit made one screen along. The claim worth holding is that a settings
 * box never contains another settings box, anywhere on the page.
 *
 *   node --test web.dbox-nesting.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

/** Every `<section class="dbox">` whose open tag sits inside another open dbox. */
function nestedBoxes(html) {
  const tags = [...html.matchAll(/<section[^>]*>|<\/section>/g)];
  const bad = [];
  const stack = [];
  for (const m of tags) {
    if (m[0].startsWith('</')) { stack.pop(); continue; }
    const isBox = /class="[^"]*\bdbox\b/.test(m[0]);
    if (isBox && stack.includes('dbox')) {
      bad.push(html.slice(0, m.index).split('\n').length);
    }
    stack.push(isBox ? 'dbox' : 'other');
  }
  return bad;
}

test('no settings box is drawn inside another settings box', () => {
  assert.deepEqual(nestedBoxes(PAGE), [],
    'a .dbox inside a .dbox draws two borders and two paddings, which is the "rammed together" defect');
});

test('CONTROL: the check finds a nested box when there is one', () => {
  const broken = '<section class="dsec"><section class="dbox">a'
    + '<section class="dbox">b</section></section></section>';
  assert.equal(nestedBoxes(broken).length, 1, 'it must be able to return the dangerous answer');
  const fine = '<section class="dsec"><section class="dbox">a</section>'
    + '<section class="dbox">b</section></section>';
  assert.deepEqual(nestedBoxes(fine), [], 'and must not fire on correct siblings');
});

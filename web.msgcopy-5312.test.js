'use strict';
/* #5312: on a touchscreen the hover bar hides Copy message id (CSS) and its Copy opens the menu with both (script,
 * msgCopyTouch). The two decisions must read the same test, or a touch bar could lose Copy message id while its Copy
 * copies instead of opening the menu. This pins that the hide rule sits inside the (hover: none) block, and that the
 * script's PJ_TOUCH_MQ is that same query. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test('#5312: the touch bar hides Copy message id inside the (hover: none) block the script reads', () => {
  const rule = '#pj-room .rxn-quick .rxn-ref, #d-dmthread .rxn-quick .rxn-ref { display: none; }';
  const at = html.indexOf(rule);
  assert.ok(at > 0, 'the hide rule is found');
  assert.equal(html.indexOf(rule, at + 1), -1, 'once');
  const open = html.lastIndexOf('@media', at);
  const head = html.slice(open, html.indexOf('{', open));
  assert.equal(head.trim(), '@media (hover: none)', 'the nearest @media before it is the touch block');
  // Still inside it: braces from the block's own { to the rule never close the block.
  let depth = 0;
  for (let i = html.indexOf('{', open); i < at; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; assert.ok(depth >= 1, 'the touch block closed before the rule (at ' + i + ')'); }
  }
  const mq = /const PJ_TOUCH_MQ = '([^']+)';/.exec(html);
  assert.ok(mq, 'PJ_TOUCH_MQ is declared');
  assert.equal(mq[1], '(hover: none)', 'the script asks the same question as the CSS');
  const fn = html.slice(html.indexOf('function msgCopyTouch()'), html.indexOf('function msgCopyButton()'));
  assert.ok(fn.length > 0 && fn.length < 400, 'msgCopyTouch is found, just before msgCopyButton');
  assert.match(fn, /window\.matchMedia\(PJ_TOUCH_MQ\)\.matches/, 'msgCopyTouch reads PJ_TOUCH_MQ');
});

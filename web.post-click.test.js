'use strict';
/**
 * #752: clicking Post in a project room must post the text, and the click
 * binding is the thing that was wrong, so this goes THROUGH the binding: the
 * real statement is lifted out of the page and run against a recording
 * element and a recording pjPostSend, then a MouseEvent is fired at the
 * listener it registered. A test that called pjPostSend with the right
 * arguments would have passed all along.
 *
 *   node --test web.post-click.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = require('./test-support/page');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = page.scriptOf(PAGE);

/** Run one binding statement for `id` in a sandbox; answer what a click delivers to the handler. */
function clickThrough(statement, handlerName) {
  const listeners = {};
  const calls = [];
  const el = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  const ctx = { document: { getElementById: (id) => (id === 'pj-post-go' ? el : null) } };
  ctx[handlerName] = (...args) => { calls.push(args); };
  vm.runInNewContext(statement, ctx);
  assert.ok(listeners.click, 'the statement registered no click listener');
  const event = { type: 'click', target: el, preventDefault() {} };
  listeners.click(event);
  return { calls, event };
}

const bindingRe = /document\.getElementById\('pj-post-go'\)\.addEventListener\('click',[^\n]*\);/;

test('a mouse click on Post reaches pjPostSend with NO attachment, so the room posts the text', () => {
  const m = SCRIPT.match(bindingRe);
  assert.ok(m, 'the Post button no longer binds a click in the shape this test knows');
  const { calls, event } = clickThrough(m[0], 'pjPostSend');
  assert.equal(calls.length, 1, 'one click, one post');
  assert.ok(!calls[0].includes(event), 'the MouseEvent reached pjPostSend as an argument: it would be posted as an attachment');
  assert.equal(calls[0][0], undefined, 'the attachment slot must be empty on a plain click');
});

test('CONTROL: the shipped-wrong binding is caught by this test', () => {
  const wrong = "document.getElementById('pj-post-go').addEventListener('click', pjPostSend);";
  const { calls, event } = clickThrough(wrong, 'pjPostSend');
  assert.equal(calls[0][0], event, 'the control did not reproduce the defect, so the test above proves nothing');
});

test('Enter still posts, and posts the same way: no attachment', () => {
  assert.match(SCRIPT, /e\.key === 'Enter' && !e\.shiftKey\) \{ e\.preventDefault\(\); pjPostSend\(\); \}/,
    'the keyboard road changed shape; it must call pjPostSend() with nothing');
});

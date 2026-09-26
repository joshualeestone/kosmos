'use strict';

/**
 * #4038 (Josh, 2026-09-26: "Change picture for an agent doesn't seem to be working"): the agent page's Change picture
 * button is never a silent no-op. Reproduced on the live board: on an untied agent the visible button stayed live
 * while its hidden input was disabled, so the click opened nothing and said nothing. setWritesOffered is tested with
 * the real function in server.test.js; this pins the withdrawn arm, the click guard and the same-file reset.
 *
 *   node --test web.avatar-4038.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test('the withdrawn arm disables the visible button with its hidden input', () => {
  const m = PAGE.match(/for \(const id of \[([^\]]*'d-start-agent'[^\]]*)\]\)/);
  assert.ok(m, 'the withdrawn arm moved; update this test');
  assert.match(m[1], /'d-file'/);
  assert.match(m[1], /'d-file-btn'/, 'the withdrawn arm left Change picture live over a disabled input');
});

test('the button says why when its input is disabled, and otherwise opens the picker', () => {
  const start = PAGE.indexOf("document.getElementById('d-file-btn').addEventListener('click', () => {");
  assert.ok(start > -1, 'the click handler moved; update this test');
  const body = PAGE.slice(start, PAGE.indexOf('\n});', start));
  const run = (inputDisabled) => {
    const els = { 'd-file': { disabled: inputDisabled, clicked: 0, click() { this.clicked += 1; } }, 'd-msg': { textContent: '' } };
    let handler = null;
    const document = { getElementById: (id) => (id === 'd-file-btn' ? { addEventListener: (_, fn) => { handler = fn; } } : els[id]) };
    new Function('document', body + '\n});')(document);
    handler();
    return els;
  };
  const off = run(true);
  assert.equal(off['d-file'].clicked, 0);
  assert.match(off['d-msg'].textContent, /cannot be changed from here/, 'a click on a disabled input said nothing');
  const on = run(false);
  assert.equal(on['d-file'].clicked, 1, 'CONTROL: a live input was not clicked');
  assert.equal(on['d-msg'].textContent, '');
});

test('the input is cleared on every change, so the same file can be chosen again', () => {
  const start = PAGE.indexOf("document.getElementById('d-file').addEventListener('change', async (e) => {");
  assert.ok(start > -1, 'the change handler moved; update this test');
  const head = PAGE.slice(start, start + 600);
  assert.match(head, /e\.target\.value = '';\s*(?:\/\/[^\n]*\n\s*)*if \(!f \|\| !CURRENT\) return;/, 'the value is not cleared before the early return');
});

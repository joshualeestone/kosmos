'use strict';

/**
 * #4038 (Josh, 2026-09-26: "Change picture for an agent doesn't seem to be working"): the agent page's Change picture
 * button is never a silent no-op. Reproduced on the live board: on an untied agent the visible button stayed live
 * while its hidden input was disabled, so the click opened nothing and said nothing. setWritesOffered is tested with
 * the real function in server.test.js; this pins the withdrawn arm, the named reason and the same-file reset.
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

test('the disabled button points at the sentence that says why', () => {
  /* A natively disabled button fires no click and leaves the tab order, so the reason cannot be a click message:
     it is the page's #d-untied / #d-withdrawn sentence, which the button names for assistive tech. */
  const m = PAGE.match(/<button[^>]*id="d-file-btn"[^>]*>/);
  assert.ok(m, 'the Change picture button moved; update this test');
  const ids = ((m[0].match(/aria-describedby="([^"]*)"/) || [])[1] || '').split(/\s+/);
  assert.ok(ids.includes('d-untied') && ids.includes('d-withdrawn'), 'the button does not name the reason: ' + m[0]);
  for (const id of ids) assert.match(PAGE, new RegExp('<p id="' + id + '"'), 'aria-describedby names a missing element: ' + id);
});

test('the input is cleared on every change, so the same file can be chosen again', () => {
  const start = PAGE.indexOf("document.getElementById('d-file').addEventListener('change', async (e) => {");
  assert.ok(start > -1, 'the change handler moved; update this test');
  const head = PAGE.slice(start, start + 600);
  assert.match(head, /e\.target\.value = '';\s*(?:\/\/[^\n]*\n\s*)*if \(!f \|\| !CURRENT\) return;/, 'the value is not cleared before the early return');
});

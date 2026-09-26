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

test('the button names its reason only while disabled, and only the reason that applies', () => {
  /* A natively disabled button fires no click and leaves the tab order, so the reason is the page's #d-untied or
     #d-withdrawn sentence, named by aria-describedby. A hidden element still describes whatever points at it, so a
     button that is live again must point at nothing (a stale withdrawn sentence would be read on a working button). */
  assert.doesNotMatch(PAGE, /<button[^>]*id="d-file-btn"[^>]*aria-describedby/, 'a static aria-describedby describes the live button too');
  const start = PAGE.indexOf('function setWritesOffered(');
  assert.ok(start > -1, 'setWritesOffered moved; update this test');
  let depth = 0; let end = -1;
  for (let k = PAGE.indexOf('{', start); k < PAGE.length; k += 1) {
    if (PAGE[k] === '{') depth += 1;
    else if (PAGE[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  const els = {};
  const el = () => { const attrs = {}; return { disabled: false, hidden: false, textContent: '', value: '', attrs,
    setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; } }; };
  const document = { getElementById: (id) => (els[id] = els[id] || el()) };
  const run = new Function('document', 'let INSTR_READY, INSTR_BANNER, INSTR_VERSION;\n' + PAGE.slice(start, end)
    + '\nreturn setWritesOffered;')(document);
  run({ sessionName: 'outsider' }, false);
  assert.equal(els['d-file-btn'].disabled, true);
  assert.equal(els['d-file-btn'].attrs['aria-describedby'], 'd-untied', 'an untied button does not name its reason');
  run({ sessionName: 'april' }, true);
  assert.equal(els['d-file-btn'].disabled, false, 'CONTROL: a tied agent\'s button is live');
  assert.equal(els['d-file-btn'].attrs['aria-describedby'], undefined, 'a live button still points at a reason');
  // The withdrawn arm names its own sentence.
  const w = PAGE.match(/for \(const id of \[[^\]]*'d-start-agent'[^\]]*\]\) \{[\s\S]{0,200}?\}\n([^\n]*)/);
  assert.ok(w, 'the withdrawn arm moved; update this test');
  assert.match(w[1], /getElementById\('d-file-btn'\)\?\.setAttribute\('aria-describedby', 'd-withdrawn'\)/, 'the withdrawn button does not name its reason');
});

test('the input is cleared on every change, so the same file can be chosen again', () => {
  const start = PAGE.indexOf("document.getElementById('d-file').addEventListener('change', async (e) => {");
  assert.ok(start > -1, 'the change handler moved; update this test');
  const head = PAGE.slice(start, start + 600);
  assert.match(head, /e\.target\.value = '';\s*(?:\/\/[^\n]*\n\s*)*if \(!f \|\| !CURRENT\) return;/, 'the value is not cleared before the early return');
});

'use strict';

/**
 * #5551 (V2, Josh's drawing of 2026-10-09): the agent page's way back.
 * - Opened from a project (#2574), Back returns to that project, but its link said "All agents" anyway. detailBackPaint
 *   names where Back goes, in both looks.
 * - In the new look only, the conversation's header row carries a round Back button and that name in front of Josh's
 *   ruled heading (#3414). Off by default: in today's look the row is display:none.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

function lift(name) {
  const start = PAGE.indexOf('function ' + name + '(');
  assert.ok(start > 0, name + ' is on the page');
  let depth = 0;
  for (let i = PAGE.indexOf('{', start); i < PAGE.length; i++) {
    if (PAGE[i] === '{') depth++;
    else if (PAGE[i] === '}' && --depth === 0) return PAGE.slice(start, i + 1);
  }
  throw new Error('unbalanced ' + name);
}

function paint(fromProject, projects) {
  const els = {};
  const el = () => ({ textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  for (const id of ['detail-back', 'd-crumb-root', 'd-crumb-back']) els[id] = el();
  const ctx = { DETAIL_FROM_PROJECT: fromProject, PROJECTS: projects, document: { getElementById: (id) => els[id] } };
  vm.runInNewContext(lift('detailBackPaint') + '\ndetailBackPaint();', ctx);
  return { back: els['detail-back'].textContent, root: els['d-crumb-root'].textContent, aria: els['d-crumb-back'].attrs['aria-label'] };
}

test('#5551: the way back names the project the agent was opened from', () => {
  assert.deepEqual(paint('p1', [{ id: 'p0', name: 'Other' }, { id: 'p1', name: 'Billing' }]),
    { back: '← Billing', root: 'Billing', aria: 'Back to Billing' });
});

test('#5551: opened from anywhere else, it says All agents', () => {
  assert.deepEqual(paint(null, [{ id: 'p1', name: 'Billing' }]),
    { back: '← All agents', root: 'All agents', aria: 'Back to All agents' });
});

test('#5551: a project not loaded yet never reads "All agents" (the click would go to the project)', () => {
  const r = paint('p9', [{ id: 'p1', name: 'Billing' }]);
  assert.equal(r.root, 'Project');
  assert.notEqual(r.back, '← All agents');
  assert.equal(paint('p9', null).root, 'Project');
});

test('#5551: openDetail paints it, and the new controls press #detail-back (one place decides where Back goes)', () => {
  assert.match(PAGE, /DETAIL_FROM_PROJECT = fromProject \|\| null;\n\s*if \(typeof detailBackPaint === 'function'\) detailBackPaint\(\);/);
  assert.match(PAGE, /for \(const id of \['d-crumb-back', 'd-crumb-root'\]\) \{\n\s*document\.getElementById\(id\)\.addEventListener\('click', \(\) => document\.getElementById\('detail-back'\)\.click\(\)\);/);
});

test('#5551: the header row is off unless the new look is on', () => {
  assert.match(PAGE, /\n\.d-crumb-back, \.d-crumb-rootwrap \{ display: none; \}/, 'hidden by default');
  // Every rule that shows the row, or hides today's link, is under the new look.
  const lines = PAGE.split('\n').filter((l) => /d-crumb-(back|rootwrap)[^{]*\{[^}]*display: (grid|inline-flex)|> #detail-back \{ display: none/.test(l));
  assert.ok(lines.length >= 3, 'found the showing rules: ' + lines.length);
  for (const l of lines) assert.match(l, /:root\[data-look="new"\] body:not\(\.consolidated\)/, l.trim().slice(0, 120));
});

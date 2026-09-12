'use strict';
/**
 * kosmos#768: the task page's three-column reflow (.tk3).
 *
 * These assertions back a claim made in a CSS comment: that .tk3 stacks to one
 * column by TWO separate paths, gated differently. A blind review (challenge-loop)
 * caught the original comment asserting it "collapses cleanly in the narrow
 * consolidated column" when the code did not do that -- the 52rem viewport query
 * cannot fire in the consolidated layout, which is floored at 60rem. Rather than
 * reword the comment into a softer prose claim, the consolidated stack rule was
 * added and this test pins both rules, so the claim is guarded rather than asserted.
 *
 *   node --test web.task-reflow-768.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

test('.tk3 is a three-column grid', () => {
  assert.match(
    PAGE,
    /\.tk3 \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1\.4fr\) minmax\(0, 0\.9fr\);/,
    'the .tk3 base rule is no longer the three-column grid the reflow defines',
  );
});

test('.tk3 stacks to one column on a narrow viewport (phone)', () => {
  assert.match(
    PAGE,
    /@media \(max-width: 52rem\) \{ \.tk3 \{ grid-template-columns: minmax\(0, 1fr\); \} \}/,
    'the 52rem viewport stack for .tk3 is gone, so it will not collapse on a phone',
  );
});

test('.tk3 also stacks to one column in the consolidated layout', () => {
  // The 52rem viewport query cannot fire in consolidated (floored at 60rem), so a
  // layout-scoped rule is what actually stacks it there. Without this the panel
  // would render three cramped columns.
  assert.match(
    PAGE,
    /html\[data-layout="consolidated"\] body\.consolidated #pj-task-view \.tk3 \{ grid-template-columns: minmax\(0, 1fr\); \}/,
    'the consolidated-layout stack for .tk3 is gone, so the compact panel would show three cramped columns',
  );
});

test('the old .pj2 grid this view used is fully removed', () => {
  // .pj2 was used only by the task view; the reflow replaced it with .tk3. A
  // lingering .pj2 rule would be dead CSS and a sign the reflow half-landed.
  assert.equal(
    PAGE.includes('.pj2 {'),
    false,
    'a .pj2 rule is still present after the reflow replaced it with .tk3',
  );
});

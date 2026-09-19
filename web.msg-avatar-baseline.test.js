'use strict';
/**
 * Message-thread avatar baseline + tightened gaps (Josh 2026-09-19).
 *
 * Josh asked for the message avatars to sit on the bubble's bottom baseline (they were
 * hanging below it), and for the inter-message gaps to tighten while leaving room for the
 * hover emoji popout. The fix, all in web/index.html CSS:
 *   - the empty reaction row (.rxns with only the hover-only .rxn-quick bar) no longer
 *     reserves height, so the flex-end avatar sits on the bubble bottom instead of below a
 *     reserved strip;
 *   - the hover popout (.rxn-quick) floats out of flow, above the bubble;
 *   - the agent body (.msg:not(.you) .msg-b) shrink-wraps to its bubble so the popout's
 *     right:0 anchors to the bubble's right edge, not the full column width (a blind review
 *     caught that anchoring to the full-width column floated the popout in blank space to the
 *     right of a left-aligned agent bubble, the DEFAULT agent case).
 *
 * These are source-rule pins (a revert of any of them reds this). Geometry is verified
 * separately by render (see the plan) and the served render-room-msgbox / render-reactions
 * browser-checks exercise the live thread.
 *
 *   node --test web.msg-avatar-baseline.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync(process.env.PLUS_PAGE || 'web/index.html', 'utf8');

test('the avatar is bottom-aligned to the bubble (.msg align-items: flex-end)', () => {
  // The base .msg row rule (display:flex + align-items:flex-end), anchored so a differently
  // scoped ".msg" selector elsewhere cannot satisfy it.
  assert.match(PAGE, /\.msg\s*\{\s*display:\s*flex;\s*align-items:\s*flex-end/,
    'the .msg row lost align-items:flex-end, so the avatar is no longer bottom-aligned');
});

test('an EMPTY reaction row reserves no height, so the avatar sits on the bubble baseline', () => {
  // With only the hover-only quick bar and no .rxn pills, the reaction row must add no
  // height; otherwise the flex-end avatar drops below the bubble (the "avatars hang low" bug).
  assert.match(PAGE, /\.rxns:not\(:has\(\.rxn\)\)\s*\{[^}]*margin-top:\s*0/,
    'the empty-reaction-row collapse (.rxns:not(:has(.rxn)) margin-top:0) is gone');
});

test('the hover popout floats out of flow, anchored to the bubble RIGHT edge', () => {
  // The .rxn-quick rule: out of flow (so the empty row reserves no height) and right-anchored.
  assert.match(PAGE, /\.rxn-quick\s*\{[^}]*position:\s*absolute/,
    '.rxn-quick must be position:absolute (out of flow, so the empty row reserves no height)');
  assert.match(PAGE, /\.rxn-quick\s*\{[^}]*right:\s*0/, '.rxn-quick must anchor right:0');
  // The anchor is only correct if the agent body shrink-wraps to its bubble; without this,
  // right:0 is the full column width and the popout floats in blank space right of the bubble.
  assert.match(PAGE, /\.msg:not\(\.you\)\s+\.msg-b\s*\{[^}]*flex:\s*0\s+1\s+auto/,
    'the agent .msg-b shrink-wrap (flex:0 1 auto) is gone, so the popout would float right of the agent bubble');
  // The popout's z-index is scoped to its own message (the base .msg-b rule).
  assert.match(PAGE, /\.msg-b\s*\{\s*flex:\s*1;[^}]*isolation:\s*isolate/,
    '.msg-b lost isolation:isolate, so the popout z-index escapes its message stacking context');
});

test('a message WITH reactions keeps its in-flow pills row (collapse is scoped to empty rows)', () => {
  // The collapse is :not(:has(.rxn)); a row that has pills keeps the base .rxns margin-top,
  // so live reactions still render below the bubble as before.
  assert.match(PAGE, /\.rxns\s*\{[^}]*margin-top:\s*6px/,
    'the base .rxns row lost its margin-top, so reaction pills would sit flush against the bubble');
});

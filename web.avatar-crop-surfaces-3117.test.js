'use strict';

/**
 * #3117: the non-.lav avatar surfaces that pinned `height: 100%` on their <img>.
 *
 * Follow-up to #3110. The class: an avatar <img> with `height: 100%` inside a
 * fixed circular box whose layout lets the height resolve against the image's
 * intrinsic height, so a portrait photo renders NON-square (a top-anchored crop
 * on an overflow:hidden box, or an ellipse where the box drops its clip). The
 * one-liner `height: auto; aspect-ratio: 1` (object-fit: cover already crops)
 * squares the img element regardless of the container's display model.
 *
 * Measured per surface with pw-runtime against a 12x44 portrait source
 * (revert control in the same run):
 *   railme-face   24x88  -> 24x24   (bug fixed)
 *   msg-av        34x125 -> 34x34   (bug fixed; the exact 34x125 #3110 traced)
 *   userpop-face  26x95  -> 26x26   (bug fixed)
 *   hub.haspic   104x381 -> 104x104 (bug fixed)
 *   onode .face  44x161  -> 44x44   (bug fixed; the real org-chart avatar is an
 *                                    HTML <img> in a .onode button, not the SVG
 *                                    face() gauge - a blind reviewer caught the
 *                                    wrong exclusion premise, re-measured here)
 *   detail-av     70x70  -> 70x70   (already square under its flex container;
 *                                    the rule is applied for uniformity, and
 *                                    aspect-ratio:1 keeps it square if the box
 *                                    ever becomes a grid like its siblings)
 *
 * NOT included: `.lav.youav img` (operator avatar). A reviewer flagged it as
 * still pinning height:100%, but it MEASURED 56x56 both arms (fix and revert) -
 * no bug. It is also a .lav surface, outside this card's non-.lav scope. The
 * exact cascade that keeps it square is not asserted here (a couple of plausible
 * mechanisms were proposed and none was pinned); the two-arm measurement is the
 * evidence, and it is what this exclusion rests on.
 *
 * This is the source-pin regression guard (the same shape web.consolidated-
 * avatar-crop.test.js uses for `.lav img`): it fails if any surface silently
 * reverts to `height: 100%`. The live geometry proof is the pw-runtime run above.
 *
 *   node --test web.avatar-crop-surfaces-3117.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

const SURFACES = [
  ['railme-face', /html\[data-layout="consolidated"\] body\.consolidated \.railme-face img \{ width: 100%; height: auto; aspect-ratio: 1; object-fit: cover; \}/],
  ['msg-av',      /\.msg-av img \{ width: 100%; height: auto; aspect-ratio: 1; object-fit: cover; \}/],
  ['detail-av',   /\.detail-av img \{ width: 100%; height: auto; aspect-ratio: 1; object-fit: cover; \}/],
  ['userpop-face',/\.userpop-face img \{ width: 100%; height: auto; aspect-ratio: 1; object-fit: cover; display: block; \}/],
  ['hub.haspic',  /\.hub\.haspic img \{ display: block; width: 100%; height: auto; aspect-ratio: 1; object-fit: cover; \}/],
  ['onode .face', /\.onode \.face img \{ display: block; width: 100%; height: auto; aspect-ratio: 1; object-fit: cover; \}/],
];

for (const [name, re] of SURFACES) {
  test(`${name} avatar img is squared with aspect-ratio:1, not height:100% (#3117)`, () => {
    assert.match(PAGE, re,
      `${name} img lost aspect-ratio:1 / regained height:100% -- a portrait photo will render non-square (#3117/#3110)`);
  });
}

test('none of the #3117 surfaces still carry the pre-fix `height: 100%` on their img rule', () => {
  /* The control: the exact defective form must be GONE from each surface's img rule.
     A guard that only checks the fixed form is present cannot see a duplicate rule
     later re-introducing the bug; this asserts the bad shape is absent per selector. */
  for (const bad of [
    /\.railme-face img \{[^}]*height: 100%/,
    /\.msg-av img \{[^}]*height: 100%/,
    /\.detail-av img \{[^}]*height: 100%/,
    /\.userpop-face img \{[^}]*height: 100%/,
    /\.hub\.haspic img \{[^}]*height: 100%/,
    /\.onode \.face img \{[^}]*height: 100%/,
  ]) {
    assert.doesNotMatch(PAGE, bad, `a #3117 avatar img rule still pins height: 100% (${bad})`);
  }
});

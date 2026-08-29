"use strict";
/**
 * Josh, #chaoskosmos-design, 2026-08-25 15:52, five screenshots: "The agent
 * avatars are not cropped properly on the agents column. You can see it's
 * showing a square image over top of a circle instead of cropping them
 * properly to a circle."
 *
 * Root cause: `.lav` normally clips its child to a circle via
 * `overflow: hidden` (its own `border-radius: 50%` alone does not clip
 * children -- only `overflow` does that). The consolidated rail's own CSS
 * switches `.lav` to `overflow: visible` so the memory ring (`.lring`,
 * absolutely positioned, drawn outside the avatar's box) can extend past
 * it. That also drops the clip on a real avatar photo, which has no
 * border-radius of its own -- so it rendered as a plain square sitting on
 * top of `.lav`'s still-circular background. The initials fallback
 * (`.lavtint`) was never affected: it already carries its own
 * `border-radius: 50%`.
 *
 *   node --test web.consolidated-avatar-crop.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

/* #1430: the assertions below no longer end at their rule's closing brace, so an
   appended declaration is not a red that looks like a product bug. That is how
   main went down at step 3 under #1310.

   The absence-shaped promise here is `\.lrow > \.lav { ... background: none; }`:
   a later `background:` in the same rule would override it unseen.

   ⚠️ THREE THINGS IT DOES NOT COVER, and all three are real. An open tail cannot
   see a SAME-RULE OVERRIDE. It tolerates an APPEND but NOT a declaration INSERTED
   between the promised ones -- #1310 happened to append; had it grouped the
   property differently this would not have prevented it. And a SAME-SELECTOR,
   LATER-RULE override is invisible to any text pin, loosened or not: if the sheet
   declares the selector twice the later rule wins, and an assertion on the earlier
   one is GREEN when the behaviour breaks and RED on a no-op. Three instances were
   found in this tree and all three are now FIXED with cascade-resolving checks --
   two by #1476 itself, and a third here that #1476's guard could not see because
   both declarations carried the same VALUE.

   ⚠️ AND LOOSENING HAS A COST FOR THAT GUARD, DISCLOSED RATHER THAN LEFT TO BE
   FOUND: web.cascade-shadowed-pins-1476.test.js matches on a rule WITH its closing
   brace, so dropping the brace takes these files out of its reach. Measured: on
   main it sees 3 such assertions in the files this branch touches, on this branch
   it sees 0. Nothing fails today. The guard wants a brace-optional matcher, and
   that is #1469's territory rather than something to patch quietly here.

   🔑 So the four-arm proof behind this change establishes that each assertion
   tracks the rule TEXT. It does NOT establish that the rule GOVERNS.

   🛑 NOT MECHANICALLY ENFORCED (#1469). A guard was built and removed rather than
   shipped: it was blind to the very spelling that caused #1310, and a green
   nobody can trust stops the next person looking.

   Full argument, counts and the four-arm proof: .claude/plans/css-brace-anchor-1430.md */

test('a real avatar photo carries its own circular clip, independent of the parent .lav', () => {
  assert.match(PAGE, /\.lav img \{ display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 50%;/,
    'the avatar image lost its own border-radius -- it now depends entirely on .lav\'s overflow to stay circular');
});

test('.lavtint (the initials fallback) already had its own circular clip -- unchanged by this fix', () => {
  assert.match(PAGE, /\.lavtint \{ width: 100%; height: 100%; display: grid; place-items: center; border-radius: 50%;/,
    '.lavtint lost its own border-radius');
});

test('the consolidated rail still switches .lav to overflow:visible, for the memory ring -- the fix does not remove that', () => {
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.lrow > \.lav \{ position: relative; overflow: visible; background: none;/,
    'the consolidated overflow:visible override on .lav is gone -- if so, check whether the memory ring still renders correctly');
});

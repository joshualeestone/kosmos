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

test('a real avatar photo carries its own circular clip, independent of the parent .lav', () => {
  assert.match(PAGE, /\.lav img \{ display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 50%; \}/,
    'the avatar image lost its own border-radius -- it now depends entirely on .lav\'s overflow to stay circular');
});

test('.lavtint (the initials fallback) already had its own circular clip -- unchanged by this fix', () => {
  assert.match(PAGE, /\.lavtint \{ width: 100%; height: 100%; display: grid; place-items: center; border-radius: 50%; \}/,
    '.lavtint lost its own border-radius');
});

test('the consolidated rail still switches .lav to overflow:visible, for the memory ring -- the fix does not remove that', () => {
  assert.match(PAGE, /html\[data-layout="consolidated"\] body\.consolidated \.lrow > \.lav \{ position: relative; overflow: visible; background: none; \}/,
    'the consolidated overflow:visible override on .lav is gone -- if so, check whether the memory ring still renders correctly');
});

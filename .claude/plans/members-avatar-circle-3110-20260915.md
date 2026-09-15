# Plan: #3110 - Members-list agent avatar renders as an oval instead of a circle

Branch: `members-avatar-circle-3110` · Card: kosmos#3110 (Josh-reported, 2026-09-15) · Author: renettilley

## The bug (root cause, measured - not guessed)
In the Members list, an agent whose photo is NON-SQUARE renders as a vertical OVAL; the others are
circles only because their photos happen to be roughly square. Reproduced + measured with pw-runtime
(a real browser) by seeding a portrait 12x44 photo for a member:

- The avatar disc BOX (`.lav.pj-face`) is a correct 34x34.
- The `<img>` inside measured **34x125** - a vertical ellipse - and `border-radius: 50%` drew it as an oval.

Why: `.lav img` sized its height with `height: 100%`, resolved against `.lav`'s grid, whose single
implicit row is `auto` and grew to the IMAGE's own intrinsic height for a tall source. So width was
box-constrained to 34 but height ran to the photo's aspect (34 / (12/44) ~= 125). Square photos hid it
by coincidence (34 wide -> ~34 tall).

## The fix (web/index.html, `.lav img`)
`height: 100%` -> `height: auto; aspect-ratio: 1`. The width is still box-constrained to 34 (100%), and
`aspect-ratio: 1` drives the height from it, so the img is ALWAYS 1:1; `object-fit: cover` crops any
photo to that square -> a true circle, robust to any source dimensions (exactly the card's ask). Square
photos are unchanged. `.lav img` is the base rule, so this covers the Members-list `.lav.pj-face` (the card)
and any `.lav` avatar that does not override the height.

## Scope: why the OVAL is Members-list-specific, and what the other surfaces actually do
The oval needs the parent box to DROP its clip. `.pj-member .pj-face` sets `overflow: visible` (so the memory
ring can extend past the disc), which lets the tall img's OWN `border-radius: 50%` draw an UNCLIPPED vertical
ellipse -- that is the Members list, and it is what this PR fixes and browser-verifies. Other avatar surfaces
that also pin `height: 100%` keep the base `overflow: hidden` (e.g. `.lav.youav`, `.railme-face`, `.msg-av`,
`.detail-av`, `.userpop-face`, `.hub.haspic`), so a tall photo is CLIPPED to the circle and shows a mis-centered
TOP-CROP, NOT an oval -- a milder, cosmetic issue. The same `aspect-ratio: 1` one-liner would center those
crops too, but that is a different surface and a different (non-oval) symptom, out of this card's scope and
broader than a P0/freeze change warrants. Tracked in follow-up #3117, not swept in blind.
(An earlier revision of this PR also patched `.lav.youav` on a "it ovals" premise; REVERTED -- youav has
`overflow: hidden`, so it top-crops rather than ovals, making that edit an out-of-scope cosmetic change.)

## Verification (browser, via pw-runtime)
Extended the existing same-surface browser-check `docs/browser-checks/render-member-modal.js`
(Browser-check-surface: pj-one-agents): it now seeds a member with a portrait photo and asserts the
rendered avatar img is SQUARE (1:1) and cropped with object-fit: cover. It reads the IMG, not the
container box (the box was already square and would pass either way - a control that can't fail is not a
control). Proven both arms: with the fix the img is 34x34 (PASS); reverted to `height: 100%` the same
assertion FAILS with `img 34x125`. Every pre-existing member-modal assertion still passes (no regression).

## Weakest premise
I reproduced the oval with a synthetic portrait PNG and confirmed the mechanism + fix in a real browser for
the Members-list `.lav.pj-face` avatar, but I have not seen Josh's exact screenshot. The card names the Members
list, which is fixed and browser-verified both arms. The non-`.lav` sibling surfaces above share the same
latent class but are NOT verified here (filed as a follow-up); if Josh's oval turns out to be on one of them
rather than the Members list, that surface is covered by the follow-up, not by this PR. Josh can confirm the
Members list in-app.

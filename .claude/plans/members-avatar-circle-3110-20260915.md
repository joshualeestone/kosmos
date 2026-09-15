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
photos are unchanged. This is the base `.lav` avatar, so it corrects the whole `.lav` avatar FAMILY -- the
Members list and every other surface that inherits `.lav img` without overriding it. One `.lav` variant DOES
override it: `.lav.youav` (the operator "you"/rail-me 56x56 avatar) re-pins `height: 100%` at higher
specificity, so it gets the same one-line fix here.

## Scope: the sibling avatar surfaces (a follow-up, tracked, not silently dropped)
The root cause is a CLASS: an avatar `<img>` pinning `height: 100%` inside a `display:grid; place-items:center`
fixed box. Beyond the `.lav` family (fixed here), the same latent oval exists on other avatar classes that
carry their own `height: 100%` and are NOT `.lav` descendants: `.railme-face img`, `.msg-av img`,
`.detail-av img`, `.userpop-face img`, `.hub.haspic img`, and possibly `.onode .face img` (the org-chart node,
a distinct render context). Those are out of #3110's literal scope (the Members list), and changing six more
avatar surfaces during the P0/6.68 freeze is broader than this card warrants, so they are filed as a follow-up
rather than swept in blind. The fix for each is mechanical and identical (`height: auto; aspect-ratio: 1`).

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

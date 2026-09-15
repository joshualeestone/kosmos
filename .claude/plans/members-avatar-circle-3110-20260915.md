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
photos are unchanged. This is the base `.lav` avatar, so it corrects every avatar surface, not just the
Members list.

## Verification (browser, via pw-runtime)
Extended the existing same-surface browser-check `docs/browser-checks/render-member-modal.js`
(Browser-check-surface: pj-one-agents): it now seeds a member with a portrait photo and asserts the
rendered avatar img is SQUARE (1:1) and cropped with object-fit: cover. It reads the IMG, not the
container box (the box was already square and would pass either way - a control that can't fail is not a
control). Proven both arms: with the fix the img is 34x34 (PASS); reverted to `height: 100%` the same
assertion FAILS with `img 34x125`. Every pre-existing member-modal assertion still passes (no regression).

## Weakest premise
I reproduced the oval with a synthetic portrait PNG and confirmed the mechanism + fix in a real browser,
but I have not seen Josh's exact screenshot. If his oval is on a NON-`.lav` avatar surface (e.g. a bespoke
roster component that does not use `.lav`), this base fix would not reach it - though every avatar surface
in the app routes through `.lav img` or the same object-fit pattern, so that is unlikely. Josh can confirm
in-app; if the oval persists somewhere, it is a non-`.lav` surface and I would need that surface named.

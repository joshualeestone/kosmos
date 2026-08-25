# settings-nav-harden-followup

## What this branch is

The 0.5.24 cut cherry-picked only the raw fix for the settings-nav
phone-width regression (f8e9050, landed on main as 36bb75f). That
commit was the FIRST of five on the original settings-nav-phone-fix
branch; the four challenge-loop rounds that followed it, hardening the
fix, never reached main. This branch lands exactly that delta: the diff
between the cherry-picked commit (36bb75f) and the branch's reviewed
tip (8dac9f2), reapplied on top of current main.

## Scope

- `web/index.html`: the phone-width rule restated inside the 56rem
  block with the same specificity, after the 60rem one (unchanged from
  the cherry-pick), plus the follow-on hardening: a redundant
  `justify-content: stretch` removed (already inherited unchanged from
  the enclosing 60rem rule).
- `web.settings-width.test.js`: rule order and uniqueness pinned.
- `docs/browser-checks/render-settings-nav.js`: the 920px band step and
  the 1400px centered-pair assertion added; assertion counts stated in
  the docblock.
- `.claude/plans/settings-nav-phone-fix.md`: carried over from the
  original branch, unchanged content.

## Done when

- `render-settings-nav.js` passes at both the 420px phone width and the
  920px band, with no regression at 1400px.
- Unit suite green.
- No new behavior: this is landing already-reviewed hardening, not new
  work.

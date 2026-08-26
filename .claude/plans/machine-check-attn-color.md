# Plan: machine-check-attn-color

Josh, #chaoskosmos-design 2026-08-26 07:12 CDT, with a screenshot of the
"Checking this computer" first-run pane: the "!" row ("This Mac goes to
sleep after 1 minute") reads as another checkmark at a glance -- easy to
skim past and hit Continue. He asked for a light red instead of matching
the other rows.

## The wrong-target detour (kept transparent, not edited away)

First pass edited `.chk.att .chk-m`, painted by `chkRow()` into
`#set-machine` -- **Settings > This Mac**, not the screen in Josh's
screenshot. Confirmed a real, structurally-identical bug there too (same
shared gold, same fix applies cleanly, own dedicated test), so that fix is
KEPT rather than reverted. But it is not what Josh asked about.

Challenge-loop iteration 2 caught the real target by tracing which
function actually renders `#fr-checks` (the first-run wizard's own
machine-check step): `frCheckRow()`, which emits an entirely different,
similarly-shaped `.fr-check`/`.fr-mark` pair, styled at
`#firstrun .fr-check.ok .fr-mark, #firstrun .fr-check.attention .fr-mark`
(one shared rule, `color: #6e5311`, the actual bug) -- confirmed by DOM
nesting that `#firstrun` and `#set-machine` are disjoint subtrees. The
base `.chk.att` light/dark split from iteration 1 is KEPT: it fixes a real
second instance of the bug, live in Settings > This Mac. The
`#firstrun`-scoped pin from that same iteration is NOT kept: iteration 3
established that the very disjointness that proved iteration 1 targeted
the wrong screen also proves the pin could never match anything
(`.chk` rows never render inside `#firstrun`), so the pin was dead CSS
built on a false premise, removed and the generated dark section
regenerated. The test that had hard-required the pin was corrected in the
same pass; a test enforcing dead CSS actively resists its removal.

## The real change

`web/index.html`, `#firstrun .fr-check.ok .fr-mark, #firstrun
.fr-check.attention .fr-mark` (one combined rule) split into two:

- `.ok` keeps its existing `#6e5311` gold, untouched.
- `.attention` gets `background: rgba(179,38,30,.13); border-color:
  rgba(179,38,30,.45); color: #b3261e` -- the same red already used
  throughout this file for attention/failed states, not a new one, and
  not `var(--warn-ink)` (an amber token this single-look, no-token
  subtree deliberately doesn't use).

No dark-mode split needed for this one, unlike `.chk.att`: `#firstrun`
pins white in every theme and this component has no dark-mode variant at
all (confirmed: `tools/sync-forced-theme.js --check` passes clean with
nothing added for it). One ground, one rule, one measurement.

Measured: `#b3261e` on its own 13%-tint over white is **5.27:1**, clearing
the 3:1 floor a status glyph needs (same WCAG relative-luminance formula
as the `.chk.att` fix, re-verified with a script rather than by hand this
time).

## Verification

- [x] `KOSMOS_REPO=<worktree> python3 Projects/kosmos-design/jargon.py`:
      3 pre-existing hits, unchanged and unrelated.
- [x] `node tools/sync-forced-theme.js --check`: clean, no dark-mode
      mirror needed for this rule.
- [x] `node --test web.label-contrast.test.js`: 7/7 pass -- the `.chk.att`
      test from iteration 1 plus a new dedicated test for the REAL target
      (`#firstrun .fr-check.attention .fr-mark`), which explicitly names
      that it is a different component from `.chk.att` and asserts `.ok`
      and `.attention` no longer share a color (the regression sensor for
      the actual reported bug).
- [x] `node --test` (full suite): 2199/2199 pass.

# Plan: first-run onboarding screen fixes (Josh, live 2026-09-08)

Two small, independent first-run (onboarding) screen fixes Josh directed live in
#chaoskosmos-design. App-deep rigor. One PR on web/index.html. The tmux
"Checking"/Next-gating fix (#2451) is a SEPARATE, larger follow-up (engine
a11ystatus + gating) and is NOT in this PR.

## 1. Default name: Alex -> Josh (About-you step)

Josh has a teammate named Alex and did not want the name field defaulting to a real
person on his team. Change the placeholder only. #683 had moved it away from "Josh"
(a real first name can read as a previous owner on someone else's install); the
comment now records both #683's reasoning and Josh's explicit override. It is a grey
placeholder (hint), not a filled value, which softens the #683 read. The name-step
render checks fill the field with 'Alex' as test INPUT and assert no placeholder
value, so they are unaffected.

## 2. File access: mock dialog's blue "Allow" becomes clickable

Josh watched a user try to click the blue "Allow" in the S2 file-access mock dialog
(they read it as the real macOS button) and nothing happened. Wire it to fire the
SAME file-access flow (frFirePermission) as the real "Allow Access" button. The mock
lives in an aria-hidden preview, so it stays a MOUSE-ONLY affordance (cursor:pointer);
the keyboard-reachable control remains the real "Allow Access" button, and a click on
the mock routes THROUGH that real button so the disabled state and message line stay
on one real control (no non-focusable control, WCAG-clean). Guarded so it cannot
re-fire: return if the real button is disabled (an in-flight flow) or the gate row is
data-granted (post-grant the real Allow Access is hidden but the mock stays visible).
The mock COPY (Terminal vs Kosmos) is Mona's separate pass, pending Kitty's
TCC-requester answer; this PR only wires the behaviour and does not touch the copy.
Validated: S2 render check 10/10; machine.a11y-1344 static-presence assertions pin
the forward + both guards against removal; full run-tests EXIT=0.

## Dropped from this PR: the notifications cog

An earlier version of this branch replaced the notifications-step cog glyph with an
inline SVG (Josh reported it high/left across ~5-6 builds). REVERTED after Mona (cog
design owner) flagged, and I verified independently, that the cog is ALREADY centred
on origin/main via #2460 (commit 7abd0ae4, the glyph fix: flex + line-height:1, 52px
box): the original gear check passes 16/16 there and Mona rendered it sub-pixel
centred. Josh's high/left screenshot was from a build that predates #2460. So the SVG
was unnecessary churn against an already-fixed cog, against the design owner's
direction ("reopening it is the styling refine-loop Josh does not want"). The
gear check + README were restored to origin/main; this branch touches the cog not at
all. Lesson: check whether the artifact is already fixed on current main before
building against an old-build screenshot.

## Decisions

- **Bundled name + blue-Allow, one PR**: two small web/index.html edits, one set of
  hands.
- **Split from the tmux-gate (#2451)**: that is a larger engine + gating change on the
  same file.
- **Name "Josh" over the #683 non-product-name convention**: Josh's explicit override,
  reversible, endorsed by the name-design owner (Mona), reasoning preserved in-comment.

## Verification

- App-deep: challenge-loop + full node validation (run-tests.sh EXIT=0) + the S2 render
  check (10/10) run headless via pw-runtime. The blue-Allow forward + guards are pinned
  by static-presence assertions in machine.a11y-1344.test.js (matching that handler's
  existing string-assertion style; the render check covers the screen, the guard logic
  was blind-reviewed). Full runtime click coverage is a documented deeper follow-up.

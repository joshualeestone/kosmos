# Plan: first-run onboarding screen fixes (Josh, live 2026-09-08)

Three small, independent first-run (onboarding) screen fixes Josh directed live in
#chaoskosmos-design (screenshots 9.36-9.40 PM). App-deep rigor. Bundled as one PR
(one set of hands on web/index.html per Splinter). The tmux "Checking"/Next-gating
fix (#2451) is a SEPARATE, larger follow-up (engine a11ystatus + gating) and is NOT
in this PR.

## 1. Default name: Alex -> Josh (About-you step)

Josh has a teammate named Alex and did not want the name field defaulting to a real
person on his team. Change the placeholder only. #683 had moved it away from "Josh"
(a real first name can read as a previous owner on someone else's install); the
comment now records both #683's reasoning and Josh's explicit override. It is a grey
placeholder (hint), not a filled value, which softens the #683 read. The name-step
render checks fill the field with 'Alex' as test INPUT and assert no placeholder
value, so they are unaffected.

## 2. Notifications cog: glyph -> inline SVG so it centres (Josh, ~5-6 builds)

Josh reported the notifications-step cog sitting high/left in its grey box across
~5-6 builds. Root cause (Mona, design owner): the U+2699 glyph's font bearings seat
its ink high-left, so every prior flex/line-height fix was dragged back. Durable fix
(Mona's design, applied by Angel): replace the glyph with an inline SVG gear, centred
by construction. Box 52->48 (slightly smaller per Josh); the 32px SVG keeps the same
visual size as the old 44px glyph ink, so the cog is NOT reduced.

render-firstrun-stepcap-gear-0640.js rewritten to match: reads the SVG's rendered
size (box ~48px, gear ~32px) instead of a glyph font size that no longer exists, and
MEASURES the cog's centre offset directly (svg centre within 1.5px of box centre,
both axes) rather than proxying centring through line-height. This is a STRONGER
guard: it reds on the exact symptom Josh reported (cog off-centre), whatever the
cause. Ran headless (pw-runtime, chromium+webkit): 16/16, svgDx=0 svgDy=0 (dead
centre). Red arm proved in the challenge-loop (offset SVG reds the centre assertion).

## 3. File access: mock dialog's blue "Allow" becomes clickable

Josh watched a user try to click the blue "Allow" in the S2 file-access mock dialog
(they read it as the real macOS button) and nothing happened. Wire it to fire the
SAME file-access flow (frFirePermission) as the real "Allow Access" button. The mock
lives in an aria-hidden preview, so it stays a MOUSE-ONLY affordance (cursor:pointer);
the keyboard-reachable control remains the real "Allow Access" button, and a click on
the mock routes THROUGH that real button so the disabled state and message line stay
on one real control (no non-focusable control, WCAG-clean). The mock COPY (Terminal
vs Kosmos) is Mona's separate pass, pending Kitty's TCC-requester answer; this PR only
wires the behaviour and does not touch the copy. Validated: S2 render check 10/10
(chromium+webkit), screen renders with no pageerror.

## Decisions

- **Bundled, not one-per-PR**: three small web/index.html edits, one set of hands,
  one PR, avoiding same-file rebase churn.
- **Split from the tmux-gate (#2451)**: that is a larger engine + gating change on the
  same file; keeping it separate ships these three (esp. the cog, Josh's biggest
  repeat frustration) without waiting on the gate build.
- **Name "Josh" over the #683 non-product-name convention**: Josh's explicit override,
  reversible, endorsed by the name-design owner (Mona), reasoning preserved in-comment.

## Verification

- App-deep: challenge-loop + node validation + the two updated/relevant browser checks
  run headless via pw-runtime (gear 16/16, S2 10/10). yarn test does not run
  browser-checks, so the render checks are run directly. Reason-grep EXPECTED_SITES is
  unaffected (no new check file; the gear check was modified in place).
- Weakest premise: that reading Kosmos.app's grant etc. is out of scope here (that is
  the #2451 tmux-gate). This PR is purely the three screen edits above.

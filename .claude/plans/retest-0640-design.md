# Plan: 0.6.40 re-test design items #9 + #10 (Mona)

## Source
Josh's 0.6.40 fresh-macOS re-test (Josh-Brain/Projects/kosmos-0.6.40-install-flow-retest-feedback-2026-09-06.md). My items (Splinter confirmed Mona #9-#10, Angel #11):
- #9 (screen 4.18.55): the two numbered step captions still wrong size + stretched; remove "(stand-in graphic)" dev-note leak.
- #10 (screen 4.19.23): notification cog ~2x.
(#11 model-screen spinners is Angel's - not touched here. My .kspin design call was handed to her; she is wiring it.)

## #9 root cause (measured headless)
The step captions ("1 keep this computer awake", "2 when prompted, switch TMUX to On")
are `<p class="s3-step-cap">`. A bare `.s3-step-cap` (0,1,0) loses its `font:600 .625rem`
to `#firstrun .fr-body p` (1,1,1, `font: 400 1.0625rem/1.6`), so they rendered 17px/400.
`letter-spacing:.1em` + `text-transform:uppercase` (not part of `font`) still apply, so
17px uppercase tracked = "gigantic + stretched". The 0.6.39 pass only scoped the MARGIN
(`#fr-pane-3 .s3-step-cap{margin}`) and the gate LABEL, never the caption font - which is
why Josh still saw it. This is the SAME specificity-loss class as the `p.s2-say` fix.

## Change (web/index.html)
- Scope `.s3-step-cap` -> `#firstrun .fr-body p.s3-step-cap` (1,2,1) to win: `.625rem`/600
  applies = 10px (a small caption like the 11px eyebrow Josh likes); .1em tracking on 10px
  is ~1px, subtle, not stretched. Baked the tightened margin (0 0 4px) into the scoped rule
  so the 0.6.39 margin tightening is preserved, not reverted.
- Remove the `<span class="s3-standin">(stand-in graphic)</span>` from the step-2 caption
  and its now-dead `.s3-standin` CSS rule (a build note that leaked to the user).
- `.s4-gear` 38px box / 22px glyph -> 76px / 44px (~2x, Josh's ask), border-radius 8->12
  to keep the rounded-square proportion at the larger size.

## Verification
Measured headless (pw-runtime): step-caps 17px/400 -> 10px/600; `.s3-standin` gone; gear
38/22 -> 76/44. New hermetic check `render-firstrun-stepcap-gear-0640.js` (3 arms x 2
engines), wired into browser-checks.sh + README; meta-guards (wired/indexed/reason-grep/
selectors) pass. PERTURB-verified: all 6 arms red against origin/main (17px captions,
standin present, 38px gear).

## Scope
Only `.s3-step-cap` (fr-pane-3) + `.s4-gear` (fr-pane-4). Disjoint from Angel's header
(#2350) and her fr-pane-5 model-spinner painter (#11) - confirmed with Angel, no collision.
Gate rows, gate labels, switches, and the functional wiring untouched.

## Rejected alternatives
- Add font to `#fr-pane-3 .s3-step-cap` (1,1,0): rejected - LESS than the 1,1,1 override, would not win.
- Reduce letter-spacing to fix "stretched": not needed - at 10px the .1em tracking is a
  normal caption (matches the eyebrow). Fixing the SIZE resolves the stretched perception.

## Weakest premise
That 10px (.625rem) is the right caption size. It is the value the base rule already
declares (this change just makes it apply) and sits just under the 11px eyebrow Josh
approved. One-value edit if Josh wants it different on his headed re-cut.

## Honest limit
Verified size/structure headless; the pixel/aesthetic fit (do the compact captions + 2x
cog sit well together) defers to Josh's REAL-macOS re-cut review (the spec's bar: no next
cut without a real-install pass). Structure/size/leak-removal ARE verified.

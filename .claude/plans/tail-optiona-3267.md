# tail-optiona-3267 -- message bubble tail: rebuild to the approved Option A + width cap

Addresses #3267. Refs #3244 (Josh picked Option A), #3247 (shipped, drifted). Josh 2026-09-18: the live tail "is not the right iMessage thing you showed yesterday" / "the graphic shows the messed up version"; also "message widths... too wide on both sides."

## Root cause
The approved Option A mockup (scratchpad/bubble-mockup.html, render bubble-options.png) draws the curved wing OVERLAPPING the bubble box, which is what makes the curve tuck under the corner and read as the Apple flick. The mockup used a SOLID tint, so overlap was fine. The app's user bubble was a TRANSLUCENT `--usermsg-tint`, so an overlapping wing double-composites into a darker triangle (#3130/6.72). #3247 dodged that by shrinking the wing onto a tiny no-overlap mask -> squished notch. My first #3267 attempt (bigger no-overlap) still rendered as a thin nub. Proven via the REAL-APP render tool: no-overlap cannot reproduce the curve; overlap-on-translucent shows the dark triangle.

## Fix (web/index.html)
1. **Option A overlap geometry** (matches the mockup): `.msg-bd::before` = colored wing 20x20 at left/right:-8, radius 18px 16px, z-index:-2; `.msg-bd::after` = --k-bg ground mask 14x22 at -14, radius 12px 16px, z-index:-1; tail-side bottom corner 6px.
2. **`--usermsg-tint` made SOLID** (pre-composited over each theme's ground) so the overlapping wing does NOT double-composite: light `#e8ebf5` (:120), dark `#141c2f` (:330 + the generated forced-dark twin :7661), navy `#1a2d58` (:7806). Visually identical over the standard ground; it only stops the tail's dark triangle. This reverses #2660's translucent choice for the tint (a design call, reversible; matches the approved solid mockup; imperceptible; flagged to Angel since her #3264 + the DM `.dm-b` also read the token).
3. **Width cap**: `.msg-bd { max-width: 52ch }` (:4758) so messages sit in from both edges. Previously only `#panel-detail .msg-b { max-width: 66ch }` (tab view) capped it; the consolidated view had NO cap -> full-width bubbles (Josh's "too wide on both sides"). The base cap covers both views.

## Verification (REAL app render, not a mock -- Josh's explicit requirement)
Rendered the actual worktree web/index.html via `/tmp/shot-app-bubbles.cjs` (real pjRoomRow, real tokens): light /tmp/app-final.png + dark /tmp/tail-dark.png. Confirmed: clean Option A curved wing on the blue bubble, NO dark triangle, avatar clearance OK, bubbles capped with margin both sides, both themes. Shown to Josh for GO before build.

## Coordination
Sequence agreed via Splinter: #3267 lands first, Angel rebases #3264 (consolidated-white) on it. Must flag Angel that #2660 tint is now solid (orthogonal to her ground change, but note it + the DM side effect).

## Weakest premise
That solid tint is acceptable vs #2660's translucent (it is imperceptible over the standard ground and matches the approved mockup, but it IS a reversal of a deliberate choice -- Josh can undo). And that 52ch is the right width (a render-judged value; easy to retune).

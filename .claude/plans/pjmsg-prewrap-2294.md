# pjmsg-prewrap-2294: plain multi-line messages keep their breaks on .pj-msg-text

kosmos#2294 (low-sev, split from #2292; Splinter parked it post-launch, now post-0.6.40-cut,
taken as an in-lane fast-follow filler).

## Problem

On the project message list, `.pj-msg-text` was `white-space: normal`. pjRich's FAST path
(a plain marker-less message) returns `esc(raw)` with the literal `\n`, which `normal`
collapses, so a paragraph break in an unformatted message rendered as a single line. A
message carrying any markdown marker / URL / link takes pjRich's SLOW path, whose breaks
become `<br>`, so it rendered fine; two messages could wrap differently by content.

## Fix (CSS only, does not touch pjRich / Renet's #2067/#2239 logic)

`.pj-msg .pj-msg-text { white-space: pre-wrap; ... }` (matching the `.dm-b` dialogue
surface, already pre-wrap). This makes the fast path's literal `\n` render as breaks.

It is safe against the slow path because pjRich's slow path does `out.join('<br>')`, its
output carries NO literal `\n`, so pre-wrap has nothing to double. Fenced code keeps its own
`.mdcb` pre-wrap regardless. Verified both paths render identically (see the check). Also
updated the pjRich comment that documented `.pj-msg-text` as "not pre-wrap" (now stale).

## Verification

- `docs/browser-checks/render-pjmsg-prewrap-2294.js`: using the page's own pjRich, asserts
  `.pj-msg-text` computes `pre-wrap`, a plain two-line message renders taller than one line
  (the break renders), and a markdown two-line message renders at the SAME height (not
  doubled). Control: the pre-fix `normal` collapses the plain message to one-line height and
  reds. Registered in tools/browser-checks.sh + README; reason-grep counts bumped 63->64,
  38->39.

## Coordination

Adjacent to Renet's rich-text lane (#2067/#2239 pjRich). The fix is CSS-only and does NOT
change pjRich's logic; the only touch in her region is updating a now-stale comment.
Heads-up sent to Renet.

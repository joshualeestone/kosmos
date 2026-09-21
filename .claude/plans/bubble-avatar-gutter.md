# bubble-avatar-gutter -- keep message bubbles clear of the opposite avatar column (#3361)

## Problem (Josh, #chaoskosmos-design 2026-09-21, small-size QA, 2 screenshots)

On smaller window widths the widened room message bubbles (#3340 raised .msg-bd max-width to
78ch) grow into the OPPOSITE side's avatar column: the operator's own (right-aligned) message
reaches left into the agent-avatar column, and an agent's (left-aligned) message reaches right
into the user-avatar column. On wide widths it looks correct because 78ch stops short of both
columns. Josh: the message "should never go into the column where the user avatars and the agent
avatars are... fit inside", while keeping the wide look and the overlap.

## Root cause

The row is `.msg { display:flex; gap:14px }` with `.msg-av { flex:0 0 34px }` and `.msg-b`
holding the bubble (`.msg-bd { max-width:78ch }`). The row reserves the NEAR avatar+gap (34+14=48px)
before the body, but `.msg-b` spans all the way to the thread's far edge with NO reservation for
the opposite avatar column. At wide widths 78ch binds first and leaves the far column clear; at
narrow widths 78ch exceeds the space, so the bubble reaches the far edge, into the opposite column.

## Fix (web/index.html)

Mirror the near gutter on the far side of `.msg-b`, so the message band is symmetric and a bubble
can never enter either avatar column:

```
.msg:not(.you) .msg-b { margin-right: calc(34px + 14px); }   /* agent: reserve the right (user) column */
.msg.you .msg-b       { margin-left:  calc(34px + 14px); }   /* operator: reserve the left (agent) column */
```

Width-agnostic, no media query and no magic breakpoint: at wide widths the 78ch max-width binds
first, so the reserved gutter is slack and the approved wide look is unchanged; only at narrow
widths, where 78ch used to reach the far edge, does the gutter cap the bubble. The tail wing/mask
sit on the NEAR side (toward the avatar), so the far gutter never touches them.

## Why this shape (rejected alternatives)

- A media query with a fixed breakpoint: rejected. The overflow is a function of available width,
  not a device class; a margin that only binds when 78ch no longer fits engages exactly when the
  space runs out, at every width, with no breakpoint to pick or maintain.
- Lowering the 78ch max-width: rejected. That would shrink the wide look Josh explicitly likes.
- Weakest premise: the far gutter equals the near avatar+gap (48px). If Josh wants the bubble to
  reach closer to the avatar (a smaller far gutter), the calc is the single tuning point. Reversible.

## Test (docs/browser-checks/render-room-msgbox-2806.js)

Added a narrow-viewport arm (host 360px): render an agent row and an operator row with long text,
assert BOTH bubbles leave a >=47px far gutter (clear of the opposite avatar column) while the
bubble is still WIDE (>=180px, so the cap is doing real work, not passing on a short message).
Proven non-vacuous: with the fix removed the arm fails with farGap=0px; with it, farGap=48px. The
existing wide-width fixtures (host 640/760/1400) still pass unchanged. Full run-tests.sh clean.

## Scope / coordination

Lane: design/frontend (Mona Lisa). Region: the `.msg` row layout only, disjoint from any dark-mode
message-token work. Splinter cleared the web/index.html sequencing (Angel not editing this region;
the dark-mode report was a version gap, not a code change). Ping Angel before merge. Ships 0.6.84+.

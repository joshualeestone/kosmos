# Plan: operator's own message avatar+name on the RIGHT, iOS-style (#2918)

## Source
Josh 6.59 QA notes, 2026-09-12 (fresh install), verbatim:
"On the project tab view dialog box and on the project view for consolidated, can we
make it such that my avatar and name are over on the right so it looks more like a
natural text message conversation, like an iOS message? All of the agent messages
have their avatar and name on the left, with their message on the right, and my avatar
and name are over on the right in kind of the opposite order. My message is to the
left of that."

So: in both the project tab-view dialog and the consolidated project view, the
operator's OWN message row is mirrored iOS-style. Agent rows keep avatar+name on the
left, message to the right. Relates to #2805 / #2806.

## The change
`web/index.html`, three CSS rules scoped to `.msg.you` (the operator's own post),
placed with the other `.msg` layout rules:

```css
.msg.you { flex-direction: row-reverse; }
.msg.you .msg-b { display: flex; flex-direction: column; align-items: flex-end; }
.msg.you .msg-h { flex-direction: row-reverse; }
```

## Why this shape
- The message row is `.msg { display: flex; gap: 14px }` with children in DOM order
  `avatar` then `.msg-b` (which holds the header `.msg-h`, the bubble `.msg-bd`, and
  the reactions `.rxns`). `row-reverse` on `.msg.you` floats the avatar to the right
  and the body to its left, with no markup change.
- `.msg-b` is normally a block whose children fill its width. Making it a flex column
  with `align-items: flex-end` right-aligns each child AND shrinks it to content, so
  the bubble hugs the right edge and wraps to its own content rather than spanning the
  full body width. That is the iMessage look.
- `.msg-h` reversed puts the name nearest the avatar on the right, mirroring the agent
  side (where the name sits nearest the left avatar) which is Josh's "opposite order".
- Text inside the bubble is not re-aligned (`.msg p` keeps its default left alignment),
  matching iMessage where the bubble is right-aligned but its text reads left-to-right.

## Both views, one rule set
Both surfaces Josh named share the same `.msg` markup (there are no consolidated-
specific `.msg`/`.msg.you` overrides in the file). One `.msg.you` rule set therefore
covers the tab-view dialog and the consolidated project view at once.

## What it must not break
- Agent messages (`.msg` without `.you`) are untouched: every rule is scoped to
  `.msg.you`.
- `.msg:hover .msg-bd` (the #2921 hover tint) and `.msg:hover .rxn-quick` (the reaction
  reveal) are unaffected: they are not layout-direction rules and `.rxns` still lives
  inside `.msg-b`.

## Verification
- Headless (pw-runtime, Chromium, 820px wide, real `.msg` rules incl. the panel-detail
  `.msg-b { max-width: 66ch }`): operator avatar sits right of a content-hugging bubble
  near the right edge (short message bubble ~82px, not full width); agent avatar stays
  left of a wider bubble near the left edge. Operator header name sits right of the time
  (nearest the avatar); agent header name sits left of the time. PASS.
- The exact iMessage polish (spacing, whether name+time should stack, bubble tail) is
  Josh's in-app josh-review call.

## Rejected alternatives
- `text-align: right` on `.msg-b`: right-aligns inline content but does not shrink the
  block bubble to content nor move the avatar, so it does not produce the iMessage look.
- Reversing the render markup order in JS (emit avatar last for the operator): a
  behavioral/markup change where a scoped CSS flip suffices and is fully reversible.

## Weakest premise
That `align-items: flex-end` shrinking the bubble to content is the intended iMessage
feel for every message length. For a very long message the bubble grows to the 66ch
cap and right-aligns, which is still iMessage-correct. If Josh wants a tighter max
width on his own bubbles, that is a one-line `max-width` on `.msg.you .msg-bd`.

## Delivery
kosmos web (agent-workforce, remote joshualeestone/kosmos). CSS-only, so the #1720
browser-check gate is satisfied with a `Browser-check:` trailer documenting the
headless geometry check. Self-merge on green; leave josh-review for the visual match.

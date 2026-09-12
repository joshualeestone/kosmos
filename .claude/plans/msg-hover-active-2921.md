# Plan: subtle darker active-state on message hover (#2921)

## Source
Josh 6.59 QA notes, 2026-09-12 (fresh install), verbatim:
"Also I want to get an active state. Right now if I mouse over a post or something,
it's cool that I get the emojis. It'd be nice if I got a slight dark color variation
just to indicate that I had hovered over that message: just a very subtle color
difference to be slightly darker."

So a hovered room post should read as active via a very subtle darker color variation,
in addition to the reaction bar (`.rxn-quick`) that already fades in on hover. Relates
to #2806 (which introduced the message bubble tints) and #2920 (idle-agent hover).

## The change
`web/index.html`, one CSS rule after the resting bubble rules (`.msg-bd` at ~4368):

```css
.msg:hover .msg-bd { background-image: linear-gradient(rgba(120,120,128,.08), rgba(120,120,128,.08)); }
```

## Why this shape
- The two resting bubble backgrounds are set with the `background:` shorthand
  (`--usermsg-tint` for `.msg.you`, `--k-sunk` for an agent's). The shorthand sets
  `background-color` and leaves `background-image: none`. Setting only
  `background-image` on hover therefore overlays a translucent layer ON TOP of
  whichever resting fill the bubble already wears, so ONE rule covers both variants
  without repeating the per-variant tokens and without disturbing the resting color.
- Mid-gray (Apple system gray `120,120,128`) is the same overlay color #2920 used for
  the idle-agent hover. A mid-gray translucent overlay darkens a light bubble and lifts
  a dark one, so the hover delta stays visible in BOTH themes. A pure-black overlay
  would darken in light mode but be nearly invisible in dark mode, so it was rejected.
- Intensity `.08`: kept light per Josh's "very subtle" / "slight". This is the value I
  chose; the exact aesthetic is Josh's in-app josh-review call and is a one-number
  nudge if he wants it stronger or lighter.

## What it must not break
- `.msg:hover .rxn-quick` (the reaction bar reveal) is a separate rule on a different
  descendant; adding `.msg:hover .msg-bd` does not touch it. Verified by reading the
  surrounding CSS.
- A bodyless message row draws no `.msg-bd` at all, so it takes no hover tint.

## Verification
- Headless (pw-runtime, Chromium): both `.msg.you` and `.msg:not(.you)` show
  `background-image: none` at rest and the `linear-gradient(...)` overlay on hover,
  with `background-color` unchanged between rest and hover. PASS for both.
- Aesthetic "subtle enough / correct direction": Josh's josh-review, in-app.

## Rejected alternatives
- Per-variant darker tokens (`.msg.you:hover .msg-bd { background: <darker tint> }`
  plus an agent variant): two rules, two new tokens per theme, and drift risk between
  the "you" and agent hovers. The single background-image overlay avoids all of it.
- Changing `background-color` on hover: would require knowing the resting token per
  variant and re-stating it, and a translucent overlay reads more naturally.

## Weakest premise
That a mid-gray overlay that LIGHTENS the bubble in dark mode still satisfies Josh's
"darker" wording. It is the standard cross-theme hover cue and #2920 set the
precedent, but if Josh runs dark mode and specifically wants darker-in-dark, the value
or color is a one-line change.

## Delivery
kosmos web (agent-workforce, remote joshualeestone/kosmos). CSS-only, so the #1720
browser-check gate is satisfied with a `Browser-check:` trailer documenting the
headless check above. Self-merge on green (Josh reviews the aesthetic in-app);
leave josh-review label.

# Plan: machine-check-attn-color

Josh, #chaoskosmos-design 2026-08-26 07:12 CDT, with a screenshot of the
"Checking this computer" first-run pane: the "!" row ("This Mac goes to
sleep after 1 minute") reads as another checkmark at a glance -- easy to
skim past and hit Continue. He asked for a light red instead of matching
the other rows.

Verified before building: `.chk.att .chk-m` (the icon badge for an
"attention" row) shared the exact same gold color as `.chk.ok` (the
checkmark rows) -- only the glyph shape (a checkmark vs an "!") told them
apart, no color distinction at all. That is a real, checkable defect, not
a matter of taste.

## Change

`web/index.html`, the `.chk.att` icon badge only, three spots (the base
rule, the `prefers-color-scheme: dark` media query, and the explicit
`:root[data-theme="dark"]` stamp -- the same three-place pattern this
file already uses for every themed color, `.chk.ok` included):

- Light: background `rgba(179,38,30,.13)`, border `rgba(179,38,30,.45)`,
  icon color `#b3261e`.
- Dark: background `rgba(255,140,130,.13)`, border
  `rgba(255,140,130,.5)`, icon color `#ff8c82`.

Not a new color: this is the exact red pair already used everywhere else
in this file for attention/failed states (`.astate.st-attn`,
`.delivery.failed`, `.acard.attn`, `.onode.attn`) -- reused for
consistency with the rest of the design system rather than inventing a
third red.

Measured rather than assumed, matching the discipline the existing gold
comment right above this rule already holds itself to (it documents a
2.78-vs-3.74 contrast measurement for the gold value): computed WCAG
relative-luminance contrast of the new red against its own 13%-tinted
background comes to ~5.05:1 in light mode and ~7.3:1 in dark mode (using
the brighter dark-mode red), both clearing the 3:1 floor a status glyph
needs. The plain light-mode red (179,38,30) would only measure ~2.52:1
against a dark-tinted background, which is exactly why the dark block
needs its own brighter value rather than reusing the light one --
the same shape of problem the gold comment already solved for `.ok`.

## Verification

- [x] `KOSMOS_REPO=<worktree> python3 Projects/kosmos-design/jargon.py`:
      3 pre-existing hits, unchanged and unrelated (line-shifted only).
- [x] `node --test`: full suite passes (2197/2197). No test asserts on
      `.chk.att`'s color value, only its class name (`server.test.js:3013`,
      unaffected).

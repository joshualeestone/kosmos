# Plan: the project room on a phone (kosmos #718, Josh's mobile priority 2026-09-24)

Owner: Kano (rooms + "waiting on you"). Plan and bar: #718 comment 5825987811.

## Finished looks like (this PR: the room)
At 375x667, 393x852, 430x932, 412x915, light and dark, Chromium and WebKit (WebKit is
Playwright's engine build, an approximation, not Safari):
- no horizontal scroll, no clipped text (measured by the audit script);
- the conversation is the first thing on a project page;
- a long post reads as lines, not a column of two or three words;
- a reaction can be added by touch, with thumb-size targets;
- the composer placeholder stays on one line.

## Measured before -> after (Chromium / WebKit, same numbers)
- bubble width at 375: 167px -> 227px; 430: -> 282px. Composer text box 135 -> 151px.
- tap on a message: add-reaction bar never shown -> shown (opacity 1, pointer-events
  auto), four 36x36 buttons. Control: without the tap handler, nothing shows.

## Decisions
- Phone rules scoped to #pj-room / the room column, at max-width 30rem, so the Direct
  Message thread (Scorpion's, shares .msg) and desktop are untouched.
- #3361 (Josh): a bubble never grows into the opposite avatar column. Kept by shrinking the
  avatar column (28px + 8px) and mirroring it, not by dropping the gutter. The 2806 check
  gains a phone arm on the REAL #pj-room (its narrow arm renders a detached .thread that the
  scoped rules never reach, so it could not see this). Control: the old 48px gutter in the
  phone rule fails the new arm.
- Tap to react: a tap on a message body toggles .rxn-show on that one row, only under
  (hover: none). Rejected: always showing the bar on every message on a phone (clutter).
- Not touched here (other owners): page gutters and header (Raiden, app frame), the Direct
  Message thread and composer (Scorpion), safe areas (Raiden, shared frame).
- Left alone and raised with Liu Kang: the grey left bar on link cards (.lpv) is shared
  with the Direct Message.

## Weakest part
Chromium does not ellipsize a textarea placeholder: it cuts it on one line without the
"...". It no longer spills a clipped second line, which was the defect, but it is not pretty.

# sortzoom-4662: the Agents board's Sort dropdown is 16px on a touchscreen

Card: kosmos#4662 (Mona Lisa's phone audit, 2026-09-29).

## Done looks like
On a touchscreen the Agents board's Sort dropdown (#agent-sort) is 16px, so an iPhone does not zoom the page when
it takes focus, and its box stays the same (32px tall). Desktop keeps 13px.

## Cause
.sortctl select is .8125rem (13px). iOS Safari zooms into a focused field under 16px and does not zoom back. The
project page's fields are already 16px on a touchscreen (#718's one field rule); the Agents board's sort was missed.
mobile-shots' field audit flagged it on home, agents-list and nav-menu at 375 and 393.

## Decisions
- `@media (hover: none) { .sortctl select { font-size: 16px; } }` (the box is a fixed 32px), next to .sortctl's own rules.
  Touchscreen-only, the same condition the project page's field rule uses, so a desktop is untouched.
- Every .sortctl select, not #agent-sort alone: the one-screen layout builds its own sorts (#agent-sort-cons via
  agentSortControlHtml, and #pj-full-sort outside the project page's field rule), and an id-only rule missed both
  (review round 1).
- Rejected: raising .sortctl select to 16px on every device (it would grow the desktop control bar for no reason).

## Weakest premise
That every sort dropdown is a .sortctl select. The check sweeps them, and builds the one-screen layout's the way that
layout does, so a new sort built another way would still need adding to the sweep.

## Checks
- render-home-phone-718, per phone size (375, 393, 412, 430; Chromium and WebKit): #agent-sort is at least 16px;
  every .sortctl select in the page, plus one built by agentSortControlHtml, is at least 16px. At 1280 a CONTROL:
  still under 16px. Red on origin/main (13px). #pj-full-sort is not built by this check; it is the same markup.
- Not asserted, by construction: the box. Its height is a fixed 32px, and its width is auto (sized to the widest
  option), with the 28px chevron gutter as padding outside that, so 16px text cannot reach the chevron. An arm
  measuring either could not fail (review round 2 found the first such arm; a text-fit arm measured 110 in 111 for
  the same reason), so neither is kept.
- render-agent-sort-4428: unchanged, green.

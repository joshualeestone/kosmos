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
- `@media (hover: none) { #agent-sort { font-size: 16px; line-height: 1.2; } }`, next to .sortctl's own rules.
  Touchscreen-only, the same condition the project page's field rule uses, so a desktop is untouched.
- Only #agent-sort: the Projects sort is already inside the project page's rule, and no other field on the
  Agents board was flagged.
- Rejected: raising .sortctl select to 16px everywhere (it would grow the desktop control bar for no reason).

## Weakest premise
That (hover: none) catches every phone. It is the rule the project page already relies on.

## Checks
- render-home-phone-718: two arms per phone size (at least 16px; box at most 40px, measured 32) and a desktop CONTROL
  (still under 16px). Red on origin/main (13px), green here, Chromium and WebKit at 375, 393, 412 and 430.

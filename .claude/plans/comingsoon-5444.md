# comingsoon-5444: Create a team's "coming soon" line is plain text

From the 0.7.26 design pass (#5444). On Create a Team of Agents with no ready-made teams, "Ready-made teams are coming soon." sat in a bordered box the size and shape of a text field (`.rolelimit`, the role caution box), so it read as something to type in.

Built: `#team-seeded-msg` uses `.dhint` (the page's plain hint line) with the same 18px top margin, in place of `.rolelimit`. The text, the role=status and the hidden handling are unchanged (a global `[hidden] { display: none !important }` keeps an empty line from taking space). `.rolelimit` itself, and its five other uses, are untouched.

Checked: shots of create-team at desktop and iPhone 15, light and dark (0 overflow); all web.* page tests; the browser check that reads this element (render-newagent-paths-4556) reads its text only.

Decided: the gap above the line comes from the hidden team picker's own spacing, not this change, so it is left.

Not in this slice: #5444's other items (the org view's blank centre disc, and shot-tool screens for Token Usage, the red missed run and the Shared-by line).

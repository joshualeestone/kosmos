# leftbars-3692: no solid left bars

Addresses #3692. Josh's rule (2026-09-24, recorded in `.claude/plans/help-tips-3574.md`): no solid
coloured left bars. Liu Kang's standing pick on the card: the rule covers every card, note and
warning block; quotes and separators stay.

## Finished means
No card, note or warning in `web/index.html` draws a stripe down its left edge, in light or dark.
Each one is marked instead by a full hairline border and/or a tinted background, using theme tokens
that have a light and a dark value. A unit test fails if a new left bar of 2px or more appears
outside a short, justified allow-list, and a browser check proves the computed styles in both themes.

## Measured (origin/main 32c24bc8e, 2026-09-25)
27 `border-left: <w>px solid` rules and one `box-shadow: inset 3px 0 0` bar. Sorted:
- **Fixed here (13):** `.detail-said`, `.svc-door`, `.dmoff`, `.msg-valve`, `.pj-warn`,
  `.rst-list li`, `.pj-folder-state.bad`, `.pj-question`, `.pj-msg.unsure`, `.rolelimit`, `.note`,
  `#d-untied, #d-withdrawn`, and the roadmap `.pj-row.attn` inset-shadow bar. The last one was not on
  the card's list (it is drawn with a shadow, not a border), and its red was hard-coded.
- **Already fixed on main:** `.askcard` (full hairline border).
- **Left alone on purpose:** hairline separators under 2px (`.themeopt`, `.layopt`, `.pj-mode-opt`,
  `.swmini`, `.vt`, `.tsk-seg`, `.acct-actions`), corner marks (1px), the `.pcombo-chev` triangle
  (transparent), the quotes `.mdq` and `.msg .quoteb` (card scope), and `.lpv`, which Kano fixes on
  `mobile-rooms-718` (the card says do not double-fix).

## Replacements
- Neutral notes: `border: 0.5px solid var(--separator); border-radius: var(--radius-control)`, with
  the padding made even on both sides. `.note` keeps its sunken background.
- Warnings (`.pj-warn`, `.pj-folder-state.bad`, `.pj-question`, `#d-untied`, `#d-withdrawn`):
  `background: var(--warn-bg); border: 0.5px solid var(--warn-border)`, rounded. Colour carries the
  meaning.
- `.pj-msg.unsure`: `background: var(--warn-bg)` only. Josh ruled on #2660 that room message boxes
  carry no strokes at all ("just the color"), so a border would break that ruling. The #2660 comment
  above the rule is updated to match.
- Roadmap `.pj-row.attn`: a full 1px inset ring in the existing attn colour, with the dark values the
  other attn rows already use. A ring, not a border, so the row does not change size.

## Decided (reversible)
- **The project tree lines stay** (`.pj-row.child` indent guide, and the roadmap `::before`
  connector). The card lists them, but they draw the tree's hierarchy, which is structure, like a
  separator, not a bar marking a card. Removing them would leave nested projects with no visible
  nesting. Rejected: a tinted background for child rows, because it reads as a state (selected or
  warned), not as depth. What would change my mind: Josh saying the tree lines count.
  **Weakest part of this call:** the card author measured these as breaches, so this contradicts the
  card. It is in the allow-list with its reason, so it is one line to reverse.

## Check
- `web.no-left-bars-3692.test.js`: it scans the `<style>` text with comments removed. Proven both
  ways: 3/3 pass here, and on origin/main's page it fails, listing exactly the 13 fixed selectors.
  Controls: a synthetic bar is flagged, while a hairline, a triangle and a comment are not; and every
  allow-listed selector must still exist, so the list cannot go stale.
- `docs/browser-checks/render-no-left-bars-3692.js`: it builds each fixed element on a sealed board in
  both themes and asserts equal borders on all four sides and no x-only inset shadow. It leads with
  two controls that must detect a bar (a quote, and an inset left shadow). Screenshot sheet per theme.
  36/36 pass. The first version passed the roadmap row vacuously: `#pj-list` carried `.asgrid`, so the
  roadmap rules never applied (the row measured a 1px border and a drop shadow). It now removes
  `.asgrid` and asserts that the roadmap rules applied (no border, an inset ring) before judging the
  bar. With the old 3px bar restored, the light arm fails. The dark arm keeps its ring through the
  dark override, which is correct.

## Review (challenge loop)
- The check now also proves the replacement exists: each fixed element carries an even border, a
  tint or a ring, and the unsure message's tint differs from a plain message's. It runs in three
  themes: light, dark by the media query, and an explicit `data-theme="dark"`. The explicit arm must
  take the dark ring, not the light one. Controls: dropping the unsure tint fails in all three
  themes, and dropping the explicit dark ring rule fails the explicit arm. 103/103 pass.
- `.detail-said` quotes the agent's own words, and quotes are out of scope. It stays in scope
  because the card lists it separately from the quote exclusions, so it is raised for Josh along
  with the tree lines.

## Weakest part
The browser check builds the elements in a sheet instead of reaching each real screen, so it proves
the styles the browser applies, not how each looks in its own context. The screenshot sheet is the
visual check in both themes.

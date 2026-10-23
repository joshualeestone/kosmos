# provtally-6966: which AI each agent runs on, on the project card (+ #6967 two-line titles)

Cards: joshualeestone/kosmos#6966 (Josh, 10-22 22:39: show what kinds of agents run in each project "if we can not
junk it up alongside the user avatars"), #6967 (from feedback: long grid titles cut to one line).

## Proposal (posted on #6966 and in #chaoskosmos-design, 22:50)

Three options mocked on the real card CSS: A a tally line beside the count, B a mark on each face, C hover only.
Called A: faces untouched, at a glance, works on a phone. B is ~9px marks on 22px faces; C has no phone and hides
the point.

## Change

1. `engine/projects.js` describe(): each member row gains `provider` = accountproblem.providerOf(card) ('Claude',
   'OpenAI', 'Qwen', 'Gemini', 'Google', 'Grok', 'Meta'), behind the same `isNamedOurs` gate as `runner` and the face.
2. `web/index.html`: `pjProviderTally(agents)` builds the tally from the provider picker's marks (providerMarkNode),
   fixed order Claude, GPT, Gemini (Google counts as Gemini), Grok, Meta, Qwen, then any other provider (initial-letter
   chip). Words in a `.vh` span for screen readers. Appended inside `.pjfaces` after the count.
3. CSS: tally shown on `.pj-list.asgrid` cards only (the list row, roadmap and rail hide or squeeze the faces; later
   step). In the grid the faces take a full row and the count plus tally share the line under them.
4. #6967: grid title clamps at two lines (`-webkit-line-clamp: 2`), unread count pinned to the first line.
   `docs/browser-checks/render-grid-card-width.js`: clipping measured across and down, asserts two lines, control
   also undoes the clamp.
5. `web.provider-tally-6966.test.js`: member rows from the real producer (tied rows carry their provider, an untied
   one null; checked by hand to fail with the engine line removed), and the tally's order, merging and words.

## Decided

- Grid cards only in this change. Room member lists and the list row are the card's second step.
- Weakest premise: people know the marks without names. Hover title and screen-reader words name them; if not
  enough, names instead of marks on wide cards.

## Validation (23:10)

- render-grid-card-width.js through the harness (KOSMOS_BC_CI_ALLOWLIST): passes (2 lines, clipped, card width
  matches). Controls: GW_CONTROL=1 (#1310's before) turns width + clipping red; GW_CONTROL=6967 (one-line title)
  turns the two-line arm red.
- design-shots `projects-grid-6966`, light/dark, desktop/iphone15: 4 shots, 0 overflow, 0 errors. The screen waits for a
  visible `.pjtally` in the grid, so it fails if the tally does not render.

## Done means

A project card in the Projects grid shows its agents' providers at a glance and a long title on two lines, seen in
light and dark at desktop and phone widths in design-shots. Merge waits on the 0.7.64 HOLD.

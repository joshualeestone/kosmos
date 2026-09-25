# #3756: project tab view Tasks and Files headers like the consolidated view (Josh, 0.6.94)

## What
- Tab view (body:not(.consolidated)): Tasks header is title | small View All | + on one line; Files
  header is title | small View All; the doors take --consolidated-link-size (11px), the + is the same
  22x22. Before: View All centred on its own second line at 14px.
- Consolidated view: unchanged.

## Decisions
- Not unscoping the consolidated rules to "reuse" them: they sit in a 960px media block among
  higher-specificity catch-alls (`> * { grid-column: 1 / -1 }`), so removing any consolidated rule in
  favour of a shared one would let those catch-alls win and break consolidated. Instead the tab
  view's own rules adopt the same tracks and sizes, and render-consolidated-layouts.js measures both
  headers the same way and compares them, so the two cannot drift apart unnoticed.
- Files' View All keeps showing whenever there are files (not only past the listed count): Josh's
  words for this page do not ask for that, and the project's Files screen also carries the
  conversation's attachments.
- Section title size not changed (tab 12px, consolidated 11px): every tab-view card title is 12px,
  Members included; matching only Tasks and Files would make the tab page disagree with itself.

## Weakest premise
- The card says "reusing it rather than copying it"; the header is matched by rules and a comparing
  check rather than by one shared rule set (reason above).

## Tests
- render-consolidated-layouts.js: #3756 arms measure the header in both views. On the check-only
  commit (4a03aaed4, main's page) the tab-view arms are RED; with b8d74cd93 all 70 pass.
- Shots: ~/.cache/claude-handoffs/shots-3756/{before,after}/3756-tab-view.png.

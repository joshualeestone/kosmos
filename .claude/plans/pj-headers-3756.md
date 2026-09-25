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

## Review pass 1 (opus): 2 blockers, 4 warnings, 3 nits
- BLOCKER web.controls-1303h.test.js and web.rules-boxes-1303b.test.js anchors matched the tab view's
  new copies too -> anchors now carry the consolidated prefix (body.consolidated / .pjsplit >), and a
  #3756 test pins the tab view's own rules (tracks, + column, View All placement and size).
- W1 the DOM kept + before View All for the old tab layout -> View All now precedes + in the DOM, so
  keyboard order matches what both views show; the comment rewritten.
- W2 my CSS comment named a check that does not exist -> render-consolidated-layouts.js.
- W3 #3132's "by construction" size comments -> say #3756 supersedes it for the tab view.
- W4 the title size (12 vs 11px) against Splinter's "identical header" -> recorded on the card.
- NIT stale tab-view comments rewritten; a consolidated "after" shot added; the 4px title shift with
  and without a door not taken (the door's 24px hit area, #3132's WCAG 2.5.8 floor).

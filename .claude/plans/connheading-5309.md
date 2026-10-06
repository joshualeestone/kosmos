# connheading-5309: main is red, a crossing of #5304's test and #5309's new heading

engine/instructionreread-sections-5304.test.js (b7c3df958, ~20:27) requires every heading in the connections block to
be named in instructionreread SECTIONS.connections. #5309 slice 1 (ffec5200e, 23:00) added the heading "A plugin the
person installed in their own app (Claude and Codex agents)" from a tree cut before that test existed, so each passed
alone and main went red (Mona Lisa 00:14: 6 pass / 1 fail on a clean origin/main).

Change: SECTIONS.connections names the three headings in the order the block has them. One string.
Tests: the #5304 test red on origin/main (6/1), green with the change; instructionreread + connections 44/44.
Weakest premise: none beyond the string matching the block's heading exactly, which the #5304 test checks.

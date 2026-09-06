# #5: remove the first-run find-agents link (Josh 0.6.39 ruling)

## Problem

Josh's fresh-account 0.6.39 install test (launch-gating; 0.6.39 held from prod until
fixed). On the empty create screen (screen 9b) the "Look in my Documents and
Downloads" find-agents link appeared, which Josh ruled should NOT be there ("There
is no link to appear, even") - all the more so because the permissions were never
actually granted (#1) - and clicking it jumped to create-agent instead of loading
found agents onto screen 9.

## Approach

Remove the #1652/#2267 link: its render in frPaintFleet's create arm, its delegated
#fr-fleet click handler, and its CSS. The create ending is silent again ("Create
your first agent. / Let's get started." + the single Giddy Up, no link). Josh's
verbatim ruling is preserved in the code comment with the reversal recorded (this is
the "a design mock can conflict with a standing code ruling" pattern, in reverse: the
mock was tried, Josh's actual use overruled it, back to his ruling).

The agents-in-Documents/Downloads case is handled in DETECTION, not a link: once the
permission flow (#1, coordinating with Kitty) grants access, a full scan of those
folders runs and any agents load onto screen 9 via the found path.

## Tests

The render-firstrun-import-1652.js browser-check is repurposed to assert the link is
ABSENT (no .fr-lookimport, no "Documents and Downloads" copy) plus the single-button
and openCreate->pm controls. README updated. Wiring guards (indexed/reason-grep/
selectors) and server.test.js (266) green.

## Weakest premise

This removes a Splinter/Mona-approved #2267 addition, but Josh's own install test is
the higher authority and Splinter routed the corrected behavior. The found-path
loading of Documents/Downloads agents depends on #1 (permissions) actually firing,
which is a separate launch item I am coordinating with Kitty.

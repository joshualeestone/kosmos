# found-tell-3877: the one-click found-agent add sends the same default-on count choice as the create form

Card: kosmos#3877 (found by the blind accuracy review of the #3869 privacy draft). Scope from Josh's telemetry ruling
(2026-09-14 11:50, relayed by Splinter, on the card): the agent-created ping STAYS, with a checkbox ON by default, never
removed or privacy-gated. So: no dropping the ping, no flipping the server default.

## Change
- web/index.html `addImportedInPlace` (the one-click "add found agent" path): sends `notifyCreated` from the create
  form's `#create-tell` checkbox, which is static markup CHECKED by default (#3038), so it exists even though this path
  never opens the form, and it carries the person's choice if they unticked it this session. Default true if the box is
  somehow absent. The stale comment ("the telemetry was deleted, so this path sends nothing") is replaced.
- web.import-found-1652.test.js: the found path reads #create-tell, sets bodyObj.notifyCreated, defaults to ON, and the
  stale comment is gone. Red without the change (5/6), green with it (6/6).

## Weakest premise
That the create form's box is the right source for this path's choice. The alternative (a box of its own on the
found-agents row) is a design change; with no box on that row, mirroring the one choice the person can make is the
honest default, and it matches the privacy draft's wording.

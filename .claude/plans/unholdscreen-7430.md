# unholdscreen-7430: after a task comes off hold on its page, say who gets it next (kosmos#7430)

## Problem
#7407 (merged as #7441) made the unhold route answer with a `next` sentence (who keeps the task, or who the Assigner
can give it to, or that nothing will move it), and both CLIs print it. The Tasks screen did not: after Take off hold,
`tkHoldSay` wrote nothing, so a person unholding a task nobody is on could not see that an idle agent was about to be
given it, which is the case the card came from.

## Decision
- The screen shows the route's own sentence in the hold line (`tk-hold-msg`), the same place the hold words appear,
  so the page and the CLIs say the same thing. No sentence is built on the page.
- When the sentence ends with the route's ask (" To choose who, assign it now."), the ask becomes a Choose who
  button. It opens the existing Who is on it picker on the task's first open part nobody is on (the name button
  that already assigns a part), so there is one way to assign, not two.
- A hold sends no `next`, so putting a task on hold says nothing about who is next.
- The line is about who was on the task when it was shown. The repaint takes it (and Choose who) down once that changes,
  whether by Choose who or by the Assigner (review 1). Choose who opens only a part nobody is on, never a held one.
- Choose who sits in its own row under the line, outside the live region (review 1), as a bordered button on a touch
  screen's 44 px list (design review).
- Found in the design shots: the route named agents by machine name ("It stays with ada.") beside a column that says
  Ada. `unholdNext` now names them (holders, who it may go to, and a tree's builder) with `readIdentity` (the card name's own source), else the machine name. It is a
  file read, so #7407 review 6 (no pane snapshot for a kept task) still holds; a test asserts it.

Rejected: building the sentence on the page from the task and the Assigner setting (two derivations drift; the
route is the one the CLIs use). A separate flag from the route for "show the button" (the closing words are the
route's own ask, and the browser check compares the page with the route, so a wording change goes red there).

## Tests
- docs/browser-checks/render-unholdnext-7430.js (gated; boots its own board): light 1400 and dark 390. Unholding a
  task nobody is on shows srv.unholdNext's sentence with Choose who; Choose who opens the picker and choosing Ada
  puts her on (premise asserted: nobody was on it first); a task Ada is on says "It stays with Ada." with no button;
  Put on hold says nothing; the line survives the five-second repaint; no sideways scroll, no page errors. Red on
  main's page (measured).
- cli.unhold-owner-7407.test.js: a new arm, the sentence names an agent by its identity name and reads no roster;
  its control is the machine name with no identity. Red on main's server.js (measured); the other 13 pass.
- mobile-shots.js: two screens, task-unholdnext-7430 and task-unholdkeep-7430.

## Open for the design review (Mona Lisa)
Whether to hide the standing "does not nudge anyone about a task on hold" hint while the task is not on hold; and
Choose who as an inline link or a small button.

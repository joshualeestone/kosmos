# memberred-6484: a member whose restart failed while asking a question is drawn red on the Members list (#6484)

On a project's page the Members list draws each member with `pjMember`, which reads the row's look from
`cardStOf(liveM)`. A member carries a failed restart as `restartFailed` (from the card's `disruption.failed`) but no
`disruption`, and `cardStOf`'s failed-restart look fires only on `disruption.failed`. So an agent whose restart failed
while it was asking its own question read as a calm Question here, while its agent card and the project's pill were red.

## Change
web/index.html, pjMember: before `cardStOf`, a member with `restartFailed === true` (and no `disruption.failed`) is
handed to it with `disruption.failed: true`, the shape it reads. Nothing else changes: the member's words already say
"Kosmos restarted it, and it did not come back." (line ~63090).

## Not new UI
It corrects the colour of an existing row to match the agent's card and the project pill (Josh's 10-17 clean-UI ruling
is about new lines, not this).

## Test
docs/browser-checks/render-project-needsyou-2699.js: a member with `state: 'needs_you'`, `stateReportedBy: 'agent'`,
`restartFailed: true` is drawn red (warning glyph and pjm-attn); CONTROL: the same member without `restartFailed` stays a
calm Question. A mutant reverting the fix must fail the red arm.

## Reachability (review 1, measured)
Today the engine reports a failed restart as needs_you with no "by" (engine/status.js reconcileReport), so a member with
restartFailed always has stateReportedBy null, and cardStOf already draws it red. The case is not reached today; the
change keeps the row matching the card if a failed restart ever carries stateReportedBy 'agent'. Kept as a cheap guard.
restartFailed is rebuilt on every describe() from card.disruption.failed (engine/projects.js), so it does not go stale.

## Weakest premise
That the guard is worth carrying although the case is unreachable today. If it is not, the card closes as no-fix.

## Left alone (review 1 NIT)
In Settings' member list the label would still say "Question" in red for that shape (stateCopyOf ignores
disruption.failed); the agent card has the same split, and it is unreachable today.

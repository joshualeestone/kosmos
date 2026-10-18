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

## Weakest premise
That `restartFailed` on a member always means what `disruption.failed` means on the card (the card #6484 says it comes
from it). If a member can carry a stale `restartFailed` after a later successful restart, the row would stay red.

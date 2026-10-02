# joinrole-4896: "every member shows the joining role" (kosmos#4896, second half)

Written 2026-10-01 22:57 CDT. The first half (role case) merged as #4915.

## What the report says
0.7.15 diagnostic N11: "every member shows the joining role whatever they joined to do." The report's board is not on
this machine (searched Kosmos collected-feedback, feedback, selfreports, the vault, and the handoffs: only my own notes
quote it). So the original board is NOT RECOVERABLE here; this is worked from source.

## Measured from source (origin/main a7cae2b3e)
- A membership stores only the agent's machine name (projects.addAgent, engine/projects.js ~2668). No per-project role,
  purpose or "joined as" exists anywhere: not in the record, not in the join route (server.js POST
  /api/project/:id/agent/:name reads no body), not in the CLI.
- Every surface reads the member's OWN role, keyed by sessionName: describe (projects.js ~937, profileRole(card) ||
  card.role), the project member row (web/index.html ~53511), the pickers, kosmos project show (projectview.js).
- Ruled out: a project-level role, a "member"/"joining" default, a join-time role written to all, a lookup keyed by
  project.

## The call
Not a code defect I can find; build the GUARD the report implies and close the code half. The test pins: on one
project each member shows its own role, before and after another agent joins, and a saved role wins for its member
only. Mutant (describe returns the first card's role for every member): both tests red; restored, green.

Rejected: building a per-project "what they joined to do" field. That is a new feature nobody has asked for in those
words, and "never invent scope" applies.

## Weakest premise
That "the joining role" means the role shown on member rows. Two readings the code allows and this test does not
settle: (1) the agents genuinely share a role, e.g. one instruction template copied N times, whose first "You are ...,
<role>" line parses the same for all; (2) the person expected a per-project purpose, which does not exist. Either
would change my mind with the reporter's board in hand (their members' instruction files, or how they joined).

## Validation
- node --test engine/projects.member-roles-4896.test.js: 2/2; mutant 0/2.
- Picked up by tools/run-tests.sh (engine/*.test.js). Full suite before merge, through the queue.

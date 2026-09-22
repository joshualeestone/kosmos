# projmembers-addexisting-3387b -- add an existing agent to any open project (#3387)

## The bug (Josh, live 0.6.88 test, 2026-09-22)
Clicking the "+" on "Project Members" in the consolidated view did not open
the add-member modal. Splinter relayed it; Josh confirmed it on 0.6.88.

## Diagnosis (reproduced headlessly, pinned-Playwright)
`paintAgentList` grouped the agents column ("Project Members" head + the top +
switched to add-existing) only when `members.length > 0`, i.e. only when at
least one agent CURRENTLY ON THE BOARD is a member of the open project. For a
project whose members are not among the board agents (which is Josh's state,
and also any project with no board members yet), it fell back to the flat
"Agents" list, so the top + reverted to New agent and there was no way to add
an existing agent to that project from the consolidated view.

Repro states measured: 1 member/0 free -> opens; 2 members/0 free -> opens;
member-not-on-board -> DID NOT open (the bug); no project open -> flat Agents +
new-agent (correct). Only the mismatch state was broken. The existing #3387
browser-check passed because its fixture always has a matching board member.

## Fix
- `paintAgentList` groups whenever a project is OPEN in the consolidated view
  (`openProj != null`), not only when it has a matching board member. Head stays
  "Project Members"; the top + stays on add-existing (openAddMemberModal).
- Empty members list shows a muted one-line hint (`.alist-emptymembers`,
  "No agents on this project yet. Use + above to add one.") so the section is
  guidance, not a silent gap; the rest render under "Other Agents" so New agent
  stays reachable. `.alist-emptymembers` hidden when the column is folded.
- No-project-open still renders the flat "Agents" list + new-agent (verified).

## Verification
- render-project-members-3387.js: added scenario 9 (the mismatch state) and the
  `alist-emptymembers` surface token; 32 pass, 0 fail (was 26).
- Repro across all states confirms the mismatch case now opens the modal and the
  no-project case stays flat.
- Surface-map + surface-gate tests pass (0 FAILED); the new token is covered.

## Scope
Consolidated-view grouping condition + one empty-state hint + its regression
test. No engine change. Rides 0.6.89 with the other Josh design items. Not
money-moving, not public under Josh's name.

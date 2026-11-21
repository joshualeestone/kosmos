# agenthow-8735: slice 7 of #8735, the PM's new-role steps to `kosmos agent --how`

Proposal: issuecomment-7057679410. Mona Lisa's read (on the card): take, with two conditions, both built.

## Built
- engine/agentguide.js: the #4474 new-role steps, word for word, printed by `kosmos agent --how` on both CLIs
  (install/kosmos cmd_agent `--how)` arm, tools/windows/kosmos-cli.js verbAgent), listed in both usage texts.
- Condition 1: the guide opens by saying it is for an agent that makes agents, and that the setup guide makes agents
  only from the list and Kosmos refuses a role it wrote (team.vetAgentMember, fromGuide), so that refusal is named
  before anyone meets it.
- Condition 2: the pointer lives only in PM_MAKE_AGENTS_LINES (NEW_ROLE_POINTER); roles.test #4474's setup-guide
  assertion now also refuses `agent --how`, and a CONTROL checks that no role but the PM is pointed at it.
- The PM keeps the confirmation, the create command, "brief it by the name Kosmos prints", the refusal and the
  maybe-made lines (#1279). NEW_ROLE_LINES is removed from roles.js, so there is one copy of the steps.
- No doctrine change: this is role text, and a PM made before it keeps the brief it was born with.

## Numbers
pm 42,837 -> 42,440. Ratchet 42,900 -> 42,500. 173 related files: 4,475 tests, 0 failed.

Weakest premise: that a PM about to write a role runs `kosmos agent --how` first. The pointer says the confirmation
comes first, in the brief itself, so the step with a consequence never depends on reading the guide.

## Round 1 (opus, blind): nothing above nit. Both nits taken: the guide says "a role the setup guide wrote", and names `kosmos agent roles` so "that list" has its referent.

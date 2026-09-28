# pmcreate-1279: a Project Manager can build the team (kosmos#1279)

needs-decision sweep, 2026-09-28. The call on #1279: teach the Project Manager role the create-agent verb, gated like
the setup guide (confirm in one line, then `kosmos agent create`). Per-agent permissions, new agent types from scratch
and network team creation are their own cards.

## Why this is enough
The substrate is merged (#2247, #2315, #2319, #2980, #3747). `POST /api/team` takes any authenticated agent token;
the creator recorded is that agent (server.js /api/team, the #1279 AUTH block), and the per-creator cap bounds a
runaway. Only the instructions stopped a PM: `engine/roles.js` named the verb for the guide alone.

## Change
- `PM_MAKES_AGENTS` + `PM_MAKE_AGENTS_LINES` in `engine/roles.js`, in the PM's "How you work" list after the briefing
  bullet. Same confirm-then-run shape as the guide's lines; the example is a team member, not a PM.
- The comment that said only the guide names the verb now names both.
- `engine/roles.test.js`: the PM lines follow their switch, carry the confirm and the verb; CONTROL: no role other than
  `pm` and `setup` names the verb. Removing the PM wiring fails it (checked).

## Not done, and why
A PM created before this change keeps the brief it was born with; there is no role-text refresh for PMs like the
guide's `refreshGuideRole`. Building one is a separate change (it rewrites a person's agent's instruction file).

## Weakest premise
That the PM confirming with the operator is the right gate, rather than a Settings permission. Reversible: one switch.

# agentname-8109: Remove takes the name `kosmos agent list` prints (kosmos#8109)

## Problem
`kosmos agent list` prints each agent's display name (Cai). `kosmos agent remove Cai --yes` answered "we cannot find
an agent called Cai", because the engine looks the name up exactly and the agent's folder is `cai`. Found by Mona Lisa
on a prod 0.7.93 Linux board for a team made from the Team step (five agents, all lowercase machine names).

## Change
- `engine/remove.js` `resolveName(name, platform)`: the name unchanged when an agent has it exactly (folder, job or
  session), when the board cannot be read, or when no single agent matches. Otherwise the folder name of the ONE agent
  whose folder name or display name equals it ignoring case.
- `server.js`: both removal routes (GET plan, DELETE remove) resolve the decoded name first, so the plan and the
  removal act on one agent. The CLI uses these routes, so it is fixed with them.
- The refusal "we cannot find an agent called <name>" is unchanged and still quotes the name as asked; a name matching
  two agents resolves to nothing and reaches it.

## Not in this branch
- restart and move resolve names their own way; the card says "probably". Left for a follow-up if they show the same.
- `agent list` output unchanged.

## Validation
`engine/remove.test.js` 109/109 (5 new, each turned red by a matching mutant: never resolves, ambiguous takes first,
no unreadable-board guard, DELETE route not resolving). Every test file that touches the removal route green, and
server.test.js 368/368 when run from the worktree (one #1304 test needs the repo as cwd).

## Weakest premise
That `status.readIdentity(dir).displayName` is the same string `agent list` prints. Both read the agent's instruction
file; not measured on a served board until a release carries it.

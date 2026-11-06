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

## Review round 1 changes
- `remove.resolve(name)` returns `{ name, ambiguous }`; both routes refuse a name two or more agents answer to with
  "more than one agent is called X (a, b); remove it by one of those names" (the folders are named so the person can
  pick). A removed (hidden) agent is not a candidate.
- The CLI (`install/kosmos agent remove`) sends the DELETE to the plan's `name` (the resolved folder), so a board that
  changes between the plan and the person's answer cannot redirect it. An older board's plan with no name keeps the
  typed name. The #7362 test that pinned the typed name on the DELETE is updated to the resolved one.
- An agent token naming the agent by its display name now resolves too; the slug check and the ownership check both
  read the resolved name.

## Not in this branch
- restart and move resolve names their own way; the card says "probably". Left for a follow-up if they show the same.
- `agent list` output unchanged.
- An agent whose folder is recorded outside the workers folder (a profile `dir`) is not a candidate, so its display
  name still does not resolve. Team-step agents (the card's case) live in the workers folder.
- The Windows CLI has its own `agent remove`; the server now resolves its requests too, but it still sends the typed
  name on its DELETE, so the between-requests window remains there.

## Validation
`engine/remove.test.js` 109/109 (5 new, each turned red by a matching mutant: never resolves, ambiguous takes first,
no unreadable-board guard, DELETE route not resolving). Every test file that touches the removal route green, and
server.test.js 368/368 when run from the worktree (one #1304 test needs the repo as cwd).

## Weakest premise
That `status.readIdentity(dir).displayName` is the same string `agent list` prints. Both read the agent's instruction
file; not measured on a served board until a release carries it.

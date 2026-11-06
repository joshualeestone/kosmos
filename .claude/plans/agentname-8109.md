# agentname-8109: Remove takes the name `kosmos agent list` prints (kosmos#8109)

## Problem
`kosmos agent list` prints each agent's display name (Cai). `kosmos agent remove Cai --yes` answered "we cannot find
an agent called Cai", because the engine looks the name up exactly and the agent's folder is `cai`. Found by Mona Lisa
on a prod 0.7.93 Linux board for a team made from the Team step (five agents, all lowercase machine names).

## Change (as it stands after review round 3)
- `engine/remove.js` `resolve(name, platform)` -> `{ name, ambiguous }` (and `resolveName` for the name alone):
  - the name unchanged when an agent has it exactly (folder, job or session), when the board cannot be read, or when
    any candidate cannot be read (it might be the second agent with that name);
  - otherwise the folder of the ONE agent whose folder name or display name equals it ignoring case;
  - two or more matches: `ambiguous` lists their folders. Removed (hidden) agents are never candidates.
- `server.js` **the plan route (GET) resolves ONLY when asked with `?resolve=1`**, which both CLIs send. The board's
  own button asks about its card by exact name without it, so a stale card is never answered with another agent's
  plan (review round 4). Two or more matches answer "more than one agent is called X (a, shown as A; b, shown as B);
  remove it by one of those names", each folder with the name it is shown by.
- `server.js` **the remove route (DELETE) does NOT resolve**: it acts on the exact name it is given. The board's
  button sends the card's exact name, and resolving there could turn a removal whose agent went away between the
  question and the DELETE into the removal of a DIFFERENT agent (review round 3's BLOCKER).
- Both CLIs (`install/kosmos`, `tools/windows/kosmos-cli.js`) send the DELETE to the plan's `name` (the resolved
  folder). An older board's plan with no name keeps the typed name. The #7362 tests that pinned the typed name on the
  DELETE are updated to the resolved one.
- An agent token still names the agent by its board name (slug) on DELETE, as before.

## Decided, unchanged
An exact folder, job or session name wins over another agent's display name, as before this branch (test: "an exact
folder name wins"). The confirmation names the agent it will remove.

## Deferred, with reasons
- One unreadable folder in the workers folder makes `resolve` leave every miss as given, so resolution is off for
  that board until it is fixed. Deliberate: skipping it could turn a two-agent name into one. Rare, because
  `readIdentity` swallows its own read errors. A log line would help; not added here.

## Not in this branch
- restart and move resolve names their own way; the card says "probably". Left for a follow-up if they show the same.
- `agent list` output unchanged.
- An agent whose folder is recorded outside the workers folder (a profile `dir`) is not a candidate, so its display
  name still does not resolve. Team-step agents (the card's case) live in the workers folder. A symlinked folder in
  the workers folder is not a candidate either (`isDirectory` on the entry is false for a link).
- Pre-existing, not caused here, and they make `resolve` treat a case variant as exact: on Windows `jobFor` asks
  `schtasks`, whose task names are case-insensitive; and `workerDir` for a profile-recorded agent reads its profile by
  `safeKey`, which lowercases. On those agents a case variant still reaches the old exact-name path.

## Validation
- `engine/remove.test.js`: 8 #8109 tests. `server.agent-remove-name-8109.test.js`: 5 route tests over a real board.
  `cli.agent-remove-7362.test.js`: Mac and Windows #8109 tests. Each guard was turned red by a matching mutant: never
  resolves, ambiguous takes first, no unreadable-board guard, unreadable candidate skipped, hidden agents counted, the
  plan route's ambiguity refusal removed, the DELETE route resolving again, the exact-name shortcut removed, and the
  CLI ignoring the plan's name.
- Every test file that touches the removal route green; server.test.js 368/368 when run from the worktree (one #1304
  test needs the repo as cwd).

## Weakest premise
That `status.readIdentity(dir).displayName` is the same string `agent list` prints. Both read the agent's instruction
file; not measured on a served board until a release carries it.

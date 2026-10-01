# #4887: `kosmos task add` can name who the task is for

Card: kosmos#4887 (0.7.15 diagnostic N1). Branch `taskwho-4887`.

## The problem, measured on main

`kosmos task add <project> "<what>" ["detail"] [--parent <n>]` sends no `who`, so every task an agent adds
is unassigned and the Assigner hands it to whichever agent is free. An agent that wrote its own name at
the start of the title then sees `[10] Mara: diagnostic (otto)`, which reads as if otto owned it.
The board's POST /api/project/<id>/tasks ALREADY takes `who` (tasks.create checks the agent is on the
project); only the two CLIs never send it.

## What this slice does

1. **`--who <agent>`** on `kosmos task add`, Mac (install/kosmos) and Windows (tools/windows/kosmos-cli.js).
   Taken out of the arguments wherever it sits, like `--parent`; `--who=<x>` and a bare `--who` are refused
   before the board, as `--parent` is.
2. **`--who me`**: the board turns `me` into the calling agent (its token, else its pane, the same
   identification `task add` already uses for "added by"). A caller nobody can identify gets a 400 that says
   to name the agent instead. Resolved on the board, not in the CLI, because only the board knows who the
   caller is.
3. **A name is matched to a member** exactly first, else by the store key (so `April` finds `april`), on
   the board. No match keeps today's refusal ("that agent is not on this project").
4. **The answer says who it went to**: "Task added to <project>, for <agent>." when the board stored a `who`.
5. **`task list` shows who added a task when that is not its owner**: `[10] Mara: diagnostic (otto) [added by mara]`.
   Only for a task an agent added (`addedVia: process` with a name); the screen's and webhooks' wording are
   unchanged. Both CLIs.

## Decided, with reasons

- **No silent default to self.** The card suggests "a task an agent adds for itself defaults to that agent".
  Rejected for now: the CLI cannot tell a task an agent adds for itself from one it files for the team (a PM
  agent adding work, a reviewer filing a follow-up), and defaulting would quietly take work away from the
  Assigner for every one of those. `--who me` makes the intent one word. **Weakest premise:** that agents
  will reach for the flag; the instruction text (`help`, usage line) is the only thing telling them. What
  would change my mind: the next diagnostic shows agents still title-tagging instead of using `--who me`.
- **No reassign verb in this slice.** Reassignment on the board goes through a task's parts
  (`.../task/<n>/part/<m>/who`), a different model from create's single `who`. It is its own slice; noted
  on the card.
- "Creator and owner as separate fields": the board already stores `addedBy` separately from the owner;
  this slice makes the CLI list say it.

## Tests

`server.task-who-4887.test.js`: the route resolves `me` (token caller), refuses `me` from an unidentified
caller with nothing made, matches a case-different name to the member, keeps the non-member refusal, and a
control without `who` stays unassigned. Both CLIs: `--who` sends it, `--who me` reaches the board as `me`,
the flag is not folded into the detail, bad forms exit 2 before the board, the list shows `[added by ...]`
only when added-by differs from the owner.

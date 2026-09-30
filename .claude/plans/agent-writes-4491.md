# agent-writes-4491: #4491 Option C slice 5a, the agent's own token reaches task add and task close

Card: joshualeestone/kosmos#4491 (claimed:angel). Built on slice 4 (`agent-reads-4491`, the three reads). Stacked on
that branch until it merges; then rebased onto main.

## Finished looks like
1. `POST /api/project/<p>/tasks` (`kosmos task add`) and `POST /api/project/<p>/task/<n>/close` (`kosmos task
   close`) pass the board-token gate for a loopback caller presenting only a valid agent token in the header.
2. Both handlers name the caller (the token, else the pane through `messages.resolveSender`), and an identified
   agent adds and closes tasks only in a project it is on. A task added by an agent is recorded as added by it.
3. Both CLIs send the agent's own token on those two verbs, plain hex only, and still send the board token.
4. A caller nobody can name (the page, the person's terminal with no pane and no token) is exactly as before.

## Why these two, and what is left after them
Step 3 of Option C is "both CLIs stop reading board.token". After slice 4 the agent verbs still needing the board
token were four writes. Two are project-scoped and take the rule slice 3 already set (this slice). The other two
are different questions and get their own slice: `kosmos project create` (no project to be a member of yet; who
may an agent put on a new project) and `kosmos room reopen` (it clears the loop-guard that exists to stop agents).

## Decisions
- **One way to name a process caller, shared by both handlers** (`processCaller`): the agent token first (header,
  or `token` in the body), and a bad token is refused, never swapped for the pane; else the pane through
  `messages.resolveSender`. This is what task built and task message do inline since slice 3. Their code is left
  as it is; the helper is for the new callers.
- **Membership, for an IDENTIFIED caller, with or without the board token** (`notOnProjectRefusal`), as task
  message and task built. The agent must be on every stored project with that id. An unreadable projects list is
  a 503 for an identified caller. A project nobody stored is left to the handler's own 404.
- **This changes what works today, on purpose, and it is the thing to overrule if it is wrong.** Until now
  `kosmos task add` and `kosmos task close` worked for any agent on any project (the board never knew who was
  asking: task add compared the pane with a roster field the CLI's `%N` never equals, and task close read no
  caller at all). With this slice, as soon as the CLI sends the token (or a pane that resolves), an agent that is
  NOT on the project is refused: "that agent is not on this project, so it cannot add tasks to it". Rejected:
  leaving these two open to any agent. The task verbs would then disagree (message and built refuse a
  non-member since slice 3), and a task carries an assignee, so adding one is closer to commanding than to
  reading.
- **Task close reads no body.** The token comes from the header only, and the roster is read only when a token is
  presented, so the page's and the terminal's close cost what they cost before.
- **Reopen shares the handler and so the rule, but not the gate.** `reopen` is not in the pattern: it stays behind
  the board token (no CLI verb uses it). With the board token, an identified non-member is refused there too.
- **`made.by` now names the agent.** It was always empty for a CLI caller (see above). Nothing else reads it
  differently: it is a record of who added the task.

## Known limits, stated
- Advisory, as every slice: an agent that holds the board token can still send no token and no pane and be an
  unnamed process. The rule binds the cooperating agent (T1 on the card) and any caller that holds only its token.
- A paneless token (a Windows agent, a token with no roster row) is matched to the project by key, as slice 3.

## Weakest premise
That no real workflow has an agent adding or closing tasks on a project it is not on. A lead agent that files
tasks for other teams' projects would now be refused until it is put on them.

## What would change this
- Josh saying an agent may add tasks anywhere: drop `notOnProjectRefusal` from the task-add handler (one line);
  the token still names who added it.

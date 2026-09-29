# task-routes-4491: #4491 Option C slice 3, the agent's own token reaches task message and task built

Card: joshualeestone/kosmos#4491 (claimed:angel). Stacked on slice 2 (#4521, branch agent-routes-4491);
rebased onto main when #4521 merges.

## Finished looks like
1. `POST /api/project/<p>/task/<n>/message` and `POST /api/project/<p>/task/<n>/built` pass the board-token gate
   for a loopback caller presenting only a valid agent token in the header, identified as that agent. They are
   parameterized, so they sit in a separate pattern list beside the exact-match AGENT_TOKEN_ROUTES set, checked
   in the same gate term (still `... && agentTokenOk(req)`).
2. Task message refuses an identified agent that is not on the project (403, before anything is recorded or
   delivered), exactly as task built already does. Today any agent can write into any project's task and have
   its assignees notified. The screen (the person) is never refused.
3. `kosmos task message` sends the agent's own token (plain hex only), as `kosmos task built` already does.

## Decisions
- Membership mirrors task built: checked against the STORED project record (agent names), only when the caller
  is identified (token, or a pane that resolves to a card). An unidentified process caller is not newly refused
  (it is still valved and named "An agent"); that residual predates this and is out of scope.
- The patterns are anchored and use `[^/]+` for the project and `\d+` for the task, so no other task verb (close,
  reopen, parts) can match. Close and reopen stay person/pane-only until they identify the caller (next slice).
- Task built's own guards are unchanged: the person's mark can only be changed from the screen, and a token
  holder is never the screen (isViaScreen is false whenever a token is presented).

## Weakest premise
That no legitimate agent messages a task on a project it is not a member of. Task built has refused that since
its own review; a coordinator-style agent that relays into other projects' tasks would now be refused on
message too. What would change it: such a caller showing up, in which case the right fix is adding it to the
project.

## Tests
- Gate suite: token-only task message and task built pass the gate; task close with the same token is still
  refused (the pattern does not over-match); no-credential refused.
- Task message: a token-only member's message is recorded and names the token's agent; a non-member's is refused
  403 and records nothing (control: the same request from a member is recorded).
- CLI: `kosmos task message` presents a valid token and nothing for junk/absent (extends the slice 2 CLI test).
- The 570 pin: the pattern list pinned exactly, like the set.

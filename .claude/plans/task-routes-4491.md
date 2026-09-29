# task-routes-4491: #4491 Option C slice 3, the agent's own token reaches task message and task built

Card: joshualeestone/kosmos#4491 (claimed:angel). Built on slice 2 (#4521, squash 0bc05dc99, now on main); rebased
onto main.

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

- Caller resolution in task message now mirrors task built: the token's card, else a pane that IS a roster target,
  else messages.resolveSender (the CLI sends tmux's %N). Before, only an exact roster target was recognised, so a
  tokenless Mac caller was never identified (and was notified about its own message).
- Names compare EXACTLY (the stored record and the roster spell them the same), and by store.safeKey only for a token
  that resolved without a roster row (`paneless`), whose name IS the key. Rejected: key comparison for everyone
  (review round 1): it admits look-alikes (Mara vs mara, "Ma ra") and refuses all-non-ASCII names. The sender is left
  off its own notification by the same rule.
- Membership is checked BEFORE the rate valve (as task built does), so a non-member hears why, not the breaker.
  Accepted costs: a valved caller now pays the roster read (and a tmux lookup for a %N pane) before its 429; an
  unreadable roster answers 503 before the 429; a membership 403 is not counted by the valve (it records and
  delivers nothing, so there is nothing to spam).
- Behaviour change for Mac agents, stated: `kosmos task message` now presents the agent token, so a stale or
  unresolvable token is refused (403) instead of falling back to the pane, and an unreadable roster answers 503.
  This matches msg, post, react and task built (a bad credential is never swapped for a weaker one); the supervisor
  mints a fresh token at every launch.

- A roster-target pane counts only when that card is tied to our agent (isNamedOurs), as resolveSender requires;
  a stranger's pane is an unnamed process (not refused as a non-member, and no longer named as our agent).
- 503, not 400, when the caller cannot be checked: task message answers 503 for an unreadable roster with a pane
  (before, `roster.find` on null threw and came back as a 400) and for an unreadable project list; task built
  answers 503 for an unreadable project list too.

- DECIDED (review round 5): removing an agent from a project does not unassign it from that project's tasks
  (engine/projects.js, on purpose), so tasks.whoOf still names a departed agent, and task message used to notify it
  with "reply in the task", a reply this slice now refuses. A task message is therefore not delivered to an assignee
  that is no longer on the project; `delivered` lists it as not sent, with the reason (like an Off swarm). Rejected:
  letting a current assignee past membership, which reopens the non-member write this slice closes. If the project
  list cannot be read at delivery time, everyone is told, as before. Residual, stated: task built still refuses a
  departed assignee's mark (it did before this slice, on the pane path).
  The other task notifications (parts, close, reopen, heard-by) still reach departed assignees: filed as #4540
  (claimed:angel), out of this slice's scope.
- The paneless test is one helper (panelessCaller), shared by both handlers with sameAgentName/projectHasAgent.

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
- A %N pane (resolveSender stubbed) is resolved: a non-member refused, a member recorded.
- Exact vs key: a carded agent is compared exactly (a stored "Mara" refuses the roster's "mara"); a paneless token
  matches its key (stored "Ghost" admits "ghost"), with a control.
- Valve order (valve suite): with the cap spent, a non-member hears 403 and a member still hears 429.
- A stranger's pane is not taken for our agent; unreadable project lists are 503 on both routes.
- Task built matches a paneless token by key (control: refused when not on the record).
- A paneless sender is left off its own notification (control: the co-assignee is notified).
- A departed assignee is not told and is listed with the reason (control: the member is sent it).
- An encoded slash passes the gate and is a 404 for a member token.
- The 570 pin: the pattern list pinned exactly, like the set.

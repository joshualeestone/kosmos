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
- **Two smaller changes to what works today, both from sending the token (named in review round 1):**
  (1) A token the board cannot resolve is refused (403), where before the CLI sent none and the write went
  through: an agent whose session is no longer tied to its name, one the person hid by removing it, a child
  process carrying a token from an earlier run. This is what msg, post and task message already do (a bad
  credential is never swapped for a weaker one). (2) A token cannot be checked when the running agents cannot be
  read (tmux not answering): 503, "we could not check which agents are running, so the task was not added".
  A caller with NO token is untouched by both: a pane with an unreadable roster names nobody and the task is
  added unnamed, as before (rejected: answering 503 there as task message does, which would take `kosmos task
  add` away from a person's own tmux window on a tmux hiccup).
- **Who gains, for these writes.** A caller that holds only its own token (a Claude setup guide on a Mac; an agent
  behind the person's reverse proxy) can now add a task, with an assignee, and close one, in a project it is on.
  Adding a task with an assignee tells that agent and spends the shared runaway budget, as it does for every
  agent. Such a caller cannot put itself on a project (slice 4's plan has the routes).
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

## Tests
- `server.agent-writes-4491.test.js` (new, 14; the last two listed were added in round 1): the gate refuses both writes bare and with an unissued token; a
  member adds on its token alone and the task is recorded as added by it; a non-member is refused with and without
  the board token and nothing reaches the task engine; the body cannot name another agent; a pane names its agent
  (through resolveSender) and a non-member pane is refused, while a pane nobody holds, no pane, and the page are as
  before; a token the board cannot resolve is refused and never swapped for a pane; an unreadable projects list is
  a 503; a member closes and a non-member does not; a tokenless close is as before; reopen stays behind the board
  token and holds an identified non-member out; 13 neighbours stay closed; a revoked token does neither.
  An unreadable roster: a token is a 503 on both writes and nothing is written, while a pane and a tokenless close
  are as before. A live agent with no roster row is matched by key on both writes.
  Measured red, one mutation each: no membership rule; the gate left closed; a bad token swapped for the pane; the
  close handler naming nobody; an unreadable list failing open; everyone counted a member; the page held to a pane
  it sent; the adder not recorded.
- `server.test.js` (existing, unchanged): "a task records who added it and how" pins that a pane which IS a roster
  target still names its agent. My first version of the helper dropped that arm and this test caught it.
- `cli.agent-token-verbs-4491.test.js` (6 new; two print the board's refusal and exit 1): `kosmos task add` and `kosmos task close` present a valid token and
  still the board token, and forward nothing for a junk or absent one. Red against slice 4's CLI (2 tests).
- `tools.windows-kosmos-cli-writes-4491.test.js` (new, 6): the same on Windows, plus the board's refusal printed
  with exit 1 for an agent that is not on the project. Red against slice 4's CLI (2 tests).
- Pins updated on purpose: the pattern pin in server.agent-token-sender-570.test.js; the slice-3 gate test (close
  now opens, reopen does not); the slice-4 neighbours list; tools.windows-kosmos-cli-570 (task add presents the
  token); the slice-4 Windows control verb is now project create.

## Review round 1 (opus): 0 BLOCKER, 2 WARNING, 2 CONVENTION, 4 NIT
- W an unreadable roster newly refused a PANE caller (the person's terminal in tmux got 503 where it got 200):
  reversed. A pane with an unreadable roster names nobody and the write goes on, as before. A token there is still
  a 503, now declared above and tested on both writes.
- W a token that no longer resolves loses add and close, undeclared: declared above (it is the msg and post rule).
- C the slice-3 pattern comment still listed close as excluded; the Windows project-create comment still said task
  add and close pass no agent token: both corrected.
- NITs: the Mac CLI's printing of the refusal is tested (exit 1, the board's sentence); a paneless member by key is
  tested on both writes; "who gains" is stated. Not taken: passing the roster through to tellEveryoneOn to save a
  second read on a token close (a small cost on one path; it would change a shared helper's signature).


# agent-writes-4491: #4491 Option C slice 5a, the agent's own token reaches task add and task close

Card: joshualeestone/kosmos#4491 (claimed:angel). Built on slice 4 (`agent-reads-4491`, the three reads). Stacked on
that branch until it merges; then rebased onto main.

## Finished looks like
1. `POST /api/project/<p>/tasks` (`kosmos task add`) and `POST /api/project/<p>/task/<n>/close` (`kosmos task
   close`) pass the board-token gate for a loopback caller presenting only a valid agent token in the header.
2. Both handlers name the caller and an identified agent adds and closes tasks only in a project it is on, with
   one exception: a project a process made that still lists nobody (what `kosmos project create` makes). Task
   add names it from the token, else from the pane. Task close reads no body, so it names it from the token ONLY.
   A task added by an agent is recorded as added by it.
3. Both CLIs send the agent's own token on those two verbs, plain hex only, and still send the board token.
4. A caller nobody can name (the page, the person's terminal with no pane and no token) is exactly as before.

## Why these two, and what is left after them
Step 3 of Option C is "both CLIs stop reading board.token". After slice 4 the agent verbs still needing the board
token were four writes. Two are project-scoped and take the rule slice 3 already set (this slice). The other two
are different questions and get their own slice: `kosmos project create` (no project to be a member of yet; who
may an agent put on a new project) and `kosmos room reopen` (it clears the loop-guard that exists to stop agents).

## Decisions
- **Close names its caller by token only, and that leaves one gap, stated:** a Mac agent on an OLD CLI (no token
  sent) that is not on the project is refused on task add (its pane names it) and still allowed on task close
  (nothing names it). It closes once that agent's CLI updates and sends the token. Rejected: reading a body on
  close to get a pane; the CLI sends none, and the page and terminal would pay for it.
- **One way to name a process caller, used by both handlers** (`processCaller`): the agent token first (header,
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
  credential is never swapped for a weaker one), and it holds on a board that is not enforcing too: a stale
  token left in an agent's environment turns these two verbs from working into a 403 there as well. (2) A token cannot be checked when the running agents cannot be
  read (tmux not answering): 503, "we could not check which agents are running, so the task was not added".
  A caller with NO token is untouched by both: a pane with an unreadable roster names nobody and the task is
  added unnamed, as before (rejected: answering 503 there as task message does, which would take `kosmos task
  add` away from a person's own tmux window on a tmux hiccup).
- **Who gains, for these writes.** A caller that holds only its own token (a Claude setup guide on a Mac; an agent
  behind the person's reverse proxy) can now add a task, with an assignee, and close one, in a project it is on.
  In a process-made project that still lists nobody it can add a task (no assignee is possible there) and close
  any task.
  Adding a task with an assignee tells that agent and spends the shared runaway budget, as it does for every
  agent. Such a caller cannot put itself on a project (slice 4's plan has the routes).
- **One exception: a project a process made that still lists nobody (round 5, narrowed in round 6).** `kosmos
  project create` makes a project with nobody on it, not even its maker, and every agent's working rules say "You
  can make a project yourself ... Once it exists you post to it and hand it work the same way as any other
  project". With the membership rule as first written, an agent that made a project could no longer add its first
  task to it, and could not put itself on it either. So a project whose record says a process made it
  (`made.via === 'process'`) and whose member list is an empty list takes tasks from any identified agent, as it
  did before this slice. Round 5's first form of this ("any project with no members") was too wide: it also
  opened a project made ON THE PAGE with nobody ticked, one made there and emptied by removing its last member,
  and any record whose member list was not a list. None of those is opened now. `made` is an advisory record,
  used here only to keep a prescribed workflow working and never to let a caller into a project that has members.
  Two things the record cannot tell apart, both open, both accepted (round 7): the PERSON running `kosmos project
  create` in a terminal makes the same record as an agent does; and a process-made project that was staffed and
  then emptied again looks like a new one (removing a member keeps `made`). Nobody is on either to be spoken for.
  This exception is a bridge. The next slice makes project create put its maker on the project; then the maker
  is a member like any other and the exception is deleted.
  What it allows there, stated: an identified agent (on a token alone, or with the board token) adds tasks and
  closes ANY task in such a project, including one the person added. A task there can have no assignee.
  What stays inconsistent until the next slice: on that same project the agent cannot, on its token alone, read
  the task list or the room, message a task or mark it built (those check membership and have no such exception).
  With the board token its CLI still sends, all of that works as it does today. The real repair is for project
  create to name its maker and put it on the project. The "post to it" half of that instruction is already untrue
  on main for the same reason (engine/messages.js refuses a post from an agent the project does not list: "you
  are not on that project, so this room is not yours to post into"; read, not run).
- **Task close reads no body.** The token comes from the header only, and the roster is read only when a token is
  presented, so the page's and the terminal's close cost what they cost before.
- **Reopen shares the handler and so the rule, but not the gate.** `reopen` is not in the pattern: it stays behind
  the board token (no CLI verb uses it). With the board token, an identified non-member is refused there too.
- **A task's added-by record (the TASK's `made.by`, not the project's) now names the agent, and the person sees it.** It was empty for a CLI caller (see above), so the
  task page's "added by" label and the task's activity log said "An agent". They now say the agent's name. That
  is the intent. Nothing else reads the field: it does not change who the task is given to, what the breaker
  counts, or how the task is listed.
- **A roster pane that is not tied to an agent no longer names anyone.** Before, task add named the caller from
  any roster row whose `target` equalled the pane. Now the row must be tied to our agent (`isNamedOurs`), as
  task message and `resolveSender` require; otherwise the caller is unnamed (recorded with no name, and not held
  to membership). A tightening: a stranger's pane is not taken for an agent.

## Known limits, stated
- Advisory, as every slice: an agent that holds the board token can still send no token and no pane and be an
  unnamed process. The rule binds the cooperating agent (T1 on the card) and any caller that holds only its token.
- An agent whose session is literally named "operator" would have its tasks labelled "You" on the page, which
  reads `addedBy === 'operator'` as the person. Not checked: whether Kosmos lets an agent be given that name.
- A paneless token (a Windows agent, a token with no roster row) is matched to the project by key, as slice 3.
  Its task is recorded as added by that KEY ("ghost"), which can differ in spelling from the name the project
  lists ("Ghost"); the label shows the key.

## Weakest premise
That no real workflow has an agent adding or closing tasks on a project that has members and that it is not on. A
lead agent that files tasks for other teams' projects would now be refused until it is put on them. (Round 5
showed the first, wider form of this premise was contradicted by the product's own instructions for a project an
agent makes; that case is the exception above.)

## What would change this
- Josh saying an agent may add tasks anywhere: drop `notOnProjectRefusal` from the task-add handler (one line);
  the token still names who added it.

## Tests
- `server.agent-writes-4491.test.js` (new, 20): the gate refuses both writes bare and with an unissued token; a
  member adds on its token alone and the task is recorded as added by it; a non-member is refused with and without
  the board token and nothing reaches the task engine; the body cannot name another agent; a pane names its agent
  (through resolveSender) and a non-member pane is refused, while a pane nobody holds, no pane, and the page are as
  before; a token the board cannot resolve is refused and never swapped for a pane; an unreadable projects list is
  a 503; a member closes and a non-member does not; a tokenless close is as before; reopen stays behind the board
  token and holds an identified non-member out; 13 neighbours stay closed; a revoked token does neither.
  An unreadable roster: a token is a 503 on both writes and nothing is written, while a pane and a tokenless close
  are as before. A live agent with no roster row is matched by key on both writes.
  A roster pane not tied to our agent names nobody (red with the `isNamedOurs` test removed). A token resolver that
  throws is a 503 on both writes and the board keeps answering (with the catch removed the test file hangs and
  fails). An unreadable projects list is a 503 on close too.
  A process-made project that lists nobody takes a task from an agent on no list and lets it close any task
  there. The same project is NOT opened when it was made on the page, when it has no `made` record, when Kosmos made
  it, when its member list is not a list, or once it has a member. A doubled id with one such copy and one
  staffed copy refuses a non-member of the staffed one. Each measured red (see round 6).
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

## Review round 2 (sonnet): 0 BLOCKER, 0 WARNING, 2 CONVENTION, 3 NIT
- C the pane path tightened (a roster pane must be tied to our agent) and the plan did not say so: said, above.
- C "nothing else reads `made.by` differently" was false: the page's "added by" label and the activity log show
  the name now. Said, as the intent.
- NITs: a paneless caller is recorded under the token store's key, a stated limit now. The checks run before the
  runaway breaker: no gain to a caller (the breaker counts created tasks only), one tmux lookup for a tokenless
  pane caller, as task message already costs. The test ordering notes needed no change.

## Review round 3 (opus): 0 BLOCKER, 2 WARNING, 1 CONVENTION, 4 NIT
- W the close handler named its caller outside any try, and the token resolver can throw (measured with the real
  roster order: a punctuation-only tmux session name such as "!!" sorting ahead of the agent's row; filed as
  #4738, a defect on main). Fixed here at the helper: `processCaller` never throws; a token that cannot be checked
  is a 503. Tested on both writes. The reviewer's example (a Japanese name) does not trigger it: it sorts after.
- W "a roster pane not tied to an agent names nobody" had no test: added, with a tied control.
- C "both handlers name the caller from the token, else the pane" was false for close: said, with the gap it
  leaves (above).
- NITs: an unreadable projects list is tested on close; two stale comments (engine/tasks.js, the Windows CLI's
  header) corrected; the "operator" name is a stated limit. Not taken: a JSON `null` body on task add answers a
  raw TypeError sentence, as it did before this branch.

## Review round 4 (sonnet): 0 BLOCKER, 0 WARNING, 1 CONVENTION, 2 NIT
- C the 503 for a throwing resolver said "we could not check which agents are running", which is false there (the
  roster was read): it has its own sentence now ("we could not check that agent just now, so ..."), asserted.
- NITs: the bad-token test now proves its 403 is the handler's, not the gate's; the stale-token effect is said to
  hold on a non-enforcing board too.
- Asked directly and answered from the code: nothing in the close handler's new block, or in what it calls, can
  still throw; the 503 cannot be forced on another agent's token or hide a "not yours" (a garbage token never
  reaches the throw).

## Review round 5 (opus), a pass around the change: 0 BLOCKER, 1 WARNING, 1 CONVENTION, 2 NIT
- W the agent instructions (engine/defaults.js, "Making a project") tell every agent to make a project and hand it
  work; a CLI-made project has no members, so the new rule refused the maker its own project. Fixed: a project with
  no members is not narrowed (Decisions, above). Tested, with the mutation measured.
- C a Windows CLI comment still said task message presents the token "unlike list/add/close": corrected.
- NITs not taken: the Mac CLI forwards lowercase hex of any length (the board's 64-hex check refuses it, as
  declared); the refusal verb is built from the route's verb (two verbs today).
- Its four attempts to break the rule from the code all failed (another project; another author; a store and
  answer that disagree; a throw or hang in close).

## Review round 6 (sonnet): 0 BLOCKER, 1 WARNING, 2 CONVENTION, 2 NIT
- W "any project with no members" also opened a project emptied by removing its last member, and a member list
  that is not a list: narrowed to a process-made project whose list is an empty list. Five shapes tested closed,
  with the open one as the control in the same test.
- C "Finished looks like" 2 and the test header did not mention the exception; "Who gains" did not either: all
  three say it now.
- NITs: the test now closes a task the agent did not add (the widest thing the exception allows); "the post half
  is already untrue on main" is marked as read from engine/messages.js, not run.
- The reviewer's consistency finding is recorded above as what stays inconsistent until the next slice.

## Review round 7 (opus): 0 BLOCKER, 1 WARNING, 1 CONVENTION, 2 NIT
- W a process-made project that was staffed and later emptied is still opened, and nothing stored can tell it from
  a new one: DECLARED, not fixed (comment, Decisions, and the test's control arm says so). The repair is the next
  slice, which removes the exception. Rejected: a never-staffed marker written by create, for an exception meant
  to live one slice.
- C "a project the PERSON made is not that" was false for the person's own terminal (`kosmos project create`
  there records a process-made project): the comment and plan now say "made on the page".
- NITs: the closed arms assert the membership sentence, not only the 403; the task's added-by record is named as
  the task's.
- Confirmed by the reviewer from the code: the helper cannot throw for any stored shape; `via` is derived by the
  route, never taken from the body; a caller with only an agent token cannot make or empty a project.

## Review round 8 (sonnet), a sentence-by-sentence truth pass: 0 BLOCKER, 0 WARNING, 0 CONVENTION, 2 NIT. CONVERGED
- NITs, both wording, both taken: the comment says the maker's name goes in the made-by record and not on the
  member list (the instructions say "with your name on it"); a clause about which round added which test is gone.
  No code changed after this round's review.

## After convergence: one test-only change
The test for a throwing token resolver made it throw through the defect filed as #4738 (a tmux session named "!!"
sorting ahead of the agent's row). When #4738 is fixed that would stop throwing and the test's control would go
red for a reason that is not this change. It now makes the resolver throw directly, and asserts both requests
went through it. No product code changed. Still red with the catch removed (the file hangs, as measured in round 3).


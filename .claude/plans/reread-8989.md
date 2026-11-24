# kosmos#8989: a task closed by someone else owes its holder a re-read

## Finding (measured on origin/main b0178ccf3a)
`projects.syncAgent` owes a running agent a re-read of "Your projects" only when the block's standing rules changed
(`rulesChangedIn`). Its own comment states the premise: "A task arriving or closing is not a change here (the agent's
own task close changes those lines)". That premise is false when a manager agent, or the person, closes the task: the
holder's file is rewritten correctly, and nothing tells the running agent, which keeps working from the copy it read at
its start. That matches the report exactly: the file changed, the changes file stayed four days old.

## Call
- `syncAgent(name, roster, { byOther })`: when `byOther` and the write changed the block, owe the `projects` re-read.
- `/api/project/:id/task/:n/(close|reopen)`: `tellEveryoneOn(t, roster, { changedBy: actor })`; every assignee who is
  not the agent the token named is `byOther` (no token: the person or their terminal, so everyone). The built subtasks
  closed with it are told the same way.
- `/api/tasks/close` (screen only): every assignee is `byOther`.
- Review 1: `/task/:n/part/:p/(close|reopen)` names its caller too (read after the change, never refusing it: the route
  never checked one); `/task/:n/text` passes `byOther` for a title changed by someone else; `givePart` syncs the agent a
  part was moved AWAY from (before, nobody synced it, so it kept listing the part), owed unless it moved it itself.
  A hold set by someone else was already owed (rulesChangedIn compares hold marks).
- Review 2: the agent a part was taken from is now `assignPart`'s own `previous`, read inside the write (not a separate
  read before it, which could race a second move and cost the Assigner an extra store read). The Assigner's failover
  source is owed a re-read on purpose: it is at its limit, and learns of the move when it is back. A whole-task
  reassign goes through the same part give (task/assign -> givePart), so it is covered.
  Not done: a route-to-oweNow test with nothing stubbed. The seam is `verdict.changed` on a TOLD verdict, which the
  engine test drives through the real syncAgent; the route tests pin what each route passes.
- Review 3: an end-to-end test with nothing stubbed now exists (server.reread-e2e-8989.test.js: real project, tasks,
  instruction files and debt file; own close owes nothing, a manager's close owes `projects`; it fails with the route
  fix taken out). The reviewer measured the notice the agent gets: "Under Your projects: - task 2 of Lease: ...".
  Holder and actor are matched by the token store's key too (sameAgentName), as the take route matches.
  STATED LIMIT, not fixed: the section lists tasks, not parts. A part closed or moved away while the task's other parts
  stay open (or while the old holder keeps another part) changes nothing in the holder's section, so nothing is owed.
  Telling that needs a direct line, not a re-read of an unchanged section: a follow-up, not this card's report (which
  is whole tasks closed by a manager).
  Ask 2 stays declined in words: a sentence inside the notice ("notices can be late") reaches only agents that got the
  notice. The #8948 line, "the live list is right", is what every agent reads.
  Out of scope, noted: a project renamed on the screen rewrites every member's task lines and owes no re-read.
- Review 4, stated rather than changed: the part close/reopen route now resolves its caller (token, or a pane claim),
  read-only and after the write, where it resolved nobody before. Holder and actor match by key whatever named the
  actor, so a pane claim (advisory, forgeable) spelled as the holder suppresses that holder's notice: a missed notice,
  the lenient direction, on a claim that is already trusted elsewhere. A previous holder who has since left the project
  is synced too; the engine then finds no block to change and owes nothing.

Rejected: a separate pane line ("task N was closed by X"). The re-read debt already persists, retries, waits for an idle
pane and gives up after a week; a second mechanism would duplicate that and could type into a busy pane.
Rejected: owing a re-read for every task change. An agent's own close would then type a notice into the pane that just
closed it.

Weakest premise: that `actor` from the token is always the holder when an agent closes its own task. An agent with no
token (an older CLI, an agent the supervisor could not mint one for, agent-supervisor.sh 551/705, or one not started by
the supervisor) is treated as "someone else" and gets one needless notice: the safe direction.

## Asks 2 and 3 on the card
- The block already says (kosmos#8948) that `kosmos task list <project-id> --mine` is right when the lines disagree.
  That is the cheap check of ask 3. Not changing the block's words here: any new standing rule owes every agent on the
  fleet a re-read at once.
- Delivery stays best-effort by design (it types only into a pane idle at two passes running, and gives up after 7 days).

## Tests
- engine/projects.test.js "#8989": own close owes nothing (control), another's close owes `projects`, an unchanged
  write owes nothing. A mutant without the byOther arm fails it.
- server.reread-close-8989.test.js: manager close -> byOther true; own close -> false (control); no token -> true;
  reopen by another -> true, own reopen -> false; bulk screen close; close with built subtasks; part close by another
  and own; a part moved away on the screen syncs the old holder, and an agent's own move is its own; a retitle by
  another and the holder's own. Each new path has a mutant that fails its test.
- engine/tasks.assignprevious-8989.test.js: a move names the previous holder; a same-holder resubmit names nobody
  (control); taking someone off names them. A mutant that never records it fails 2 of 3.

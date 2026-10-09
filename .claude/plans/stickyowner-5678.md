# stickyowner-5678: a subtask under somebody's open task is theirs; the Assigner leaves it, and the list says so

Card: kosmos#5678 (user feedback 10-09, triaged by Splinter, routed to Angel 06:38). The Assigner (engine/assigner.js
pick) gives an idle agent "the next task nobody is on". A subtask nobody is on directly, under a parent another builder
holds, read as nobody's, so a second builder was given the same work.

## Done looks like

The Assigner never hands out a task under an open task somebody holds an open part of (any depth); `kosmos task list`
(both CLIs) names that owner on such a subtask, "(owner: X, through task N)"; tests pin the Assigner, the derivation and
both CLIs.

## Decisions (reversible)

- The Assigner treats a task TREE (a parent and everything under it, tasks.rootIn) as one builder's work (review 1):
  if any of the project's agents holds an open part of an open task in it (tasks.treeHolders), nobody else is given any
  task in it, and the holder may be (when it reads free: a built or on-hold parent, between runs). Within one pass, a
  tree given to one agent is not given to another (`taken` carries the tree and the agent). A holder no longer on the
  project holds nothing (#5034). A finished task holds nothing, whatever its parts say. Review 2: only a BUSY hold
  counts (busyHold: hasOpenWork's rules, plus the project's swarm switch), so a parked hold (on hold, built and freed,
  between runs) never locks a tree for good. Failover moves a part only into a tree no other busy agent holds.
- Not covered on purpose: a busy holder rate-limited with failover off keeps its tree for the reset window (it is
  still that builder's work; failover is the release, as for its own parts). Likewise a holder whose session stopped
  but who is still on the project: its tree waits for it, or for a person, as its own part always did. Requiring the
  holder on the live roster would hand a tree away whenever a pane blinks, which is the bug.
- The task list SHOWS, on a task nobody is on directly, the nearest open held ancestor, else the held open task with
  the lowest number anywhere in its tree (tasks.ownerIn, members only), so a held subtask's parent and siblings say
  whose they are (review 3).
- The Assigner hands out subtasks before their parent: a parent with open subtasks waits (review 3), so an umbrella
  parent's holder does not sit busy on a tree locked to everyone else. Only a subtask that will move holds it back
  (review 4): one pick could hand out, or one a project agent holds busy; never a webhook, repeating, on-hold or built
  subtask, or one held by an agent who left or parked it.
- Shown where an agent looks before starting (`kosmos task list`, from the /api/tasks rows' new ownerNames/ownerFrom).
  The page already shows the parent's holder and the child's "under task N" breadcrumb; an owner line on the page is
  a design call for Mona, noted on the card, not built here.
- Not covered: two agents who each start a subtask by hand (no Assigner) still can; the list now tells the second one
  whose it is. A hard refusal on hand assignment would block a person's deliberate choice.
- Weakest premise: the feedback says "after one builder has explicitly taken ownership". I read that as holding the
  parent; if the user's agents mark ownership some other way (a claim report naming the task, with no part held), this
  does not see it. What would change it: a report showing the second builder was given a subtask whose parent nobody held.

## Verification

- engine/assigner.test.js: no subtask or grandchild of a held parent is handed out; CONTROLS: an unheld parent's
  subtask is, a finished parent's subtask is; a parent loop cannot hang the pick. Red by mutation of the gate.
- engine/tasks.test.js: ownerIn's cases.
- cli.task-who-4887.test.js (a real board, both CLIs): the subtask row carries ownerNames/ownerFrom, both lists print
  "(owner: mara, through task N)", and the parent prints its own holder (CONTROL).
- Task, assigner, CLI, server and web task suites with the guards: 589/589.

## Review log

- **Round 1 (opus):** 1 blocker, 3 warnings, NITs.
  - BLOCKER fixed: one pass gave an unheld parent to one idle agent and its subtask to another (ownership read only from stored records; the test even pinned it). `taken` now carries the tree and its agent; a step test with two idle agents asserts one gets the tree (CONTROL: two separate tasks go to both). Red by mutation.
  - W2 fixed: the owner was shut out of its own subtasks (on-hold or built parents, between runs), and a holder who left the project kept a tree stuck. The holder may be given its tree; only members hold.
  - W3 fixed: a held CHILD did not keep its unheld parent from a second builder (nothing checked descendants). The whole tree is one unit now.
  - W4 fixed: the finished-parent cases could not fail (legacy `who` + closedAt closes the part too); now a closed task with a part still open (red by mutation).
  - NITs taken: owner names folded to one line in both CLIs. Left: failover's write-time race (a person gives the parent out between read and write); the dead `if (!a)` removed; webhook wording beside an owner line is mixed but not unsafe.
- **Round 2 (sonnet):** 0 blockers, 3 warnings, 1 convention, 3 NITs.
  - W1 fixed: a parked hold (built, on hold, between runs, or a holder switched off here) locked a tree from everyone for good, while the holder read free. Holds now count only when they keep the holder busy (busyHold, hasOpenWork's own rules). Tested built and on-hold parents (red by mutation).
  - W2 fixed: failover could move a part into a tree another busy agent holds. failoverPick now checks the tree (leaving out the stalled holder) and this pass's trees; both paths record the tree in `taken`. Tested both ways (red by mutation).
  - W3: resolved by W1 (the holder exception mattered only in the parked states, which no longer lock).
  - C taken: the plan states what "holds" means. NITs left: `[...taken].some` per candidate and per-pick tree building (bounded; fine at current sizes); `pick`'s choice carries treeKey for step (stripped before it leaves step).
- **Round 3 (opus):** 0 blockers, 3 warnings, 2 NITs.
  - W1 fixed: failover left the stalled holder out of the tree check even when it keeps another busy part there (given after its limit began), so two builders could share the tree. It is left out only when every busy part it holds there is stalled (red by mutation; CONTROL with all parts stalled).
  - W2 fixed: the list showed no owner on a held subtask's unheld parent or siblings, while the Assigner kept them from others. ownerIn now falls back to the tree's held open task with the lowest number (red by mutation).
  - W3 fixed in part: an umbrella parent given first held its tree from everyone while its holder sat on it. Subtasks now go before their parent (a loop of parent links is not read as "open subtasks"). The offline-holder case is recorded above.
  - NIT 1 recorded: from `step`, the holder-may-take-more branch is unreachable (a busy holder is never idle); it stays for pick's direct callers and costs nothing. NIT 2 accepted: the list can name a parked holder the Assigner no longer honours, until the next holder takes the task.
- **Round 4 (sonnet):** 0 blockers, 2 warnings, 2 NITs.
  - W1 fixed: the subtasks-first rule starved a parent for good behind a subtask that never moves (webhook, repeating, on hold, built, held by one who left or parked). Now only a subtask pick could hand out, or a busy-held one, holds the parent back. Six cases tested (red by mutation), with CONTROLS for a pickable and a busy-held subtask.
  - W2 fixed: ownerIn's fallback was quadratic per /api/tasks call (measured by the reviewer: 348 ms at 2000 tasks). The tree speakers are computed once per project (treeOwners) and looked up; a test checks the row agrees with ownerIn.
  - NIT 1 fixed: a finished task names no owner. NIT 2: nothing to change.
- **Round 5 (opus):** 0 blockers, 2 warnings, 1 convention, 5 NITs (each warning shown by the reviewer with a mutation that stayed green).
  - W1 fixed: the step test could not fail once subtasks went first (its one child was the only candidate). It now has two open subtasks, so only the same-pass tree guard keeps the second agent off (red by mutation of that line).
  - W2 fixed: "a held child keeps its parent" passed through the subtasks-first rule, not the tree gate. Added the sibling case (parent unheld, child 2 held, child 3 unheld), which only the tree gate stops (red by mutation).
  - C fixed: willMove copied pick's filters by hand; both now call one handOutable(t), so a filter added later is seen by both.
  - NITs: a test message corrected (the holder branch is not what it reaches); the busyHold comment now says it adds the swarm switch to hasOpenWork's rules (a holder switched off in a project holds nothing there, decided); recorded: a finished top task still joins its subtrees into one tree (rootIn walks past closed ancestors), so a held child keeps a cousin from others until it is done, not for good; the display can name a parked ancestor while the Assigner protects a busy sibling (round 4's NIT 2); small per-call costs, fine at today's sizes.
- **Round 6 (sonnet):** nothing above WARNING; 15 of 17 one-line guard deletions caught. Both survivors now have tests:
  - W1: failover in one pass (two idle agents, one stalled holder with two stalled parts in one tree): the tree key keeps the second off (CONTROL: without it, it would move); step's passing of `taken` to failoverPick is pinned in source (a step-level run needs rate-limited cards).
  - W2: a holder switched off in the project does not keep its tree (CONTROL: switched on, it does); red by mutation.
  - Behaviour of the handOutable extraction checked unchanged against origin/main. NIT left: per-task costs in pick, fine at today's sizes.
- **Round 7 (opus):** 0 blockers, 2 warnings, 2 conventions, 3 NITs (15 guard deletions in a scratch copy; 3 caught before).
  - W1 fixed: a closed subtask with a part still open could starve its parent if the closed check went; tested (red by mutation).
  - W2 fixed: the list's member filter and nearest-ancestor rule had no tests; added a former holder, a nearer holder, and the tree fallback (each red by mutation).
  - C1 fixed: four comments now describe the tree-wide display. C2: busyHold's comment says its callers leave out closed tasks and paused projects; its built-for-all clause is tested (red by mutation); its between-runs clause is left untested (a repeating task between runs is costly to build here; the clause is hasOpenWork's own call).
  - NITs: failover's keeps reads busy holds only (a parked part does not keep the holder; tested, red by mutation). The holder branches (willMove's held arm for the holder itself, treeIsOthers' `held.includes(session)`) are unreachable from step, as recorded in round 3.

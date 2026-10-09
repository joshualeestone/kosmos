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
  still that builder's work; failover is the release, as for its own parts).
- The task list SHOWS the nearest open held ancestor (tasks.ownerIn, members only) on a task nobody is on directly.
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

# #9176: the instructions task list shows built tasks as open work

Split from #9166 item 5 (feedback triage 11-26).

## Measured (origin/main 0f16043fe1)
- engine/projects.js `blockBody` lists every task the agent holds that is not closed. A built task (builtAt: done,
  waiting on a release or a check) reads exactly like work to do.
- `kosmos task list --mine` shows open tasks by default and built ones only with `--built` (tasks.listGroup). So the two
  lists disagreed, which is what the report saw.
- The report's other half (a task kept after it moved to someone else) was fixed by kosmos#8989 (11-24, in 0.8.25):
  the previous holder is synced when a part moves. Not in this card.

## Change
- A task that is built FOR THIS AGENT gets " [built: done and waiting; `kosmos task show <project> <n>` has the rest]"
  (worded in review 5: a mark can carry no note, so the line names where the rest is). Built
  for this agent is the Assigner's rule (hasOpenWork, busyHold): builtAt, and either the person's mark freed everyone
  (builtFreesAll) or this agent's own mark is in builtWho. It stays on the list: the agent uses its number to follow up.
- Another holder's mark does not cover this agent's open part, so such a task is listed unmarked (review 1).
- A hold or a paused project is still named first (`held(t) || built(t)`), as #5864 keeps a built task in a paused
  project "on hold". One mark per task.

- The instruction blocks follow the mark (review 4, 5): the task built route (set and clear) and the repeat route (a
  repeat rule drops a built mark) re-sync every holder through tellEveryoneOn, owing re-reads per owesNotice. The repeat
  route learns of the drop from setRepeat itself (`opts.out.droppedBuilt`, set inside its write; review 6).

## Rejected
- Dropping built tasks from the block: the agent would lose the number it reports against.
- tasks.listGroup (the first version): it is per task, this list is per holder; it told a second holder with an open
  part that there was nothing to do (review 1's BLOCKER).
- Naming the wait ("a release or a check"): a built task can wait on the person or a review; the words stay neutral.

- Making the block agree with `--mine` everywhere: `--mine` groups per task, so it hides another holder's built shared
  task from a holder still on it. The block is right there and `--mine` is not; filed as #9177 (one shared helper).

## Weakest premise
That builtWho holds the same session names the block is built for (the Assigner reads it the same way, and the `mine`
filter matches whoOf against the same name).

## Tests: engine/builtmark-9176.test.js (5)
- built (by this agent) marked, open not (CONTROL); an unnamed caller's mark (builtWho empty) leaves it unmarked; built + on hold reads on hold only; two holders, built by ada: ada
  marked, bo not, and after the person's mark both are; built in a paused project reads on hold only.
- Controls: any builtAt marks (1 fail, the two-holder case); the mark removed (2 fail); hold not first (2 fail).
- Existing: the 50 files that render the block or sync agents, 1793 tests, 0 fail.

## Reviews
- Round 1 (opus): 1 BLOCKER, 2 WARNING, 0 CONVENTION, 2 NIT.
  - BLOCKER: on a task with parts, one holder's `task built` sets builtAt for the task but covers only that holder
    (builtWho). The listGroup rule marked it "nothing to do" for EVERY holder, while the Assigner still counts the other
    holder's open part as its work. Reproduced by the reviewer. Fixed: the Assigner's per-holder rule; two-holder test
    with the person's-mark case; perturbation (any builtAt) red.
  - WARNING: "waiting on a release or a check" is wrong for a task waiting on the person or a review. Fixed: neutral words.
  - WARNING: the weakest premise named the wrong axis. Rewritten above.
  - NITs: the listGroup test tested its own wiring (replaced by the two-holder test); the comment cited --mine (reworded).
- Round 2 (sonnet): 0 BLOCKER, 1 WARNING, 1 CONVENTION (none found), 2 NIT.
  - WARNING (SELF, prose): the comment called the gate "the Assigner's own rule", but hasOpenWork also frees a holder
    whose own parts are all closed. Fixed by deleting the claim; the comment now says only what the code checks.
    The case itself (a holder with all its parts closed on a task another part keeps open) is DEFERRED: it was listed
    unmarked before this change too, and it needs different words from "built" (its part is done, not built).
  - NITs not taken: repeating tasks waiting for their next run (setBuilt drops built on a recurring task, so not
    reachable); no test for the closed-parts holder (deferred with it).
- Round 3 (opus): 0 BLOCKER, 2 WARNING, 0 CONVENTION, 2 NIT.
  - WARNING: with the per-holder rule the block and `--mine` disagree for a second holder of a shared built task (the
    standing line says the live list is right). `--mine` is the wrong one there (pre-existing); filed as #9177 and named
    under Rejected.
  - WARNING: "nothing to do on it unless it is reopened": a built task is not reopened (new work drops the mark), and its
    note can name the agent's own follow-ups. Fixed: "done and waiting; its note says what is left".
  - NIT taken: a test that an unnamed caller's mark frees nobody. NIT not taken here: one shared builtFor helper (in
    #9177, where --mine needs it too).
- Round 4 (sonnet): 1 BLOCKER, 2 WARNING, 0 CONVENTION, 3 NIT.
  - BLOCKER: the task built route (set and clear) synced nobody, so the new mark only appeared, or went away, when some
    unrelated change re-synced the agent; a cleared mark could keep saying "done and waiting". Confirmed (no periodic
    sweep either). Fixed in server.js: when the mark changed, every holder is synced, owing a re-read to each one the
    change did not come from (owesNotice, as the edit and close routes). server.built-sync-9176.test.js (3): an agent's
    mark syncs both holders (only the other owed), the person's clear owes both, CONTROL unchanged syncs nobody.
    Perturbation (sync off): 2 fail. Built-route, 8989 and block files: 1864 tests, 0 fail.
  - WARNING: a third copy of the built-for-holder predicate: duplicate of round 3's NIT, in #9177.
  - WARNING: repeating tasks waiting for their next run: unreachable (setBuilt drops built on a recurring task).
  - NIT taken: the test header named the wait. NITs not taken: a sentence in the standing rules about the mark (changes
    every agent's instructions; the mark explains itself); the plan's suite count (measured here, stated with its files).
- Round 5 (opus): 0 BLOCKER, 2 WARNING, 0 CONVENTION, 3 NIT.
  - WARNING: a repeat rule drops a built mark (setRepeat) but the repeat route synced nobody, so the block kept "built".
    Fixed: the route reads the task first and, if the mark went, re-syncs the holders (tellEveryoneOn with notice). Test +
    CONTROL (not built: no sync); perturbation red. (Give and part routes already rewrite the block through
    tellEveryoneOn when they drop the mark for new work, and the holder is told of the new work.)
  - WARNING: "its note says what is left" could point at no note. Fixed: the mark names `task show <project> <n>`.
  - NITs taken: the built route now calls tellEveryoneOn (it fetches a roster if none), not a hand copy, and its comment
    says owesNotice decides; the route test's agent case now runs the real new-mark path (waitsOnly off).
  - After: new files 5/5 and 5/5; every repeat, built, block and sync file (67): 2186 tests, 0 fail.
- Round 6 (sonnet): 0 BLOCKER, 1 WARNING, 0 CONVENTION, 4 NIT.
  - WARNING (SELF, code): the repeat route read the task before setRepeat, so a mark set in between was missed.
    Fixed: setRepeat reports `out.droppedBuilt` from inside its write (setOnHold's `out` pattern); the earlier read is
    gone. A test of the real setRepeat (built: true; CONTROL not built: false). Perturbations: the report removed (1
    fail), the route ignoring it (1 fail).
  - NIT taken: the mark guards a missing project id. NITs not taken: the predicate copies (#9177); the route test's stub
    (the real setRepeat is now pinned at engine level); the #5864 citation.
  - After: the 76 repeat, built, block and sync files: 2259 tests, 0 fail.

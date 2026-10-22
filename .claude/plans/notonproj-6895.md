# notonproj-6895 (kosmos): a task's holder who is not on its project is named so (#6895), and the reviewer choice reads members by name (#6896)

Card: kosmos#6895, split from #6893 (a user's feedback; never quoted or named). Moved to Baron by Splinter 10-22 06:43.
Angel's slice, decided on the card and kept: show it where the person looks, no automatic fix.

## The change
- engine/tasks.js `allTasks`: each Tasks row gets `offProject`, the holders of an OPEN part who are not in the project's
  `agents` (absent when none). The Tasks row (`tskRow`) names them "Rex (not on this project)".
- web/index.html `tkMemberName(p, sessionName, holds)`: a third argument; when true and the name is not one of
  `p.agents` (member objects), it appends " (not on this project)". Passed as `!part.closedAt` by the project's task
  cards (each part row and the sole holder) and the task page's part rows. Every other caller (built by, receipts,
  history, claims) is unchanged.
- The project page: `#pj-offproject` under the task list, "N open tasks are held by agents not on this project", over
  every open task (not only the five cards shown), hidden at 0.
- #6896, found while reading the "(left the project)" precedent: `tkPaintReviewer` read `p.agents` as names, but the
  page's members are objects, so on a real board the "If missed, tell" choice listed "[object Object]" and called a
  member's stored reviewer "(left the project)". Measured by lifting it as its unit test does, with both shapes (card
  #6896). It now reads `sessionName` (a bare name accepted too). web.notonproject-6895.test.js tests it on member rows from the
  real producer (projects.describe; fixture-discipline.test.js forbids hand-built rows); web.task-repeat-4787.test.js is
  unchanged and still passes on bare names.

## Decided
- Only OPEN parts of an OPEN task count. A finished part's holder who later left is history, and so is a finished task
  (closing a task leaves its parts open, so review 1 found the Tasks row and the task page marking a closed task while
  the project count, over open tasks only, did not). Both now skip a finished task; web.notonproject-6895.test.js
  and engine/tasks.offproject-6895.test.js each have a finished-task case that fails without it.
- The count has its own class, `.pj-offproject` (callout size, label-3, left-aligned under the list). Review 1: it first
  borrowed `.tk-empty`, the centred, padded empty-state style.
- The label goes through `tkMemberName` rather than a new helper: about a dozen web tests lift that painter with a fixed
  list of names, and every one already lifts `tkMemberName`.
- Not labelled (reviews 2 and 4): the claim line that names the agent a claim is about, the task page's close-note
  ("It does not stop Rex", from `aboutName || who`), the history lines, and the notification text. The claim line and
  the close-note sit beside the part row that already carries the label, so repeating it there doubles it; history and
  notifications say what happened, not who holds the task now. Every holder ROW is labelled.
- Two derivations of one fact (review 5): the Tasks rows read the engine's `offProject` (the stored `agents` names);
  the project page's labels and count read the page's member rows. They agree because projects.describe emits one row
  per stored member (the new test's pre-control asserts it). Sending the count on the project route was rejected for
  this slice: it adds a field to a route every screen reads, for a number the page can already derive.
- An inherited owner on a Tasks row (`ownerNames`, #5678) is never labelled, and never needs to be: treeOwners and
  ownerIn already keep only the project's members.
- The Tasks rows take the fact from the engine (`offProject`), as they take `ownerNames`, rather than re-deriving
  membership on a screen that has no project roster.
- Rejected (Angel, on the card): adding the agent back automatically; refusing to remove an agent who holds tasks.

## Measured
- New tests: engine/tasks.offproject-6895.test.js (3), web.notonproject-6895.test.js (5, one runs the real paintTaskPage). Against main's code both
  files fail every test (red control); on this branch they pass, with the 15 other task-related web and engine test
  files (197 tests).

## Weakest premise
That the mismatch arises only by removal after assignment (the card's premise too): assigning already requires
membership in engine/tasks.js. A route that assigns without that check would be its own bug. Second: the count's
wording and place (a muted line under the task list) were chosen here without a design review.

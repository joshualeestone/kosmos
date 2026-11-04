# heldios-7918: a held question reads held on the iPhone (kosmos#7918, follow-up to #7915, #7916)

The iPhone mirrors what #7916 does on the web page (Renet's branch heldcount-7916, plan .claude/plans/heldcount-7916.md).

## The split with #7916 (as of heldcount-7916 at 6424c0c36c)
#7916 marks a held question in four web places: pjPillOf (`summary.needsYouHeld`), tskAskRow
(`askingWithoutTask[].held`), tskRow's wait and who lines (`waitingOn[].held`, engine/tasks.js waitingOnOf) and
pjNeedsNotice (a member's `stateHeld`); pjAlsoWhy words the also-rows, which the phone does not have.
- **On #7916 (cherry-picked from this branch, plus Renet's map entries):** the phone's project pill and ask row, and the
  `held` entry in both phone needs-reason maps (BoardRoom.swift and TasksLogic.swift `needsWhy`, PJ_NEEDS_WHY.held's
  words). So the room suite's two-way pin against PJ_NEEDS_WHY passes on #7916 alone.
- **On #7918 (this branch, stacked on heldcount-7916):** the phone's task rows and needs notice. On #7916 alone those
  still say "Waiting for your answer"; this branch fixes that. Merge it right after #7916.

## Built here
- **Task rows** (ios/Kosmos/TasksLogic.swift `decisionLine`, mirroring tskRow): `waitingOn[].held` is read with `isTrue`
  (a JSON true only, as the web's `=== true`; `1` is not held). When every entry is a held question, the wait line is
  "<names>: Held until you are back." with no age; in the who line a held question reads held and every other reason
  keeps its words. Held means something only on a question.
- **The room's needs-you notice** (ios/Kosmos/BoardRoom.swift `needsNotice`, mirroring pjNeedsNotice): a member's
  `stateHeld` is read with `isTrue`; a held question reads "Held until you are back." with Answer.

## Built on #7916 from this branch's first commits (for the record)
- **Project pill** (`projectWord`, pjPillOf): `.questionHeld`, "Question held", calm, when needsYou == needsYouQuestions
  == needsYouHeld and the agents are readable.
- **Tasks ask row** (`askWait`, tskAskRow): "Held until you are back.", no age, even with no known start.

## Decided (reversible; my call)
- Review round 1 accepted "task rows unchanged" on my reading that #7916 did not mark them; round 2 showed it does
  (waitingOnOf, tskRow). My reading was wrong; corrected here and on #7916.
- The #7797 hold for the person (`heldForYou`) stays the plain "Question", as on the web.
- The agent list is untouched: it already shows the Mac's own word (cardWord), so "Question held" reaches it.
- No phone counterpart for pjAlsoWhy's "Held until you are back, about another project.": the phone's notice has no
  also-rows (needsNotice lists only members with needsYouHere).

## Rejected
Building against main alone (round 1's choice): the phone's maps are pinned both ways against PJ_NEEDS_WHY, so a
phone-only `held` fails on main and a web-only `held` fails on #7916. Stacking and splitting as above avoids both.

## Weakest premise
That #7916 merges with these field names (`waitingOn[].held`, a member's `stateHeld`). Renet confirmed no renames
(03:29). If they change, the phone falls back to the plain words: safe, but the card is not done. Check by content
after #7916 merges.

## Tests
ios/LogicTests/tasks/main.swift (#7918): task rows: every question held reads held with no age; controls: one of two
held keeps the age, held on a non-question is ignored; the who line names the held one; `held` read only from a JSON
true. ios/LogicTests/room/main.swift (#7918): the needs notice held with Answer; controls: an unheld question, held on a
non-question; stateHeld read only from a JSON true. Mutants on both arms go red. Every runner that compiles
BoardRoom.swift or TasksLogic.swift was run.

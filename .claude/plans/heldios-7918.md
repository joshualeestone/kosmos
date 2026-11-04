# heldios-7918: a held question reads held on the iPhone (kosmos#7918, follow-up to #7915, #7916)

The iPhone mirrors what #7916 does on the web page (Renet's branch heldcount-7916, plan .claude/plans/heldcount-7916.md).
**Stacked on heldcount-7916 (review round 2).** The fields are read as optional, but the phone's needs-reason maps are
pinned both ways against web/index.html's PJ_NEEDS_WHY (room suite line ~1090, tasks suite), and ios.board-parity-7084
runs those suites in the node validation. #7916 adds `held` to PJ_NEEDS_WHY, so: #7916 alone fails the room suite
(measured, 1 of 812), and this branch alone would fail it the other way. They merge back to back, #7916 first.

## Built
- **Project pill** (ios/Kosmos/BoardRoom.swift `projectWord`, mirroring web pjPillOf): `summary.needsYouHeld` is read
  (0 when absent or not a number). When every waiting question is an agent's own question AND every one is held
  (`needsYou == needsYouQuestions == needsYouHeld`, agents readable), the word is the new `.questionHeld`, "Question held",
  coloured as Question (calm, Palette.askedWord). One held of two, an Issue among them, or unreadable agents: unchanged.
- **Tasks ask row** (ios/Kosmos/TasksLogic.swift `askWait`, mirroring web tskAskRow): `askingWithoutTask[].held` is read
  with `isTrue` (a JSON true only, as the web's `=== true`; `1` is not held). A held question's line is
  "Held until you are back." with no age.

- **Task rows** (TasksLogic.swift `decisionLine`, mirroring tskRow): `waitingOn[].held` is read with `isTrue`. When
  every entry is a held question, the wait line is "<names>: Held until you are back." with no age; in the who line, a
  held question reads held and every other reason keeps its words. Held means something only on a question.
- **The room's needs-you notice** (BoardRoom.swift `needsNotice`, mirroring pjNeedsNotice): a member's `stateHeld` is
  read; a held question reads "Held until you are back." with Answer. Both maps gain the `held` reason, as PJ_NEEDS_WHY.

## Decided (reversible; my call)
- Round 1 accepted "task rows unchanged" on my reading that #7916 did not mark them; round 2 showed it does
  (waitingOnOf, tskRow). My reading was wrong; corrected above and on #7916.
- The #7797 hold for the person (`heldForYou`, a task held for the person) stays the plain "Question": it is a different
  thing from a question the agent holds, and the web keeps it "Question" too.
- The agent list is untouched: it already shows the Mac's own word (cardWord), so "Question held" reaches it.

## Rejected
Building against main alone (round 1's choice): it cannot pass the parity pins once #7916 lands, and #7916 cannot pass
them without it. Keeping the held words outside the maps would pass on main and break the moment #7916 merges.

## Weakest premise
That #7916 merges with the field names as they are on its branch today (`summary.needsYouHeld`, `askingWithoutTask[].held`).
If its review renames them, this reads nothing and the phone falls back to the plain words: safe, but the card is then
not done. Check by content after #7916 merges.

## Tests
ios/LogicTests/room/main.swift (#7918): every question held reads Question held; controls: one of two held, an Issue among
them, agents unreadable; parse: the field read, absent (older board) and non-number both read the plain Question.
ios/LogicTests/tasks/main.swift (#7918): ask row and task rows: `held` read only from a JSON true (`1` is not); held,
no age; controls: one of two held keeps the age, held on a non-question is ignored, an unheld one keeps its wait.
Room suite also: the needs notice held and its controls. Mutants on all four arms go red. Every runner that compiles BoardRoom.swift or TasksLogic.swift was run.

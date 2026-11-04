# heldios-7918: a held question reads held on the iPhone (kosmos#7918, follow-up to #7915, #7916)

The iPhone mirrors what #7916 does on the web page (Renet's branch heldcount-7916, plan .claude/plans/heldcount-7916.md).
Built against main: both new fields are read as optional, so this ships before or after #7915/#7916 merge. Until they
merge, a board sends neither field and the phone reads exactly as before.

## Built
- **Project pill** (ios/Kosmos/BoardRoom.swift `projectWord`, mirroring web pjPillOf): `summary.needsYouHeld` is read
  (0 when absent or not a number). When every waiting question is an agent's own question AND every one is held
  (`needsYou == needsYouQuestions == needsYouHeld`, agents readable), the word is the new `.questionHeld`, "Question held",
  coloured as Question (calm, Palette.askedWord). One held of two, an Issue among them, or unreadable agents: unchanged.
- **Tasks ask row** (ios/Kosmos/TasksLogic.swift `askWait`, mirroring web tskAskRow): `askingWithoutTask[].held` is read
  with `isTrue` (a JSON true only, as the web's `=== true`; `1` is not held). A held question's line is
  "Held until you are back." with no age.

## Decided (reversible; my call)
- **Task rows (waitingOn) are not changed.** The card names "waitingOn entries", but #7916's web change touches only
  pjPillOf and tskAskRow; engine/tasks.js adds `held` only to askingWithoutTask. The phone mirrors the web, so a
  waitingOn row keeps "Waiting for your answer for N". If the web later marks waitingOn rows held, the phone follows.
- The #7797 hold for the person (`heldForYou`, a task held for the person) stays the plain "Question": it is a different
  thing from a question the agent holds, and the web keeps it "Question" too.
- The agent list is untouched: it already shows the Mac's own word (cardWord), so "Question held" reaches it.

## Rejected
Waiting to stack on heldcount-7916: the phone only reads two optional fields, so nothing needs the branch to compile or
test, and stacking would tie this to two unmerged branches.

## Weakest premise
That #7916 merges with the field names as they are on its branch today (`summary.needsYouHeld`, `askingWithoutTask[].held`).
If its review renames them, this reads nothing and the phone falls back to the plain words: safe, but the card is then
not done. Check by content after #7916 merges.

## Tests
ios/LogicTests/room/main.swift (#7918): every question held reads Question held; controls: one of two held, an Issue among
them, agents unreadable; parse: the field read, absent (older board) and non-number both read the plain Question.
ios/LogicTests/tasks/main.swift (#7918): `held` read only from a JSON true (`1` is not); a held question's line; control:
an unheld one keeps its wait. Every runner that compiles BoardRoom.swift or TasksLogic.swift was run.

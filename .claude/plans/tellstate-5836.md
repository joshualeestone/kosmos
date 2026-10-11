# tellstate-5836: tasks keep last verified and last communicated, and ran checks against what the person was told

Card: joshualeestone/kosmos#5836 (from user feedback). A monitoring agent compared a new result with its OWN last run
instead of with what the person had last been told, so a change the person never saw went unreported.

## Finished looks like
- `kosmos task ran <project> <n> --value "<reading>"` records the reading as last verified and answers, in the same
  command: the person was never told / the same as what they were told / CHANGED since they were told (naming it).
- `kosmos task told <project> <n> ["<what you said>"]` records last communicated (default: the caller's own last reading).
- The task's line on the page says the latest reading against what the person was last told.
- Agents learn it from a new instructions heading (doctrine v28), so edited copies are offered it too.
- Both CLIs (Mac, Windows) say the same words; tests for every answer, the report's exact mistake pinned.

## Decided
- Task fields + a `kosmos task` helper, not an instructions-only pattern: the comparison lives in the board, so the
  agent cannot compare against the wrong baseline. Exact text, whitespace runs folded.
- Not marking "told" automatically from messages: Kosmos cannot tell which message carried which reading, and agents
  may answer where Kosmos cannot see (#5805).
- A bare `told` takes the default only for the caller's own reading (two agents on one task).
- Weakest premise: that an agent runs `told` after telling the person; if it forgets, it over-reports (safe direction).

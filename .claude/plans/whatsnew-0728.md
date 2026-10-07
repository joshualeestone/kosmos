# whatsnew-0728: the 0.7.28 highlights

Splinter assigned it (10-07 14:00); Mona checked the copy (14:10). The cut pins origin/main at 03:00 Thu 10-08.

## Entries (each checked NEW since the 0.7.27 pin f443ad947 by ancestry of its merge commit, not by date)
1. [chat] "Agents see what you attach": #5448, PR #5465 (10d31a061, not an ancestor of the pin). An attached file reaches
   the agent with its type, its size, and an image's pixel size. Mac and Windows (the engine change covers both).
2. [tasks] "Choose who hears about a missed run": #4787 slice 3, PR #5427 (90325488f, not an ancestor of the pin). The
   "If missed, tell" choice under Repeats: Nobody, Me, or an agent on the project. Mac and Windows. Title per Mona: the
   one told can be an agent, so the title does not promise only the person hears.

## Left out, decided
- #5293 (propose an addition to another agent's instructions): PR #5439 IS an ancestor of the 0.7.27 pin, so it shipped in
  0.7.27; Splinter 14:02: leave it out.
- #5498, #5458, #5481: not merged at this draft. Each is added by a follow-up only if it merges before the 22:00 freeze.

## Check
`node tools/whats-new-check.js 0.7.28` (and `--platform=windows`): 2 highlights, mac 2, windows 2.

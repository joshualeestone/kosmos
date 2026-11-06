# landing-8125: a reopen switch that never lands counts as a miss (kosmos#8125)

Stacked on reopen-8118 (PR #8127). Opens as a PR after #8127 merges, rebased onto main.

## Problem
#8118's review round 8: when the launch reopen answers 'opening' (the list said the computer was online, the
ticket was made) and the other computer's page then never loads, nothing counted a miss. The reopen stayed
outstanding, a quit kept the computer, and every launch said "Going back to ..." again, past REOPEN_MISS_LIMIT.

## Change (native-app/main.swift only)
- `reopenLandingDue`: set by an 'opening' answer; cleared when another computer's page loads (`.keep`) and by
  Back to This Computer.
- At quit, before `quitKeeps` decides: still due means the switch never landed, so `quitMissesAfter` counts one
  miss and `reopenMissesForget` forgets the computer at the limit (3 launches in a row), as for an offline one.
- Selftest: 3 `quitMissesAfter` rows (290 in all). Wiring test pins the order and both clears.

## Decided
- Counted at quit, not on a timer: the page may still land late in a slow launch, and the quit is the one moment
  the launch is known to be over. A crash counts nothing (as for every other rule here).

## Weakest premise
That a page which loads at all clears the landing: a page from the computer that loads and then fails (blank, an
error page served by that computer) counts as landed.

## Validation
App selftest 290/290 (a mutant that never counts fails both counting rows); web*/native-app* test files 3860/3860.

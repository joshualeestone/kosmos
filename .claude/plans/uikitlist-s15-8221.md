# uikitlist-s15-8221: an earlier-pages check's failure says how each page ask ended

Card: joshualeestone/kosmos#8221, slice 15. Off main f31e6cac92.

## Scope

Slice 14's control (EarlierDroppedUITests, testControlWithoutTheFixTheReaderLandsElsewhere) went red 3 times in 10 on
2026-11-10 (04:16, 04:40 and 06:56 CST) at EarlierDroppedUITests.swift:66, "the first page never landed": the line
"Loading earlier messages" stayed past the 23 s wait, and the screen showed Message 41 at the top with no page rows. Once it
ran alone, so not an order effect.

Not in scope: changing the product's page-ask logic without a reproduction (see Decided).

## Finished looks like

Either the cause is found and fixed, or the next occurrence (local or CI) names its cause in the failure output without
anyone re-running it: which page asks went out, how each one ended (a page, a moved answer, a failure, or one of the three
early exits that would leave the line loading for good), each reset, and when the list reported its top showing.

## What was measured

- The app and test code at the 06:56 failure equal main f31e6cac92 (no ios/Kosmos or test change after c00e4c3596).
- 18 runs of the control on this branch with the new traces: 18 passed. Every trace: two asks, two answers, no early exit.
- 10 runs on unmodified main (no new traces), same runner: 10 passed. So the traces are not hiding it.
- 28 of 28 against 3 of 10: at last night's rate, 28 clean runs is about 1 in 22,000. Something about last night's
  conditions differs; no other simulator results from other agents in either window (scratchpad sweep).

## Decided

Ship the instrument, not a guessed fix. Rejected: changing loadEarlier or ChatList's top reading on a hypothesis with no
reproduction (a fix nobody can see work is a claim, and the control arm would have nothing to compare).

Leading hypothesis, from source and the passing traces: the screen at the failure ("Message 41 at top, no page rows") reads
the same for a page that never came and for one that landed above a held reader. In every passing trace the list reports
its top gone 30 to 50 ms after the page lands. If that report were ever missed (atTop left true while the reader is down
in the new page), the 5 s read's loadEarlier would ask for the next page by itself, and the loading line would keep coming
back through the wait. The new lines tell the two apart.

Weakest premise: that the failure will recur at all on current conditions. Would change my mind: a recurrence whose trace
shows an early exit (a product bug: earlier messages never load until the chat is left), or an ask with no atTop true
before it (the missed top report).

## Change

- ChatView.loadEarlier (DEBUG sample trace, file only, ring: false): one line per ask, one per way out (nil read, epoch,
  finishLoad nil), one per answer with its kind; restartEarlier writes the opening/loading/rows change.
- BoardLogic.olderKind: an answer's kind in three fixed words, for that line.
- ios/LogicTests/room/main.swift: the new traced values judged and added to the record's allow-list (counters, positions,
  fixed words); olderKind's body pinned, as heightLine's and numbers' are. Found by the existing guard on the first run.
- ios/tools/ui-sample.sh: when an EarlierDroppedUITests or EarlierPagesUITests check fails, print those lines from the
  app's trace (asks, exits, answers, restarts, atTop, the hold and drop lines, "chat shown" per launch).

## Coverage

- room suite's #7420 allow-list guard: the new values pass it; a perturbed olderKind fails the new pin (FAIL 1 of 866),
  restored passes (866/866).
- ui-sample.sh block: its failure pattern matches a real failing test line and not a passing log; its line pattern
  printed the expected 12 lines from a real trace (both checked by hand, not in CI). Not covered: the block running in a
  real failed CI job (it cannot be made to fail on demand); stated as a limit.
- Behaviour: none changed outside DEBUG sample tracing. The 18 traced UI runs were on the version before the lines became
  file-only; ring: false changes only whether the line is also kept in memory.

## Results

- node: 16 files reading the touched files, 129/129.
- LogicTests: every run*.sh PASS (room 866/866, run.sh 2135/2135, others all pass).
- UI: control 18/18 (traced), 10/10 (main, untraced).

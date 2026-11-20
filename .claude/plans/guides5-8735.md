# guides5-8735: slice 5 of #8735 (doctrine 62)

Stacked on wording2-8735 (doctrine 61), which is stacked on wording-8735 (60). Both unmerged (0.8.13 hold), so
doctrine-past carries hand-restored 60 and 61 rows until the rebase onto main regenerates it.

Proposals: issuecomment-7051293772. Mona Lisa's read: the 21:43Z comment.

## Built
- P1: `--held` keeps one line naming the flag and pointing at `kosmos report --help` (both CLIs already print the
  whole of it, measured). "Kosmos sees every other state for itself" goes: "And tell the board" already says the
  board is a separate listener. "Clear it when it is answered" stays whole.
- P3: the react paragraph keeps the command, where the id is (with the `[m3]` example: #4631's positive control
  needs an id in backticks), and that a raised hand is a claim. The chat analogy and the toggle go.
- P5: `--moved-to` moves word for word to `kosmos task --how` (movedTask leaves it out as moved), and the
  task --how pointer names the case. taskguide.test.js pins both.

## Not built
- P4: defaults.test.js pins "stops passing on agreement-only" (PM review on #4934/#5967), so agents expect the
  refusal they will meet.
- P2: the browser mechanics need a guide verb that does not exist; its own slice.

## Numbers
pm 43,474 -> 42,963 (42,927 before review 1 put the react toggle back). Ratchet 43,500 -> 43,000. 141 related files, 4,365 tests, 0 failed (from the worktree root).

Weakest premise: that an agent asked to hold questions reads `kosmos report --help` before using `--held`.

## Round 1 (opus, blind): two should-fix, three nits
- should-fix 1, taken two ways: the react toggle ("the same emoji again takes it back") goes back in the brief, since
  no guide states it and an agent reacting twice would undo itself; the two "You do not stop" removals get a note
  (movedHeld, an empty set as doctrine 54's movedAnswer) pointing at `kosmos report --help` and the rest of that section.
- should-fix 2 taken: a doctrine 62 pair in instructionreread-changes-7149 (moved-to left out, the note present,
  plus a CONTROL); perturbing the marker turns the main test red.
- nit 3 taken (taskguide header names --moved-to). nits 4, 5 not taken: the repeated lead is the cost of moving the
  text word for word, and the react parenthetical still says where the id is.

## Round 2 (sonnet, whole branch, blind): nothing above nit (a ragged header wrap; V61_SEES is version-specific on purpose). Converged.

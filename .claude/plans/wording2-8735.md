# wording2-8735: slices 3 and 4 of the #8735 wording pass

Goal: pm brief under 40,000 (NEW_AGENT_GOAL). Base: `wording-8735` (slices 1 and 2, doctrine 60, pm 44,103, not yet
on main: the 0.8.13 hold). This branch is stacked on it and is rebased onto main, with doctrine-past regenerated,
after slices 1 and 2 merge.

Mona Lisa's read: issuecomment-7050465958 (slices 3 and 4, against 7a5733ad4f).

## Built (doctrine 60 -> 61)
- **Slice 3 A** (her change-to): the shell trap points at the next section's heredoc and keeps the
  `kosmos msg --stdin <agent> <<'KOSMOS_MSG'` route on one line (defaults.test.js #6653 runs it).
- **Slice 3 B** (her change-to): "Formatted messages need line breaks" keeps the room example and replaces the
  reply example with "`kosmos reply --stdin <<'KOSMOS_MSG'` takes it the same way" (#4582 opener kept).
- **Slice 4** (taken, one sentence kept): the render list ("What a room shows you") moves word for word to
  `kosmos post --how` (engine/postguide.js, both CLIs, in the verb list). The brief keeps the from-first-message rule,
  the pointer, and the two cases that fail silently (raw HTML, `>` in a room) in one sentence.
- instructionreread: movedPost leaves the moved lines out as moved (keyed on the old list's first line).

## Decided, not in her read
- defaults.test.js:468 RUNS both heredoc examples in bash and zsh; B removed the second. Kept B; the test now builds
  the reply heredoc from the kept opener with the room example's body (the #6653 msg pattern). Weakest premise: the
  test runs the opener plus a body it supplies, not a full example as written.
- Render-list asserts (defaults.test.js ~360-366) moved to engine/postguide.test.js, both CLIs; the `>` assert
  stays in the brief's test, since the sentence stays.

## Numbers
pm 44,103 -> 43,474 (43,489 before round 1 cut "it does not do"). Ratchet 44,200 -> 43,500. Fingerprint 61 pinned.
doctrine-past: regenerated, then the v60 rows restored by hand (the generator reads origin/main and drops the
base branch's unmerged rows; known trap).

## Tests
141 related files (grep for defaults/doctrine/instructionreread/dmfiles/claimguide/postguide + Windows parity),
run from the worktree root: 4,365 tests, 0 failed, 124 skipped.
Perturbation: V60_POST_ONLY broken -> the doctrine 61 moved test red, its CONTROL green; restored.

## Weakest premise of the slice
That an agent runs `kosmos post --how` before its first formatted post. The kept rule and pointer carry it; if
not, the room still renders the formatting, so the cost is a plainer message, not a wrong one.

## Next
Review rounds (alternate models, max 8, last whole-branch), then wait for slices 1 and 2 to merge, rebase,
regenerate doctrine-past, validate, PR.

## Round 1 (sonnet, blind): nothing above nit
- nit 2 taken: "Two things it does not do fail silently" had "it" read as the guide; now "Two things fail silently". Re-pinned 61; the generator replaced the three draft 61 rows, and one draft section hash my hand-merge carried (b2940647) was removed in round 2. 141 files, 4,365 tests, 0 failed.
- nit 1 not taken, MEASURED false: main's v59 holds the exact marker line, and movedPost keys on the line, not the version.
- nit 3 not taken: the reply route stays in prose; listing the old example's opener as removed is accurate.

## Round 2 (opus, whole branch, blind): nothing above nit, all six taken
1-2 plan figures corrected (above). 3 size-test history gets 43,474. 4 the moved test carries all 8 moved lines
(both paragraphs) and asserts 8; a rewording of the guide's "does not" paragraph turns it red (perturbed, restored).
5 version log: about 200 characters (the sentence measures 197). 6 the guide's last line points at "Formatted
messages need line breaks" without naming a form, so it is true on PowerShell too.

## Round 3 (sonnet, whole branch, blind): nothing at all. Converged at 1bf9e29048.

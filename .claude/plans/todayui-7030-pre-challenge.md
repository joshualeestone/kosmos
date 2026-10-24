---
pre_challenge: true
method: challenge-loop
branch: todayui-7030
diff_hash: 87ff8f56b3daf51079c9e65ac06ba2774ad5cd1d6039c1294e6451395f852ea2
validation: passed
subdir_audit: passed
timestamp: 2026-10-24T08:57:41Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 blind reviewers, each given the code, not my conclusions.
**Converged:** Yes (iteration 3: two minors, both fixed; the recorded decisions re-checked and judged sound)
**Fixed:** 3 majors and 12 minors across rounds 1 to 3 | **Deferred:** starred agents first (#7034, Agents and Today together) | **Asked:** Mona Lisa (design review: approved with one change, made)

Validation at e386d3f822 (origin/main not ahead at proof time):
- ios/LogicTests run.sh 857/857, run-actions.sh 97/97, run-settings.sh 41/41.
- Simulator build of the Kosmos scheme at e386d3f822: BUILD SUCCEEDED.
- Both browser-check gates run directly on the branch: coarse 0, surface 0 (no web/ change).
- Mutants for each round's fixes, each turning its new test red (recorded per round in .claude/plans/today-7030.md).
- Design shots (light, dark, largest text, two scrolled) in ~/work/design-shots/kosmos-7030/, approved by Mona Lisa.
Subdirectory CLAUDE.md audit: none under ios/.

### Per-Iteration Breakdown

#### Iteration 1
- [MAJOR] Today flipped to the board when Tasks came or went. Fixed: only a real change of tab moves anything; the app sends the person under Today through showBoardToday().
- [MAJOR] another Mac's tasks stayed on screen. Fixed: forgetToday() on another Mac, account, sign-out and refusal.
- [MINOR] a failed tasks read kept the old list. Fixed.
- [MINOR] the subhead claimed nothing was ready when the tasks were unknown. Fixed.
- [MINOR] the hidden board page moving moved the bar off the native Today. Fixed.
- [MINOR] the board under Today did not open at its home. Fixed.
- [MINOR] a rosterUnreadable tasks answer read as a list. Fixed: unknown.

#### Iteration 2
- [MAJOR] Kosmos+ refusing this iPhone left Today on a dead end. Fixed: a Sign in button in the refused state, and the line names no tab.
- [MINOR] a stale tasks read could clear the handle of the next one. Fixed: startTasksRead with a token.
- [MINOR] old tasks showed as current when Today came back. Fixed: unknown until the read answers.
- [MINOR] the ready card's spoken label. Fixed.
- [MINOR] the Agents-only check did not wait for background reads. Fixed.

#### Iteration 3
- [MINOR] stop() left a tasks read in the air. Fixed: stop() cancels it.
- [MINOR] an old "could not read" line survived Today coming back. Fixed.

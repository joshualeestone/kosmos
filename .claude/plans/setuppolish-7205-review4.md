# Challenge round 4: setuppolish-7205 (head ae936d20e5), blind CTO lens

Scope: the whole branch diff against origin/main, extra attention on the round 3 commit ae936d20e5.
Each claim is marked MEASURED (run on this head) or REASONED (read from source, not run).

## Round 3 findings: does each fix hold?

- [WARNING] the Swift half had no pin: HOLDS. MEASURED by mutation on a scratch copy (main.swift mutated, the test
  file, tools/build-kosmos-bundle.sh and install/kosmos copied unchanged; the worktree untouched):
  - control, unmutated: exit 0
  - M1 guard's third clause replaced with `true`: exit 1
  - M2 `modeAskedThisLaunch = false` removed from switchToConnect: exit 1
  - M3 the late-start undo's `if self.computerMode == .connect` made `if false`: exit 1
  - M4 guard's third clause loosened to `(modeAskedThisLaunch)` (connect allowed): exit 1
  - M6 readLaunchComputerMode sets `modeAskedThisLaunch = true` always: exit 1
  - M7 the undo's `stopBoard` call removed: exit 1
- [NIT] Connect save-failure alert worded by mode: HOLDS in source (main.swift:2991-2994). REASONED: with run or both
  in memory, loadBoard reloads with no ?mode and the board keeps running, so "it still runs agents" is true. The one
  sub-case (Run's own write failed, so disk is still unset, then Back, Connect, a second failed write) says "still runs
  agents", which is true for this launch; the next launch asks again, which the alert does not promise either way. Fine.

## New findings

[NIT] native-app/main.swift:2992-2994: the new alert reads "Kosmos could not save your choice on this computer, so it
still runs agents on this computer." "on this computer" twice in one sentence, in a dialog Josh will read. Scenario:
Run, Welcome, Back, Connect with an unwritable Kosmos folder; the person sees the doubled phrase. Fix: drop the first
one in that branch only, or word the clause "so Kosmos keeps running agents here" (the product voice rule is "this
computer", so the first form is safer): "Kosmos could not save your choice, so it still runs agents on this computer."
Keep "on this computer" in the "will ask again" branch, where it appears once.

[NIT] native-app.computer-mode-4356.test.js:80: the mode-aware wording is not pinned. MEASURED: M5 (`let stays = false`,
so the old "will ask again" lie returns on the Run, Back, Connect path) leaves the file green, exit 0. The plan says the
alert was fixed, and nothing would notice it reverting. Fix: in the existing pageChoseMode test, assert
`/let stays = computerMode == \.run \|\| computerMode == \.both\n\s+\? "so it still runs agents on this computer"/`
(adjusted to whatever the wording above becomes), and re-run M5 to see it fail.

## Checked and found clean

- MEASURED: `node --test native-app.computer-mode-4356.test.js` (worktree cwd): 32 tests, 32 pass, 0 fail, exit 0.
- MEASURED: `swiftc -typecheck native-app/main.swift` (DEVELOPER_DIR=CommandLineTools): exit 0. The ImplicitStrongCapture
  warning at :2900 is pre-existing (origin/main has the same `[weak self]` at its :2901), not from this branch.
- MEASURED: render-firstrun-choice-4356.js exit 0, "all first-screen checks passed (50)", C7 no page errors.
- MEASURED: web.firstrun-choice-4356.test.js plus web.firstrun-consent-prc2.test.js: 39 pass, 0 fail.
- MEASURED: em dashes in added lines of the branch diff: 0 (control: 283 in web/index.html, so the pattern can match).
- REASONED: the round 3 set-count assertion (`(?<!var )modeAskedThisLaunch = `) does not count comparisons (`==` has no
  space after the first `=`) and does count a `self.`-prefixed set, so a new set anywhere trips it.
- REASONED: the web half (frBackOffered, frBackToChoice, frChoiceForget, frDots.host, FR_CHOSE_HERE) is unchanged since
  round 3's review; frClose only hides and un-inerts, writes nothing, so Back persists no first-run state.

0 blockers, 0 warnings, 2 nits.

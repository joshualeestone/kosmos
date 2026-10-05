# kosmos#4962: a found agent file with no name gets a Name field on its row

Split from #2461's acceptance (Josh's 0.6.47 test, 2026-09-07): "the empty-name case lets the person type a
name as part of adding".

## Change (product code: web/index.html only; tests and browser-check files beside it)
- `foundImportRowsHtml`: a row with no name gets a labelled Name field (`tk-inp fr-importinput`, the page's own
  field style) and the helper "What should we call it? You can rename it anytime." (the first-run adopt rows'
  words). The field id carries the row index as well as the path, since cssId keeps only 60 characters.
- `addImportedInPlace`: an empty field says "Give this agent a name first." and focuses it, sending nothing (the
  first-run adopt rows' rule). A typed name is sent as BOTH `name` (the engine folds it, "Claude Pip" becomes
  claude-pip, and refuses one it cannot use, with a reason the row shows) and `label`. The field is disabled while
  adding, re-enabled on a refusal, left disabled once added (like the button).
- Enter in the field presses that row's Add.
- Both surfaces get it: the create form's import panel (the one a person reaches today) and first run's
  find-agents loose-file rows (`frPaintScan`, same builder and handler; not reached during setup since #2497,
  but kept and live code, so it is made safe too).

## Decided, and rejected
- The typed name wins over anything the file parses to, because the row asked the person. Rejected: using the
  file's displayName when present (the row only shows a field when the scan found no name, and someone who typed
  a name expects to see it).
- Rejected: a separate slug field. The engine already folds a display name into a machine name and refuses an
  unusable one in words (create.js slugFor / nameProblem), so one field is enough.

## Weakest premise
That one field is enough on a phone through Kosmos+: the field is 13px (`.tk-inp`), and iOS zooms into a field
under 16px. The project page has a touch-only 16px rule (#718) that does not reach this panel; the first-run
adopt field is 14px and has the same exposure. Not fixed here; stated.

Second weakest premise (review 3): two nameless rows look the same on screen ("An agent file with no name in
it"), so a sighted person could type a name into the wrong one. Josh's 0.6.45 ruling for these rows is "no
markdown file, no path", so the file is NOT shown; it is in each field's and button's accessible name only.
What would change it: a tester naming the wrong file, or Josh saying the file may be shown on a nameless row.

## Tests
- (Current totals are in the LAST review section below; this list is round 1's.) web.import-name-4962.test.js (12; review 1 added the Enter handlers run for real, the first-run exemption,
  per-surface ids, a typed name kept across a redraw, focus and aria-invalid after a refusal): the nameless row's field, label and helper (a named row has none); distinct
  ids for two paths sharing a 60-character tail; an empty field asks, sends nothing, focuses the field; a typed
  name is sent as name and label; a named row is unchanged (control); the typed name beats a parsed displayName;
  an engine refusal shows its reason and re-enables the field and button; Enter wiring.
- 7 sabotages, each red by rc: no field, empty not asked, cursor not placed, typed name ignored, typed label
  ignored, field left disabled on a refusal, colliding ids.
- web.import-found-1652.test.js and fixture-discipline.test.js unchanged and green.
- Browser check: an arm for the nameless row (both engines). Design shots for the new row.

## Review 1 (opus, blind, 2026-10-01 23:00): 1 blocker, 3 warnings, 5 nits, all taken
Blocker: Enter in the field on first run also pressed Continue (frEnterSubmit) and ended setup mid-add; that
handler now exempts `.fr-importinput` and `.fr-adoptinput` (the adopt field had the same problem), and the row's
Enter handler ignores an already-handled Enter. Warnings: a refusal puts the cursor back in the field, marks it
aria-invalid and ties the reason to it (aria-describedby -> the row's error line, which now has an id); the field
id carries the surface (cf / fr) so both lists in the page cannot share ids; a typed name and the cursor survive
a redraw (importNamesKept / importNamesRestore at both draw sites). Nits: the Enter tests run the handlers; maxlength
is the engine's 32; a row that was added names what was made; the keydown handler sits after the click handler
it no longer interrupts; the test count corrected. 7 more sabotages red, one of them the blocker itself.

## Review 2 (opus, blind, 2026-10-01 23:05): 0 blockers, 2 warnings, 3 nits, all taken
W1: only a refusal ABOUT THE NAME (the engine's `field: 'name'`) marks the field invalid and moves the cursor
into it; a missing account, a non-agent file or a network failure re-enables the field and says nothing about
the name. W2: an add's state lives in IMPORT_ADDS, keyed by file; a redraw re-applies it (adding / added) and a
finished add applies its receipt to whichever copy of the row is on screen, so a redraw mid-add never offers the
row again one keypress from a duplicate (named rows' lost receipt is fixed by the same change). Nits: a held
Enter (key repeat) does not press Add again; the adopt exemption is tested; frEnterSubmit's comment names
importNameEnter and the rule that keeps the two apart. Unit 16/16; 6 more sabotages red.

## Review 3 (opus, blind, 2026-10-01 23:10): 0 blockers, 4 warnings, 2 nits, all taken
A refusal that lands after a redraw shows its reason on the copy on screen, which is ready again (and marked
invalid with the cursor in it when it is about the name); that reset is now tested. A receipt belongs to one
visit to the list (importAddsNewVisit at each new populate generation), so a page left open does not block a
legitimate re-add. Each nameless field's accessible name carries its file ("Name, <file>"); the visual sameness
is recorded above as a premise. Typing clears the old reason with the invalid mark. Enter in a first-run adopt
field adds its row. Unit 21/21; 7 more sabotages red.

## Review 4 (opus, blind, 2026-10-01 23:15): 1 blocker, 1 warning, 3 nits, all taken
Blocker (in MY browser check, written in review 1 and never run since): N1 looked the helper up with
getElementById(aria-describedby), which holds two ids since review 1, so N1 could never pass. It now checks the
`-help` id is among them and reads it by id. The check has still not run (queued as bc-4962): its first run is
its first proof. Warning: importNameEnter ignores an input method's Enter (keyCode 229, which WebKit can send with
isComposing false) and a modified Enter (as PLUS_ENTER_GO). Nits: the adopt-field Enter also covers the board's
disk-scan and found panels (stated); an added row's disabled name is not carried into a fresh field on the next
visit; the "not about the name clears an earlier invalid mark" branch is tested. Unit 24/24; 4 more sabotages red.

## Review 5 (opus, blind, 2026-10-01 23:21; traced every browser-check arm): 0 blockers, 2 warnings, 2 nits
The reviewer traced N1 to N5 against the page and found each can pass on correct code and fail on broken code
(N5 only for a page-level overflow, now tightened). Taken: focus goes back to where the keyboard was after a
refusal that is not about the name, and moves on to the next row after a successful add (this list is pressed
down, add after add); N5 also asserts the field stays clear of the Add button; "dark" is stated as screenshot-only.
NOT taken, recorded as a known gap: a file the scan NAMES (so no field is drawn) but whose name the engine cannot
use (a one-letter heading: agentfile.suggestName returns '') still gets the old "Open it from Create an agent"
dead end. Fixing it means inserting the field after the parse; that is a separate change, and the case is rare
next to the nameless one this card is about. Unit 26/26; 2 more sabotages red.

## Review 6 (opus, blind, 2026-10-01 23:25): 0 blockers, 1 warning, 3 nits, all taken
W: the move-on-after-success fired for a POINTER add too (Chrome focuses a clicked button), which on a phone would
open the keyboard over the list after each tap; it now needs a keyboard add (the click's detail is 0: Enter, Space,
or importNameEnter), passed from the extracted importGoClick. Nits: it moves past a row already added; a refusal
shown just before a redraw keeps its reason and invalid mark through it; the plan's round-1 test list is marked as
such. Unit 29/29; 5 more sabotages red (one, "the click handler ignores detail", needed importGoClick extracted
before it could go red).

## Review 7 (opus, blind, whole diff, 2026-10-01 23:31): 0 blockers, 0 warnings, 2 nits, both taken. CONVERGED.
A refused name also gets the page's flagged-field border (`.bad`, #2606), cleared on typing or on a refusal not about
the name; an add in flight over a minute (a request that never settles) is dropped on the next visit so the row
can be pressed again. Unit 31/31; 2 more sabotages red. Converged at iteration 7. Remaining before the PR: the
browser check (bc-4962, queued; its first run is its first proof), the full validation, the proof file.

## Review 8 (sonnet, blind, whole final diff incl. the post-convergence test-only commits, 2026-10-02 11:31): 0 blockers, 2 warnings, 3 nits
- FIXED: importRowsSync focused EVERY unadded copy on a name refusal; with both lists visible focus could land on the
  other surface. Now at most one copy, never one inside a hidden list (unit test review 8, red with the old line).
- DEFERRED (decided in review 1, restated for the PR): Enter adds on first run's adopt rows and the board's found
  panels too, not only the import panel. One field shape, one keyboard rule; the first-run exemption is what keeps
  Enter from also pressing Continue. The PR body says so.
- NITs noted, not taken: a comment names chk where chkAll carries the FAIL string; HEADED default is the sibling checks'.

## Review 9 (opus, blind, 2026-10-02 11:34): 0 blockers, 1 warning, 4 nits
- FIXED: review 8's "at most one copy" could still move focus off the field the person used (fail() focuses the
  pressed row, then the sync focused the first copy in #import-found). importRowsSync now takes the pressed row and
  moves focus only when that row was redrawn away. Unit test arm, red with the old line.
- FIXED (nit): the flagged border (.bad) now goes with aria-invalid everywhere it is set or cleared (the sync, the
  redraw restore), and a refusal not about the name clears a stale mark on the other copies. The fake DOM gained
  removeAttribute (all four fake-DOM test files pass).
- Not taken: first run's frPaintScan never forgets a receipt (first-run import rows are not reached in setup today);
  the chk/chkAll comment wording; the adopt-row Enter scope (deliberate, stated in the PR body).

## Review 10 (sonnet, blind, 2026-10-02 11:37): 0 blockers, 2 warnings, 4 nits
- FIXED: the flagged border outlived a retry and a success (only aria-invalid was cleared). An attempt now starts
  unflagged, success clears both marks, and importRowApply clears both on any adding or added copy (unit test,
  red without the importRowApply line).
- DEFERRED again (decided in review 1, for the PR body): Enter on adopt rows outside the import panel.

## Review 11 (opus, blind, 2026-10-02 11:41): 0 blockers, 2 warnings, 6 nits
- FIXED: a NAMED row refused about its name lost keyboard focus (the restore skipped every name refusal, but only a
  row with a Name field gives focus to the field). Now: restore unless the field took it. Unit test, red without it.
- FIXED: an attempt dropped as stuck (over a minute) that failed late deleted the NEWER attempt's state and offered the
  row again. Each attempt carries a token (its start time); only the current attempt settles the row. Unit test with
  two held creates, red without the guard.
- FIXED (nit): the leftover bare block in importRowsSync.
- Not taken: copy rows synced at add start (one list is hidden in practice); focus when the pressed row is redrawn
  away on a non-name refusal or a keyboard success; border-class assertions in a real engine (aria-invalid is
  asserted); the review-10 control is a source regex; plan heading wording.

## Review 12 (sonnet, blind, 2026-10-02 11:48): 0 blockers, 3 warnings, 4 nits
- FIXED: a stale attempt that succeeded late still painted its row "Added" before the token guard. The guard now runs
  before any success paint (unit test review 12, red without it).
- FIXED (wording): viaKey (detail 0) also covers voice control and screen-reader activation; the comment says so and
  that it is deliberate (they act as keys here).
- DEFERRED again: adopt-row Enter scope (PR body). Nits not taken (regex-over-source tests, a corner-case guard).

## Review 13 (opus, blind, 2026-10-02 12:01): 0 blockers, 0 warnings, 3 nits. CONVERGED.
NIT taken (a9af7bbe): two comments the change made untrue (the nameless-add guard in addImportedInPlace; the
frEnterSubmit docblock). LEFT: a double press on two visible copies of one row can lose the first add's success and
show a duplicate-name refusal; one of the two lists is hidden in practice, so low likelihood.

## Review 14 (sonnet, blind, 2026-10-02 12:35, the comment fix): CONVERGED; both new comments true against the code.
LEFT NITs: line ~68624 says "the document handler below" (it is above, at importNameEnter); "plus importNameEnter's
defaultPrevented check" overstates its role for these two fields (the early return alone keeps them apart).

## Validation (a9af7bbe4, 2026-10-02 13:36)
Full validation PASSED: node 14259 tests, 14037 pass, 0 fail, 222 skipped; test:shell done; build ok; subdir audit
rc 0. The "shell-shard 1/1: FAILED (exit 3)" lines in that log are fixture output from the shard runner's own test
("stops at the first failure, with its exit status"), not the real shell run.

## Rebase and re-validation (2026-10-02 13:50 to 17:54)
Rebased onto main: browser-checks-reason-grep.test.js EXPECTED_SITES conflicted (main's #4930 site and this branch's
render-import-name-4962 site both took 231 to 232), resolved to 233 and MEASURED: that file 5/5 and
web.import-name-4962.test.js 36/36 after the rebase. Full validation PASSED again at f85ef65db: node 14381 tests,
14158 pass, 0 fail; test:shell; build.


## Rebase onto #5106 and a fresh review loop (2026-10-04 19:1x onward)
- Rebased onto main after #5105/#5106: the counter conflict is gone with the counter. This branch now adds ONE
  SITE_COUNTS line, 'render-import-name-4962.js': [1, 0] (its earlier +1 emit site / no catch site, measured by its
  full runs before the rebase). The "resolved to 233" above is history.
- Loop iteration 1 (opus): a stuck add that SUCCEEDS late with nothing newer now records the agent (no second Add for
  an agent that exists). Two comment claims removed. Plan heading names the test files.
- Iteration 2 (sonnet): first run's list drops a stuck add too (importAddsDropStuck from frPaintScan; receipts stay
  for the visit). Adopt-row Enter scope: unchanged, as decided in review 1.
- Iteration 3 (opus): a stuck add that FAILS late with nothing newer now frees its row (iteration 2 made this
  reachable from #import-found while first run's list repaints); it moves no focus that late. Tested.
- The test counts quoted above (36/36) are history too; the file has grown with each fix.
- Iteration 4 (sonnet): the attempt token is strictly increasing (two attempts in one millisecond differ). Review
  14's two LEFT comment nits were fixed in iteration 1. Adopt-row Enter: unchanged, as decided.
- Iteration 5 (opus): an empty Name field no longer refuses before reading the file. A file the parse can name
  (a Kosmos export header the scan does not read) adds under its own name in one click, as before this card; only a
  file that names nothing asks for a name (same words, cursor in the field, nothing created). Unit tests for both;
  browser check N2 now waits for the row's answer. Adopt-row Enter scope: unchanged, as decided.
- Iteration 6 (sonnet): importNamesKept skips a field with no row before reading the row (raised as a nit four times,
  a warning here). The committed proof file is the old run's and is replaced by this loop's. Adopt-row Enter: unchanged.

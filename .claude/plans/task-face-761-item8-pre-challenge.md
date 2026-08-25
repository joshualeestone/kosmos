---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: task-face-761-item8
diff_hash: 5aa93f1cb65149918064a1bc6630dda13e5fd128749beeaae9549136823fea26
timestamp: 2026-08-25T08:20:00Z
iterations: 1
converged: true
---

# Pre-Challenge Proof: task-face-761-item8

**Single pass, explicit override, labelled honestly.** /code-review was
attempted twice earlier tonight (on a different branch) via the Skill
tool's background fork and stalled both times without ever collecting its
sub-agents' results. Splinter traced the root cause separately: this
session's `~/.claude-account-c` had no skills directory at session start
(symlinked in later, after this and Angel's sessions had already booted),
so `/challenge-loop` itself was invisible all night, which is why the
Skill-tool workaround was being reached for in the first place. Per
Josh's 2026-08-19 21:25 ruling (beta app, no users, ship finished work),
a labelled single self-pass beats blocking the queue on a tool that
cannot run in this session tonight.

## Iteration 1 (single pass, self)

[STRENGTH] **The face-drawing rule was extracted and shared, not
duplicated.** `tkFace(p, sessionName)` is the exact logic the task detail
page's local `faceFor` already had (avatar when `hasAvatar`, tinted
initials otherwise, `+` placeholder when unassigned), lifted to a
top-level function both the card list and the detail page now call. One
rule, checked once, cannot drift between the two surfaces the way two
copies could.

[BLOCKER] (found and fixed before this proof) **`taskClaimHtml` originally
capitalized the status text** ("Says it is on this" / "Says it is not on
this"), diverging from the pre-existing lowercase convention everywhere
else on this page (`#tk-note`'s own "says it is on this." construction,
untouched by this change). `docs/browser-checks/render-tasks.js` line
~178 regex-matches `/says it is on this/`, case-sensitive -- a real
browser check this change would have broken had it shipped as first
written. Caught by running `render-tasks.js` directly before opening this
PR, not assumed safe from unit tests alone (the unit tests I wrote used
the same wrong capitalization and would have passed either way -- a unit
test that mirrors an implementation's own choice cannot catch a
regression in that choice, only an external check with its own
independent expectation can). Fixed by reverting to lowercase, in both
the implementation and the new unit tests.

[BLOCKER] (found and fixed before this proof) **The column filter used
`t.who && !t.closedAt` directly** -- the legacy single-assignee field --
instead of going through `t.progress.assigned`/`t.progress.closed`
(engine-computed, `progressOf`). A task assigned only through `t.parts`
(the parts-first creation path, carrying no top-level `who` at all) would
silently fall out of the visible column. This is not a hypothetical: it
is the exact "second `t.who` gate" mistake `engine/projects.js`'s own
`withParts` comment names as already having bitten once (`joinTaskClaims`'s
claim computation had the same bug, fixed there; the frontend's own,
separate column filter still had it). Fixed by switching to
`t.progress.assigned > 0 && !t.progress.closed`, mirroring
`engine/tasks.js`'s own `columnTasks()` for the same reason it exists.
Covered by a new test that builds exactly this shape (a task with `parts`
but no top-level `who`) and asserts it is not dropped.

[WARNING] (checked, not a bug) **The unassigned-part face's muted
background (`.lav.q`) was scoped only to `.tkpart`** (the detail page's
per-part container) in the existing CSS. The new `.tkcard-part` (the
card's per-part row) would have inherited only the base `.lav` background
(a faint `rgba(20,22,26,.06)`, not literally invisible but visually
inconsistent with the detail page's intended muted treatment). Found by
reading the CSS the new markup depends on rather than assuming a class
name implies its styling travels with it. Fixed: extended the selector to
`.tkpart .lav.q, .tkcard-part .lav.q`.

[WARNING] (checked, not a bug) **`#tk-note`'s own status sentence is a
third, independent construction** of the same underlying fact (only
handles `claimed === true`, hardcodes its own lowercase "says it is on
this."). Confirmed it does not reference the `say` variable this change
renamed to `sayHtml` in `paintTaskPage` -- `#tk-note`'s construction is
untouched, no `is not defined` risk, and left as its own thing rather
than folded into `taskClaimHtml`, since unifying a third call site that
already has its own well-tested behavior (`web.task-page.test.js`'s
"the close-note says what closing does NOT do" and "the unknown claim
gets its reason on the page" tests, both still green) was out of this
card's scope.

[STRENGTH] **The pack's exact vocabulary ("Not started" / "Waiting on
you") was deliberately NOT reproduced.** No engine field computes that
axis -- `t.claim` (commitments.js, self-report reachability) and
`t.progress` (progressOf, parts done/closed) are both real but neither is
it. Inventing a client-side mapping would be fabricating business logic
that belongs in engine/tasks.js. Recorded in the plan file as a named gap
for Angel/Josh, not silently shipped as though it were the real thing.

[STRENGTH] **The third claim state (`claimed: null`) was not collapsed
into "not started".** Splinter's 02:55 heads-up caught this before it was
built: Josh's complaint was about the WORDS ("we could not check" is
unusable), not the STATE. The fix shown here uses the engine's real
`because` text instead of a canned non-answer, CSS-clamped to one line
(`.tkcard-who-b .tkunk { text-overflow: ellipsis; ... }`) rather than
string-truncated, so a screen reader and a hover still get the full
sentence -- never an invented paraphrase standing in for it.

[STRENGTH] **The multi-part branch shows every part, not just assigned
ones**, including the pack's own "+ Nobody yet" unassigned row -- an
earlier draft only iterated `assigned` parts and would have silently
hidden an unpicked-up part on a multi-person task, which is exactly the
kind of state-that-renders-as-nothing this whole item exists to fix.
Caught while writing the test for it (the pack's own multi-assignee
example shows three rows, including one unassigned), not by inspection
alone.

## Verification run (on the rebased tree)

- `node --test web.task-card-761.test.js web.task-page.test.js`: 17/17
  pass.
- `npm test` (full suite): 0 failures, exit 0.
- `bash tools/browser-checks.sh` (full suite, unfiltered):
  `PASS render-tasks`, and `all page checks passed` for the full run --
  the exact check that would have caught the capitalization regression
  ran clean after the fix.

### Final Ledger

2 BLOCKERs found by self-review and fixed before this proof (capitalization
vs. an existing regex-matching check; the column filter's legacy-field
bug). 2 WARNINGs investigated and resolved (a missing CSS scope, extended;
a third independent call site, confirmed unaffected and left alone). 2
STRENGTHs recorded as deliberate scope decisions, not omissions. 0
findings remain open.

---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: project-page-761
diff_hash: c85cdfb7947dba0a975dd4b73084595c95252c5754a9b4772ec9bc42bcc2b511
timestamp: 2026-08-25T07:50:00Z
iterations: 1
converged: true
---

# Pre-Challenge Proof: project-page-761

**Single pass, explicit override, labelled honestly.** /code-review was
launched twice via the Skill tool as a background fork and stalled both
times: it spawned its 8 finder sub-agents over the async mailbox, then
gave up waiting on them (once after a blocked `sleep 30`) without
collecting their results. Rather than a third attempt against
infrastructure that was demonstrably not completing in this forked
context, I read the full diff myself, line by line, against the enclosing
functions. Per Josh's 2026-08-19 21:25 ruling (beta app, no users, ship
finished work), a labelled single self-pass beats blocking the queue on a
tool that is not returning.

## Iteration 1 (single pass, self)

[STRENGTH] **The new `tick()` call is correctly gated.** `if (PJ_CURRENT
&& !document.getElementById('pj-one-view').hidden) pjLoadDocs(PJ_CURRENT);`
-- a hidden project view costs nobody a fetch, same reasoning #743 already
established for the Plus tab's repaint.

[BLOCKER] (found and fixed before this proof) **`pjLoadDocs` had no epoch
guard against two overlapping calls for the same project.** It now has
two callers -- `openProject`'s immediate call on switch, and the next
`tick()` poll 5s later. A slow fetch from the first can resolve after a
faster one from the second, and the existing `PJ_CURRENT !== id` check
only catches a response arriving after a project SWITCH, not two in-flight
reads of the SAME project settling out of order. The older, later-resolving
response would overwrite `PJ_DOCS_STAMP` and repaint with stale data,
undoing a correct paint the person already saw. This is the same class of
bug `PLUS_EPOCH` (#743) exists to prevent in `paintPlus()`. Fixed by adding
`PJ_DOCS_EPOCH`, a per-call token checked immediately after each await,
discarding any response whose epoch no longer matches the counter. Covered
by a new test (`pjLoadDocs epoch guard: an older in-flight read cannot
overwrite a newer one that already landed`) that dispatches two calls
before awaiting either, resolves the second (newer) one first, then the
first (older) one, and asserts the older response's data never reaches
the screen.

[WARNING] (checked, not a bug) **`tkPartPost` captures `msg =
document.getElementById('tk-msg')` before `await pjReload()`, then writes
to it after.** This is exactly the stale-DOM-reference shape that
`dropMemberTarget()` was built to fix earlier this session (#762), so it
needed checking rather than assuming. Traced `pjReload()` -> `loadProjects()`
-> `paintTaskPage()`: `paintTaskPage()` only rewrites `#tk-who`'s innerHTML
and sets `.textContent` on specific elements by id; it never touches
`#tk-msg` or replaces any container `#tk-msg` lives inside. The captured
reference stays attached to the live DOM across the reload. Not a bug --
the comment left in the diff at that line records this reasoning so the
next person does not have to re-derive it.

[STRENGTH] **The `nt-go` (New Task) call site does the safer thing**
instead of capturing early: `document.getElementById('pj-one-msg')` is
looked up fresh, after `pjReload()` and `leaveNewTask()` both complete,
so even if some future repaint DID replace that element the write would
still land on the live one.

[WARNING] (checked, not a bug) **`heardSentence`/`spokenHeard` correctly
translate the wire's raw `sessionName` to a display name before the
sentence is built** (`spokenHeard(p, heard)` calls `pjNameOf(p, heard.who)`
before `heardSentence` ever sees the object) -- this was a real bug an
earlier review pass in this session caught and fixed (raw session names
leaking to the screen); confirmed here that both call sites (`nt-go`,
`tkPartPost`) go through `spokenHeard` before `heardSentence`, not just
one of them.

[STRENGTH] **`pjLoadDocs`'s `PJ_DOCS_OK` handles the recovery-from-error
case**, not just the identical-success case: a transient failure between
two identical successful reads (same stamp) sets `PJ_DOCS_OK = false`
without moving the stamp, so the next success -- even though its stamp
matches the one from BEFORE the failure -- still repaints, because the
skip condition requires both the stamp match AND `PJ_DOCS_OK` already
being true. Verified by a test that forces exactly that sequence
(success, failure, success-with-old-stamp) and asserts the stale error
message is cleared and the file list is repainted.

[CONVENTION] No em dashes in any user-facing string added
(`heardSentence`'s four returned sentences, both call-site comments) --
checked against `~/work/workers/monalisa/CLAUDE.md`'s "No em dashes,
anywhere, in any output" rule. None present.

## Verification run (after the fix above, on the rebased tree)

- `node --test web.project-page.test.js`: 9/9 pass.
- `npm test` (full suite): 0 failures, exit 0. One `site-deploy-export`
  failure appeared on an earlier combined run under concurrent machine
  load (a live board process and a browser-check sandbox both active);
  reran `bash tools/test-site-deploy-export.sh` alone immediately after
  and got 0 failures -- contention, not this change, and that suite does
  not touch any file this branch changes.
- `bash tools/browser-checks.sh`: all page checks passed, run twice (once
  before the epoch-guard fix to confirm the base feature works, once
  after to confirm the fix did not regress anything the suite covers).

### Final Ledger

1 BLOCKER found by self-review and fixed before this proof was written
(the `pjLoadDocs` epoch race). 2 WARNINGs investigated and refuted with a
traced call path, not assumed safe. 0 findings remain open.

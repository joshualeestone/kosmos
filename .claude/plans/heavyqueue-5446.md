# #5446: heavy-gate's BUSY names the queue; the queue works on a machine without the default lib folder

## Finished looks like
- `tools/heavy-gate.sh` answering BUSY also says, on stderr (not with --quiet), that polling holds no place in line,
  and names the queue command with its absolute path: `bash <repo>/tools/queued-heavy.sh "<what>" <command>`, and
  `--light` for one browser check or one test file. The stdout verdict stays one line.
- `tools/queued-heavy.sh` run with QUEUED_HEAVY_LIB unset on a machine without `~/work/kosmos-bc-main-4610` uses
  the MAIN checkout of the repo it lives in (git common dir's parent; GIT_DIR, GIT_WORK_TREE and GIT_COMMON_DIR ignored), says so on stderr
  with that checkout's commit and branch (it is not guaranteed to be on main), and joins the queue. Every worktree of one clone resolves the same folder; a second clone
  or a set QUEUED_HEAVY_LIB can still bring another lib generation, which the stderr line makes visible. If that main
  checkout's lib is too old (a needed function missing), it exits 3 and names `git -C <it> pull --ff-only`. A
  QUEUED_HEAVY_LIB that is set and wrong still exits 3 (unchanged).
- The BUSY hint names the INSTALLED copy (~/.cache/claude-handoffs/queued-heavy.sh) whenever it exists, so a Mac
  where the documented route already works keeps one wrapper generation (review 7). Otherwise it names the MAIN
  checkout's queued-heavy.sh when that copy already has this fallback (one wrapper
  generation per clone, review 1; an older copy would fail where the default lib is missing, review 2), else the one
  beside heavy-gate.sh (measured here: the main checkout was at 10-01, before the script existed).
- Scope: the fallback reaches REPO copies only. The installed copy under ~/.cache sits outside any repo and still exits
  3 without QUEUED_HEAVY_LIB (pinned by a test); the BUSY hint names a repo copy, which reaches a working queue when
  that repo's main checkout carries a current lib. When it does not (this Mac's is at 10-01, with no lib), the stop
  message now names that checkout and the pull that fixes it, instead of only the default folder.

## Rejected
- Falling back to the worktree the script runs from: several branches' libs would share one queue (#4977 item 1).
- Changing the installed copy under ~/.cache: not reviewable here and not on every machine; the BUSY hint names the
  repo copy, which now works everywhere.

## Weakest premise
That a repo's main checkout is close enough to origin/main. Nothing updates it (this Mac's is at 10-01); the same is
true of the default folder today. The stderr line names the folder and commit used, and a too-old lib now says the
one command that fixes it, so a stale checkout is loud rather than a silent split. Not caught: a branch's queue
script running against a main-checkout lib that has the same function names but different behaviour (the same risk
the default folder carries today); the stderr line naming the folder and commit is what makes that visible.
- The hint names the main checkout's copy only when that copy has the marker AND that checkout has cut-guard.sh; it
  relies on the two files coming from one commit there.

## Tests
- tools.heavy-gate-3805.test.js: BUSY names the queue on stderr with an existing path; CLEAR and --quiet do not.
- tools/test-queued-heavy-4977.sh, six arms in all: in a throwaway git repo, the fallback joins and runs and names the
  folder and commit; without cut-guard.sh it still exits 3 and runs nothing; with an old lib it exits 3 and names the
  pull; a copy outside any repo (the installed one) still exits 3.
- tools.heavy-gate-3805.test.js: in a throwaway repo plus a worktree of it, the hint names the main checkout's queue only when
  that copy carries the #5446-lib-fallback marker AND that checkout has cut-guard.sh, else the worktree's own.
- and: a worktree's copy falls back to its MAIN checkout (not its own tree); a main
  checkout with no lib at all gets the pull line.

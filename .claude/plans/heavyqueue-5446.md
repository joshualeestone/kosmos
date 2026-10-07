# #5446: heavy-gate's BUSY names the queue; the queue works on a machine without the default lib folder

## Finished looks like
- `tools/heavy-gate.sh` answering BUSY also says, on stderr (not with --quiet), that polling holds no place in line,
  and names the queue command with its absolute path: `bash <repo>/tools/queued-heavy.sh "<what>" <command>`, and
  `--light` for one browser check or one test file. The stdout verdict stays one line.
- `tools/queued-heavy.sh` run with QUEUED_HEAVY_LIB unset on a machine without `~/work/kosmos-bc-main-4610` uses
  the MAIN checkout of the repo it lives in (git common dir's parent), says so on stderr, and joins the queue. Every
  agent on a Mac resolves the same folder, so the queue keeps one lib generation (#4977's reason for a shared lib). A
  QUEUED_HEAVY_LIB that is set and wrong still exits 3 (unchanged).

## Rejected
- Falling back to the worktree the script runs from: several branches' libs would share one queue (#4977 item 1).
- Changing the installed copy under ~/.cache: not reviewable here and not on every machine; the BUSY hint names the
  repo copy, which now works everywhere.

## Weakest premise
That a repo's main checkout is close enough to origin/main. Nothing updates it; the same is true of the default
folder today. The stderr line names the folder used, so a stale one is visible.

## Tests
- tools.heavy-gate-3805.test.js: BUSY names the queue on stderr with an existing path; CLEAR and --quiet do not.
- tools/test-queued-heavy-4977.sh: two arms in a throwaway git repo: fallback joins and runs (and says so); without
  cut-guard.sh it still exits 3 and runs nothing.

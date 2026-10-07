# #5446: heavy-gate's BUSY names the queue; the queue works on a machine without the default lib folder

## Finished looks like
- `tools/heavy-gate.sh` answering BUSY also says, on stderr (not with --quiet), that polling holds no place in line,
  and names the queue command with its absolute path: `bash <repo>/tools/queued-heavy.sh "<what>" <command>`, and
  `--light` for one browser check or one test file. The stdout verdict stays one line.
- `tools/queued-heavy.sh` run with QUEUED_HEAVY_LIB unset on a machine without `~/work/kosmos-bc-main-4610` uses
  the MAIN checkout of the repo it lives in (git common dir's parent; GIT_DIR and friends ignored), says so on stderr
  with that checkout's commit, and joins the queue. Every worktree of one clone resolves the same folder; a second clone
  or a set QUEUED_HEAVY_LIB can still bring another lib generation, which the stderr line makes visible. If that main
  checkout's lib is too old (a needed function missing), it exits 3 and names `git -C <it> pull --ff-only`. A
  QUEUED_HEAVY_LIB that is set and wrong still exits 3 (unchanged).
- The BUSY hint names the MAIN checkout's queued-heavy.sh when that copy already has this fallback (one wrapper
  generation per clone, review 1; an older copy would fail where the default lib is missing, review 2), else the one
  beside heavy-gate.sh (measured here: the main checkout was at 10-01, before the script existed).
- Scope: the fallback reaches REPO copies only. The installed copy under ~/.cache sits outside any repo and still exits
  3 without QUEUED_HEAVY_LIB (pinned by a test); the BUSY hint names a repo copy, which is how an agent on any machine
  now reaches a working queue.

## Rejected
- Falling back to the worktree the script runs from: several branches' libs would share one queue (#4977 item 1).
- Changing the installed copy under ~/.cache: not reviewable here and not on every machine; the BUSY hint names the
  repo copy, which now works everywhere.

## Weakest premise
That a repo's main checkout is close enough to origin/main. Nothing updates it (this Mac's is at 10-01); the same is
true of the default folder today. The stderr line names the folder and commit used, and a too-old lib now says the
one command that fixes it, so a stale checkout is loud rather than a silent split.

## Tests
- tools.heavy-gate-3805.test.js: BUSY names the queue on stderr with an existing path; CLEAR and --quiet do not.
- tools/test-queued-heavy-4977.sh: two arms in a throwaway git repo: fallback joins and runs (and says so); without
  cut-guard.sh it still exits 3 and runs nothing; with an old lib it exits 3 and names the pull.

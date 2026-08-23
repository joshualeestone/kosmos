# release-restart: the release restarts the board on this Mac (#360)

Three stale-board incidents and four hand restarts on 2026-08-23: every
merge touching engine/ or server.js left the developer board (the repo under
a hand-written launchd job, what Josh reviews in) serving the previous code.
`tools/release.sh` publishes to installs, which update themselves, and never
touched this board.

## What finished looks like

- `tools/restart-local-board.sh`: restarts `com.kosmos.board` only when the
  job exists AND its working directory is this repo; says which case it found
  (no launchctl, no job, runs from elsewhere, runs from here); `--check`
  reports without restarting; waits up to ten seconds for the board to answer
  with the version on disk and fails loudly if it does not.
- Step 10 of the release runs it after the served check passes; the served
  check no longer exits the script early.
- Between releases, the same script from the main checkout is the one
  command, and from a worktree it declines (the job runs main's code).
- Documented in docs/releasing.md; `yarn test:shell` syntax-checks it; a test
  pins the order and the `--check` cases.

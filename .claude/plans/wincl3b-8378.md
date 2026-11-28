# kosmos#8378 cluster 3, slice 2 (branch wincl3b-8378)

Slice 1 (branch wincl3-8378) took the cluster-3 files whose failing arms test something Windows lacks. This slice
takes the rest of the 62, one file at a time, from the per-test detail of run 46116329603 on the never-merged branch
`wincl3-8378-never-merge` (GitHub's windows-latest).

## Real Windows bugs, each with its own card

- **#9263, fixed here.** engine/receipt.js read a Codex `apply_patch` path only up to its first backslash, so an
  absolute Windows path was cut to `C:` and the receipt listed the agent's folder. An escaped backslash (`\\`, as a
  JavaScript string carries one) is now part of the path; any other escape still ends it. A new arm, a patched name
  `a\b.md`, fails on the old reader (it read `a`) and passes now, on the Mac.
- **#9267, fixed here.** engine/projects.js `isUnderTmpDir` joined the boundary with `/`, so on Windows no folder in
  `%TEMP%` read as temp and the #525 temp-folder refusal never fired. It joins with `path.sep` now.
- **#9268, carded, not fixed, and its arm left red.** securewrite's create-exclusive (`'wx'`) temp file follows a
  planted dangling symbolic link on Windows (engine/trust.test.js "a file planted at the temp path"). A skip would
  hide a guarantee that does not hold, so the test stays red until #9268 is fixed.

## Test fixes (the test assumed a POSIX host)

- receipt-5153: `src/a.js` expected as `path.join('src', 'a.js')`; the linked-folder arm records the long-name
  spelling (`fs.realpathSync.native`), as a session does; the Codex fixture writes its path escaped.
- projects.test: the taught command for a path with a backslash is the bare word, by clipath's own rule (#570).
- reporthook.test: the shell-form arms ask for that form on every host through the platform seam.
- trust.canonical-spelling-2129c: the Claude key is written with `/`, so the marker check reads it with path.sep.
- usageagy-5158: the folder key is the host's resolve of `/w/agyagent` (a file URL reads back with a drive letter).
- bridges.board-proof-1765: grok gets a host-absolute folder (it refuses a driveless rooted path on Windows by design).
- engine.live-execution-1598 and test-support.tool-guard-4326: node prints the word, not `/bin/echo`.
- engine.runnable-not-directory: the executable stand-in is an `.exe` on Windows (it runs by extension, PATHEXT).
- engine/startimports-5774: ported the way its token-only-guard siblings were in #8452 (sandbox outside the home,
  the same reason for the macOS-guard arms, and a place in the Windows job's ALSO list).

## Skips, each naming its mechanism

update.marker (the run-setup shell line through /bin/sh), remove.redisable (launchd's own disable record),
pdfpreview (Linux stand-ins found by the POSIX execute bit; a `"` in a file name), the release and fleet tools
(build-kosmos-linux.sh, release.sh, heavy-gate.sh, build-kosmos-bundle.sh, plus-signin-auto.sh), the shell report hook
(install/kosmos-report-hook.sh), the macOS cwd-case arm of trust.canonical-spelling, tool-guard's two POSIX controls,
and runnable-not-directory's tmux-key arm (machine.js does not probe tmux on Windows).
**Owed, not lacking:** orgchartfile (4 arms) and teamcreate-structure-4557 (6 arms) check things that exist on
Windows but set up with a `#!/bin/sh` fake claude, fake-tmux.sh and `/bin/echo`; their reason names #9272, which
owes the Windows arms.

## Decided, and what I rejected

- Rejected: skipping #9268's arm. It is the one place the runner showed a guarantee failing, not a setup gap.
- Rejected: writing the orgchartfile and teamcreate Windows arms here. Each needs a Windows stand-in (a `.cmd` claude,
  a roster served as Windows reads it) that I cannot check off the runner in one pass; #9272 owns them.

## Weakest premise

That the reporthook shell-form arms, asked for `darwin`, accept a Windows sandbox path (backslashes, `~` in an 8.3
name) as a script path; ensureWired refuses shell-special characters. The Windows run after this slice decides it.

## Checked

- Every edited file passes on the Mac, with engine/windows-tests-1777.test.js green.
- The Windows run after this slice is the control that the fixed arms pass there and the skipped ones skip.

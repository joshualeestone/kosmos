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
  `%TEMP%` read as temp and the #525 temp-folder refusal never fired. It joins with `path.sep` now, compares each temp
  root both as given and resolved (an 8.3 name), and on Windows compares case-blind. engine/projects.test.js moves from
  HOST_BRANCH_EXCLUDED into the Windows job's ALSO list (it passed there in full: run 46118283614, 162 pass, 0 fail),
  so the fix is guarded where it matters; on the Mac `path.sep` is `/` and no arm could see it. Note for Windows: a
  folder under `C:\tmp` now reads as temp too (`/tmp` resolves there), as `/tmp/anything` already did on the Mac.
- **#9268, carded, not fixed, and its arm left red.** securewrite's create-exclusive (`'wx'`) temp file follows a
  planted dangling symbolic link on Windows (engine/trust.test.js "a file planted at the temp path"). A skip would
  hide a guarantee that does not hold, so the test is not skipped. It is red only where somebody runs trust.test.js
  on Windows (the never-merged measurement branch here): the file is in HOST_BRANCH_EXCLUDED, so the Windows CI job
  does not run it, and card #9268 (PR #9289, which fixes it) is what tracks it.

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
pdfpreview's two Linux renderer arms (stand-ins found by the POSIX execute bit; a `"` in a file name; its refusal and
--out arms run for the Windows renderer on every host and for Linux off Windows), the release and fleet tools
(build-kosmos-linux.sh, release.sh, heavy-gate.sh, build-kosmos-bundle.sh, plus-signin-auto.sh), plus-signin-2036's one
arm that checks the seed secret's 0600 mode (the seed, plus-signin-fresh.js, runs on Windows in its other arms), the shell report hook
(install/kosmos-report-hook.sh), the macOS cwd-case arm of trust.canonical-spelling, tool-guard's two POSIX controls,
and the 7 startimports arms that run the macOS guard (its parser arm runs everywhere, with host-resolved paths).
runnable-not-directory skips nothing: its installedCheck arm checks claude and codex on Windows, where machine.js does
not probe tmux, and the file joins the Windows job (ALSO_ROOT) after passing 22 of 22 there.
**Not in this slice:** engine/orgchartfile.test.js and teamcreate-structure-4557.test.js. Mona Lisa owns both on
#9272 (branch wincl-9272): she measured that #4660 and the teamcreate arms fail on Windows for path spelling and a
roster seam, not a shell script, fixes those, and puts the sh-script orgchart arms beside node stand-ins. An earlier
version of this slice skipped them naming #9272; that was dropped so two branches do not edit the same lines.

## Decided, and what I rejected

- Rejected: skipping #9268's arm. It is the one place the runner showed a guarantee failing, not a setup gap.
- Rejected: touching orgchartfile and teamcreate here at all, once #9272 had an owner working both files.

## Weakest premise

That a skip which names a Mac or Linux script hides nothing Windows ships. Each was checked from the script and its
callers (setup.sh refuses other systems; the release tools run on the release Mac), not from a Windows install.

## Checked

- Every edited file passes on the Mac, with engine/windows-tests-1777.test.js green.
- Windows, all 62 files, run 46118072144: 4 failing tests (99 before this slice), 59 of 62 files green. Two were
  reporthook's shell-form arms (the shell form rightly refuses a backslash, so they now use POSIX literals) and one
  was isUnderTmpDir comparing a not-yet-made folder in the temp folder's 8.3 spelling (each root is now compared both
  as given and resolved; added to #9267). Run 46118283614 on those three files: projects and reporthook green; the
  one red left in the cluster is #9268's arm, on purpose.
- After review 1, on the Windows runner: runnable-not-directory 22 of 22 (10 failed before), projects 162 pass and
  pdfpreview 11 pass (run 46135356176); startimports 8 pass, its 7 macOS-guard arms skipped (run 46135446761, after
  its parser arm was corrected to resolve a rooted path on the file's own drive).
- Review 3: what was fixed to hold on Windows is now run there by the Windows job: reporthook, trust.canonical-spelling,
  pdfpreview, receipt-5153 and usageagy join ALSO, and engine.live-execution-1598 and bridges.board-proof-1765 join
  ALSO_ROOT (each measured green on the runner above). A new Windows-only arm in projects.test.js pins the case fold
  (a temp folder typed in another letter case, not yet made). Reasons that read as coverage claims now say "needs no
  skip on Windows"; redisable's says off macOS it schedules and logs nothing. Deferred: startimports' review-4 arm
  checks TEXT_EXTS.size beside its macOS-guard checks and skips as a whole; that count still runs on the Mac.
- After review 3, on the Windows runner (run 46136406318): every file now in the Windows job passes there (reporthook
  29, receipt 32, usageagy 14, pdfpreview 11, projects 163 with the case arm, runnable 22, board-proof 18,
  trust.canonical-spelling 5, live-execution 3; 0 fail). The case arm can fail: with the fold removed (a never-merged
  mutant build, run 46136503594) it, and only it, fails.

# win-skip-rm7405-8378: the remove-member CLI tests on Windows (kosmos#8378)

**Posture:** production

## Problem
cli.project-remove-member-7405.test.js fails 20 tests on Windows. Its "Mac:" tests run install/kosmos, the Mac and
Linux CLI (a bash script), directly by its shebang line, which Windows cannot do (spawn ENOENT). Its "on both" tests run
one case through the Mac CLI and the Windows CLI, so their Mac step fails the Windows half with it. This is the same
pattern #8446 fixed for other CLI files.

## Change (test-only; no production code)
- The nine "Mac:" tests skip on Windows with skipOnWin32 and a reason naming the mechanism (the #8446 wording).
- The eleven mixed tests keep every Windows assertion. Their Mac step is guarded with `if (!SKIP_POSIX_SHELL)`. Where a
  test counts DELETE requests, Windows expects one (only the Windows command ran), and macOS and Linux still expect two.
- Two controls ("a real member is sent", in review 3 and review 4) ran through the Mac CLI. On Windows they run through
  the Windows CLI, so the "nothing sent" check there still has a working control.
- tools/windows-tests.js: the file joins ALSO_ROOT, so the Windows CI job runs its Windows arms.

## Decided, not missed
- ALSO_ROOT rather than HOST_BRANCH_EXCLUDED (where #8446 put its mixed file): this file's Windows arms are real
  Windows coverage of the Windows CLI. The weakest part: the file makes two symlinks when it loads (node and the engine
  folder). They work on this box, and the GitHub runner runs as an administrator, which may make links, but no file in
  the Windows CI selection does this yet. If the first CI run refuses the links, the file moves to HOST_BRANCH_EXCLUDED.

## Measured on the Windows box
Before 7 pass / 20 fail / 1 skip; after 18 / 0 / 10. On macOS and Linux every guard is false, so nothing changes there.
Policy tests (fixture-discipline, no-name-refs-3071, engine.reachable, windows-tests-1777, win32-separator-guard,
windows-coupling-audit-1732) pass.

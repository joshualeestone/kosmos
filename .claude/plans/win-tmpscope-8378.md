# win-tmpscope-8378: the test temp scope works on Windows (kosmos#8378, found in its triage)

**Posture:** production

## Problem
test-support/tmpscope.js (#4273) gives each test process its own temp folder by pointing TMPDIR at it, so every later
mkdtemp under os.tmpdir() lands inside and is removed at exit. On Windows os.tmpdir() reads TEMP, then TMP, and ignores
TMPDIR (measured on the box: TMPDIR alone left os.tmpdir() on the real temp folder; TEMP moved it). So on Windows the
scope did nothing: test fixtures piled up in the real %TEMP% (23,333 aw-/fixture-/kts-/tsc- entries on the Windows box),
and children spawned by tests also wrote there.

## Change (test-support only)
- tmpscope.js: on win32 also set TEMP and TMP to the scope folder (this process and every child it spawns inherit them).
  Mac and Linux unchanged.
- New test-support.tmpscope.win32-8378.test.js (selected for the Windows CI job by its name): in a child that requires
  tmpscope, os.tmpdir() is a kts- folder, a fixture made there lands inside it, TEMP and TMP point at it, and it is gone
  after the child exits; CONTROL: on Windows TMPDIR alone does not move os.tmpdir(). The first test fails against the
  previous tmpscope.

## Risk checked
Every test file that requires tmpscope now runs on Windows with TEMP/TMP pointed at a per-process folder (children such
as PowerShell or schtasks inherit it). The whole Windows suite (node tools/windows-tests.js) on this branch on the box:
245 passed, 0 failed, 0 new red, 0 stale.

## Review round 1
- On Windows the scope now holds every fixture, and Windows will not remove a folder a process still holds (a working
  folder, an open file) for a moment after a child exits; the single rmSync sweep then left the whole folder. The sweep
  retries briefly on win32 through test-support/remove-tree.js (4 tries, about 1.5 s at most). Test: a detached child
  holding a fixture as its working folder for 400 ms past exit; it fails against the previous sweep. The not-covered list
  names a hold longer than the retry.
- Follow-up, not this PR: tools/run-tests.sh sets only TMPDIR for its per-run temp root, so `npm test` on Windows does
  not put the kts- folders under that root and its leak guard cannot see them.

## Review round 2
- The held-folder test's grandchild lives 150 ms (was 400), so the test still fails against a single rmSync (3 of 3)
  but cannot outlast the retry budget under load. The test file requires tmpscope itself, so a failing run's kts- folder
  stays inside its own scope. remove-tree is required at module load, not at exit. Two stale comments fixed: the
  communitysend-5431 sandbox note, and the HOST_BRANCH_EXCLUDED reason for test-support.tmpscope.test.js (it now names
  the new Windows test as where the win32 branch is covered).

## Review round 3
- The held-folder test now proves its grandchild ran: it writes a started marker outside the child's scope, and the test
  asserts it, so a grandchild that never started cannot pass the test vacuously. Still fails against a single rmSync.
- Wording: the HOST_BRANCH_EXCLUDED reason names the win32-only branch of tmpscope.js (first draft used an apostrophe
  inside the single-quoted string and broke tools/windows-tests.js; the #1777 audit caught it before commit).
- Follow-up, not this PR: test-support.tmpscope.test.js fails 17 of 23 on Windows (most arms are POSIX/TMPDIR-shaped),
  more than its exclusion reason says.

## Done when
- The new test passes on the Windows box and fails against the previous tmpscope.
- windows-tests.js green on the box; policy tests green; Mac/Linux CI green.

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

## Done when
- The new test passes on the Windows box and fails against the previous tmpscope.
- windows-tests.js green on the box; policy tests green; Mac/Linux CI green.

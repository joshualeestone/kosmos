# win-skip-reasons-8368: the Windows suite green on a real Windows box (kosmos#8368, phase 1)

**Posture:** production

Splinter's call (11-11): #8368 closes on phase 1 — `node tools/windows-tests.js` green on a real Windows box, plus a
mutation check. Phase 2 (the full `npm test` on Windows, 508 failing files by cause) is #8378.

## Measured on the Windows box (origin/main 53a164708d)
`node tools/windows-tests.js`: 226 passed, 2 new red, 4 stale:
- engine/setupsettings.fsync-5434: 4 token-only tests fail "the save did not happen". The guard read the HOST: its
  import part read this computer's own ~/.claude/CLAUDE.md, an ANCESTOR of every temp folder on Windows (TEMP sits
  inside the home), whose imports the permission rules cannot carry. A clean CI runner's home has no such file.
- engine/bigint-ino.win32-7229: "no colliding pair could be made on this disk" after 2.8 s, i.e. all 128 rounds ran
  out long before the 60 s bound (the file took 5 s in all), during a run with heavy parallel file churn. Alone: 6 of 6 passed, 4 at once passed.
- 4 STALE (ALL_SKIP_OK, "its tests run now"): the win32 agy/codex e2e files skip on the runner (no runners there) and
  RUN on a box that has them, so every real Windows box with the runners fails the suite.

## Change
- engine/setupsettings.fsync-5434.test.js: DEPS also pins `env` (the shell-start and plugin scans; not the cause, one
  more host input out; review 1 corrected my first diagnosis, which blamed the PATH: that came from my own probe, which
  lacked the launch-PATH pins the test already had). HOST_NOT_CLEAN asks the guard itself, once, on a throwaway
  folder: only when EVERY complaint is the import note (and never on CI) do the four arms whose answer the host decides
  skip, in the guard's own words: the two needing ok, and the two expecting a refusal, which an unclean host gives anyway. A clean host runs them all. The guard is right; the host is not clean.
- engine/bigint-ino.win32-7229.test.js: rounds up to 4096; the 60 s bound decides. Cause inferred, not measured. The
  failure now says how many rounds ran, in how long, and which bound ended it, so the next one tells which.
- tools/windows-tests.js: `judge(..., { onCi })`. An ALL_SKIP_OK file that runs and passes is stale only on CI
  (onCi(process.env), the CI variable, the same rule as the scheduler guard), where it still catches an entry no longer needed; elsewhere it prints "ran here".
  Default onCi true, so every existing caller keeps the CI rule.
- engine/windows-tests-1777.test.js: the off-CI rule, the CI rule, the default, and a failure off CI still red.

## Verified
- Branch: `node tools/windows-tests.js` 229 passed, 0 failed, 0 new red, 0 stale, exit 0; the 4 e2e files "ran here".
- Mutation (uncommitted, reverted): childenv.winOpenerEnv returning the whole env -> NEW RED
  engine/childenv.win32-5895.test.js, 228 passed, 1 new red, exit 1.
- Controls for the setupsettings skip (at the final code): in this box's own TEMP 4 pass, 23 skipped, 0 fail; with
  TEMP outside the home (C:\kt8368tmp) the host is clean and the arms run: 12 pass, 0 fail; with CI=true (no skip
  allowed) on this host: 4 fail, as they must. The skip rule's own parser: test-support.hostimports-8368.test.js 4/4.
- The full-suite numbers above were taken before review; the final run on the reviewed code is in the proof.

## Decided
- The real cause (review 2 corrected review 1 and me): this test pins macOS rules (DEPS.platform 'darwin') and runs on
  every host; under macOS rules a Windows path is never carriable (its backslash is a rule-syntax character,
  setup-assistant.js IMPORT_RULE_SYNTAX), and on Windows the person's own ~/.claude/CLAUDE.md is an ancestor of every
  temp folder, so ANY import there makes the pinned guard answer ok:false. In production a Windows run returns
  "unsupported" before this code. A test artifact, said as one in the skip text, not blamed on the person's files.
- Skip, not a production seam for the ancestor walk: a seam only for tests would change production code for a test,
  and the skip is fenced (only on a Windows host, only when every complaint is the import note; never on CI, which still runs every arm).
  What would change my mind: a second test needing the same walk bounded, or a Windows rule set for this guard.
- Weakest part: bigint-ino's cause is inferred (other writers taking the freed records); not reproduced on demand.

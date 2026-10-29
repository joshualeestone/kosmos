# kosmos#7554: follow-ups to the data-root hardening (#1760, storemode-1760)

Built stacked on Ice Cream Kitty's `storemode-1760` (head 477b7c1d8a, not yet merged); rebased onto main once it is.

## 1. ensure() no longer resolves the data root on every write

`ensure()` runs on every store write and called `currentDataRoot()` each time, which in a test process includes a
real-path check (`isRealRootInTests`). The root depends only on a fixed set of inputs: `AGENT_WORKFORCE_DATA`,
`AGENT_WORKFORCE_HOME`, `APPDATA`, `HOME`/`USERPROFILE` (behind `os.homedir()`), the test-process markers
`NODE_TEST_CONTEXT`, `KOSMOS_TEST_RUN` and `KOSMOS_ALLOW_REAL_ROOT`, and `TMPDIR`/`TEMP`/`TMP` (behind `os.tmpdir()` in
`inThisTestRun`).
- `rootForEnsure()` caches the root per their values (`ROOT_ENV_INPUTS`), so a write is a Map lookup until one changes.
- The cache is bounded at 64 keys.

## 2. A transient chmod failure is retried

`secureRoot()` recorded every failure except ENOENT as tried for the life of the process.
- **EBUSY:** no longer recorded, because it is transient by nature, so the next write tries again.
- **EPERM and EACCES:** stay recorded. They are a root this user cannot change, usually for good, and retrying them
  would cost a failing chmod on every write. The board's start call (`secureRoot()` directly) always tries again.
- That remaining case is named in the code comment.

## 3. Auth-off boards (not code)

A check on a real cloud box running the FIRST release that contains storemode-1760 (not 0.7.74, which does not): the
data root reads 0700 and messages.jsonl 0600 after the board has started. Cloud boxes have no SSH, so finding a way
to read the modes is part of it. Recorded on the card; done when such a release serves.

## Tests (engine/store.ensure-cost-7554.test.js)

- **Audit:** every environment variable `dataRootFor`, `resolveDataRoot`, `currentDataRoot`, `isTestProcess`,
  `inThisTestRun` or `isRealRootInTests` reads, plus HOME/USERPROFILE for `os.homedir()` and TMPDIR/TEMP/TMP for
  `os.tmpdir()`, is in `ROOT_ENV_INPUTS`. CONTROL: the scan sees DATA, HOME and KOSMOS_TEST_RUN.
- **Cache follows a change:** a changed `AGENT_WORKFORCE_DATA` gets its own root tightened. CONTROL: a folder already
  tried is not chmodded again on every write.
- **EBUSY:** retried on the next write and tightened.
- **EPERM:** tried once by ensure() over three writes, and the board start call still tightens it.

Mutants:
- DATA left out of the key: 4 red.
- A constant key (a stale cache): 3 red.
- EBUSY recorded: 1 red.
- EPERM not recorded: 1 red.

All store tests: 111/111.

## Review 1 (no BLOCKER)

- [WARNING] nothing tested that the cache is USED (replacing `rootForEnsure()` with `currentDataRoot()` left every test
  green) -> FIXED: a test seam `_ensureRootCacheSizeForTest` and a test that the same environment adds no entries over
  five writes and a new data folder adds exactly one. The no-cache mutant is now red.
- [NIT] `env[n] || ''` keyed set-but-empty like unset (HOME='' and no HOME resolve differently) -> FIXED (`n in env`).
- [NIT] SystemRoot and windir (os.tmpdir()'s Windows fallback) were missing -> FIXED (added to the key).
- [NIT] the audit reads only the six functions, not the helpers they call -> KEPT: none of those helpers reads the
  environment today; this is the weakest premise below.
- Reviewer's checks: a stale entry can at worst skip a chmod in a TEST process, never leave the real root loose in
  production (the variables do not change in a running board, and the board start call always runs secureRoot).

## Review 2

- [BLOCKER] tools/check-frozen-roots.js (CI test:shell) read the ROOT_ENV_INPUTS declaration and matched `os.tmpdir()` in
  a comment inside it ("resolves a root at require time"): exit 1 on HEAD, 0 on the base -> FIXED: the note moved above
  the declaration; the guard exits 0.
- [NIT] the audit never checked SystemRoot/windir (an upper-case-only regex) -> FIXED (a mixed-case regex; the tmpdir
  branch requires both). Mutant: dropping them is red.
- [NIT] EACCES untested -> FIXED (the lasting-failure test runs for EPERM and EACCES). Mutant red.
- [NIT] set-but-empty vs unset untested -> FIXED (APPDATA '' gets its own entry). Mutant red.
- Checked, no defect: key completeness (every input traced), a stale entry can only skip a chmod and never chmod the
  wrong root, the test seam matches the repo's `_xForTest` convention.

Tests: 7/7; store suite 114/114; frozen-roots guard exit 0.

## Rejected

- Not recording EPERM/EACCES either: a failing chmod on every write for a root that will never change.
- Keying the cache on the resolved root alone: that is the resolution being saved.

## Weakest premise

That `ROOT_ENV_INPUTS` stays complete. The audit test reads the six functions that decide the root, but a new input
reached through another helper they call (not a direct `env.X` read) would not be seen by it.

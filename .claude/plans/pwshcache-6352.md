# pwshcache-6352: a shell test that starts pwsh gives it a cache folder of its own

Card: kosmos#6352. pwsh replays a per-user startup profile (`powershell/StartupProfileData-NonInteractive` under the
cache folder) and rewrites it on every run. One damaged write on the fleet Mac made every later pwsh start crash (rc
134), and `tools/test-publish-r2-3725.sh` failed 87 of 87 in every validation for about two hours, until the file was
moved aside (Renet Tilley's fix on the card).

## What changes
- `tools/test-publish-r2-3725.sh` exports `XDG_CACHE_HOME="$TMP/xdg-cache"` right after its temp folder exists and
  before it first starts pwsh. pwsh reads that variable on macOS and Linux, so a damaged shared profile cannot reach
  this test, and parallel validations cannot tear the shared one through it.
- `tools.pwsh-cache-6352.test.js`: every `tools/test-*.sh` that looks up the real pwsh (`command -v pwsh`) exports
  its own `XDG_CACHE_HOME` before its first pwsh start. A sweep, so a new script is covered too.

## Measured (both arms, the damaged profile from that night as the outer cache)
- `XDG_CACHE_HOME=<damaged> pwsh -NoProfile -Command 1`: rc 134, the same FileLoadException as on the card.
- `tools/test-publish-r2-3725.sh` with that outer cache, before the change: 87 failed. After: all passed, and the
  damaged file was byte-identical afterwards.
- A fresh `XDG_CACHE_HOME` gets its own profile file, and `~/.cache/powershell`'s was not written.

## Decided
- **Per test, not per suite.** Rejected: setting `XDG_CACHE_HOME` in `tools/run-tests.sh` for every test. It would
  also move the caches of the real Codex and grok CLIs that some tests run.
- **No committed damaged fixture.** The 121 KB binary would pin pwsh's own parser more than this change. The
  measurement above is recorded here and on the card instead.
- **Rejected: clearing a damaged profile before each run.** It would have to recognise damage, and it still shares one
  file between parallel runs.

## Not covered
- A node test that starts pwsh off Windows (none today; `tools.win-setup-ps1.test.js` runs pwsh only on Windows).
- pwsh started outside the tests (an agent's own use) still shares `~/.cache/powershell`; the weakest premise on the
  card is that the torn write came from parallel test runs, which is not proven.

## Tests
- `tools.pwsh-cache-6352.test.js`: 2/2. Mutants, each red: the export removed (the shared-cache message); the export
  moved below the first pwsh start (names line 66, the first start); the export indented, as inside an if (review 1).
  The start pattern takes "$PWSH", $PWSH and "${PWSH}" with a flag, and pwsh by name; `[ -z "$PWSH" ]` is not a start.
- Review 1 NIT, documented rather than built: a script that finds pwsh other than by `command -v pwsh` is not swept.

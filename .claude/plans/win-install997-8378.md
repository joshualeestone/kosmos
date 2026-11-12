# win-install997-8378: the Claude install contract tests on Windows (kosmos#8378)

**Posture:** production

## Problem
engine/connect.install-997.test.js fails 16 of 20 tests on Windows, the CONTROL installs included. Two test-only
assumptions about macOS and Linux:
- The local release server served only `/<version>/<plat>/claude`. On Windows the install asks for `claude.exe`
  (engine/connect.js, the download url), so every download 404'd (10 tests).
- The stub installer left an extensionless file. On Windows a file is runnable by its extension (runners.js,
  hasExecutableExt), so every success arm ended in "no runnable binary" (6 tests).
The production code is right on both points: it asks for the file the vendor publishes for Windows, and applies the
Windows rule for what runs.

## Change (test-only; no production code)
- The fixture serves `claude.exe` on Windows and `claude` elsewhere, the rule the download uses.
- The stub binary's path ends in `.exe` on Windows only. It is never run (the runner is injected); only its presence
  is asked.
- tools/windows-tests.js: the file joins ALSO, so the Windows CI job runs it.
On macOS and Linux the URL and the stub are exactly as before.

## Decided, not missed
- No skips: every test's subject exists on Windows, and all 20 now run there.
- The weakest part: nothing here has run on GitHub's Windows runner (node 26, 8.3 TEMP); the first CI run is the check.

## Measured on the Windows box
Before 4 pass / 16 fail; after 20 / 0. windows-tests-1777 24/24. Policy tests (fixture-discipline, no-name-refs-3071,
engine.reachable, win32-separator-guard, windows-coupling-audit-1732) pass.

## Review log
- Round 1 (no blocker, 1 warning). The stub path in AGENT_WORKFORCE_CLAUDE_BIN carried `.exe`, so the board's PATHEXT
  lookup (runners.pathextCandidates), the one production uses to find `claude.exe` behind the extensionless
  `~/.local/bin/claude`, never ran. Fixed: the override stays extensionless and the stub installer writes `.exe` beside
  it (installedAt), so the success arms pass only through that lookup. 20/0 on the box.

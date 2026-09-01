# macOS-only gate (Option A of the cross-platform analysis)

Routed by Splinter 2026-09-01 03:54: "Build the gate. Leave every user-facing string
alone. Say so plainly in the PR so he can add the copy change himself whenever he
rules on it." And: do NOT pair it with the cheap download/Linux-data-root fixes
(Option C) - an honest refusal is the opposite of a fix that implies Windows works.

## Why

Kosmos's agent substrate is macOS launchd end to end (45 launchctl call sites,
process.getuid, .plist jobs across create/remove/machine/register/delete-leftover),
plus darwin-hardcoded binary downloads and a /bin/sh curl|sh installer. None of it
works off macOS. Today a non-macOS board would attempt Mac-only operations and
half-succeed or fail obscurely. This gate makes it refuse honestly instead.

The full analysis and the three priced options are at
`~/work/Josh-Brain/Projects/kosmos-cross-platform-surface-analysis-2026-09-01.md`.
This branch builds Option A only.

## What (mechanism only)

1. **engine/platform.js** (new, pure) - the single source of truth for "does this
   OS run Kosmos": `SUPPORTED = ['darwin']` (frozen), `isSupported(platform =
   process.platform)`, `describe(platform = process.platform)` -> `{ platform,
   supported }`. Pure and parameterized like `store.dataRootFor` so the unsupported
   OSes are testable on this Mac. Fails closed (unknown/empty -> not supported).
2. **server.js** real-start block (`if (require.main === module)`) - arms
   `live-execution.allowLiveExecution()` ONLY when `platformGate.isSupported()`; on
   any other OS it leaves live execution UNARMED and writes an honest stderr
   diagnostic. The guarded ops (create/remove/delete-leftover/update) already fail
   closed when live execution is not armed, so they refuse honestly rather than
   running launchctl / curl|sh on the wrong OS. No new user-facing product copy.
3. **engine/firstrun.js** - `state()` reports `platform: platform.describe()` so a
   future gate screen can tell an unsupported-OS visitor the product runs on macOS.
   Machine facts only, no copy.
4. **engine/connect.js + engine/runners.js** (added at Splinter's ruling 2026-09-01,
   after a blind reviewer flagged the download as an uncovered Mac-only path) - the
   provider-binary DOWNLOADS refuse on a non-macOS platform before any bytes move.
   `connect.download()` throws; `runners.install()` returns its job-shaped refusal.
   Both binaries are darwin builds (the `darwin-${arch}` Claude fetch and the
   codex-darwin-arm64 tgz), so on any other OS a download would land a Mac binary
   that cannot run. This is the gate (REFUSE), NOT the Option C fix: it fetches no
   Windows build, so no part of Windows is made to look functional. Each takes the
   platform as a seam (default process.platform) so the refusal is testable on a Mac.

⇒ The gate now covers BOTH the launchd substrate (via live-execution) AND the
provider-binary downloads (connect + runners). That is the whole honest-refusal
boundary; a non-macOS board cannot start an agent and cannot download a runner.

## Deliberately NOT built (the operator's to decide)

- **The user-facing "runs on macOS" copy and the screen it shows on.** Splinter's
  instruction: leave every user-facing string alone; Josh adds the copy when he
  rules. `firstrun.state().platform` is the hook that copy/screen will read.
- **The download/data-root FIXES (Option C) - the REFUSAL is built, the FIX is not.**
  The gate now REFUSES the darwin downloads on a non-macOS OS (above). What stays out
  is making them SUCCEED off macOS: `platformKey()` still returns `darwin-${arch}`,
  runners.js still pins darwin-arm64, and the Linux data-root gap is untouched.
  Fixing those would fetch a Windows/Linux build and imply the OS works while the
  launchd substrate still cannot start an agent - the C trap. They stay out until
  Josh decides on a real port (Option B).

## Tests

- `engine/platform.test.js`: isSupported darwin/win32/linux/unknown/empty (fail
  closed), describe() shape (machine facts, no copy), SUPPORTED frozen + macOS only,
  and the arm decision the server uses.
- `engine/platform-gate-wiring.test.js`: firstrun.state() carries platform.describe()
  (behavioral); server.js arms live execution only under the isSupported guard and
  never in the else (source-asserted, because the real-start block is not run by
  tests by design - same reason update.test.js asserts the installer spawn from
  source); platformGate is required in server.js.
- `engine/platform-gate-download.test.js`: connect.download refuses on win32 AND
  linux (each naming itself, so the gate reads the param, and it throws before any
  fetch); runners.install refuses on win32 in its job shape; and a control pair
  proving the platform gate fires before other checks on win32 and does NOT fire on
  darwin (the unknown-provider refusal wins there instead), with no download in any arm.

## Verification

Full suite `bash tools/run-tests.sh` green. Challenge-loop to convergence.

## Reversibility

Add-only and reversible: no existing behavior changes on macOS (live execution arms
exactly as before), and no existing string is touched. On a non-macOS board the only
change is that the Mac-only substrate refuses instead of misfiring.

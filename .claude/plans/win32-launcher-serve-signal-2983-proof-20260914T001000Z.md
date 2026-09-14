---
pre_challenge: true
method: challenge-loop
branch: win32-launcher-serve-signal-2983
diff_hash: 29784987c581d1d8b17c9593c4f1e882c1461a46c3043ca94da2bee977378889
validation: passed
subdir_audit: passed
timestamp: 2026-09-14T00:10:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2. **Converged:** Yes. Round 2 raised no new findings and
independently blessed the three tradeoffs accepted in round 1.

**Fixed / addressed:** the #2983 defect (a false "running from here" box during a
slow-but-successful boot on a box where every `GetExtendedTcpTable` read fails),
plus the stale "34 s" derivation comments in both files and the launcher README.

**Accepted tradeoffs / known limits (both rounds agreed these are acceptable):**

1. **The no-box case now needs a DOUBLE fault.** The launcher shows its stop-box
   on positive proof only: the board LISTENING, or the serve-here signal file. A
   serving-here board therefore gets no box only if BOTH proofs are unavailable at
   once -- the TCP table is unreadable AND `%TEMP%` is unwritable, or a version
   skew (launcher and board disagree on the signal contract) coincides with an
   unreadable table. This is degraded, not broken: the board still serves and the
   browser still opens; only the stop-box convenience is missing, and Task Manager
   still stops the board. Honest caveat: on the *specific* unreadable-table +
   unwritable-`%TEMP%` box, NEW is strictly worse than main (main's timer would
   eventually box it, however falsely), while on the *common* locked-down box
   (unreadable table, writable temp) NEW is strictly better -- the signal boxes it
   fast and correctly, where main fired a false box mid-hand-off. Forward note: the
   Windows updater must swap `Kosmos.exe` and the engine ATOMICALLY, or the
   version-skew arm becomes reachable. The S4 updater already does; the v1 by-hand
   whole-folder zip swap does too (the whole folder is replaced at once).
2. **A sub-second decision-vs-bind flash.** The board writes the signal at the
   `serve:true` decision, microseconds before `server.listen()`. If `listen()` then
   fails (e.g. EADDRINUSE), the box can flash before the board exits non-zero and
   the "stopped unexpectedly" box follows. The window is sub-second and the paths
   that reach `serve:true` have already probed the port clear, so this is rare and
   self-correcting.
3. **Test-coverage shape.** The GUI box-appears-on-signal path is proven by an
   out-of-suite fake-board live check (below) rather than a committed GUI test,
   because a positive box assertion needs an interactive desktop (`UserInteractive`)
   and cannot run reliably in headless CI. The committed tests cover the board
   write, the launcher gate source-shape, the pinned env-var name, and the C#
   `ServeHereSignalPresent` via a compiled probe.

**Asked (awaiting user):** 0. **Open for Josh:** the updater-atomicity forward note
in observation 1 (already satisfied by S4 and by the v1 by-hand zip).

## Proof hash

`diff_hash` is the sha256 of the raw bytes of

```
git diff <merge-base>..HEAD -- . ':(exclude).claude/plans/win32-launcher-serve-signal-2983-proof-*.md' | sha256sum
```

- merge-base (= `origin/main`): `1bfd8ad265a51dc5de64102e7a037ec2b7d2b723`.
- Taken at HEAD `413fc67d` (before this proof commit), 2 commits ahead, 0 behind.
- The proof file is excluded from the hash so the diff is verifiable byte-for-byte
  after this file is committed (the pre-challenge-gate hook is not installed on this
  Windows box, so the recipe is written out here).

## Validation of record

Tests run on this box with the Kosmos runtime node v24.19 via PowerShell, under the
schtasks guard (`NODE_OPTIONS=--require=C:\Users\joshu\kosmos-scripts\no-schtasks-preload.cjs`),
scratch `APPDATA`/`LOCALAPPDATA`/`USERPROFILE`, and `KOSMOS_SCHTASKS_BLOCK_LOG` to a
scratch file.

**Test files and results:**
- Core relevant set (`engine/win32handoff.test.js`, `engine/win32board.test.js`,
  `engine/win32board.reanchor.test.js`, `engine/win32board.start-at-sign-in.test.js`,
  `engine/win32board.world-2628.test.js`, `tools.win-launcher-native.test.js`):
  **156 pass, 0 fail** on the branch.
- Consumers (`engine/win32relocate.test.js`, `engine/win32uninstall.test.js`,
  `engine/win32uninstall.realboard.test.js`, `server.board-identity-header-570.test.js`):
  79 pass, 0 fail.
- `engine/win32apply.test.js` alone: 101 pass, 0 fail.
- `engine.reachable.test.js`, `engine/windows-coupling-audit-1732.test.js`,
  `engine/win32update.test.js`, `engine/runningas.win32-570.test.js` (serial): 118
  pass, 1 environment skip, 0 fail.
- No schtasks block log was ever created (no test attempted a live schtasks call).
- `verify-launcher.ps1`: OK -- the committed 90,112-byte `Kosmos.exe` reproduces
  from the committed `KosmosLauncher.cs`, 24 build-metadata bytes masked.

**Suite comparison (names AND reasons):** the same core set on a `git archive` of
`origin/main` is **152 pass, 0 fail**; the branch is 156 pass. The difference is
exactly the 4 new tests. No new failing name and no new reason. One earlier
combined run showed `win32apply.test.js` "failed" at 192 s -- a concurrency timeout
from running several heavy files in parallel plus a mid-run process kill; in
isolation it is green, and this change does not touch `win32apply`'s dependency
(`probeBoard` is unchanged).

## Controls (all went red)

Run by swapping `origin/main`'s `KosmosLauncher.cs` and `win32handoff.js` into the
working tree (via `git show >`, not `git checkout`/`git restore`) and running the new
tests, then restoring my sources (verified byte-identical to backups) and rebuilding:

- `#2983 serve-here writes the launcher's signal` -> RED (ENOENT: the board never
  writes the signal on main).
- `#2983 signalServingHere reads the real process env by default` -> RED (the export
  does not exist on main).
- `rounds 1-2 BUG ... box gated on positive proof` source-shape -> RED (main still
  has the `unreadableLongPastAnyHandOff` time gate).
- `#2983: the serve-here signal check ... ServeHereSignalPresent` compiled probe ->
  RED (main's `KosmosLauncher.cs` lacks `ServeHereSignalPresent`, so the probe fails
  to compile).

## Live GUI checks (not committed tests)

Each used the committed rebuilt `Kosmos.exe` with a fake board staged in a scratch
dir (`<scratch>/Kosmos/{Kosmos.exe, runtime/node.exe, app/server.js}`), never port
16180 and never the real server. `UserInteractive` was True.

| Fake board | Result |
|---|---|
| Never listens on TCP, writes the serve-here signal | `#32770 "Kosmos"` box appeared purely on the signal; on a stop file the board exited and the launcher exited 0 (box auto-closed) |
| Never listens, never signals | 0 dialogs (no false box); launcher exited 0 |

## Round 1

Raised the three observations above (the double-fault no-box case, the sub-second
decision-vs-bind flash, the test-coverage shape) and confirmed the fix, the removed
time fallback on both sides, the pinned env-var name, the removed stale comments,
and the README update. All three observations accepted as documented tradeoffs; no
code change demanded beyond what shipped.

## Round 2

No new findings. Independently reviewed and blessed the three accepted tradeoffs,
confirmed the controls go red, the pinned constant holds (C# `ServeHereSignalEnvVar`
== node `SERVE_HERE_SIGNAL_ENV`; C# `CheckForServingAfterMs` ==
`HANDOFF_CHECK_FOR_SERVING_AFTER_MS`), and that `server.js` and the other owned-by-
other-builders files were not touched. Converged.

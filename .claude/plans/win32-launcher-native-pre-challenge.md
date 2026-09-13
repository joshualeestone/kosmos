---
pre_challenge: true
method: challenge-loop
branch: win32-launcher-native
diff_hash: fb6a775df186ef4bbecec873e2db7cf92bfeae7462525e9fb61b3ecbed06ec91
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T08:40:00Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4 (opus, opus, opus, sonnet).
**Converged:** Yes. Round 4 found NO NEW FINDINGS.
**Fixed:** every finding from rounds 1-3. That is 2 BUGs (an invisible board on a failed hand-off; a false box from an 18 s "worst case"), 3 CONVENTIONs, 2 TEST-GAPs and 6 NITs. Rounds 1-4 found no SAFETY issue.

**Asked (awaiting user):** 0. The coordinator made the design calls:
- The launcher stays the person's handle through a "Kosmos" box, shown only once the board provably serves in-process (its PID owns a LISTEN socket).
- There is a 45 s fallback for an unreadable TCP table.

**Open for Josh (recorded in the plan, not blocking):**
- the legal company name on the Azure signing certificate (AssemblyCompany is left out until then);
- a real measurement of double-clicking Kosmos.exe inside the zip;
- whether he prefers a full-bleed icon.

## Proof hash

`diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- . ':!.claude/plans/win32-launcher-native-pre-challenge.md'`, computed with node over git's own output.
- Taken at `c5b1bd2d` (151,159 bytes), on origin/main `04e23b70`, 8 commits ahead and 0 behind.
- The pre-challenge-gate hook is not installed on this Windows box, so the recipe is written out here.

## Validation of record

Round 4 ran the tests on this box with the Kosmos runtime node v24.19 via PowerShell, under the schtasks guard (`NODE_OPTIONS=--require=C:\Users\joshu\kosmos-scripts\no-schtasks-preload.cjs`).

**Test files:**
- `tools.win-launcher-native.test.js`
- `tools.build-windows-570.test.js`
- `tools.win-open-board-2007.test.js`
- `engine/win32handoff.test.js`
- `server.board-identity-header-570.test.js`
- `engine.reachable.test.js`
- `engine/win32board.test.js`

**Results:**
- **128 tests, 126 pass.** The 2 failures are the known `tools.win-open-board-2007` EFTYPE tests: they spawn a bash stub Windows can't run, and that file is unchanged from main.
- No schtasks block log was created.
- `tools.win-launcher-native.test.js` run on its own twice: 21/21 both times.
- `verify-launcher.ps1`: OK. The committed 68,096-byte `Kosmos.exe` reproduces from the committed `KosmosLauncher.cs`, with 24 build-metadata bytes masked.
- `make-kosmos-ico.ps1` gives byte-identical output across runs.

## Controls

Every control went red, run as hand edits or scratch builds and then undone.

**Round 1:**
- a console build;
- no icon;
- zip detection removed;
- TEMP matching removed;
- the old README wording.

**Round 1 fixes:**
- the box wait removed;
- AllocConsole restored;
- the sibling-prefix guard broken;
- the drive-root guard removed.

**Round 2:**
- the listener gate removed, plus the IPv4 PID offset broken;
- a box shown under `--console`.

**Round 3:**
- the unreadable-table fallback removed;
- the catch narrowed to `DivideByZeroException`.

## Live GUI checks

These were not committed tests. Each used the committed or a scratch exe with a fake board on a random loopback port, never port 16180 and never the real server:

| Fake board | Result |
|---|---|
| Listens, never exits | Box at ~19 s; OK stopped it |
| Never listens, exits 0 at 25 s | No box; exit 0 |
| Listens, then exits | The box closed itself |
| Listens with the TCP-table read forced to fail | Box at 46 s (the fallback) |
| Never listens, table read forced to fail, exits 0 at 40 s | No box; exit 0 |

## Iteration 1 (opus): 1 BUG, 2 CONVENTIONs, 3 NITs

- **[BUG]** A failed hand-off served on an invisible console, with no way to see or stop it. The next Kosmos.exe hit EADDRINUSE. Fixed: in GUI mode, a still-running child gets a "Kosmos" box, and OK stops the server tree.
- **[CONVENTION]** Stale "window" comments.
- **[CONVENTION]** An AllocConsole on redirected runs, since NUL wasn't counted.
- **[NIT]** Recovery text that doesn't work in Windows 11's Terminal.
- **[NIT]** The README path, which now goes through the Explorer address bar.
- **[NIT]** A missing TEMP sibling-prefix test.

## Iteration 2 (opus): 1 BUG, 1 TEST-GAP, 2 NITs

- **[BUG]** 18 s was not the worst case (synchronous schtasks calls with 20 s timeouts), so a false box was possible. Fixed: the box shows only once the server PID owns a LISTEN socket (`GetExtendedTcpTable`, v4 and v6).
- **[TEST-GAP]** The `--console` arm couldn't catch the box gate regressing.
- **[NIT]** A watcher race could close the crash box.
- **[NIT]** README wording.

## Iteration 3 (opus): 1 CONVENTION, 2 NITs

- **Verified:** the P/Invoke offsets against the documented structs, measured on x86 and AnyCPU. The lock can't deadlock.
- **[CONVENTION]** The safety text omitted the fake-board state.
- **[NIT]** An unreadable TCP table would never show the box. Fixed: a three-way check with a 45 s fallback (18 s + win32board's `SCHTASKS_TIMEOUT_MS` + a margin), one derivation.
- **[NIT]** The `--console` test now uses marker and stop files.

## Iteration 4 (sonnet): NO NEW FINDINGS

- **Fallback:** it can't be re-armed after a readable poll, and it is timed from the board child's start. A successful hand-off exits by about 34 s, inside the 45 s fallback.
- **`SCHTASKS_TIMEOUT_MS`:** it is byte-identical at its single call site. The lazy getter creates no cycle.
- **The delegate seam:** it is never replaced in production.
- **The test:** no stray processes.

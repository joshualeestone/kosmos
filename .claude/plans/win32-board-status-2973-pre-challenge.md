---
pre_challenge: true
method: challenge-loop
branch: win32-board-status-2973
diff_hash: 0f25f3257ac614e1744355f020414adb078faac121c966c462c0c1c489f8f83e
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T13:05:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, sonnet).
**Converged:** yes. Round 2 found NO NEW FINDINGS.
**Fixed:** every round-1 finding (1 BUG, 1 TEST-GAP, 1 CONVENTION, 2 NITs), plus three pre-review coordinator items:
- one shared deadline per status read, so a hand-off's schtasks time didn't grow;
- the shared test-process guard for the board's runner;
- the rebase over #2979.

**Asked (awaiting user):** 0. Coordinator decisions:
- unknown is never acted on;
- the board announces whether its task started it via a header, which decides the hand-off;
- the Last Result fallback counts 267009 and 0x800710E0 only.

**Filed:** #2983, the launcher's 45 s unreadable-table fallback vs the real worst case (pre-existing; the roster syncs run before the hand-off).

**How the hash was taken.** `diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- . ':!.claude/plans/win32-board-status-2973-pre-challenge.md'`, computed with node over git's own output.
- It was taken at `c85495f0` (115,056 bytes), on origin/main `169c1a33`, 13 commits ahead and 0 behind.
- The rebase onto `169c1a33` (#2977) applied cleanly, with no code change and no file overlap.
- The pre-challenge-gate hook isn't installed on this Windows box, so the recipe is written out here.

## Validation of record

All runs used the Kosmos runtime node v24.19 via PowerShell, the schtasks guard (`NODE_OPTIONS=--require=C:\Users\joshu\kosmos-scripts\no-schtasks-preload.cjs`), and APPDATA/LOCALAPPDATA pointed at scratch.

**Post-rebase suite run (builder), 46 files against a `git archive` of `169c1a33`:**
- The files are round 2's 31, all `engine/create*` suites, `worldstarts.test.js`, and `server.world-switch-agents-1704`.
- Results: `169c1a33` had 946 tests and 165 failing; the branch had 974 tests and 164 failing. They are identical by name AND first error line, with random temp-folder names normalized.
- The only base-only failure is `fixture-discipline`'s `git ls-files` arm, which can't run in an archive.
- **Extra run:** six more `server.js` source-reading suites (`engine.update-poll-1945`, `server.agent-token-sender-570`, `server.named-world-spawn-2827`, `server.remote-bind-1112`, `server.worldenv-order`, `server.agent-import-1652`) ran separately: 53 tests on each side, with the same single pre-existing failure.

**Round 2 (reviewer), 24 files:** base had 369 tests and 67 failing; the branch had 397 tests and 67 failing. Identical names, with 0 first-error-line differences.

**Block log:** the branch's is EMPTY. The base made 8 live `schtasks /Query /TN Kosmos\board` calls from `engine/machine.test.js`, blocked.

**Real outputs measured** on scratch tasks under non-Kosmos folders, deleted afterwards:
- The XML is 8-bit with no BOM, and has no `<Settings><Enabled>` when the task is on.
- The CSV status words are localized (Bereit/Deaktiviert, Prêt/Désactivé), so no status word is read.
- Last Result: running 267009; after an ignored `/Run` while running, -2147020576 (0x800710E0), which persists; after `/End` 267014; killed externally 0 or 1; never run 267011.

## Control runs

All red. They cover:
- the XML enabled read;
- unknown not acted on in ensure, restart and boardrestart;
- `taskXml` keeping the switch;
- C12-C18: the shared deadline; a query started with too little time left; ensure not passing its clock; no guard in the board's runner; the board keeping its own copy of the rule; the shared answer returning true; the per-call timeout ignored;
- C19-C25: the hand-off ignoring the header; 0x800710E0 not counted; the server always sending `1`; the server sending no header; the probe not reading it; an unrecognized code reading false; `describe` taking running from Task Scheduler.

## Iteration 1 (opus): 1 BUG, 1 TEST-GAP, 1 CONVENTION, 2 NITs

- **[BUG]** Last Result 267009 stopped meaning "running" after any ignored `/Run`, measured on a board-shaped scratch task. The next new-zip launch would read not-running, fail to bind, and show "Kosmos stopped unexpectedly".
  - **Fix:** GET / carries `x-kosmos-board-started-by-task`, read from the board's own marker, and the hand-off decides from its probe.
  - Boards without the header fall back to Last Result, counting 267009 and 0x800710E0.
- **[TEST-GAP]** A fixture for the refused code; header vs fallback; the server header only with the task marker.
- **[CONVENTION]** The "42 s" comment and test were reworded to cite #2983.
- **[NIT]** A comment on the duplicate `Math.min`; a first-run residual recorded.
- **Verified:** unknown on a first run is safe (no claim, so the next boot retries); the guard can't misfire in production; the port passthrough; no overlap with #2975.

## Iteration 2 (sonnet): NO NEW FINDINGS

- **Start paths:** every one was traced. `MARKER_ENV` is set only by `BOOT_JS`, so the header can't claim a task start that didn't happen.
- **Old boards:** a never-run old board (267011) reads unknown, which is the same branch main took.
- **`describe.running`:** it has no consumer.
- **GET /:** unchanged posture.
- **Source-extraction harnesses:** they pass.

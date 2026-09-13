---
pre_challenge: true
method: challenge-loop
branch: win32-agent-job-read
diff_hash: b3a28fae3fdeb32c70751cc862b8d037cc3f81d4c118a82366242ece02932a26
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T08:05:00Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (opus, opus, opus).
**Converged:** Yes. Round 3 found NO NEW FINDINGS against the branch's changes.
**Fixed:** everything from rounds 1-2:
- 1 SAFETY (a removed agent's task was re-enabled);
- 2 BUGs (codex home; a localized/name-carrying disabled read);
- 3 TEST-GAPs, 1 CONVENTION, NITs.

**Asked (awaiting user):** 0. The coordinator made these design calls:
- The re-register preserves the enabled state and fails closed.
- `CODEX_HOME` is derived like the Mac's, only for a named home.
- The enabled state is read from `<Settings><Enabled>` in `/Query /XML`.
- `accountEnvVar` lives in a neutral leaf.
- The 15 new Windows-host-only failures are accepted: plist-seeding tests read through readers with no platform parameter. On this host they now correctly read the Scheduled Task, and on darwin CI they still read the plist.

**Filed follow-ups (not in this branch):**
- #2973: `win32board.status()` has the same localized `/disabled/i` read for the board task.
- #2977: the #1704 pause treats an unreadable switched-off state as on. That predates this branch.

`diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- . ':!.claude/plans/win32-agent-job-read-pre-challenge.md'`, computed with node over git's own output. It was taken at `b408898a` (113,014 bytes), on origin/main `04e23b70`, 10 commits ahead and 0 behind. The pre-challenge-gate hook is not installed on this Windows box, so the recipe is written out here.

**Validation of record.** Round 3 ran the suites on this box with the Kosmos runtime node v24.19 via PowerShell, the schtasks guard (`NODE_OPTIONS=--require=C:\Users\joshu\kosmos-scripts\no-schtasks-preload.cjs`), and APPDATA/LOCALAPPDATA in scratch:

| Tree | Files | Tests | Failures |
|---|---|---|---|
| `git archive` of `04e23b70` | 53 | 966 | 147 |
| Branch `b408898a` | 54 | 1003 | 162 |

- **Failure diff by name:** 15 fail only on the branch, exactly the accepted set:
  - #2250;
  - #2906 ×6;
  - #2257 ×3;
  - #2413;
  - #2803;
  - the codex completion, WORKING-pane and DECOUPLED recording tests.

  Nothing fails only on main.
- **#1704 suites** (`worldstarts`, `server.world-switch-agents-1704`, `web.world-switch-agents-1704`, outbox 1704, `engine/outbox`): no branch-only failures.
- **Block log:** 0 schtasks attempts on the branch (win32job's own test-process guard now refuses them at the source); 375 on main.
- **Mac plists:** byte-identical to main across 40 runner × home × model combinations (checked in rounds 2 and 3).
- **Live probe (round 3, scratch tasks under `\ClaudeReviewProbeR3`, since deleted):** the branch's `taskEnabled` read real `schtasks /Query /XML` output correctly in 12 of 12 cases:
  - a disabled trigger with enabled Settings reads on;
  - disabled Settings reads off;
  - no `<Settings><Enabled>` reads on;
  - a product-built task reads off after `/Change /DISABLE` and on after `/ENABLE`.
- **Real output format:** 8-bit, no BOM despite `encoding="UTF-16"`, CRLF, and the `task` namespace.

**Control runs.** All red, with byte-exact restores:
- C1-C3 and C5-C20. C4's target line was rewritten, and C11 covers that guard.
- They include:
  - re-register as enabled (C12);
  - `taskXml` always true (C13);
  - no `CODEX_HOME` (C14);
  - no refusal on an unreadable state (C15);
  - the spec drops `enabled` (C16);
  - the setter back on the LIST reader (C17);
  - the absent-`<Enabled>` default flipped (C18);
  - the vanished-task refusal removed (C19);
  - the world pause back on `status` (C20).

### Iteration 1 (opus): 1 SAFETY, 1 BUG, NITs
- **[SAFETY]** A model, provider or account change on a REMOVED agent re-registered its task as Enabled (`taskXml` always wrote true, and `/Create /F` re-enables, measured), so the agent came back at logon. Fix: read the current state and carry `enabled` in the spec; an unreadable state REFUSES.
- **[BUG]** A Windows codex account change reported success, but `childEnv` never set `CODEX_HOME`. Fix: the launch env sets it for a named codex home, derived like the Mac.
- **[NIT]** Stale plist-only comments.
- Verified clean: the rebase, the re-register derivation, the cache, the test-process guard, and that the Windows-host-only failures are not Mac regressions.

### Iteration 2 (opus): 1 BUG, 2 TEST-GAPs, CONVENTION, NITs
- **[BUG]** `presence` decided disabled with `/disabled/i` over the whole LIST output, including TaskName and HostName. So an enabled `agent-disabled-bot` read as off, and on non-English Windows a removed agent read as on. Fix: the setters read `<Settings><Enabled>` from a fresh `/Query /XML` (absent means true, per the schema). `worldstarts.jobIsSwitchedOff`, a live #1704 decision, uses it too. `presence` is display-only.
- **[TEST-GAP]** The not-found refusal, and the detached `launch()` codex home.
- **[CONVENTION]** `accountEnvVar` moved to `engine/accountenv.js`.
- **[NIT]** Plan wording, a deleted-codex-home edge, and the read-to-`/Create` residual race.

### Iteration 3 (opus): NO NEW FINDINGS
- The worldstarts change is still 2 queries per agent (XML ~20 ms); on error it pauses, matching #1704's documented choice.
- The XML read is scoped to `<Settings>` (live-probed).
- The uncached read leaves the cache consistent for `/Create`.
- `accountenv` has no cycle, and the Mac plists are byte-identical.
- Pre-existing issues recorded as follow-ups: #2977 (the pause on an unreadable state) and #2973's sharper impact.

---
pre_challenge: true
method: challenge-loop
branch: win-staging-verify
diff_hash: f2010f4acf68a640ec071b0d6b96ba607efcfe83e9b7d3089a8a979adbf39309
validation: passed
subdir_audit: passed
timestamp: 2026-09-13T00:10:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, then sonnet).
**Converged:** Yes. Round 2 found NO NEW FINDINGS.
**Fixed:** every round-1 finding: 2 safety, 2 bugs, 1 convention, 3 test gaps and 5 nits.
**Asked (awaiting user):** 0.
- Josh's standing rule covers the policy: "everything has to go to staging before it
  goes to prod after my approval".
- The writer never runs for a real release without his go, and the checklist now
  says so.
- Running it for real is a separate, later step.

`diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- .
':!.claude/plans/win-staging-verify-pre-challenge.md'`, computed with node over git's
own output.
- Taken at `a56b1731` (111,943 bytes), on origin/main `cfaa273e`, 0 behind.
- The pre-challenge-gate hook is not installed on this Windows box, so the recipe is
  written out here.
- The branch began as work in progress recovered after the box blue-screened
  (`7e1b8ff7`, committed exactly as found, with no NUL bytes and `node --check`
  clean), then was finished in `28c2c52f`.

**Validation of record.** Round 2 ran both suites at `a56b1731` on this box, with the
Kosmos runtime node v24.19.0 and, for Git Bash, a `shasum` → `sha256sum` shim.

| Suite | Result |
|---|---|
| `tools.win-staging-verify.test.js` | 20/20 |
| `tools/test-promote-channel-win.sh` | 46/46 (43 from main, plus 3 new) |

- The suites use a local HTTP server only, with no real network.
- No test wrote to the real `%LOCALAPPDATA%\Kosmos\release-verify`.
- `deploy-site.sh` and the served-file inventories are untouched, so
  `tools/test-served-verify.sh` (which can't run here: no python3) is unaffected.

**Control runs.** All ran on scratch copies, never the worktree, and every one went
red.

| Control | Went red |
|---|---|
| The gate's result-must-match-the-checks rule off | 2 node tests + the shell `gate overclaim` arm |
| The sidecar comparison skipped | the V1 three-way sha test |
| The overwrite refusal dropped (and always rename) | 6 tests, including the byte-for-byte untouched assertion |
| 5xx treated as a hard fail | the caps and transient-answers test |
| A missing check defaults to pass | 3 tests |
| The undecided-record refusal removed | `--yes refuses an undecided record` |
| A typo'd `--attest` id ignored | attestation parsing |
| The `--for-sha` comparison removed (round 1 and, independently, round 2) | the pointer-moved test: a PASS was written for the moved-to build |
| The temp removed only after a successful write | the failed write/fsync test |
| The first `manifest.json` wins, with no duplicate check | the duplicate-manifest test |

### Iteration 1 (opus)

**[SAFETY] Attestations weren't bound to the tested build.** The checklist printed a
ready-to-paste `--attest …=pass` line with no sha, and the answers were applied to
whatever pointer V1 fetched at write time. A demo showed the hole: a dry run on X, the
pointer moves to Y, then `--yes` wrote a PASS for Y, whose V2 nobody ran, and the gate
accepted it.
- **Fix:**
  - `--attest` requires `--for-sha <64hex>`.
  - A mismatch with the freshly fetched pointer exits 3 and writes nothing.
  - The checklist prints the sha and `<pass|fail>` placeholders.

**[SAFETY] The V2 checklist must say Josh's go is needed.** Its steps move
`engine-path`, which the logon tasks run, and drive the board on the live port.
- **Fix:**
  - "STOP: get Josh's go before step 2".
  - Note `engine-path` first, and check it is restored at the end.
  - The broken `repoint-main.js` hint gets its `<repo> <node>` arguments.

**[BUG] Two bugs:**
- A temp leaked on a write or fsync failure (ENOSPC). There is now one try/finally
  from the open through the link or rename.
- A duplicate `manifest.json`: the first won, while extractors keep the last. Now any
  path listed twice, ignoring case, is refused.

**[CONVENTION]** The plan now matches the code, and records the deviations: link for a
new record, rename only under `--force-rewrite`; 408/429/5xx count as "cannot tell";
a pass needs a 40-hex `source_sha`; and `--for-sha`. The gate header lists a non-commit
`source_sha` as ambiguous.

**[TEST-GAP]** Arms were added for:
- 408/429/5xx on the pointer, sidecar and zip;
- the pointer moving;
- the refusal before any temp is created.

**[NIT]**
- "replaced" is logged after the rename.
- A held record gives a sentence and exit 3.
- There is a FAT/exFAT message, and a docs line that records need NTFS hard links.
- The saved size is checked against the hashed byte count.
- Ctrl+C, Ctrl+Break or a kill deletes the partial zip.
- A full disk is reported as a full disk.

**Open questions, judged:**
- The dry run keeps printing no promote line.
- Unsigned records, and having the approval name `record_sha256`, are listed as a
  follow-up.

### Iteration 2 (sonnet): NO NEW FINDINGS

Every round-1 item was re-verified in the code at HEAD.
- **`--for-sha`:** the comparison uses the pointer fetched in the same run, before
  the record is built, so there is no gap between check and write. The pointer sha
  and `--for-sha` are both lowercased and anchored to 64 hex, and an attest-less run
  can never derive a pass.
- **The signal handlers:** they are removed in `finally` on every path, and only
  ever delete their own `mkdtemp` directory.
- **The injected seams:** they all default to production values.
- **Logging:** no secrets are logged.
- **Also re-checked:** the SAFETY 1 revert control, run independently.

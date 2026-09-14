---
pre_challenge: true
method: challenge-loop
branch: win32-staging-channel
diff_hash: f7ddacac12466b2dbc345653f51106967c4cb56d15c0fd2885727e00a46dd024
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T22:00:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, then sonnet).
**Converged:** Yes. Round 2 found NO NEW FINDINGS.
**Fixed:** every round-1 finding (1 safety, 3 policy, 1 bug, 2 nits and the test
gaps), plus one CI failure after convergence (see the end of this file).
**Asked (awaiting user):** 0. The release lane (Splinter) approved the design and the
stricter post-review shape. Josh's promote-approval rule is standing ("everything has
to go to staging before it goes to prod after my approval"), so it was not re-asked.

`diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- .
':!.claude/plans/win32-staging-channel-pre-challenge.md'`, computed with node over
git's own output. It was taken at `2811e97d` (177,068 bytes), after rebasing onto
origin/main `57574825`, with no conflicts. The review base was `3f8797b6`; the PR opened
on `1226ce87`. The pre-challenge-gate hook is not installed on this Windows box, so the
recipe is written out here.

**Validation of record** (on this box, in Git Bash with the `zip` and `shasum` shims):

| Suite | Result |
|---|---|
| `tools/test-promote-channel-win.sh` | 43/43 (coordinator's own run) |
| `tools/test-staging-channel-2036.sh` (the Mac promote, plus the race arm) | 39/39 |
| `tools/test-dist-retention.sh` | 80/80 |
| `tools/test-deploy-site-winderive.sh` | 18/18 |
| `tools/test-deploy-site-promote.sh` | 18/18 |
| `tools/test-staging-wire-2036.sh` | 36/36 |

- **Syntax:** `bash -n` / `sh -n` are clean on every changed script.
- **`tools/test-served-verify.sh`** can't run on this box: it needs `/usr/bin/python3`
  for its local server. Its two sidecar-pair arms were verified with an isolated
  replica (see the end of this file), and macOS CI runs the whole suite.
- **`node --test tools.publish-windows-2008.test.js`:** 18/18 in the builder's run.
  In the reviewer's run node couldn't spawn the bash `zip` shim, and the same happens
  on main. macOS CI runs it.
- **The wider node suites** fail the same names on the branch and on main (Mac
  assumptions).

**Control runs:** 34 of 34 went red: 18 from the build, and 16 for round 1 (the race
on both families, the break-glass, the renamed variable, the ref, the record logging,
the unwritable log, and the retention and override nits). The Mac promote gave
byte-identical output and dist bytes against main across 13 gate arms.

### Iteration 1 (opus)
- **[SAFETY]** A promote race. The staging pointer was copied by path after the gate,
  so a mid-gate staging publish put an UNAPPROVED build into `latest-win.json`. The
  reviewer reproduced it. The fix works from one snapshot, re-checks it before the
  write, compares the temp copy before the `mv`, and checks the alias hash. It covers
  both families.
- **[POLICY]** Three gaps:
  - `KOSMOS_CUT_CHANNEL=prod` silently bypassed both gates. It is now a gated
    break-glass: `KOSMOS_WIN_PROD_APPROVED_SHA` + `KOSMOS_WIN_PROD_APPROVAL_REF`, a
    `path=direct` log line and a banner.
  - The shared variable let a Mac `export` leak Windows to prod. It is renamed
    `KOSMOS_WIN_CUT_CHANNEL`.
  - Approvals were an honour system. `--approval-ref` is now required, and the
    record's path and sha256 are logged through the one lib `tools/lib/win-approval.sh`.
- **[BUG]** An unwritable approval log only warned. It now refuses before any write.
- **[NIT]** `staged_version` appears in the retention JSON only when a pointer exists;
  the fail-closed deploy is documented.
- **[TEST-GAP]** Winderive arm 4 asserts the derived name, and there are new arms for
  every fix.

### Iteration 2 (sonnet): NO NEW FINDINGS
All 8 round-1 fixes were re-verified in the code at HEAD, not from the report:
- the race tests run a REAL mid-gate `publish-kosmos-windows.sh`;
- prod is written only from the snapshot;
- the break-glass hashes the exact zip it copies;
- the ref rule passes real Slack ts and permalinks and refuses free text;
- `win-approval.sh` is the one place for the ref rule and the log;
- the Mac output and exit codes are unchanged when there is no race.

### After convergence: macOS CI (`test-served-verify.sh`)

PR #2951's first CI run went red on both macOS jobs: `tools/test-served-verify.sh`,
the deploy-site sidecar-pair inventory, gave 2 FAIL. Neither the builder nor the
reviewers ran it, because it needs `/usr/bin/python3`.
- **The export arm** inventories the pre-deploy `[ -f "$EXPORT/dist/<name>" ]` lines by
  name. The new staged-file loop `for f in "$WIN_STAGED" …` read to it as an artifact
  literally named `$f`, with no `.sha256`.
- **The served arm** found `served_verify_asset_ok "$HOST/dist/latest-win-staging.json"`
  with no `.sha256` companion. A pointer JSON has no sidecar by design, but that arm had
  no exemption; only the export arm did, from a later, separate list.

**The fix** (`2811e97d`):
- the loop is now three literal `[ -f ]` checks;
- `latest-win-staging.json` joins `_sidecarless`;
- `_sidecarless` is now ONE list defined before, and read by, BOTH pair arms, so they
  can't disagree about what a pointer is;
- the list's stale comment ("it is inert today") is corrected to say it is live.

**Verified with an isolated replica** of both arms (`scratchpad/pair-arms-replica.sh`,
using the test's own `_ds_code` comment-strip rule):

| Run | Expected | Result |
|---|---|---|
| 1. fixed logic × edited `deploy-site.sh` | both arms pass | **0 fails** |
| 2. CONTROL: old logic × pre-fix `deploy-site.sh` | CI's exact failures | **2 fails** (`$f`; `latest-win-staging.json`) |
| 3. fixed logic × pre-fix `deploy-site.sh` | the loop still matters | **1 fail** (export arm on `$f`) |
| 4. CONTROL: fixed logic minus the new exemption × edited `deploy-site.sh` | the exemption is live | **2 fails** (both arms on `latest-win-staging.json`) |

`test-deploy-site-winderive.sh` and `test-deploy-site-promote.sh` were re-run on the
edited `deploy-site.sh`, 18/18 each. macOS CI runs the full `test-served-verify.sh`.

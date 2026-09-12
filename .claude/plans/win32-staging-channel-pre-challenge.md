---
pre_challenge: true
method: challenge-loop
branch: win32-staging-channel
diff_hash: 11c7a47ef318d8574cb021aa1578afb578febbc48a985b9069af5404ec06da3b
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T21:10:00Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (opus, then sonnet).
**Converged:** Yes. Round 2 found NO NEW FINDINGS.
**Fixed:** every round-1 finding (1 safety, 3 policy, 1 bug, 2 nits and the test
gaps).
**Asked (awaiting user):** 0.
- The release lane (Splinter) approved the design, and the stricter post-review
  shape.
- Josh's promote-approval rule is standing ("everything has to go to staging before
  it goes to prod after my approval"), so it was not re-asked.

`diff_hash` is the sha256 of the raw bytes of `git diff origin/main HEAD -- .
':!.claude/plans/win32-staging-channel-pre-challenge.md'`, computed with node over
git's own output. It was taken at `6e91efe6` (172,799 bytes), after rebasing onto
origin/main `1226ce87` (22 commits past the review base `3f8797b6`, with no
conflicts). The pre-challenge-gate hook is not installed on this Windows box, so the
recipe is written out here.

**Validation of record** (after the rebase, on this box, in Git Bash with the `zip`
and `shasum` shims):

| Suite | Result |
|---|---|
| `tools/test-promote-channel-win.sh` | 43/43 (coordinator's own run) |
| `tools/test-staging-channel-2036.sh` (the Mac promote, plus the race arm) | 39/39 |
| `tools/test-dist-retention.sh` | 80/80 |
| `tools/test-deploy-site-winderive.sh` | 18/18 |
| `tools/test-deploy-site-promote.sh` | 18/18 |
| `tools/test-staging-wire-2036.sh` | 36/36 |

- `bash -n` is clean on `promote-channel.sh`, `publish-kosmos-windows.sh`,
  `win-staging-verified.sh`, `lib/win-approval.sh`, `dist-retention.sh` and
  `deploy-site.sh`.
- `node --test tools.publish-windows-2008.test.js` passed 18/18 in the builder's run.
  In the reviewer's run node could not spawn the bash `zip` shim
  (`spawnSync zip ENOENT`); the same call is on main. macOS CI runs it.
- The wider node suites fail the same names on the branch and on main (Mac
  assumptions).

**Control runs:** 34 of 34 went red: 18 from the build, and 16 for round 1 (the race
on both families, the break-glass, the renamed variable, the ref, the record
logging, the unwritable log, and the retention and override nits). The Mac promote
gave byte-identical output and dist bytes against main across 13 gate arms.

### Iteration 1 (opus)
- **[SAFETY]** A promote race. The staging pointer was copied by path after the gate,
  so a mid-gate staging publish put an UNAPPROVED build into `latest-win.json`
  (reproduced). The fix works from one snapshot, re-checks it before the write,
  compares the temp copy before the `mv`, and checks the alias hash. It covers both
  families.
- **[POLICY]** Three gaps:
  - `KOSMOS_CUT_CHANNEL=prod` silently bypassed both gates. It is now a gated
    break-glass: `KOSMOS_WIN_PROD_APPROVED_SHA` + `KOSMOS_WIN_PROD_APPROVAL_REF`, a
    `path=direct` log line and a banner.
  - The shared variable let a Mac `export` leak Windows to prod. It is renamed
    `KOSMOS_WIN_CUT_CHANNEL`.
  - Approvals were an honour system. `--approval-ref` is now required, and the
    record's path and sha256 are logged through the one lib `tools/lib/win-approval.sh`.
- **[BUG]** An unwritable approval log only warned. It now refuses before any write.
- **[NIT]** `staged_version` now appears in the retention JSON only when a pointer
  exists; the fail-closed deploy is documented.
- **[TEST-GAP]** Winderive arm 4 now asserts the derived name. There are new arms for
  every fix.

### Iteration 2 (sonnet): NO NEW FINDINGS
All 8 round-1 fixes were re-verified in the code at HEAD, not from the report:
- the race tests run a REAL mid-gate `publish-kosmos-windows.sh`;
- prod is written only from the snapshot;
- the break-glass hashes the exact zip it copies;
- the ref rule passes real Slack ts and permalinks and refuses free text;
- `win-approval.sh` is the one place for the ref rule and the log;
- the Mac output and exit codes are unchanged when there is no race.

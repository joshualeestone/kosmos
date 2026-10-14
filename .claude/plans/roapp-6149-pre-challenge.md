---
pre_challenge: true
method: challenge-loop
branch: roapp-6149
diff_hash: b65362138cc92f93a798cbe10592a20e061ac2ad8cc3500e0b3adea95504977f
validation: passed (full validation at head b1667940e, 06:15 to 06:50 CDT 2026-10-14: node 20583 tests, 20340 pass, 0 fail; shell 234 of 234; the helper recorded clean under b65362138cc9, this diff)
subdir_audit: passed
timestamp: 2026-10-14T12:11:51Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes
**Total findings:** 7 (0 BLOCKERs, 6 WARNINGs, 1 CONVENTION), plus NITs listed below
**Fixed:** 3 | **Deferred:** 4 | **Asked (awaiting user):** 0

Origin: every finding is recorded BRANCH by the fail-safe; no blame lookups were run. Several later findings were plainly about lines an earlier iteration wrote (iteration 2's on iteration 1's advice line, and iteration 3's NIT on iteration 1's note); all were fixed as code or user-facing text.

`tools/test-install.sh` in full is queued on Mortals at 9faee5d816 (the last code commit; b1667940e changes only the plan). Its result goes on the pull request before merge.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 6 NITs
**Self-generated:** 0 of the above (nothing committed by the loop yet)
- [WARNING] install/setup.sh:1396: the advice cleared only `uchg`, while the search refuses on four flags; an append-only file stayed refused --> FIXED (d625625e: `nouchg,nouappnd`, plus the administrator's `noschg,nosappnd` line; measured on a scratch append-only file both ways)
- [WARNING] install/setup.sh:1397: the advice ran `chflags -R` on the whole Kosmos folder --> FIXED (d625625e: the stuck part only)
- NITs taken in d625625e: the header named every Darwin-only arm and the real reason NOISY skips its fault; GNUFIND checks nothing was removed; `/bin/chmod` for the stub; the uninstall check covers the whole folder. The single-quote path limit is in the plan as accepted.

#### Iteration 2
**Reviewer model:** sonnet
**New findings:** 0 BLOCKERs, 3 WARNINGs, 1 CONVENTION, 2 NITs
**Self-generated:** 0 of the above (not looked up)
- [WARNING] install/setup.sh:1381: only the first locked part was named, so a second try was refused on another --> FIXED (d242a750: every part searched; TWOLOCKS, whose mutant is stopping at the first hit)
- [WARNING] install/setup.sh:1396: a system flag set by the person's own sudo --> DEFERRED: the "if it is still refused" line covers it
- [WARNING] tools/test-install.sh:306: unsetting the switch could break fixtures, unmeasured --> DEFERRED: unset and 1 behave the same (`${KOSMOS_READONLY_APP:-1}`, iteration 4 confirmed); the full run on Mortals is queued anyway
- [CONVENTION] plan file present (the reviewer recorded it as a check, not a defect) --> DEFERRED: not an issue

#### Iteration 3
**Reviewer model:** fable
**New findings:** 0 BLOCKERs, 1 WARNING, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above (not looked up)
- [WARNING] .github/workflows/test-linux-setup-4920.yml:236: the new lines have never run --> DEFERRED: true and stated in the plan; the pull request's test-linux-setup job is their first run and is read before merge
- NITs taken in 9faee5d8: the not-understood note no longer says "left read-only" before the chmod (a failing chmod then printed the opposite); the switch's header comment, run_block's stub comment and the workflow's && rule match the code.

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 4 NITs
**Self-generated:** 0 of the above
**Converged**: no new actionable findings. Its first NIT corrected the plan's reason for the full install run (b1667940e).

### Final Ledger

| # | Iter | Category | File:Line | Origin | Description | Status | Resolution |
|---|------|----------|-----------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | install/setup.sh:1396 | BRANCH | Advice cleared only uchg | FIXED | d625625e |
| 2 | 1 | WARNING | install/setup.sh:1397 | BRANCH | Advice covered the whole Kosmos folder | FIXED | d625625e |
| 3 | 2 | WARNING | install/setup.sh:1381 | BRANCH | Only the first locked part named | FIXED | d242a750 |
| 4 | 2 | WARNING | install/setup.sh:1396 | BRANCH | System flags set by the person's sudo | DEFERRED | The advice's second line covers it |
| 5 | 2 | WARNING | tools/test-install.sh:306 | BRANCH | Unset switch could break fixtures | DEFERRED | Unset equals 1; full run queued |
| 6 | 2 | CONVENTION | .claude/plans/ | BRANCH | Plan file present (a check) | DEFERRED | Not an issue |
| 7 | 3 | WARNING | .github/workflows/test-linux-setup-4920.yml:236 | BRANCH | New CI lines never run | DEFERRED | First run is the PR's CI |

### NITs (non-blocking, not taken)
- Only the `-flags` search is pinned to `/usr/bin/find` (iteration 4; noted in the plan)
- A lock and a permissions problem in different parts: the second is named only on the next try (iteration 4; noted in the plan)
- `default-zero-note` skips the `in_sb` check its siblings get (iteration 4)
- The GNUFIND cleanup has no failure handling (iteration 2)

### Strengths (across all iterations)
- GNUFIND proves its stub rejects `-flags` before trusting a refusal, and its mutant (the bare find) fails it.
- TWOLOCKS asserts both directions: the locked parts named, the unlocked one not.
- The not-understood note is tested where it must print and where it must not, and never changes the decision.

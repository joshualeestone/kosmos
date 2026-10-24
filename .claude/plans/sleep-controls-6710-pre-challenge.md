---
pre_challenge: true
method: challenge-loop
branch: sleep-controls-6710
diff_hash: 4620d0af3e821fb58a07a841913181260c42590f9f0bd3aaef1c31016409e8ad
validation: passed (targeted; not the full `yarn test` suite — see Validation note)
subdir_audit: n/a (no subdir CLAUDE.md changed)
timestamp: 2026-10-20T17:18:42Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (converged — iteration 3 raised no actionable BLOCKER/WARNING/CONVENTION)
**Converged:** Yes
**Total actionable findings:** 1 WARNING + 3 WARNINGs + 0 across iters = 4 WARNINGs, 3 CONVENTIONs, several NITs.
**Fixed:** all 4 WARNINGs + 2 CONVENTIONs (stale comments) + 3 message/NIT fixes. **Deferred:** 3 (reasoned). **Asked:** 0.

### Validation note (why targeted, not the full suite)
kosmos's nominal pre-PR gate is `yarn test` (= the full `tools/run-tests.sh` suite). This change is
test-infra-only (tools/test-*.sh + package.json wiring); it cannot affect node product code, and the
full node suite false-fails 3 subtasks-3861 tests on this box unless `KOSMOS_AGENT_TOKEN` is unset.
The PM instructed "run the touched tests one by one, not the full suite." So validation here is:
`bash -n` on all 5 changed shell files (clean); **each of the 4 touched tests run one-by-one on a
free box, all PASS** (tunnel 57/0; queued-heavy 142 OK/0 FAIL with its PASS verdict, no 900s watchdog
on a quiet box; light-side 96/0; cut-guard 0 failures and 0 `q_ready` FIXTURE lines); and the new
guard's battery + 143-file scan green. The PM was told; if the full `yarn test` is wanted it should
run with `KOSMOS_AGENT_TOKEN` unset. The real downstream gate is green CI on the PR (test:shell runs
all four tests plus the guard).

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** opus
**New findings:** 1 WARNING, 2 CONVENTIONs, 3 NITs
**Self-generated:** 0 (ITER_COMMITS empty on the first pass — nothing committed yet)
- [WARNING] tools/test-sleep-control-guard-6710.sh — whole-line fractional/zero exclusion short-circuited a real control sharing a line with a pause (`( exec sleep 30 ) & p=$!; sleep 0.1`) --> FIXED (55f3d16: persistent shapes require a complete integer >= 1, decisive regardless of other sleeps on the line)
- [NIT] guard — no-space `sleep 30&` missed --> FIXED (55f3d16: added the no-space form)
- [NIT] guard allowlisted() — unescaped `.` in an ERE --> FIXED (55f3d16: exact first-token compare)
- [CONVENTION] tools/test-cut-guard.sh:682 — comment "sh -> sh -> sleep" now perl --> FIXED (55f3d16)
- [CONVENTION] tools/test-light-side-4911.sh — comment "plain sleep" now perl --> FIXED (55f3d16)
- [NIT] tools/test-cut-guard.sh — five "...sleep never reached its cwd" fail messages now perl --> FIXED (55f3d16)

#### Iteration 2
**Reviewer model:** sonnet (a different model from iter 1, per the vary-the-model rule — it caught three guard WARNINGs iter 1 missed)
**New findings:** 3 WARNINGs, 2 NITs
**Self-generated:** ~2 of the 3 WARNINGs (blame attributes the guard's precondition and backgrounded-regex lines to iter 1's restructure commit 55f3d16; these are CODE findings fixed normally, not the prose-regeneration pattern of kosmos#120)
- [WARNING] guard — precondition `[^-[:alnum:]_./"]` dropped a sleep preceded by `"` or `/`, so a backgrounded sleep inside a double-quoted `bash -c` and a `/bin/sleep` control slipped past; also surfaced a 9th file (test-running-anchor-5470.sh) neither flagged nor allowlisted --> FIXED (20b51536: allow `"`/`/`; allowlist the 9th file under #6730 + add to #6730)
- [WARNING] guard — backgrounded detection missed `sleep 30 > "$f" &` (space-separated redirect) and false-flagged `sleep 30 &>/dev/null` --> FIXED (20b51536: redirect allows a space; `&` terminator excludes `&>`)
- [WARNING] guard — allowlist entries never checked against reality --> FIXED (20b51536: existence check fails loudly on a stale entry)
- [NIT] guard header / cut-guard / light-side — line-number references rot --> FIXED (20b51536: symbol/phrase references; header documents the wrapper-backgrounded limitation)

#### Iteration 3
**Reviewer model:** opus
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 actionable CONVENTIONs, 2 NITs + 1 weak CONVENTION
**Self-generated:** 0 acted on as SELF
**Converged** — no new actionable findings. The reviewer independently re-verified the conversions, the q_ready flip (all 14 call sites), the matcher (incl. iter-2's fixes), and the command-under-test boundaries, finding only reasoned tradeoffs:
- [NIT] guard — allowlist is file-granular, so a NEW control added to an allowlisted file escapes until #6730 --> DEFERRED (deliberate: PM scoped #6710 to 4 files; the other files are #6730)
- [NIT] guard — the existence check does not also require a flagged line --> DEFERRED (deliberate: some allowlisted shapes are undetectable, e.g. the wrapper-backgrounded sh -c case)
- [CONVENTION] .claude/plans/ plan file omits the `-<timestamp>` from the written naming rule --> DEFERRED (matches the repo's de-facto practice; every existing plan omits it, so following the written rule would make this file inconsistent with the rest)

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | guard | BRANCH | whole-line exclusion short-circuits a control sharing a line with a pause | FIXED | 55f3d16 |
| 2 | 1 | NIT | guard | BRANCH | no-space `sleep 30&` missed | FIXED | 55f3d16 |
| 3 | 1 | NIT | guard | BRANCH | unescaped `.` in allowlist ERE | FIXED | 55f3d16 |
| 4 | 1 | CONVENTION | cut-guard.sh:682 | BRANCH | stale "sh->sh->sleep" comment | FIXED | 55f3d16 |
| 5 | 1 | CONVENTION | light-side-4911.sh | BRANCH | stale "plain sleep" comment | FIXED | 55f3d16 |
| 6 | 1 | NIT | cut-guard.sh | BRANCH | stale "sleep never reached" fail msgs | FIXED | 55f3d16 |
| 7 | 2 | WARNING | guard | SELF | precondition dropped quote/slash-preceded sleeps; 9th file unlisted | FIXED | 20b51536 |
| 8 | 2 | WARNING | guard | SELF | `&>` false-flag + space-redirect miss | FIXED | 20b51536 |
| 9 | 2 | WARNING | guard | BRANCH | allowlist not checked for stale entries | FIXED | 20b51536 |
| 10 | 2 | NIT | guard/cut-guard/light-side | mixed | rotting line-number comment refs | FIXED | 20b51536 |
| 11 | 3 | NIT | guard | BRANCH | file-granular allowlist blind spot | DEFERRED | PM scope; #6730 |
| 12 | 3 | NIT | guard | BRANCH | existence check does not require a flagged line | DEFERRED | undetectable shapes |
| 13 | 3 | CONVENTION | .claude/plans/ | BRANCH | plan filename lacks `-<timestamp>` | DEFERRED | matches repo de-facto practice |

### NITs / deferred (non-blocking)
- [NIT] guard allowlist is file-granular; new controls in allowlisted files are not caught until #6730 converts + de-allowlists them (documented in the guard header).
- [NIT] the allowlist-existence check does not require a still-flagged line (some shapes are undetectable).
- [CONVENTION] plan file omits the timestamp the written rule names (consistent with every other plan in the dir).

### Strengths (across all iterations)
- Shell-quoting correct in every `perl -e 'select(...)'` form, including the triple-nested `sh -c 'sh -c "perl -e \"...\"; :" & wait; :'` (preserves the sh->sh->perl tree), with exec/backgrounding/pid/argv structure intact and wait lengths preserved.
- `q_ready` `sleep*`->`perl*` flip in lockstep across all 14 call sites; explicit-glob calls left untouched.
- queued-heavy's exact-length `^sleep $((U+n))$` command-under-test matchers, the `sleep 7` poll, and Mona Lisa's line-177 false hit all correctly left alone.
- The PM's instruction to run touched tests one-by-one was honoured; all four pass clean (0 q_ready FIXTURE lines proves the glob coupling).
- The guard mirrors the sibling pipe-lint's two-armed battery and was itself hardened across three blind passes.

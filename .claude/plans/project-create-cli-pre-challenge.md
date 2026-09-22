---
pre_challenge: true
method: challenge-loop
branch: project-create-cli
diff_hash: 7a617abb63ca9782eb2269304cdddcdabb316e28da53088a11ed3077d284a89d
validation: passed
subdir_audit: passed
timestamp: 2026-09-22T16:19:18Z
iterations: 3
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 3 (1: build + full node suite caught a count-index; 2: adversarial reviewer caught a --help parity gap; 3: CI shell gate, only a pre-existing unrelated failure)
**Converged:** Yes
**Total findings:** 3 (2 real defects in my change — both count/verb-list INDICES the change forgot to update — plus 1 pre-existing unrelated test failure that is NOT mine), 0 open.
**Fixed:** 2 | **Deferred:** 0 | **Asked:** 0

The verb `kosmos project` touched SIX verb-list/count indices; the loop's job here was finding the ones the first pass missed.

### Per-Iteration Breakdown

#### Iteration 1 — build + targeted tests, then the FULL node suite
Built `cmd_project` (install/kosmos) + `projectCreate` (Windows shim) + two tests. Targeted tests green: my CLI test (5/5), the shim behavioral test (34), the verbs-parity test (10/10), regressions clean. Contract verified against the engine first (POST /api/projects reads name/folder/description/from_pane; returns {project,told,id} on success, {error} on 4xx/5xx).
- [BLOCKER, self-caught] `tools/test-msg-newlines-1927.sh` pins the COUNT of guarded multi-line JSON-escape sites in install/kosmos (its own history 4->6->7). `esc_desc` is a legitimate new site -> the full node suite went red (7 found 8). **FIXED**: bumped to 8 with the history note. This was invisible to the targeted tests and only the full runner caught it (the "run the FULL runner" lesson). Also caught here: the first background run's exit was masked by a trailing `echo` (the trailing-command bulletin); re-ran with a truthful exit and got 8076 tests / 0 fail.

#### Iteration 2 — adversarial reviewer (1 subagent, independent)
Reviewed the diff for correctness (escaping, id-extraction, off-argv token, parity, false-success).
- [BLOCKER] `install/kosmos` top-level `--help` re-dispatch allowlist (~line 1785) lists the bare-usage verbs; `project` was missing, so `kosmos project --help` fell through to the GENERIC banner while `cmd_project`'s own `-h|--help` arm sat dead (shadowed by the guard) — AND the Windows shim printed project usage, so Mac/Windows DIVERGED. A 4th verb-list index. **FIXED**: added `project` to the allowlist (bare `kosmos project` -> usage, exit 2 -> mapped to 0, exactly the pattern). This surfaced a 5th index — `tools/test-kosmos-help-exit0-3036.sh` greps the exact allowlist string AND loops MSG_VERBS — **FIXED** both (grep + MSG_VERBS, which also ADDS `project --help`/bare coverage).
- The reviewer confirmed 5 items CLEAN, checked against the engine/reference (not prose): JSON escaping is byte-for-byte identical to cmd_post/cmd_msg (no field injection on a name with `"`/`\`/newline); the greedy id-extraction grabs the top-level `id`=made.id and the `{"error":` prefix-case can't be flipped by a nested key; `kosmos_curl "$_bt" ""` sends the board token off-argv (mode-600 -H @file), no agent token, matching the endpoint's auth and the task-add sibling; the shim's `{agent:false}` matches; parity stays green.

#### Iteration 3 — the CI shell gate (yarn test:shell)
My install/kosmos-touching tests all PASS in the gate: `kosmos project --help exits 0 and prints usage`, `control: bare kosmos project still exits 2`, `all 8 multi-line JSON-escape sites`, `test-kosmos-help-exit0-3036: 0 failures`, `test-msg-newlines-1927: 0 failures`, `bash -n install/kosmos` OK.
- [NOT MINE] The gate's `&&` chain then died at `test-promote-channel-win` (a Windows release-promote approval-log test). It fails IDENTICALLY on a clean `main` checkout (zero of my changes), touches none of my files, and passed in CI 40 min ago when the 0.6.88 HOME fix merged green through this same `node --test + yarn test:shell` gate — so it is local-state-specific on this box, not a regression from this change and not expected to red CI. Documented, not fixed (out of lane).

### Final Ledger
| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | test-coverage | tools/test-msg-newlines-1927.sh | esc_desc is a new guarded JSON-escape site; the pinned count (7) went red | RESOLVED | bumped 7->8 with history note; full node suite 8076/0 |
| 2 | 2 | correctness | install/kosmos | `project --help` fell to the generic banner (Mac) vs project usage (Windows) — a missed 4th verb index | RESOLVED | added project to the --help allowlist + the 5th index (help-exit0 shell test grep + MSG_VERBS) |
| 3 | 3 | n/a (not mine) | tools/test-promote-channel-win.sh | pre-existing failure, also red on clean main, unrelated to this change | DOCUMENTED | not fixed (out of lane); flagged separately |

No open BLOCKER / WARNING / CONVENTION findings remain in this change.

### Strengths
- [STRENGTH] Contract verified against the engine (server.js POST /api/projects) BEFORE building, so the request/response handling is not guessed.
- [STRENGTH] The token never touches argv/scrollback — reused `kosmos_curl`'s mode-600 header-file mechanism (off-argv), the exact thing the verb exists to spare agent instructions.
- [STRENGTH] Mac and Windows kept behaviorally parallel (arg validation, description handling, success-requires-id, exit codes, --help) — the divergence the reviewer found was fixed rather than left.
- [STRENGTH] Tests hit a REAL http stub the CLI's own curl reaches (end-to-end request + each outcome), binding 127.0.0.1:0 so no real board is touched and the #327 valve is never burned; each has a load-bearing error control.

### Validation
- Full node suite (`tools/run-tests.sh`): **8076 tests, 0 fail** (truthful exit, not masked).
- CI shell gate (`yarn test:shell`): every install/kosmos-touching test PASSES; only the pre-existing, unrelated `test-promote-channel-win` fails (also red on clean main).
- Targeted: cli.project-create-3388 (5), tools.windows-kosmos-cli-570 (+1 project case), verbs-parity (10) all green.

### Known gaps
- Only the `create` subcommand (the assigned verb); `agents`/`parent` accepted by the endpoint but not exposed.
- Verified against a stub board, not a live one, deliberately (a live create would pollute a shared board and burn the 12/hr valve); the stub receives the real request bytes, so request-shape + outcome handling are exercised end-to-end.
- `test-promote-channel-win` is red on this box (pre-existing, not this change) — flagged to Splinter separately in case it is also flaky in CI.

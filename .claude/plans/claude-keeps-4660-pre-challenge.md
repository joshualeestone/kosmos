---
pre_challenge: true
method: challenge-loop
branch: claude-keeps-4660
diff_hash: a48ee8166f459c094ae725ba3027324f51686ad4803ebea7093cfb8e5b3394bd
validation: passed
subdir_audit: passed
iterations: 3
converged: true
generated_at: 2026-11-01T12:25:42Z
---

# Challenge-loop proof: claude-keeps-4660 (the Claude org-chart consent line says what Anthropic keeps)

Addresses #4660 (follow-up to #4559 the Claude read path and #4560 the key-connected retention line).

## What this branch is, and why it was re-looped

This is the previously-built, challenge-looped #4660 work, which had been stacked on #4560's
branch and never landed after #4560 merged (2026-10-08). It was rebased `--onto origin/main` from
that stale base onto current main. Two semantic conflicts were resolved, both preserving main's
post-#4560 state while layering in #4660's additions:
- `engine/orgchartkeys.js` module.exports: keep main's `TIMEOUT_MS` / `OFF_SHORT` /
  `googleOffWhyFor`, add `CLAUDE_KEEPS` / `CLAUDE_API_KEEPS`.
- `engine/orgchartfile.js` `consentFor()`: keep main's codex routing (`#5346`:
  `r.kind === 'codex' ? require('./orgchartcodex').KEEPS : keys.keeps(r)`), route every other
  reader through `keeps()`, which #4660 made handle the Claude plan and Claude-API-key cases.

Because a rebase changes the bytes being reviewed, the branch was put through a fresh
challenge-loop after the rebase. The pre-rebase loop's commits (`9f3f43ca7b`..`0e11a1ea16`:
"address challenge-loop iteration 1/2/3 findings", "round 4 NITs") are preserved in history. The
ledger below is the POST-REBASE loop that certifies the current diff.

## Validation

- Final full Node suite green on a quiet box: `shell-shard 4/4: all 77 passed`,
  `test:shell ran as 4 shards at once in 925 s; all green (#7100)`,
  `validation PASSED for stack=typescript hash=a48ee8166f45`. Verdict line present (not a
  killed-suite tally); re-run against HEAD `8c4f484c97`.
- `subdir_audit: passed` — the three directly-affected test files pass on their own
  (orgchartkeys / orgchartfile / server.orgchart-read-4559); the change touches no CLI-spawn test.
- Conflict prediction clean: `git merge-tree --write-tree HEAD origin/main` exits 0 against
  current main (`a792495f51`); merge-base `03b388797f` is stable, so the three-dot diff_hash holds.

## Per-iteration ledger

### Validation round 0 — contention red, resolved
First full-suite validation FAILED on CLI-spawn contention under 1-minute load 22.30
(`cli.agent-token-verbs-4491.test.js:145` + `cli.agent-remove-7362.test.js` SIGTERM). Confirmed
contention, not the change: both files pass 94/94 alone, and #4660 touches neither. A clean full
re-run on a quiet box PASSED. Not a code finding; recorded for honesty.

### Iteration 1 — reviewer model: Opus (blind)
- Self-generated findings: none.
- [CONVENTION] no plan file committed for branch `claude-keeps-4660`. The `pre-challenge-gate` /
  pre-PR hook enforces this. FIXED: wrote `.claude/plans/claude-keeps-4660-20261101T0947.md`
  (sourced from card #4660 + parent plan `orgchart-keys-4560-20260929T2305.md`), committed
  `4c67de2740`.
- [NIT] reviewer-acknowledged non-issue on API-key detection ordering; no change (behaviour
  correct, env key fixed at board start).
- [STRENGTH] single source of truth respected (keys live in `orgchartkeys.js`, page and consent
  both read it). [STRENGTH] merge-conflict resolution preserved main's codex routing.
  [STRENGTH] retention numbers each carry a dated, quoted source citation.

### Iteration 2 — reviewer model: Sonnet (blind)
- [WARNING] `keeps()`'s Claude branch had no DIRECT unit test — only indirect coverage via the
  page/consent render tests. A model-rotation catch: Opus iteration 1 did not surface it. FIXED:
  added `#4660: keeps() returns the Claude retention line per reader kind` to
  `engine/orgchartkeys.test.js`, pinning Claude-plan -> `CLAUDE_KEEPS`, `apiKey:true` ->
  `CLAUDE_API_KEEPS`, and `apiKey:'true'` (string) -> `CLAUDE_KEEPS` (strict `=== true`). Targeted
  run 29/29 green. Committed `8c4f484c97`.
- [NIT] strict `=== true` for the API-key flag (a truthy non-boolean routes to the plan line) —
  now pinned by the new unit test above.

### Iteration 3 — reviewer model: Opus (blind) — CONVERGED
- Zero [BLOCKER] / [WARNING] / [CONVENTION]. Plan file present, no convention violation; plan
  claims match the code.
- [NIT] `docs/browser-checks/render-orgchart-file-4559.js:150` — the browser check exercises only
  the plan path, not the apiKey page rendering. Reviewer-judged near-zero risk (the page appends
  `out.keeps` identically for both); no change.
- [NIT] `engine/orgchartkeys.js:260` — the `CLAUDE_KEEPS` two-sentence wording could read as
  cumulative rather than alternative. Reviewer-judged a deliberate "say both cases" disclosure per
  the plan; the "up to" ceilings keep each clause literally true. No change.
- [STRENGTH] single source of truth respected end-to-end. [STRENGTH] `keeps()` branching correct
  for every reader kind. [STRENGTH] API-key detection accurate via `defaultModelRunner`'s
  `{...process.env}` at `orgchartfile.js:601`. [STRENGTH] test coverage thorough with good
  controls, including the new direct `keeps()` unit test and the negative-control regex forbidding
  a flat "30 days".

## Convergence

Iteration 3 (Opus) produced zero NEW actionable findings after dedup and no unresolved ASKED
findings -> `6d CONVERGED` at iteration 3. The convergence was witnessed by two models (Opus and
Sonnet); the one real WARNING of the loop was a Sonnet catch between two clean Opus passes, which
is exactly the cross-model independence the rotation exists for. Two NITs remain, both
reviewer-judged non-issues and recorded above; neither blocks.

---
pre_challenge: true
method: challenge-loop
branch: onboarding-preaccept-3383
diff_hash: 07dd53a77eb255c6ffbdbffcb75c3f305d6e55ad28a32610d44d88faa1aa4920
validation: passed
subdir_audit: passed
timestamp: 2026-09-22T02:24:31Z
iterations: 2
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2 (round 1: three parallel blind reviewers on independent axes; round 2: one fresh reviewer on the fixed diff)
**Converged:** Yes
**Total findings:** 4 actionable, ALL FIXED (0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 2 NITs, 6 STRENGTHs)
**Fixed:** 4 | **Deferred:** 0 | **Asked (awaiting user):** 0

Round 1 surfaced exactly three real issues along three independent attack axes (correctness, wiring,
test-quality); all three were fixed and the fix re-proven. Round 2 (a fresh reviewer that saw the fixed
diff, including the round-1 changes) found **no code defect** — only one low-severity plan-doc
inconsistency (the plan still described the superseded `{ hasCompletedOnboarding, theme }` file shape
after the theme seed was dropped), since corrected. No open findings remain.

### The core claim is MEASURED, not reasoned

The one thing a unit test cannot prove — that seeding the key suppresses the v2.1.278 theme picker —
was measured on this box (the same claude v2.1.278 Josh runs), interactively in tmux, which is how
Kosmos launches agents:

| config launched interactively | first screen |
|---|---|
| fresh `CLAUDE_CONFIG_DIR`, unseeded | the theme picker ("Welcome to Claude Code / Choose the text style") — Josh's exact bug screen |
| `.claude.json` = `{ hasCompletedOnboarding: true }` only | picker GONE, jumps to the trust prompt |
| real create sequence (`trustFolder` + `preacceptBypass` + `preacceptOnboarding`) | the ready composer — no theme picker, no trust prompt, only "Not logged in / Run /login" (the separate sign-in) |

The middle row is load-bearing: `hasCompletedOnboarding: true` **alone** (no theme) suppresses the
picker, which is why the fix seeds only that one boolean.

### Per-Iteration Breakdown

#### Iteration 1
**New findings:** 0 BLOCKERs, 2 WARNINGs, 0 CONVENTIONs, 1 NIT (three parallel blind reviewers)

- [WARNING] engine/trust.js — `preacceptOnboarding` seeded `theme:'dark'`; for a default-account agent
  the target is the operator's own `~/.claude.json`, so it silently changed a UI preference they never
  set, contradicting the "changes no behaviour / never global" invariant. **FIXED:** measured that the
  boolean alone suppresses the picker, so the theme seed was dropped entirely; the function now writes
  one agent-neutral consent-like boolean, exactly like `trustFolder`/`preacceptBypass`.
- [WARNING] engine/win32launch.js:290,435 — the two Windows onboarding calls were NOT provider-guarded,
  so a codex agent on Windows would get Claude first-run keys written into its CODEX_HOME `.claude.json`
  (the Mac path is fenced behind `if (provider !== 'openai')`). **FIXED:** guarded both (launch + resume)
  with `if (s.runner !== 'codex')`, matching the Mac fence and the existing `s.runner` discriminator.
- [NIT] engine/trust.test.js — the literal key string `hasCompletedOnboarding` was unpinned (product and
  test both imported `ONBOARDING_KEY`, so a typo would move them together and stay green while the real
  picker, which reads the literal, is NOT suppressed). **FIXED:** pinned the literal in the CREATE test's
  whole-object `deepEqual`; added a test asserting ONLY the onboarding key is written (no theme).

#### Iteration 2
**New findings:** 0 BLOCKERs, 0 WARNINGs, 0 CONVENTIONs, 1 NIT — **Converged** (no code defect)

A fresh blind reviewer on the fixed diff independently cleared: no dangling theme reference in product
code (every `theme` hit is explanatory comment or a pre-existing unrelated `trustFolder` fixture); the
`if (s.runner !== 'codex')` guards correct (undefined runner → Claude fires, codex skipped; no
scope/brace error); the modified tests non-vacuous (the CREATE `deepEqual` is a whole-object literal
that fails on any extra/renamed key; the undo test's `undoWrites === 1` is a strict count that fails if
the undo never wrote); and no new locking/data-loss (same `configTarget`/`withFileLock` as `trustFolder`,
so they serialise).

- [NIT] .claude/plans/onboarding-preaccept-3383.md — the plan still described the created file as
  `{ hasCompletedOnboarding, theme }` after the theme seed was dropped. **FIXED:** corrected to
  `{ hasCompletedOnboarding: true }` (doc-only; no runtime impact).

### Final Ledger

| # | Iter | Category | File | Description | Status | Resolution |
|---|------|----------|------|-------------|--------|------------|
| 1 | 1 | correctness | engine/trust.js | `theme:'dark'` seed polluted the operator's own `~/.claude.json` | RESOLVED | dropped theme; seed only the boolean (commit a0f98b48) |
| 2 | 1 | wiring | engine/win32launch.js | Windows onboarding calls not codex-guarded | RESOLVED | `if (s.runner !== 'codex')` on both (commit a0f98b48) |
| 3 | 1 | test-quality | engine/trust.test.js | literal key `hasCompletedOnboarding` unpinned | RESOLVED | literal `deepEqual` + only-one-key test (commit a0f98b48) |
| 4 | 2 | doc | .claude/plans/onboarding-preaccept-3383.md | stale `{ …, theme }` shape in plan | RESOLVED | corrected to `{ hasCompletedOnboarding: true }` (commit 7022c9fb) |

No open BLOCKER / WARNING / CONVENTION findings remain — all four raised were fixed.

### NITs (non-blocking, all fixed)
- [NIT] engine/trust.test.js — literal key was unpinned (iteration 1) — FIXED
- [NIT] .claude/plans/onboarding-preaccept-3383.md — stale `{ …, theme }` doc shape (iteration 2) — FIXED

### Strengths
- [STRENGTH] The core picker-suppression claim is MEASURED end-to-end in tmux, not reasoned — including the isolating middle-row measurement that the boolean alone suffices (iteration 1)
- [STRENGTH] Data-loss/corruption path is byte-for-byte cloned from `preacceptBypassInner`: merge-not-replace preserves `trustFolder`'s `projects` and all other keys; symlink/non-object refusal, empty-fill, ENOENT create-if-absent, atomic `wx`, mode preservation (both reviewers, iterations 1 and 2)
- [STRENGTH] Locks on the same `configTarget`/`withFileLock` as `trustFolder`, so a concurrent trust + onboarding write on the same `.claude.json` serialise and cannot lost-update (iterations 1 and 2)
- [STRENGTH] Resolves the correct target file (default-account → `defaultAgentConfig()` ignoring the engine's `CLAUDE_CONFIG_DIR` per #2129; named → `<configDir>/.claude.json`), so no silent wrong-file no-op (iteration 1)
- [STRENGTH] Tests mutation-proven non-vacuous: a no-op `preacceptOnboardingInner` reddens all `#3383` tests; replace-not-merge reddens the merge/create-sequence tests; the undo test's phase-gated injection + `undoWrites === 1` proves the injection reaches the undo (iterations 1 and 2)
- [STRENGTH] The relaunch-ensure omission is correct, not a wedge: `hasCompletedOnboarding` is a per-account marker seeded once and never unset (no `forgetOnboarding`), so by re-trust time the config already carries it (iteration 1)

### Validation
Full JS suite (`node --test engine/*.test.js *.test.js`) ran, not skipped: **tests 8003 / pass 7857 /
fail 0 / skipped 146**, no FAIL-shaped lines. `diff_hash` in this file matches
`git diff origin/main...HEAD` (excluding this proof). End-to-end re-measured on the final code (theme
dropped): the real create sequence writes only the trust entry + `hasCompletedOnboarding`, and the
interactive launch reaches the ready composer with no theme picker and no trust prompt.

### Known gaps, disclosed rather than implied
- The **macOS** path is proven end-to-end here; the **Windows** wiring mirrors the same verified pattern
  and is unit-covered by the cross-platform `trust.test.js`, but cannot be exercised end-to-end from this
  Mac. It needs a real Windows retest (Baron / Homer own the clean Windows verify).
- The picker-suppression measurement is a property of one machine's shipped v2.1.278; a future Claude
  Code version could add another first-run prompt behind the theme picker. This closes the one wedging
  today; the plan says to walk a genuinely-clean first-run for any other new prompt.
- This gets the agent past onboarding TO the login screen; it is NOT the sign-in step (the separate
  connect flow, #3326/#3367).

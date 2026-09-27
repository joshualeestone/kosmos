---
pre_challenge: true
method: challenge-loop
branch: firstrun-focus-4082
diff_hash: 63b4716968ad5794138bbb5b2e7d2c22f7985b1a2805ce9269ff561fecff47a0
validation: passed
subdir_audit: passed
timestamp: 2026-09-27T05:41:30Z
iterations: 10
converged: true
---

# Challenge loop proof: firstrun-focus-4082 (#4082, first run keeps keyboard focus when a subscription sign-in finishes)

Ten blind reviews, alternating Opus and Sonnet. The ledger is in the plan `.claude/plans/firstrun-focus-4082-*.md`.
Validation rc=0 and subdir audit rc=0 at b7e0ba883 (first run). Both browser-check gates rc=0.

## Per-iteration findings
- Iteration 1 (Opus): 6 NEW.
  - [BLOCKER] The coarse browser-check gate failed CI. FIXED: render-firstrun-openai-sub-2621 now asserts focus on
    the box (it reads BODY on main).
  - [WARNING] GPT decided "lost" before a multi-second read. FIXED (Grok's order).
  - [WARNING] The box could be announced twice. FIXED.
  - [NIT] x2.
  - [CONVENTION] A trailer's wording. Noted.
- Iteration 2 (Sonnet): 3 NEW.
  - [CONVENTION] Gemini's step stayed pressable until the repaint. FIXED (collapse first).
  - [NIT] x2.
- Iteration 3 (Opus): 2 NEW.
  - [WARNING] The focused box was stale or empty during the read. FIXED (the sentence at connect time).
  - [NIT] Deferred to #4081.
- Iteration 4 (Sonnet): 1 NEW.
  - [WARNING] The FR_STEP guard polarity was inverted for the harness. FIXED; the harness has a real FR_STEP.
- Iteration 5 (Opus): 3 NEW.
  - [WARNING] The page-focus arm and the collapse were untested. FIXED.
  - [NIT] The order (focus, then sentence). FIXED.
  - [NIT] An empty finally. FIXED.
- Iteration 6 (Sonnet): 3 NEW.
  - [BLOCKER] Focus in GPT's re-shown picker fell to BODY. FIXED.
  - [WARNING] The winReady call was bare. Guarded.
  - [CONVENTION] Guard shape. FIXED.
- Iteration 7 (Opus): 5 NEW.
  - [WARNING] Skip, then Connect, fell to BODY. FIXED.
  - [WARNING] The order was untested. FIXED.
  - [NIT] x3. FIXED or left.
- Iteration 8 (Sonnet): 2 NEW.
  - [WARNING] No Gemini browser check. DEFERRED to #4081 (commented there).
  - [NIT] GPT catch. FIXED.
- Iteration 9 (Opus): 3 NEW.
  - [WARNING] The catch test swallowed the rejection. FIXED.
  - [NIT] A Gemini failed-repaint test. Added.
  - [NIT] winReady untested. Left.
- Iteration 10 (Sonnet): 0 NEW. CONVERGED. The reviewer mutation-checked the focus move and the catch.

## Evidence
- web.agy-on-3568.test.js and web.firstrun-focus-4082.test.js: each fix was mutation-checked (red without it).
- render-firstrun-openai-sub-2621 asserts focus on #fr-openai-msg in a real browser (BODY on main).
- The related first-run, Settings and Grok checks pass.

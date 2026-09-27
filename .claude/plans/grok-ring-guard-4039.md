# grok-ring-guard-4039: a Grok agent's first single-call turn shows its real context

Card: #4039 (Grok follow-up; #4039's main change merged as PR #4071, 65f5d9b9d).

## Problem (measured 2026-09-26, Grok Build 1.0.41, grok-4.6, three real turns on Agent1s)
- signals.json `contextTokensUsed` is Grok's own context gauge. Once a model call has returned it
  tracks the real prompt within 0.3% (40,783 vs 40,922; and 40,291 vs 40,341).
- Before the session's first call returns it holds a pre-call estimate without the system prompt and
  tools. A session whose only turn made ONE model call keeps it: 2,716 against a real 40,111, about
  15x low, so a fresh Grok agent's ring read ~0.5% instead of ~8%.
- usage.json `turns[].inputTokens` is a SUM over the turn's model calls (80,292 and 81,382 on two-call
  turns, about 2x), so it is never occupancy, except when `modelCalls` is 1.
- usage.json is written 27-63 ms before signals.json; a resume in a new process (`grok -r`) appends to
  the same usage.json.

## Change
- engine/groksession.js `singleCallFloor`: when usage.json holds exactly ONE turn and it made exactly
  ONE call, contextUsed = max(contextTokensUsed, that turn's inputTokens). Every other case, and any
  missing or malformed usage.json, keeps Grok's own figure. contextUsedAt stays signals.json's mtime.
- engine/groksession.test.js: the measured figures as fixtures; the multi-call sum, a one-turn two-call
  turn, a later single-call turn after a compaction, and absent/malformed/smaller usage.json.

## Rejected
- The last turn's inputTokens always: it doubles on every multi-call turn.
- The floor on any single-call last turn: after a compaction an old turn's prompt pins the ring high.

## Weakest premise
Three turns, one model, one Grok version. The lag mechanism is read from Grok's update stream, not its
source. A Grok that updates the gauge before the first call returns makes the floor a no-op.

## Review
Iterations 1-4 opus (converged at 4), iteration 5 sonnet (no BLOCKER/WARN; NIT: usage.json re-read on
every poll for a session's whole life -> FIXED: a per-process set of session folders seen past turn 1,
since turns only grow). Iteration 6 opus on that change.

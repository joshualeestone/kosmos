# Plan: #2257 — OpenAI/Codex context ring reads "Not yet read" (Claude agents show it)

## Problem
Josh, 0.6.35 staging: the context-window ring reads "Not yet read" with no
readout for an OpenAI/Codex agent (Ben the cat), while a Claude agent shows real
context. The OpenAI ring never fills. This is the OpenAI half of the ring; the
Claude half was #2406 (merged, PR #2415).

## Root cause (confirmed; traced by Baron + Renet, verified by me)
- Renderer is CORRECT (web/index.html ~11989 handles notYet / fill% / Unknown).
- `status.js` context assembly (~5079) calls `readContext` for EVERY tied pane.
  `readContext` reads a Claude `.jsonl` transcript. A Codex agent does not write
  one, so `transcriptFor` returns null and the ring lands on `notYet` regardless
  of activity. `status.js` never consulted the Codex rollout at all.
- `codexsession.js` computes the context WINDOW (from `task_started`) but left
  `contextUsed: null` deliberately — its author had not seen a real Codex run
  report token usage.

## The measurement that unblocked it (6 real gpt-5.6-sol rollouts, 2026-09-07)
Codex records usage on `event_msg` payloads of type `token_count`:
`info.last_token_usage` (the last turn) and `info.total_token_usage` (cumulative).
- Denominator = `model_context_window` (task_started) — MEASURED, not assumed.
- Numerator = last `token_count`'s `last_token_usage.input_tokens` = the last
  prompt = current window occupancy (held ~11.7k while cumulative `total_tokens`
  climbed 23k→39k). Cumulative `total_tokens` is the wrong field — it climbs past
  the window and never resets on a compaction.

## Fix
1. `codexsession.js`: fill `contextUsed` from the last `token_count` event's
   `last_token_usage.input_tokens`; update the "deliberately null" notes.
2. `status.js`: add `readCodexContext(agentName)` mapping `codexsession.read` into
   the standard ring shape (`tokens`/`percent`/`ceiling`/`ceilingAssumed:false`/
   `confidence:STRUCTURED`), and branch the context assembly on the same
   `isCodexPane` discriminator the account-badge gate uses. Reuse the
   provider-agnostic `notYetStarted`/`neverRecorded` split and shared `NO_READING`.

## Tests
`status.openai-ring-2257.test.js`: LAST token_count wins over cumulative; the fill
maps to a measured %; no rollout / no-usage-yet yields a null readout, never a
wrong number. Armed: all fail on old code.

## Scope / non-goals
- Reads the fill from a MATCHED rollout. `codexsession.forWorkdir` matches on
  `realpathSync` (resolves the `/private` twin, not case). A case-divergence there
  is the same #2406 class and is left to the canonicalOnDisk SWEEP (Splinter's
  post-launch hardening card), not widened here.
- Model number for OpenAI agents stays out of scope (#12, accepted).
- Non-gating; rides the 0.6.46 staging cut for Josh's single re-test. Verification
  is `needs-browser` at that re-test; the code path is unit-tested from a real-
  rollout-shaped fixture.

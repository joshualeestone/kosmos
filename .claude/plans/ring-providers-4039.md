# ring-providers-4039: the context ring for Gemini and Antigravity agents

Card: kosmos#4039 (Josh, 2026-09-26: "Context rings for Grok agents and Gemini agents don't work").
Findings, all measured on Agent1s, are on the card.

## Causes (measured)
- Gemini CLI: geminisession reads the tokens and model, but the transcript never states the
  window, so the arm returned measured-no-ceiling and the ring had nothing to draw.
- Antigravity: no reader at all (the #3568 placeholder refusal).
- Grok: NOT in this branch. The reader and the 1.0.41 field names check out; the one local session
  never completed a turn. Settling it needs a session listing from Josh's box (asked on the card).

## Change
- engine/agysession.js: agy's workdir -> conversation map, the SQLite db opened read-only, the
  newest NEWEST_GENS gen_metadata blobs decoded raw (model 1.19; prompt 1.4.2). agy records no window.
- engine/status.js: readAgyContext (the Gemini arm's shape); the agy model from the conversation;
  assumedGeminiWindow: a known Gemini text model's published 1,048,576-token window as an ASSUMED
  ceiling, stated on the ring, for both the Gemini CLI and agy arms.
- Occupancy is the newest prompt, the same fact the Codex and Gemini CLI readers use.

## Rejected
- Reading 3.13.2.22 as agy's window: it is an edit tool's 1 MiB config (iteration 1).
- Prompt + reply as occupancy: it made agy's ring mean something different from its siblings'.
- Unknown models guessed at 1M: they keep the honest no-ceiling reading.

## Weakest premises
- agy's field meanings are inferred from its blobs (the 1.4.3 = 1.4.9 + 1.4.10 identity holds in
  every generation), not documented; a fresh live conversation read correctly (12465 tokens).
- The window table is from Google's published limits as known today, not queried.

## Challenge-loop iterations
- 1 (opus): BLOCKER 3.13.2.22 is not a window; WAL companion files; 10-byte varints; per-poll cost;
  the window table too broad. All fixed; the card corrected.
- 2 (sonnet): WARNING occupancy diverged from Codex/Gemini (prompt+reply) --> prompt only;
  CONVENTION no plan file --> this file; NITs: the -latest aliases and -001 ids added; the count
  query noted as unbounded (cheap).

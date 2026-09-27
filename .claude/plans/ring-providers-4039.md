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
  assumedGeminiWindow: a known Gemini text model's 1,048,576-token window as an ASSUMED ceiling
  (marked assumed; the detail page's Memory box says so), for both the Gemini CLI and agy arms.
- Occupancy is the newest prompt, the same fact the Codex and Gemini CLI readers use.

## Rejected
- Reading 3.13.2.22 as agy's window: it is an edit tool's 1 MiB config (iteration 1).
- Prompt + reply as occupancy: it made agy's ring mean something different from its siblings'.
- Unknown models guessed at 1M: they keep the honest no-ceiling reading.

## Weakest premises
- agy's field meanings are inferred from its blobs (the 1.4.3 = 1.4.9 + 1.4.10 identity holds in
  every generation), not documented; a fresh live conversation (4bd5c46f, 19:01 on Agent1s) read
  correctly: 12407 prompt tokens (reply 58; 12465 was the rejected prompt+reply), gemini-3.8-flash.
- The window table is from Google's published limits as known today, not queried, and ANY later
  3.x text model (3.8 on agy) is assumed to keep 1M: a guess, which is why it is only assumed.

## Challenge-loop iterations
- 1 (opus): BLOCKER 3.13.2.22 is not a window; WAL companion files; 10-byte varints; per-poll cost;
  the window table too broad. All fixed; the card corrected.
- 2 (sonnet): WARNING occupancy diverged from Codex/Gemini (prompt+reply) --> prompt only;
  CONVENTION no plan file --> this file; NITs: the -latest aliases and -001 ids added; the count
  query noted as unbounded (cheap).
- 3 (opus): BLOCKER the NONE_BASE family count went 16 -> 17 and render-talk-goldencard pins it (the
  full suite had not been run) --> updated in every copy; WARNINGs: agysession.HOME ignored the
  AGENT_WORKFORCE_HOME sandbox (and agytrust derived the dir a second time) --> fixed, one
  derivation; the table covered 2.0 Pro (2M) and unreleased 3.x --> 2.0 Pro out, the 3.x
  assumption stated; "stated on the ring" --> the Memory box states it. NITs: lastAt from the WAL
  file too; a self-contained gate control; 1318 is an id, not cached tokens (card corrected).
- 4 (sonnet): agytrust loaded status.js on every agy launch (173ms) --> agy's dir derived once in
  agytrust (agyHome), agysession imports it (1ms); the supervisor's default path tested; CLAUDE.md.
- 5 (opus): lastAt counted an empty -wal (our own read) as activity --> ignored; no test told newest
  from largest prompt --> a compaction fixture; this plan quoted prompt+reply --> 12407; a stale
  "ring says so"; test temp dirs moved under the sandbox; agyDirUnder makes the one derivation true;
  readAgyContext carries the Gemini arm's residual note.

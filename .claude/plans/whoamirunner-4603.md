# whoamirunner-4603: whoami names a Grok (Gemini) agent's model and account (#4580 item 12)

Card: joshualeestone/kosmos#4603. The Grok agent: "kosmos whoami cannot name the Grok model or account, even when
the session is Grok 4.6 on a connected xAI subscription."

## Traced on main
- Runner: named, but "a grok agent" / "a gemini agent" (runnerDisplayName had no entry for either).
- Model: always null for Grok, Gemini, Antigravity. The live reader (runningas) knows only claude and codex, and the
  card's own session model (status.js readGrokSession etc. -> card.model, what the board shows) was never consulted.
- Account: the route looked the agent up in the Claude account list only, so an xAI (or Google) account was never found.

## Done
- runnerDisplayName: Grok, Gemini.
- whoamiFor model: after the transcript (Claude only) and the live read, a non-Claude agent takes card.model, source 'session'.
- The route's account list adds grokaccounts and geminiaccounts rows (accountForAgent matches a keyed row only for an
  agent of that provider, so Claude and Codex answers cannot change).
- keyTail carried in all three account constructions (parity test) and a sentence rung: "the API key ending in ABCD".

## Decided
- Reuse the card's model rather than a new session read in whoami: one reader, and the words match the board.
- OpenAI rows are NOT added to the list: Codex answers are pinned by many tests and were not asked about.

## Weakest premise
card.model is from the Grok session file, which follows a mid-session /model switch only when Grok Build rewrites
summary.json; if it lags, whoami says the older model, as the board does.

## Tests
server.whoami-grok-4603.test.js (4): three fail on main (measured), the Claude control passes on both. server.test.js 344/344.

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
- whoamiFor model: after the transcript (Claude only) and the live read, a non-Claude agent takes card.model, source
  'session', only when card.runner equals the resolved runner (after a provider switch the job names the new runner
  while the card still describes the old pane and its model). Confidence `structured` (a purpose-written session file).
  This also changes Codex: a Codex agent whose live read failed, or answered without a model (the common case, since
  Codex is launched without --model), now names its card model instead of "we cannot tell".
- The route's account list adds grokaccounts and geminiaccounts rows. accountForAgent's default (dir-less) arm matches a
  keyed row only for an agent of that provider; its dir-match arm is ungated, so a Claude or Codex answer is unchanged
  because the account folders differ (~/.claude*, ~/.codex*, ~/.grok*, ~/.gemini*), not by code. A route-level control
  pins a Claude agent's answer with both keyed accounts on disk.
- keyTail carried in all three account constructions (parity test) and a sentence rung below name, email and label:
  "the API key ending in ABCD". accountForAgent is also /api/status's, so board cards gain `keyTail: null` (unread).

## Decided
- Reuse the card's model rather than a new session read in whoami: one reader, and the words match the board.
- /api/status still passes the Claude account list only, so the board's per-agent account for a Grok agent stays empty
  while whoami names it. Not changed here: widening /api/status touches every card render; a follow-up if wanted.
- OpenAI rows are NOT added to the list: Codex answers are pinned by many tests and were not asked about.

## Weakest premise
card.model is from the Grok session file, which follows a mid-session /model switch only when Grok Build rewrites
summary.json; if it lags, whoami says the older model, as the board does.

## Tests
server.whoami-grok-4603.test.js (10), including a Grok model read end to end from a real summary.json through the route.
Mutations: dropping the runner-agreement guard, the Gemini lister, or the card-model rung each fail tests. server.test.js 344/344.

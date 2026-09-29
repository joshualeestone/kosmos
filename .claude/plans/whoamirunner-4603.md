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
- whoamiFor model: after the transcript (Claude only), and ABOVE the live launch argument (the session file follows a
  mid-session /model switch; the launch argument does not), a non-Claude agent takes card.model, source
  'session', only when card.runner equals the resolved runner (after a provider switch the job names the new runner
  while the card still describes the old pane and its model). Confidence `structured` (a purpose-written session file).
  This also changes Codex: a Codex agent whose live read failed, or answered without a model (the common case, since
  Codex is launched without --model), now names its card model instead of "we cannot tell".
- The route's account list adds grokaccounts and geminiaccounts rows. accountForAgent's default (dir-less) arm matches a
  keyed row only for an agent of that provider; its dir-match arm is ungated, so a Claude or Codex answer is unchanged
  because the account folders differ (~/.claude*, ~/.codex*, ~/.grok*, ~/.gemini*), not by code. A route-level control
  pins a default-account Claude agent (with a launch job, so the default arm is reached) with both keyed accounts on disk;
  it fails when the default arm's keyed-row gate is removed.
- keyTail carried in all three account constructions (parity test) and a sentence rung below name, email and label:
  "the API key ending in ABCD". accountForAgent is also /api/status's, so board cards gain `keyTail: null` (unread).

## Decided
- Reuse the card's model rather than a new session read in whoami: one reader, and the words match the board.
- /api/status still passes the Claude account list only, so the board's per-agent account for a Grok agent stays empty
  while whoami names it. Not changed here: widening /api/status touches every card render; a follow-up if wanted.
- OpenAI rows are NOT added to the list: Codex answers are pinned by many tests and were not asked about.

## Limits
- A paneless card has no runner, so a paneless Grok/Gemini/Antigravity agent still gets "we cannot tell which model".
- The card carries a model only for a tied pane whose session has been read, and card.runner is 'codex' only from a
  recorded @kosmos_runner marker; a Codex agent with no recorded marker keeps the launch-argument answer (fails safe).

## Review
challenge-loop: 4 blind rounds (default, Sonnet, default, Sonnet), converged at round 4. Full validation NOT run:
held by Splinter 12:50 (run-tests.sh queue deadlock, #4574); proof file follows validation.

## Weakest premise
card.model is from the Grok session file, which follows a mid-session /model switch only when Grok Build rewrites
summary.json; if it lags, whoami says the older model, as the board does.

## Tests
server.whoami-grok-4603.test.js (11), including a Grok model read end to end from a real summary.json through the route.
Mutations: dropping the runner-agreement guard, the Gemini lister, or the card-model rung each fail tests. server.test.js 344/344.

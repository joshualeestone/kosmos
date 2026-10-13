# accounts-6108: accounts at a glance, slice 1 (kosmos#6108)

## Done when (slice 1)
Settings > AI Models: each Claude account row shows (a) its weekly limit used as a meter and "N% of its weekly limit
used · resets <day time> · as of <age>" when Kosmos has a reading, or "No usage reading for this account yet." when
it does not (no meter for an API key); (b) a warning at 75% or more; (c) its agents on this computer by display name;
(d) "Move them to…" that moves each of those agents to the picked Claude account through the existing per-agent
route and says how many moved and why any did not. Tested: server route test and a browser check, both proven red on
main.

## Engine
GET /api/accounts Claude rows gain `weekly: {usedPct, resetsAt(ms), at(ms)} | null` (allowance.readWeekly) and
`agentsHere: {names, complete}` (enumerateAgentsOnAccount, runner 'claude').

## Decisions
- Show only what Kosmos knows; say plainly when there is no reading. Rejected: estimating % from token counts.
- Thresholds: warn at 75% (the card's number), red meter at 90%.
- Move = the existing one-agent route in a loop, not a new bulk route: one tested path, the engine's own refusal
  sentence per agent. Rejected: a server bulk route (more surface for slice 1).
- Targets exclude rejected/signed-out accounts; the engine still refuses a target without shared memory and the row
  shows that sentence.
- Weakest premise: the weekly reading is only as fresh as the last running agent on that account, so the row shows
  "as of <age>".

## Not in slice 1 (follow-ups after it ships)
Default ~/.claude reading (no statusline), the 5-hour limit, OpenAI/Gemini/Grok percentages, Windows, agents on other
computers, a bulk route.

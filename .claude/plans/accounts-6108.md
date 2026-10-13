# accounts-6108: accounts at a glance, slice 1 (kosmos#6108)

## Done when (slice 1)
Settings > AI Models: each Claude account row shows (a) its weekly limit used as a meter and "N% of its weekly limit
used · resets <day time> · last changed <age>" when Kosmos has a reading, or "No usage reading for this account yet." when
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
- Targets: other Claude accounts with shared history (as the agent page's picker requires, #1492) that are not
  signed out or refused. Any other refusal is the engine's own sentence, said once per reason.
- Weakest premise: the reading only moves when an agent on that account runs and its usage rises (the statusline
  records a change, not a look), so the row says "last changed <age>", never "as of".
- The warning's "Move its agents" sentence appears only when a move is offered.
- The default account (no statusline) says "Kosmos cannot read usage for this account."; others without a reading
  say "No usage reading for this account yet."
- A finished move's sentence stays until the first repaint after two minutes; the restart is said beside the control
  before the click and in the result after; focus goes to the row's menu, or its sentence when the menu is gone.

- Move's border is --gold-bright like Sign in again's (1.95:1 on white, under the 3:1 control-edge floor). Kept
  deliberately: Josh reverted the --gold-edge fix on Sign in again (2026-08-26), and this button follows that ruling
  rather than diverging from its sibling. Revisit both together if he changes it.
- The setup guide is left out by the server (the shared walk checks the guide marker, as isSetupGuide does), not only
  by the page's cached list.
- Progress shows on the button; the live region speaks once, with the result. Each move times out after 60 s.

- One shared walk (agentsByAccountWalk) behind both the account guards (count every agent) and this list (skips
  the setup guide), so they cannot drift.
- A move that times out is "No answer yet", not a failure (the route works before it answers).

- A full target (100%) is not offered, and the "Move its agents" sentence needs a target with room.
- A saved-but-not-restarted agent is "Not restarted yet (Name): <the engine's own sentence>". Refusals are grouped by
  their exact sentence, so they merge only when the engine words them the same (its sentences often name the agent).

- No confirm step before a bulk move (the agent page's own Move has none; the card asks for a quick move before the
  limit). The note beside the control says how many restart, before the click, and that a stopped agent is moved but stays
  stopped (the account route never starts a dead agent; engine/remove.js keeps that a separate decision).
- Cost: the accounts list now walks the agents once per request. The route is press-driven by contract (server.js:
  "every caller is A PERSON PRESSING SOMETHING ... a TIMER is not"); follow-up reads stop at ACCT_FOLLOWUP.max (6).

- "Cannot read" only when the server knows why (weeklyBlocked: 'windows', or 'own-statusline' when the account's
  settings hold a status line that is not Kosmos's). The default account is wired by the installer, so it waits for a
  reading like any other.
- A stopped agent's move comes back 'partial' from the route (it never starts a dead agent); for an agent stopped at
  the click AND an engine sentence saying it is not running, the page counts that as moved and says it stays stopped
  (any other partial keeps the engine's words). A server test pins that reply. An agent of unknown state gets no restart count.

## Not in slice 1 (follow-ups after it ships)
- A bulk move blocks the server once per agent (removal.restart runs inside the route); a bulk route could batch it.
- After a 'partial' move the server already lists the agent under the new account, though it still runs on the old
  one until it restarts.
Default ~/.claude reading (no statusline), the 5-hour limit, OpenAI/Gemini/Grok percentages, Windows, agents on other
computers, a bulk route.

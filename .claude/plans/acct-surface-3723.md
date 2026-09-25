# Plan: #3723, tell the person about a blocking account problem where they look

## Finished looks like
When an agent is stopped by its account (out of credits or a usage limit, a sign-in that stopped
working), the person learns it without opening Advanced:
- the agent's card names it in plain words (for Codex too, which today reads Idle or Can't tell);
- the agent's own Direct Message thread shows one Kosmos line saying what happened and the one thing
  to do, with the link, for as long as the problem lasts, and it goes away when it is fixed;
- the person's project manager is told once per incident, in its own conversation, so it can say so.
Screenshots of today's display and the new one go on the card for Josh.

## Why
Josh 2026-09-25 06:55, relaying a user: "Today I ran out of open AI credits for the first time. And I
couldn't figure it out. Then I found the advanced window on my primary agent." Josh: any project
manager should surface it immediately, as well as the agent.

## Measured (2026-09-25, before building)
- Codex (0.x installed here) shows these, read from its own program text:
  "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits",
  "You've hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus)",
  "You've hit your usage limit. To get more access now, send a request to your admin",
  "You've hit your usage limit for ..." then "Try again at ...",
  "Your workspace is out of credits. Ask your workspace owner to add more.",
  "You've reached your workspace credit limit".
  Kosmos recognises none of them: a Codex pane's classify arm knows only needs_you, working and idle.
- Claude: rate_limited exists for two phrasings ("reached your ... limit", "/usage-credits");
  auth_failed exists; connection_lost exists with the #3410 self-heal.
- The DM thread has no Kosmos-voice row. The closest match to "one line, cleared when resolved" is
  chat.withQuestionRow, a synthetic row computed on each read and not stored.
- There is no "primary agent" field. The manager is profile.reportsTo if set, else a project member
  whose role reads like a manager (chat.looksLikeManager; not chat.defaultAgentFor, which falls back
  to the first member and would interrupt an ordinary colleague).

## Change (one PR, both halves Josh asked for)
1. engine/status.js: Codex's usage and credit messages (CODEX_LIMIT_MARKERS, from Codex's own program
   text) read as rate_limited on a Codex pane, above idle (Codex redraws its prompt under the message)
   and below working, counted only in the last 12 rows (an old line up the scrollback does not hold a
   recovered agent). reconcileReport: Codex's AUTOMATIC end-of-turn idle cannot hide it (a failed turn
   still ends); an agent's own report, and every Claude case, behave as before.
2. engine/accountproblem.js: the one reading of a card into "which account problem, in words"
   (usage/credits, or a sign-in that stopped working), quoting the vendor's own sentence and link.
3. The agent's DM: chat.withAccountRow adds one Kosmos line from that reading on every thread read
   (not stored, like the question row), so it is one line and clears itself; the page draws it as
   Kosmos's band with the vendor's link clickable.
4. The manager: engine/accountnotify.js, a ~1-minute sweep beside the #3410 one (same gating, brake
   AGENT_WORKFORCE_ACCOUNT_NOTIFY_OFF=1). Seen on 2 sweeps, then ONE message typed into the manager's
   conversation asking it to tell the person; recorded in account-notices.json under the data root so
   a restart does not repeat it; the incident ends after 10 minutes without the problem. The manager
   is profile.reportsTo, else a project member whose role reads like a manager; never the agent itself,
   and only typed into a manager that is idle or working. The notice carries Kosmos's own words only,
   never screen text. An unconfirmed delivery counts as told (never twice). No manager: recorded once.
5. The DM line's links: only known vendor hosts are clickable, and no preview is fetched for it.

## How firm each reading is
A Codex usage limit is Codex's own sentence at the START of a row (a line that merely mentions it,
from an answer or a search, does not count), so it is said plainly and its manager is told. Every other
usage-limit reading goes through Claude's "reached your ... limit" pattern, which has a known false match
kept on the card, so it is said as "It looks like ...", "context" is dropped, and no manager is
interrupted for it. A sign-in that stopped working (Claude's own error text) is firm.

## Not in this PR, recorded
- The Issue tile does not count a usage limit or a failed sign-in (engine/status.js needsPerson); the
  card says Paused and the DM and manager say it. Worth a follow-up with the design owner.
- connection_lost after the #3410 self-heal gave up (the reconnect phase lives in the route, not the
  board card the sweep reads).
- Gemini and Grok limit wording (their panes read through the Claude arm; nothing measured yet).
- Windows: none of these states are scraped there today.
- "Nearly out" warnings: Codex prints usage percentages, but no threshold is measured yet.

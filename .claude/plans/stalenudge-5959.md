# stalenudge-5959: an agent is told once when its blocked report has stood a day (#5959 slice 3)

Card: joshualeestone/kosmos#5959, item 4 of the Windows agents' QA report: "Point out a stale self-reported state to the
agent after a day or two (one agent carried a 'blocked' from 09-26)." Slice 1 (`reportshow-5959`) says it when the agent
runs `kosmos report show`; this says it without being asked. Stacked on slice 1 (it uses its `STALE_WAIT_MS` and
`cardlabel.standingFor`), so it merges after slice 1.

## The call
- `engine/stalereport-nudge.js`, the shape of `firstreply-nudge.js`: a pure `plan`, an injected `sweepOnce`, a gated
  `makeTick`. Told: a Claude card of ours reading `blocked` that shows the agent's report (`stateReported`), whose latest report
  (`selfreport.read`) is `blocked`, not written by Kosmos, over `selfreport.STALE_WAIT_MS` (a day) old with the comparison
  report show uses, not mid-turn (`activeWhileWaiting`: a later sweep tells it), and whose swarm is not switched off.
- Once per report line, kept on disk: `stalereport-reminded.json` under the data root (session -> the report's `at`,
  an entry dropped only when its agent is off the board and its report over 30 days old), so a board restart or an update does not repeat it; a write that
  fails is logged, since a restart may then repeat it. A fresh report starts a new day. A delivery that reached nothing
  is retried up to MAX_TRIES (3, in memory), and the give-up is logged; an unconfirmed delivery counts as reached.
- A held delivery (deliverAutomatic's holds: an answer awaited on screen, a usage limit, a quota, the Gemini cap)
  spends no try and is logged once per report with what held it.
- The words are `kosmos report show`'s for a blocked report ("Your own" for the agent's, "This" for anyone else or no
  writer), then how to see the card. The report's own `on` text is not repeated to the agent.
- server.js: its own timer (5 minutes), gated like the sibling sweeps: live execution allowed, brake
  `AGENT_WORKFORCE_STALEREPORT_NUDGE_OFF=1`, typed through `chat.deliverAutomatic` (pinned in
  `server.agyhold-4588.test.js`'s AUTOMATIC table with the other timers).

## Rejected
- **needs_you.** It is a question waiting on the person. For a runner other than Claude nothing holds a typed line out
  of an open question (chat's menu hold is Claude-only), so the reminder would be taken as its answer (an Antigravity
  agent reports needs_you from a live ask_question). Review 3.
- **Runners other than Claude, and agents reached through a channel (Windows).** The screen check below knows Claude
  Code's screens only, and a channel-reached agent's screen cannot be read from here. `kosmos report show` still names
  a stale report for them. Reviews 4 and 6.
- **Relying on deliverAutomatic's menu hold.** It reads the screen only for a needs_you or working card, never for the
  blocked cards this sweep types to (review 6). So the sweep reads the screen itself first (`screenOpen`: the safeguards
  menu, a question menu, the usage-limit menu, a permission prompt, or an unreadable screen, with status.js's readers) and types nothing then;
  no try is spent and it is logged once per report.
- **Inside agentnudge (the Prompter's stall nudge).** It deliberately leaves out blocked agents and is keyed on idle
  stall episodes; a stale report is a different trigger.
- **Repeating it daily.** Once per report is what the card asks; a repeat would nag an agent that is rightly waiting.

- **A report Kosmos wrote** (`by: auto`). For a Claude agent the only automatic blocked is the StopFailure hook's
  provider failure (`provider api (<kind>)`): while the provider still fails, the turn a reminder starts fails and writes
  a fresh report, so it would be reminded once a day for the outage. Reviews 7 and 9.

## Weakest premises
- The cost of leaving out Kosmos-written reports: an outage blocked is the stickiest report there is (nothing automatic
  may overwrite a standing blocked, selfreport.record), so after the provider recovers it can stand for days and is
  pointed out only if the agent runs `kosmos report show`.
- Windows agents (reached through a channel) are not reminded: the QA report came from them, so item 4 stays open for
  Windows beyond slice 1's report show. Say so on the card when this ships.
- A record file that cannot be read is treated as empty, and the next write keeps only the new entry, so every earlier
  reminder can repeat once after the following restart.
- The screen is read, then the line is typed: a menu that opens between the two is not seen (the same window the
  sibling sweeps have). So "nothing typed while a menu is open" holds for what the read saw, not for that instant.
- A reminder starts a model turn, which costs tokens: once per stale report per agent.
- The retry count is in memory, so a restart allows three more tries that reach nothing.
- A board restart can remind every eligible agent in one sweep (about five minutes after boot), once each, since the
  record keeps it from repeating.
- The card's example is a `blocked` report; a stale `needs_you` goes unmentioned here (report show still names it).

## Tests
- `engine/stalereport-nudge-5959.test.js`: real fleet cards with injected reports; once per report and across a
  restart (record on disk under the sandboxed data root, pruned only when off the board and old), needs_you never,
  by:auto in its own words, mid-turn waits, "This" for other writers, the
  exact-day boundary, controls (under a day, the card not showing it, set aside by reconcile, working, paused, not
  ours), retries and give-up, unconfirmed, holds, the gate, the server wiring. Mutations checked red: card shows it,
  once, paused, the day, needs_you (the card filter; the report filter is also backed by the state match), Claude-only, prune, record-log, mid-turn, the persisted record, unconfirmed, held-once.

# stalenudge-5959: an agent is told once when its own waiting report has stood a day (#5959 slice 3)

Card: joshualeestone/kosmos#5959, item 4 of the Windows agents' QA report: "Point out a stale self-reported state to the
agent after a day or two (one agent carried a 'blocked' from 09-26)." Slice 1 (`reportshow-5959`) says it when the agent
runs `kosmos report show`; this says it without being asked. Stacked on slice 1 (it uses its `STALE_WAIT_MS` and
`cardlabel.standingFor`), so it merges after slice 1.

## The call
- `engine/stalereport-nudge.js`, the shape of `firstreply-nudge.js`: a pure `plan`, an injected `sweepOnce`, a gated
  `makeTick`. Told: a card of ours whose state is needs_you or blocked, whose latest report (`selfreport.read`) is that
  same state, written at least `selfreport.STALE_WAIT_MS` (a day) ago, and whose swarm is not switched off.
- Once per report line: the book keys on the report's `at`. A fresh report of the same state starts a new day. A
  delivery that reached nothing is retried up to MAX_TRIES (3); a held delivery spends no try.
- The words are `kosmos report show`'s for the same report (own / written by Kosmos / other), then how to see the card.
  The report's own `on` text is not repeated to the agent.
- server.js: its own timer (5 minutes), gated like the sibling sweeps: live execution allowed, brake
  `AGENT_WORKFORCE_STALEREPORT_NUDGE_OFF=1`, typed through `chat.deliverAutomatic`.

## Rejected
- **Inside agentnudge (the Prompter's stall nudge).** It deliberately leaves out blocked and needs_you agents (a blocked
  agent reported it is waiting) and is keyed on idle stall episodes; a stale report is a different trigger.
- **Repeating it daily.** The card asks for it pointed out; once per report is the floor, and a reminder that repeats
  would nag an agent that is rightly still waiting.

## Weakest premises
- The book is in memory: a board restart reminds a still-stale agent once more.
- A Kosmos-written report (by: auto) is included, as slice 1's report show does. A #5948 sign-in report on Windows is
  one: the reminder says to clear it only "if what it was about has passed".

## Tests
- `engine/stalereport-nudge-5959.test.js`: real fleet cards with injected reports; once per report, a fresh report
  waits a day, controls (under a day, the card not showing it, working, paused, not ours), retries and holds, the gate,
  and the server wiring. Mutations checked red: the card-shows check, once, paused, the day threshold.

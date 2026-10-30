# #7374: the board asks one idle agent a day to write the product-feedback report

**Branch:** `fbnudge-7374` · **Card:** kosmos#7374 · **Go:** Splinter 2026-10-27 13:42 CDT, under Josh's default-on ruling for the daily report (#2037, #2013).

## The defect

Sending the daily report is on by default and wired (`engine/feedbacksend.js`, `sweepTick` on the board loop), but a report exists only if an agent runs `kosmos feedback write`. The only instruction to do so was the "Once a day" block in the Project Manager role (`engine/roles.js`, 2026-09-05). No other role has it and no sweep reminds anyone. Telemetry 10-27: 122 new real installs in 7 days, reports from 8.

## The change

1. `engine/feedbacknudge.js`: a pure planner plus a tick, on the pattern of `engine/stalereport-nudge.js` (injected reads and delivery, a record on disk, tries in memory).
2. Gates: sending on and readable; no report today; 17:00 local or later; an agent seen working today (kept on disk) or on an unobservable provider.
3. Candidates: idle cards of ours, never the setup guide (fail closed), Project Manager, then Director, then roster order. Held, busy or refused passes to the next; quiet hours and the usage cap stop the tick without a try; a throw counts as maybe reached.
4. Once asked, `{ date, session }` is written to `feedbacknudge.json` under the data root.
5. The line names the cost (one turn on the person's AI account) and the opt-out (Settings, Automation).
6. `server.js`: its own unref'd 10-minute timer, gated like the sibling nudges, brake `AGENT_WORKFORCE_FEEDBACK_NUDGE_OFF=1`.
7. `engine/roles.js`: the PM block's closing sentence says the report is sent, matching the ask.

## Tests

`engine/feedbacknudge-7374.test.js`: real fleet rosters, roles from the real template line, injected delivery, a sandboxed data root. Each gate has a control that opens it. Focused run on the rebased head: 57 files, 2388 pass, 0 fail.

## Not covered

A real board at 17:00 asking a real agent, which writes, and the report sends: observed after merge, on the card.

# kosmos#8548: a "while you were away" digest at a restart

Card: an agent back from hours offline (here, after the host crashed) has no single place showing what it missed. Ask:
at restart, a digest of room posts and direct messages addressed to it since its last turn, shown once.

## Measured on main 6863762fc6 (the card is live)
- A restart types only `hello` (web/index.html autoHelloAfterRestart) or the handoff pickup line
  (engine/handoff-restart.js pickupPrompt); a supervisor relaunch (bin/agent-supervisor.sh) types nothing.
- The SessionStart hook only reports `started` (install/kosmos-report-hook.sh SessionStart branch;
  engine/kosmos-report-hook.js reportFor), printing a systemMessage only when that report fails.
- While the pane is down, room posts and DMs are refused at once (chat.addressable -> COULD_NOT) and kept only in the
  message log (engine/messages.js readLog: `kind:'post'` rows {id, project, from, to[], text, at, outcomes},
  `kind:'message'` rows {id, from, to, text, at, state}, `kind:'refused'` rows {from, to, because, at}) and the person's
  DIRECT thread (engine/chat.js readThread('@you', agent): the person's rows have no `from`).
- roomhold's "While you were away" line serves a REACHABLE busy agent, per project, at `idle` or a typed arrival, never
  at `started`.
- Claude Code SessionStart `hookSpecificOutput.additionalContext` reaches the model at startup: measured 11-14 with
  `claude -p --settings <throwaway>` (hook gave a code word, the model repeated it; control without the hook said NONE).

## Call
At a real startup (SessionStart, source `startup` or absent), BEFORE the `started` report, the hook asks the board for
a digest and prints it as SessionStart additionalContext. Nothing is typed; no turn is spent.

Window: from the agent's LAST report before this startup (when the board last heard from it; a person's clear,
`by: 'operator'`, does not count) to now, clamped to 7 days. No earlier report, or nothing in the window: no output.
Shown once by construction: the next startup's window begins after this session's own reports, so no acknowledgement
state is kept. Run by hand (`kosmos away`), the window is rebuilt from the report before the session's newest
`started`, ending at that `started`, so it shows what the hook gave.

A room post counts only when its outcome for the agent is `could_not` (the room tried to reach it and could not).
`placed` was typed into its pane; `quiet` the room never tried to type to it (it did not address the agent, or the loop
cap held it), so it is not counted either way: `kosmos room` shows every post. So a post that named the agent while the
room's loop cap was spent is not shown. The person's DMs count only when their own delivery state is could_not (one held for a limit or sign-in is typed
later, and a duplicate copy was sent once as the other).

Contents (bounded, ids not text, so no colleague's words are handed over as instructions):
- per project: how many room posts could not reach it, and the ids of those that name it (engine/messages.js namedIn:
  `mentioned` and `addressed`) or come from the person (at most SHOWN ids, then "and N earlier"); ends with
  `kosmos room <id>`;
- `kosmos msg`: refusals to it, for any reason, as "at least N" (logRefusedSend keeps one row per sender, recipient and reason in a
  window); senders named; it says to ask the sender. A message row is written only for one typed into a running pane
  or held for one, so it is not counted;
- the person's DMs to it in the window: count; ends with `kosmos inbox --since <window start> --limit 50`.
Kosmos's voice, saying it is a summary of what arrived while the agent was not running, not a request from the person.

## Pieces
1. engine/awaydigest.js (new): pure `windowFrom(history, { startup, nowMs })` and
   `build({ name, sinceMs, untilMs, rows, direct, namedIn })` -> { lines, counts, clamped }, `contextText`, `hookJson`
   (SessionStart). Mention rule: messages.namedIn, passed in by the route.
2. Last-seen time: engine/selfreport.history (the agent's report rows); the hook calls BEFORE `started` is recorded.
3. server.js: `GET /api/away?as=hook|text&at=startup` (loopback agent route like /api/file-notices/take: added to
   LOOPBACK_AGENT_ROUTES), sender resolved the same way (token first, then pane; bare pane refused on an enforcing
   board). `as=hook` answers the hook JSON or an empty body, on every failure too. Nothing is cleared.
4. install/kosmos: `kosmos away --hook` (1 s cap, prints only the hook JSON) and `kosmos away` (the text, for a person
   or an agent by hand).
5. install/kosmos-report-hook.sh SessionStart branch: call `kosmos away --hook` after the source guard and before
   `report started`; print it only when it starts with `{"hookSpecificOutput":`. If the started report then FAILS, print
   only the systemMessage (reporting being off matters more; one JSON object on stdout).
6. engine/kosmos-report-hook.js: Windows asks AFTER a recorded `started`, without `at=startup` (the window this startup
   had). Before `started` the route cannot tell who is asking on Windows: the roster row appears only once Claude Code
   registers the session, and the heartbeat is stale after an absence; `started` beats liveness (kosmos#8372). Only with
   an agent token (the hook never sends a pane).

## Tests (new file engine/awaydigest-8548.test.js, plus the hook tests that already cover SessionStart)
- window: rows before the last report and after now are left out; no last report -> nothing; >7 days -> clamped and said.
- own posts not counted; @-named and person posts listed by id; cap and "N earlier".
- refused and delivered `kosmos msg` rows counted; person DMs counted; nothing -> '' and no JSON.
- the route refuses a caller without its own token on an enforcing board; returns '' on any failure.
- the bash hook prints the JSON before `report started` and prints only the systemMessage when the report fails
  (controls that can fail: a mutant that skips the call, one that prints both).

## Rejected
- Typing the digest into the session: a turn on every restart, racing the `hello` / handoff line.
- Reusing engine/filenotices.js: worded for file owners, 10-notice cap, 24 h expiry; a digest is built on demand.
- Queuing undelivered posts to type later: re-wakes agents on posts the room has answered (#4624/#4926).

## Weakest premise
"Last report = last seen." It errs both ways: an agent whose reporting broke before the crash gets a window that starts
too early (more shown); a working agent's last report is a heartbeat, so a post typed into its busy pane after that
heartbeat and lost in the crash was `placed`, not `could_not`, and is not shown (less). The digest is a summary of
what could not reach the agent, not a full replay; the room log stays the record.

## Not covered (stated)
- An interactive (non -p) startup was not measured for additionalContext; Windows only by its own CI.
- The Mac hook asks before `started`, and that the board can tell who is asking then is reasoned, not measured: the
  `started` report a moment later resolves its caller by the same path (token, then pane) with the same roster. If it
  cannot, the digest is silently not shown (an empty body), never wrong.
- By hand, a report record longer than the history read (4 MB) can hold the newest `started` but not the report before
  it, so the window starts later than it should (fewer shown), or says it cannot tell.
- A `kosmos msg` refusal is counted for any reason (a sender's own malformed message too); matching the not-running
  reasons would be a second copy of the refusal sentences that drifts. The line says "for any reason".
- Windows: an agent that dies under a living supervisor is relaunched with `claude --resume <id>`
  (engine/win32supervisor.js), so SessionStart says `resume` and no digest is asked (the `started` report is skipped
  on a resume for #1058, and so is this). Only a fresh `startup` gets one. A follow-up could treat a supervisor resume
  as a return.
- Agents on runners without Kosmos's Claude Code hook (codex, gemini, grok) get nothing from this slice.

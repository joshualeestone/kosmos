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

Window: from the agent's LAST report before this startup (when the board last heard from it) to now, clamped to 7 days.
No earlier report, or nothing in the window: no output. Shown once by construction: the next startup's window begins
after this session's own reports, so no acknowledgement state is kept.

Contents (bounded, ids not text, so no colleague's words are handed over as instructions):
- per project the agent is on: how many room posts arrived from others, and the ids of those that @-name it or come
  from the person (at most SHOWN ids, then "and N earlier"); ends with `kosmos room <id>`;
- `kosmos msg` messages to it in the window (delivered or refused): count and senders; ends with how to read them;
- the person's DMs to it in the window: count; ends with `kosmos inbox --since <window start>`.
Kosmos's voice, saying it is a summary of what arrived while the agent was not running, not a request from the person.

## Pieces
1. engine/awaydigest.js (new): pure `build({ name, sinceMs, nowMs, projects, rows, direct })` -> { lines, counts } and
   `contextText(digest)`, `hookJson(digest)` (SessionStart). Mention rule: reuse whatever messages.js / roomhold uses for
   "names you" (find it; do not write a second one).
2. Last-seen time: find where the board keeps an agent's latest report (engine/status.js or the /api/report handler in
   server.js); the digest route reads it BEFORE `started` overwrites it. Ordering is the hook's job (call first).
3. server.js: `POST /api/away/take?as=hook` (loopback agent route like /api/file-notices/take: add to
   LOOPBACK_AGENT_ROUTES), sender resolved the same way (token first, then pane; bare pane refused on an enforcing
   board). Answers the hook JSON or an empty body; never throws; any failure is an empty body.
4. install/kosmos: `kosmos away --hook` (1 s cap, prints only the hook JSON) and `kosmos away` (the text, for a person
   or an agent by hand).
5. install/kosmos-report-hook.sh SessionStart branch: call `kosmos away --hook` after the source guard and before
   `report started`; print it only when it starts with `{"hookSpecificOutput":`. If the started report then FAILS, print
   only the systemMessage (reporting being off matters more; one JSON object on stdout).
6. engine/kosmos-report-hook.js: the same for Windows (SessionStart case).

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
"Last report = last seen." An agent whose reporting broke before the crash gets a window that starts too early: more
shown, never less.

## Not covered (stated)
- An interactive (non -p) startup was not measured for additionalContext; Windows only by its own CI.
- Agents on runners without Kosmos's Claude Code hook (codex, gemini, grok) get nothing from this slice.

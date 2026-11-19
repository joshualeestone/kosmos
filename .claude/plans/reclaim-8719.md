# reclaim-8719: link a window Kosmos did not start to its agent (kosmos#8719 part 2)

Card: kosmos#8719 asks 2 and 3. Stacked on unmanaged-8719 (part 1: the label, the reason, the 409).

## Finished means
On an agent's page whose window Kosmos cannot tie to it, a "Link this window to Kosmos" button, behind a confirmation,
makes Kosmos treat that window as the agent: messages are typed into it and its conversation shows. Only a Claude
window named exactly for the agent and not already linked is linked; anything else is refused with the reason, and
nothing is changed. Proven by engine, route and page tests (each refusal with a control) and a real-tmux test.

## How
- engine/linkwindow.js: plan(name, panes) decides from the board's own tmux look (status.panesWithCommands, new: the
  same look as paneRoster with the full rows); link() sets `@kosmos_agent` = session on `=session` (exact target) and
  reads it back with show-options; linked only when the read shows it. A runner seam for tests.
- server.js: POST /api/agent/:name/link, body { confirm: true } required (400 otherwise); 200 linked, 409 refused with
  `because`, 500 when tmux cannot be asked. The board-wide crossSiteWrite guard runs before every route.
- web/index.html: #d-link (button + live status line) beside #d-untied, shown exactly when #d-untied is; #link-modal
  (alertdialog, harmless answer first and focused, Escape and backdrop close); after a link, tick() and reopen the page.
- status.js exports isClaudeCommand and panesWithCommands.

## Decided
- A person's confirmed act on one named window, never automatic: the guard exists so Kosmos does not type into a
  window it cannot tie to an agent, and linking is the person vouching for it.
- Claude windows only for now. A Codex/Antigravity/Grok window would also need `@kosmos_runner`; an empty runner reads
  as Claude and would route it through the wrong classifier. Refused with the reason instead.
- The program is checked before "is an agent running": the board never counts an unmarked Codex window as an agent,
  so the other order told that person "no agent is running", which is false.
- Not in this change, carried on kosmos#8724: the launch job (restart still needs one), `kosmos adopt` re-binding
  (ask 2), and non-Claude runners. The dialog says what is left: until Kosmos starts the agent, the board cannot
  restart it and its own kosmos commands do not speak for it.

## Rejected
- Relaxing the delivery guard for a name match (it is exactly what the guard is for).
- Linking any window under the name without checking what runs in it (a shell or editor under the name would then
  receive typed messages).

- Review 1: windows are matched by the pane's `name` (what cards key on; a named Kosmos's sessions carry `+world`) and
  the mark goes on the raw `session`. After marking, the mark AND the program are read again; on any mismatch the mark
  is taken off and nothing is linked. panesWithCommands fails closed on an unreadable answer. The dialog says what
  linking hands over: Kosmos looks after the window like its own, which includes restarting it and closing it if the
  agent in it has stopped (bin/agent-supervisor.sh adopts a marked session, and kills one whose panes are at a shell).
  The dialog joins the shared Tab trap and gives focus back; a stale message clears when the page shows another agent;
  success is said in the composer's message line, which stays.

- Review 2: MEASURED on tmux 3.6a (a private socket, nothing else reachable): `set-option -t =zara` and
  `display-message -t =zara` do not resolve; `=zara:` does, marks exactly zara, never zarah, and marks nothing when only
  zarah exists. link() now reads the session's id and program before marking and compares the same pair after (a
  same-named Claude session swapped in is caught), checks the unmark's own result, and refuses Windows before reading
  tmux. A test drives link() through a real tmux on a private socket and fails on the old `=zara` form (measured).
- Who can link (review 3 corrected this): the person on the board, and any local process that can reach the board's
  loopback port, as for every other board write. Not an agent with only its token (not in AGENT_TOKEN_ROUTES), and not
  a remote session without a fresh sign-in: the route is on REMOTE_STEP_UP_PATTERNS, beside connect-agent and restore,
  since it opens a typing channel into a window kept outside Kosmos (tested over HTTP in server.remotestepup-6595).
- Review 3: the look reads the exact pane plan() checked (=session:W.P) and the session's current mark; a mark already
  there refuses before anything is set; (superseded by review 4: every write after the look targets the session id,
  so the unmark only ever touches the session this call marked); every pane carrying the name is checked for a mark before one is chosen; the roster read's fail-closed
  arms and the route's 500 are tested; the real-tmux test runs with -f /dev/null, and its prefix phase reads the
  program as Claude, so a target without `=` is caught (measured red).

- Review 4: after the look, every call targets the SESSION ID the look read (`$N`), not the name. Measured on tmux
  3.6a: once that session is gone, `$N` answers "no such session" and a new session under the name is never marked; so
  a window replaced after the look cannot be marked at all, and an unmark only ever touches the session this call
  marked. The look must also report the very program the board vetted (not merely any Claude-like command, so an
  unmarked node that replaced it fails). The mark field joins the rest of the line.

- Review 5: the tmux binary is the board's own (status.boardTmux: the one whose look listed the panes); a session with
  any window besides the agent is refused (the mark covers the whole session, and a supervisor later closes a marked
  session none of whose panes is an agent, which would take the person's editor too); a mark naming something else is
  its own refusal, not "already linked". The page's submit is one function (linkSubmit) with its own test: the POST,
  the button off while out, a refusal said only on that agent's page, success never pulling the person back
  (removing the page guard measured red).

- Review 6: the look reads `#{session_windows}x#{window_panes}` and requires 1x1 before and after the mark (measured on
  tmux 3.6a: there is no session_panes; a split reads 1x2 and a second window 2xN), so a window or split added
  meanwhile is caught.
- MEASURED END TO END, 2026-11-18 19:30 CST: a sandboxed board (temp HOME and data roots, AGENT_WORKFORCE_DRY_RUN=1)
  with AGENT_WORKFORCE_TMUX_BIN pointed at a private tmux socket, and a session `zara` running a compiled idle program
  named 2.1.212 (so tmux reports Claude's version string). Before: the card had isNamedOurs false, and a message was
  refused 409 'untied' with part 1's sentence. POST link: 200 linked; the private tmux showed @kosmos_agent=zara. After:
  the card had isNamedOurs true, and a message was no longer refused for identity; it stopped only at the sandbox's own
  live-execution switch ("running without permission to touch agents"). Not measured: a supervisor (launch job) adopting
  a linked session, since no launch job exists in the sandbox.

## Weakest premise
That a supervisor waiting in the not-ours loop (an agent that also has a Kosmos launch job) adopts the marked session
rather than doing something worse; read from bin/agent-supervisor.sh (it compares the mark with $SESSION), not run.
The mark itself making the board treat the window as its own is measured (above). Reasoned from launchidentity.paneSessionIsOurs and chat.addressable; to be checked end to end on a real
hand-started window before calling the card done.

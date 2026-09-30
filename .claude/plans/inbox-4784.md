# inbox-4784: an agent can read its own recent messages with the person

Card: joshualeestone/kosmos#4784 (daily feedback). An agent was told a person messaged it, the text never
reached its session, and no verb could read it; the only recovery was asking the person to resend.

## Where the notice without text comes from (mapped on origin/main)
- The first-reply nudge (engine/firstreply-nudge.js, #3226): "the person you work for sent you a message
  and nothing has reached them yet" with no message text, fired when the stored DM row says `placed`,
  which records only that the paste and Enter succeeded. A pane that lost the text, or a restart or clear,
  leaves the agent with this notice and nothing to read.
- The board keeps every DM (chat DIRECT, `<data>/chats/direct..<name>.json`), stored even when delivery
  failed; GET /api/agent/<name>/thread serves it, but only with the person's board token and with no
  check of who is asking, so an agent could not use it.

## Change
- GET /api/inbox (`?limit=`, default 10, max 50; `?as=text` for the bash CLI): the caller's OWN DM thread,
  person rows and its own replies, newest last. Caller resolved exactly as GET /api/report resolves it
  (token first, then pane; a bare pane is refused on an enforcing board); no agent parameter. In
  LOOPBACK_AGENT_ROUTES, like GET /api/report.
- `kosmos inbox [--limit N]` in install/kosmos and the Windows CLI (parity test green); read-only on
  --help like whoami.
- The first-reply nudge now ends "If their message did not reach you, read it with: kosmos inbox".

## Tests
- server.inbox-4784.test.js: own thread, both arms and the limit; another agent's thread never appears
  (control: it is on disk); a bare pane on an enforcing board is refused (control: the token reads).
- cli.inbox-4784.test.js: token, pane and limit sent, text printed; a bad limit sends nothing; a refusal
  exits 1 with the board's words.
- engine/firstreply-nudge.test.js pins the new sentence.

## Weakest premise
That the nudge is the notice the report saw. The report does not say which notice it was; the verb helps
whichever it was, as long as the message was stored (every DM is).

## Review 1 (sonnet, blind, on 18457d028), 17:04 CDT: no BLOCKER, 6 WARNINGs, all fixed
- `kosmos inbox --help` on the Mac re-dispatched bare and PRINTED THE MESSAGES: now its own help arm.
- The setup guide's thread is masked like the thread route (guideMaskedRows, every row).
- Kosmos's own notice (`kosmos: true`) is left out, not printed as "you:" (the kind filter was dead).
- A message's further lines are indented, so typed text cannot pass for another row.
- Attachments, menu choices and undelivered messages are said.
- Plan and comment say a BOARD-token holder can name any pane (no new reach: the thread route already
  serves every thread to the board token).
- Also: --limit 0 refused on both CLIs; the enforcing test asserts the route's words.
Not taken: a test of the guide mask (it is the thread route's own helper; a guide fixture is heavy).

## Review 2 (opus, blind, on 755fd3eae), 17:11 CDT: no BLOCKER, 4 WARNINGs, all fixed
- unconfirmed (pasted, Enter not confirmed) now reads "[this may not have reached you]"; only could_not
  reads "did not reach you" (telling an agent it never got a message it acted on invites a repeat).
- Tested: on an enforcing board the agent's token wins over any pane (four panes tried; control: its
  own rows come back).
- Tested: the setup guide's thread comes back masked (a real guide fixture: the marker file).
- Tested: the Windows verb (route, token, text, refusal exit, bad limits send nothing).
- NITs taken: markers sit before the colon (typed text cannot pose as one); attachment names lose
  brackets and C1 controls; --limit must be 1 to 50 (and present with a value) on both CLIs; the Mac
  parses its arguments before asking the board; one help sentence on both CLIs.
- NITs not taken: WORLD_CHECKED_AGENT_ROUTES (GET /api/report has the same gap; a separate card if
  wanted); append order vs time order; the refusal on stdout (as whoami).
Focused set: 66 of 66 (both route tests, both CLIs, help, parity, verbs, the nudge).

## Review 3 (fable, blind, on 57fd86712), 17:29 CDT: no BLOCKER, 1 WARNING, 4 NITs
- WARNING, taken: the FALLBACK Mac path (board token + TMUX_PANE; see review 6: Mac launches DO mint a token) had no
  route test, and review 2's "token wins over a pane" arm could not fail (fake-tmux names one session for every
  pane, so no pane ever named nova). Replaced with mapped panes (messages.setRunner: %1 leo, %2 nova): board token
  + leo's pane reads leo; board token + nova's pane reads nova (the documented reach, pinned; also the CONTROL
  that %2 names nova); leo's token + nova's pane reads leo. Perturbation: the route ignoring from_pane reds it.
- NIT, not taken: UTC stamps. "...Z" is unambiguous and the markers' position depends on the row shape.
- NIT, not taken: a person row with no delivery field reads "yes". Those rows predate delivery tracking; marking
  every old message "may not have reached you" invites the agent to act on all of them again (review 2's reason).
- NIT, not taken: a BAD_THREAD name gets the transient 503. A name that cannot be filed has no DM thread at all,
  so nothing is lost; the retry costs one call.
- NIT, not taken: row size. The default is 10 and --limit is the agent's explicit ask.
Focused: server.inbox-4784.test.js 7 of 7.

## Review 4 (sonnet, blind, on 684a0f374), 17:32 CDT: no BLOCKER, 1 WARNING, 2 NITs
- WARNING, taken: rows split only on LF/CRLF, so a lone CR, VT, FF, NEL, U+2028 or U+2029 in typed text could draw
  an unindented "you:" row. Every one of those now starts an indented piece, and the other C0/C1 controls (ESC,
  BEL, CSI; tab kept) are dropped. Test: one message per separator (LF and CRLF are the controls, and the count
  arm fails if any separator produced no indented piece); perturbation: the old LF-only split reds it.
- NIT, not taken: attachment names in the guide's thread are not secret-masked. The thread route shows the same
  names to the board, and the mask's contract (#3769) is message text; a key as a file name is a separate card
  if wanted.
- NIT, noted: refusals on stdout (as whoami), already a recorded choice.
Focused: server.inbox-4784.test.js 8 of 8.

## Review 5 (opus, blind, on 46ddb131d), 17:35 CDT: no BLOCKER, 1 WARNING, 2 NITs
- WARNING, taken: attachment names skipped review 4's rule (attachments.safeName drops only C0 and DEL), so a
  file named with U+2028 could draw a row. One pair of sets now (INBOX_BREAK, INBOX_DROP, top of server.js): a
  message's breaks start indented pieces, a name's become spaces; both drop the same controls. Test arm: a name
  with U+2028 and CRLF stays on its row; perturbation (names unsanitized) reds it.
- NIT, taken: bidirectional marks and overrides (U+200E/F, U+202A-E, U+2066-9) are dropped too. Zero-width
  joiners are kept (emoji sequences use them; they cannot move a row).
- NIT, not taken here: a wrongWorld 421 prints as JSON, as cmd_report_show does today (inherited, not new).
Focused: server.inbox-4784 8/8, cli.inbox-4784 6/6.

## Review 6 (fable, blind, on 55fdf0cbc), 17:43 CDT: no BLOCKER, 1 WARNING (record only), 3 NITs, all taken
- WARNING, taken: review 3's test comment and this plan said Mac agents carry no agent token. False:
  bin/agent-supervisor.sh mints one per launch and exports KOSMOS_AGENT_TOKEN, so the usual Mac path is token-first
  (as on Windows); board token + pane is the fallback (a launch that minted none, or the person's terminal).
  Corrected in the test comment, its title and review 3's line above. No product change: the code was right.
- NIT: the nudge test also asserts install/kosmos dispatches the inbox verb it names.
- NIT: U+061C (Arabic letter mark, a Bidi_Control) joins INBOX_DROP; the test's control set and input carry it
  (perturbation: dropping it from INBOX_DROP reds the arm).
- NIT: attachment names are joined with "; " (a name can hold a comma).
Focused: 36 of 36 (the four #4784 files).

## Review 7 (opus, blind, on 2942e0b45), 17:48 CDT: no BLOCKER, 1 WARNING, 1 NIT, both taken
- WARNING: the INBOX_BREAK/INBOX_DROP block sat between resolveAgentSender and its doc comment, so the doc bound
  to INBOX_BREAK. Moved above that doc block; the doc again sits directly on the function. (A second placement
  I tried split another comment from the function "The same" refers to; not kept.)
- NIT: a stored `at` reached the row unsanitized (an outbox entry file edited by hand can carry any string
  Date.parse accepts, newline included). The row prints a time only in the board's ISO shape, else none.
  Test with the reviewer's own string (control: an ISO time still prints); perturbation reds it.
Focused: server.inbox-4784 9 of 9.

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

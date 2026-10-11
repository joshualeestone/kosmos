# kosmos#5805: task messages to an agent out of usage are kept and typed after the reset

The gap found writing 0.7.40's What's New (comment 6107325876 on #5805): `kosmos task message` (and the person's own
task message from the screen) went through `chat.deliverAsync` straight into the assignee's pane, so a Claude agent
paused on a usage limit got the line on its limit screen and the sender was told it was told. `kosmos msg` (slice 2a),
room posts (slice 1) and the person's DMs (slice 2b) are already held. The What's New says "most from other agents"
for this reason.

## What exists (measured)
- server.js, `POST /api/project/<id>/task/<n>/message`: one line built once, then `chat.deliverAsync(one, line, roster)`
  per assignee; the outcomes go into `delivered` and `taskMessageSummary` turns them into the one sentence both CLIs
  print (install/kosmos sed-reads `summary`; tools/windows/kosmos-cli.js prints it). Both exit 0 on `ok: true`.
- The screen (web/index.html tkSayPost) never reads `delivered` or `summary`: it repaints the task's activity. No web
  change, so no browser-check surface.
- engine/limitqueue.js keeps `kosmos msg` and DM entries; the minute sweep (sweepHooks) types non-dm entries with
  `chat.deliverAutomaticAsync(n, env, r)` and, for non-dm, logs a `held-delivered` / `held-dropped` message-log row
  pointing at the held `message` row.

## The call
- messages.keepTaskLine(toName, line, roster, from, about): the same two tests sendWithDelivery makes:
  `chat.limitHeldVerdict` holds it, or the agent is released but limitqueue still has entries for it (or its queue
  cannot be read), in which case it goes behind them. Kept as `{ kind: 'task', from, envelope: line, about, at, reset }`
  with id `k<12 hex>`. Answers null (type it now) when neither holds or the agent is not addressable (the delivery
  refuses it as before). Held: `state: 'held'`, heldUntil the printed reset while it is ahead, and heldReceipt's
  because ("held: casey is out of usage until ...; Kosmos types it after the reset"). Could not keep it: could_not with
  the reason, nothing typed.
- The route calls it before deliverAsync for every recipient. `from` is the sending agent, or '' when the screen sent.
- limitqueue keeps `kind: 'task'` and `about`. sweepHooks: a typed task entry writes no message-log row (there is no
  held `message` row to point at; the task's own conversation already records the message). A dropped one is told to
  the sending agent's pane: "Your message in task 7 in Launch never reached casey: Kosmos kept it for a day ...". One
  from the person is told to nobody: the task conversation holds it, and the route already said it was kept.
- taskMessageSummary: a held outcome reads "Kept, not typed yet: <because>." It is never "told", never "may have been
  told", never "not told". Rank for an agent listed twice: not told 3, may have been told 2, kept 1, told 0.

## Rejected
- Logging task entries into the message log: its rows are `kosmos msg` messages, and `held-delivered` rows are read
  by the repeat-send fold (messages.js 1284/1306), which would then look for a task line id it never wrote.
- Holding inside chat.deliverAsync itself: every caller would then need to keep a line, and handoff restarts and
  setup prompts (server.js 8314, 8379) must not be held.
- A CLI change: both already print the board's sentence and exit 0 on ok.

## Weakest premises, stated
- The person's task messages share the per-sender cap (MAX_PER_SENDER, 20) with the person's DMs, both from ''.
  Twenty kept from the person per capped agent is far past any real use; past it the line is refused, said, untyped.
- An agent that sent with no resolvable name (senderName empty, not via the screen) is stored with from '' and so is
  not told about a drop. Same as before this change: such a sender was already unnamed in the line.
- Windows agents: limitHeldVerdict needs a RATE_LIMITED Claude card, exactly as for `kosmos msg`; unmeasured there
  (the 0.7.40 What's New tags the holds Mac only).

## Tests
- engine/limittask-5805.test.js (10): held and not typed; idle CONTROL not held; unreachable not held; behind a backlog;
  the real sweepHooks types it after release with the kept note and no message row; a drop tells the agent sender
  which task; a drop from the person types nothing; a full queue is refused and said; the route keeps before typing.
  Red-capable: with keepTaskLine returning null, 4 of 10 fail.
- server.task-message-summary-4540.test.js: two cases for the kept sentence.
- engine/limitmsg-5805.test.js: the wiring test now reads all of sweepHooks (it read a fixed 1400 characters, and the
  new task branches pushed tellHeldDropped past it).
- Local gates: engine.reachable, browser-checks-reason-grep, the browser-check surface gate: all pass.

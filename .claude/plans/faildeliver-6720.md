# faildeliver-6720: "Message failed to deliver, try again." with a one-shot retry

Card: kosmos#6720 (Josh, #admin 2026-10-20 08:49).

## What changes
- Page, the agent's direct thread (dmRow): a person's row whose verdict is COULD_NOT no longer draws the red
  `.delivery.failed` box inside the bubble. It draws one quiet line UNDER the bubble (`.dm-failed`, --k-ink-2, the
  board's quiet text in both themes): "Message failed to deliver, try again." The engine's reason is the line's
  tooltip. "try again" is a button (dmRetrySend). A row that cannot be sent again that way (a reply, a menu answer,
  a file) says "Message failed to deliver." alone. Every other verdict (held, unconfirmed, placed) is unchanged.
- Retry, server: the DM send route takes `retry_of: <the row's at>`. It runs every gate the first press ran, then
  REWRITES that row's verdict (chat.retryDmBegin before any key, chat.retryDmFinish after; see review 1) instead of appending a second message. Refused with nothing
  typed: a row that is not COULD_NOT (so a message that went is never typed again), other words, an agent's row, a
  reply, a menu answer, a file, `anyway`/attachments/reply_to/chose/asked/automatic in the body, a retry of the same
  row already in flight (DM_RETRYING, released in .finally), an agent out of usage or signed out (it would otherwise
  become a second, held row), and a question menu on its screen (it would otherwise be typed as a menu key or close
  the question).
- Retry, page: DM_RETRYING keyed by agent and row, so a poll repaint mid-flight draws the button pressed; after the
  answer the button is put back as the row now is (a thread that did not change is not redrawn).
- Send path: a NEW send the board answers COULD_NOT and KEPT (recorded, no file, no reply) no longer also puts the
  words back into the box (#4944) and leaves the line under the box empty; it is announced once ("Message failed to
  deliver.") through dmReplyAnnounce, after the "Sending..." it queued. Not kept (no row to retry), the #4944
  behaviour stands.

## Why COULD_NOT and only COULD_NOT
engine/chat.js documents COULD_NOT as "nothing of the person's text reached the pane" (every partial paste and
every in-the-box case is UNCONFIRMED, e.g. UNSENT_BECAUSE, which Kosmos already presses Enter on by itself,
kosmos#6436). So typing a COULD_NOT row again cannot double it. A person's own send is never `held` (deliverAsync).

## Rejected
- A second appended row on retry: the conversation would show the failure and the success as two messages.
- Restoring the words to the box AND offering try again: two ways to send one message; Send then try again types
  it twice. Josh's rule: "It must never send twice."
- Retry on unconfirmed rows: the text may be in the agent's box already.
- Changing the project panel's thread (pjVerdict / pjMsg, the "Could not deliver:" pill there): out of scope for
  this card (Josh's screenshot is the direct message); recorded as a follow-up.

## Weakest premise
That `row.text` as served to the page equals the stored text: dmServeRows can mask a guide secret, in which case
the server refuses the retry (409, nothing typed) rather than sending the masked words. Safe, but the button then
cannot work for that row.

## Tests
- server.dmretry-6720.test.js (real route, deliverAsync a recorder): retry types once and rewrites the one row; a
  second press after it went is refused; a retry that fails again leaves one failed row with the new reason; two
  presses at once type once (and the mark is released after); ten refusal shapes type nothing; an account hold
  refuses (CONTROL: the same hold keeps an ordinary send held); the begin/finish rules (as of review 1). 6/6. MUTANTS (no
  in-flight lock, append instead of rewrite, no failed-state check, no hold refusal): each red.
- docs/browser-checks/render-dm-retry-6720.js: R1-R6 above, light and dark, 32/32; shots read by eye.
- render-talk.js: its "sent as beside a failure" arm matched only "could not deliver", so it went vacuous on the
  DM; widened to "failed to deliver". MUTANT (wire shown on failed rows): red in both themes.
- web.agent-answers.test.js: the dmRow control now reads "Message failed to deliver" (dmFailedLine lifted). 9/9.

## Review round 1 (blind, opus) and what was done
- [BLOCKER] the "being sent again" mark lived in memory and the row was rewritten only after typing, so a failed
  final write or a restart mid-send left a row reading failed for words that went, and a second press typed them
  again --> FIXED: two writes. chat.retryDmBegin turns the row UNCONFIRMED (retrying, "may have arrived; check its
  window") under the thread lock BEFORE any key; retryDmFinish writes the verdict only over a row carrying that mark
  (a could_not result is retryable again: nothing was typed). A crash or a failed final write leaves "may have gone",
  which offers no button. The in-memory DM_RETRYING stays, checked first, for the clear "being sent again now".
  Tests: the row reads unconfirmed during the typing; a failed final write leaves it unconfirmed and a second press is
  refused. MUTANT (no begin): 4 red.
- [WARNING] old could_not rows (before this change their words went back into the box, maybe sent again from it)
  would offer try again --> FIXED: the route marks a plain kept could_not row `retryable` (chat.appendMessage keeps
  the field, which it did not: it whitelists delivery fields, found by the tests going red), and retry requires it.
  MUTANTS: retryable not kept on append, 9 red; no route check, 1 red only after the test was pinned to the route's
  own words (retryDmBegin refused the unmarked row too, so the arm first passed by a different rule).
- [WARNING] an old failed row retried later arrives out of order --> FIXED: only the person's newest message, on the
  server (409 "you have sent a message since") and the page (DM_NEWEST_MINE_AT). MUTANT: red.
- [WARNING] every non-placed result was announced "Message failed to deliver." --> FIXED: placed "Sent.", unconfirmed
  "We could not confirm it went...", a refusal its own sentence.
- [WARNING] a refusal was only in a tooltip --> FIXED: said under the box (d-say-msg, as dmHeldSend does) and
  announced; the tooltip stays.
- [WARNING] no test of the menu refusal --> ADDED, through the route's own screen read, with the fixture's premise
  asserted. MUTANT: red. The non-Claude menu case rests on deliver's own menu hold, as every send does: NOT CHANGED.
- [NIT] identical buttons on several rows --> each has an aria-label naming its words. [NIT] the fixed 150 ms wait
  --> polls until the first press is typing. [NIT] no test of a failed final write --> added (above).
  [NIT] a masked row has no working retry --> as the weakest premise says; the box path then keeps the words only
  in the row, NOT CHANGED (rare, and the server refuses rather than send masked words).
- Results: server.dmretry-6720 10/10; render-dm-retry-6720 35/35; render-talk rc 0; render-dm-held-5805 passed;
  web dmRow tests and the check index 38/38.

## Review round 2 (blind, sonnet)
- No double send found. [WARNING] a throw after begin left the row "may have arrived" when nothing may have been
  typed --> FIXED: the catch finishes it UNCONFIRMED "may or may not have arrived" (retrying cleared). MUTANT: red.
- [WARNING] "newest only" was checked before several awaits --> FIXED: retryDmBegin decides it under the thread lock.
  MUTANT: red.
- [WARNING] the page dropped the box restore for any kept row, though only a retryable row offers the button; and
  a masked guide row would be refused forever --> FIXED: the route marks a row retryable only when the page is shown
  its words as they are (dmServeRows), answers `retryable: true`, and the page drops the box copy only on that.
  MUTANT (no flag in the answer): red. R7 CONTROL: kept but not retryable, the words go back.
- [NIT] refusal arms could pass by an earlier rule --> each asserts the retry guard's own words. [NIT] inverted
  assertion message, stale function names in this plan, an overstated comment --> FIXED.
- Results: server.dmretry-6720 13/13; render-dm-retry-6720 36/36.

## Review round 3 (blind, opus)
- No double-send or lost-message path. [WARNING] since review 1 the board serves a row mid-retry as "being sent
  again" (unconfirmed), so the 5 s poll redrew a normal retry as a warning; R4 passed only because its mocked thread
  kept serving could_not, a state the real board cannot produce mid-flight --> FIXED: dmRow draws a retrying row as
  the pressed button while THIS page has it in flight (DM_RETRYING); R4 now serves the real mid-flight row; R4b
  CONTROL: the same row with no flight here (a stopped board) keeps its warning. MUTANT (no in-flight draw): R4 red.
- [NIT] a retry that went emptied whatever the line under the box said --> only a line an earlier retry wrote
  is cleared (dataset.retryLine).
- [NIT] the reactions/question bookkeeping after delivery sat between the send and the retry's final write, so a
  throw there left "being sent again" under a refusal --> the retry's verdict is written first (retryWrote).
- Results: server.dmretry-6720 + web.agent-answers 22/22; render-dm-retry-6720 37/37.

## Review round 4 (blind, sonnet): converged
- No double-send or loss path; every delivery state draws consistently. Three [NIT]s, NOT CHANGED:
  a final write that fails after a could_not retry leaves "may have arrived" with no button (safe, affordance only;
  same as any failed final write); a refusal written by another path is not cleared by a retry that went (cosmetic,
  and the deliberate scope of review 3's fix); the "first" comment does not say the placed-only marks still run.

## Validation 1 (on 956795c5, tree untouched): 22537 tests, 2 FAILED, both mine
- server.test.js "link previews: ... the payload carries the preview on the next poll": "a preview was attached before
  the fetch could have finished". 3/3 red alone on this branch, green on origin/main (control). CAUSE: the retryable
  check called dmServeRows on the new message's words to see whether the page is shown them unmasked, and dmServeRows
  ends in withPreviews, which STARTS the link-preview fetch: a side effect in what read as a pure check. FIXED: the
  guide mask is its own function (dmServedText), used by dmServeRows and by the check; the check never touches previews.
  server.test.js + dmretry + guide-secrets-3769 + the check index: 416/416.
- #1387 "every browser check is RUN by the runner": render-dm-retry-6720.js was not wired. FIXED: added to
  docs/browser-checks/gated.txt (one sorted line).
- Lesson: a helper that "decides what the page is shown" can also DO things (fetch previews); call the narrowest one.

## Validation 2 (on e06eeb3e, tree untouched)
- 22537 tests, 2 failed, BOTH mine and both the same line: my gated.txt entry was written `render-dm-retry-6720.js`
  while every other entry is the bare name (no .js), so #3929 ("one bare check name per line") and #1387 ("every check
  is run") failed. FIXED to `render-dm-retry-6720`; tools.browser-checks-wired.test.js 11/11 alone (from the repo
  root). Everything else in validation 2 passed, including the link-preview test validation 1 caught. No third full
  run: the fix changes one line of a list only those wired-check tests and the runner read.

## Rebased onto main 2026-10-24, merged with #6774
The nine commits were squashed to rebase once (the originals: origin/faildeliver-6720-local-backup at 1a845fb252).
#6774 now keeps a message refused for a stuck input box and types it once the box clears, so the case behind this
card no longer fails; try again stays for every other could-not-deliver reason.
- Decided: a retry is never kept for the box. It stays the one failed row with its line (as for out of usage and
  signed out). Test with a control (a new message IS kept), red without the guard.
- Decided: a retry whose words are already kept for the box is refused, 409, nothing typed, no duplicate row. Test, red
  without the guard.
- Decided: a kept-above copy (#6774's duplicateOf) gets no failed line; it is not a failure. web.agent-answers test,
  red without the exemption.
- Rejected: keeping the retry for the box and marking the old row replaced (a new row link for a rare case).
- Weakest premise: a retryable row meeting a stuck box needs the box to stick between the first send and the press.
- render-dm-retry-6720.js still uses the stuck-box sentence as its failure reason. After #6774 that sentence no longer
  reaches a failed row in real use; it only feeds the tooltip text, so the check is unchanged.
- The 17 DM checks the surface gate names (the d-dmthread token) were each run on 433b0bbdaf and pass; trailers below.

## Delta review of the #6774 merge (blind, opus, 2026-10-24 02:55): 1 BLOCKER, 1 WARNING, 1 NIT
Decisions (a), (b) and (c) held.
- [BLOCKER] #6774's race path (two sends at once, both refused for the box) answers the later one with a kept-above
  copy (duplicateOf), and `retryable` did not exclude it, so try again on it typed the words a second time after the
  sweep typed the kept copy. --> FIXED twice over: retryable never holds for a duplicateOf, and the retry_of route
  refuses a duplicateOf row whatever it says (an older row). Tests: the race itself (one kept copy, the other row not
  retryable, a retry after the sweep refused with nothing typed), and the route refusal with a control; each red with
  its fix removed.
- [WARNING] a retry behind messages kept for the box was refused as "out of usage" --> FIXED: it names the box, as the
  held path does. Test with a control (behind an out-of-usage message it still says out of usage).
- [NIT] retryDmFinish drops inputHeld/busy from a retried row --> DECIDED: kept; nothing reads them on a row, and the
  reason is still in `because`.

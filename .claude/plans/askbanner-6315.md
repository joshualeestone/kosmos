# askbanner-6315: the Kosmos+ join notice can be dismissed, and Review clears it

Card: #6315 follow-up (Josh 2026-10-16 19:41, via Splinter). Owner: Angel. Target: 0.7.55, with the relay pairing fix.

## Done means
On any view but Kosmos+, the one-line "Your computer X wants to join. Review" notice has a close button. Pressing it,
or Review, puts that set of requests away: the notice stays hidden across repaints and a reload (per browser). A new
request brings it back. The request cards on the Kosmos+ page are unchanged.

## Steps
1. [x] web/index.html: paintAsk's off-Plus branch keys each waiting request as device id plus first_seen (a
   re-ask is a new request), plus the "here" browser, and hides the notice while every key was put away;
   askAct 'note-dismiss' and 'open' record the keys (localStorage kosmos.asknote.dismissed, read on every paint so
   another tab's dismissal applies; combined on every paint with this tab's own record, which holds when storage fails). The record is never cleared on an
   empty list (a list being rewritten reads empty, and another tab can be behind); a re-ask has a new first_seen.
   Focus goes to the view's tab, or the Sections button on a phone. A 44px close button with a focus ring.
2. [x] render-plus-asks-signin-4610.js (the served list is the check's, then it calls pollAsk): dismiss hides and
   moves focus, one answered elsewhere keeps it away, a repaint keeps it hidden, CONTROL a new request brings it
   back, a list that read empty for a moment does not undo it, the same device asking again shows it, kept across a
   reload (after the list loads), CONTROL storage cleared shows it, storage throwing still holds in the tab, Review
   clears it, at 1400 and 390. A mutant run by hand (ignore the dismissal) turned the dismiss arms red.
3. [x] render-plus-panel-3829.js: its earlier Review press now dismisses, so the #3978 focus arm restores the
   notice first.

## Decided, not missed
- Per browser, not per board: join requests end on Allow or Not me, so the store only needs to outlive a reload.
  Mona Lisa's #6341 project notices are server-side because they last; same rule (a new thing comes back), two
  stores, agreed with her 19:4x.
- The cards on Kosmos+ keep no dismiss: they are the place the decision is made.
- With waiting requests AND a connected-here browser, the line names the requests. Closing it puts only those away,
  so the notice moves on at once to "Safari on this computer is connected." Decided: that line is the only way to
  the browser's Undo (a security control), so it must be seen before it can be put away; a close that hid it unseen
  was iteration 6's finding. The role=status region announces the new line.
- A request whose first_seen and denied_at both arrive as 0 cannot come back once put away (the key cannot change).
- A device turned away from another tab, or from the Devices list, gets a new denied_at; until the tunnel's list
  drops it (a poll or two), this tab sees a new key and the notice can come back for it briefly. Not excluded: a
  device that is turned away and then asks again is shown on purpose (the cards say so), and it looks the same.
- first_seen is stable while a request waits, checked in the coordinator (kosmos-relay coordinator/src/db.rs
  4156-4177): set on insert, and refreshed only when a DENIED device asks again, which is a new request here too.
  Read from the code, not measured against a live coordinator.
- Storage and this tab's own record are read together, so another tab's dismissals and this tab's survive a storage
  failure and its recovery; two tabs saving at the same instant can lose one (a notice shown again).
- With N requests the line says "N devices want to connect"; a dismiss puts away the N waiting at that moment, even
  if one replaced another without the count changing. Accepted: the line names a count, not devices.
- Review puts the notice away before anything is decided (Josh's ruling): a request left unanswered after Review
  is marked only by the Kosmos+ nav dot and the cards there, until a new request comes. A connected-here line put
  away by Review is the same: Review opens Kosmos+, where its card (and its Undo) shows.

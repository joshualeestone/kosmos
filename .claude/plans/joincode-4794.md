# joincode-4794: the app half of #4794 slice 1 (pair two computers with a code both screens show)

Card: joshualeestone/kosmos#4794 (Kitty: server and trust; Pete: the app). Relay PR #255 merged; coordinator 763d43f1.

## Tunnel interface (Kitty's read of kosmos-relay main d1216d79; struct is the authority)
- Joining computer B: `kosmos-tunnel join status --coordinator <url> --state-dir <dir>` runs one pairing round, prints
  {held, join_code, join_codes:[{on, code}], asked_of:[names], failed, confirmed, confirm_expired}.
  `kosmos-tunnel join confirm --state-dir <dir> --code <code>` -> {"confirmed": true, "with": "<name>"} (local only).
- Allowing computer A: pending rows (devices.rs) carry `code` = the computer's join code ("" until worked out; a
  phone's is its match code) and `code_wait` (why it is still empty, or "was_a_computer"). `devices allow --code`
  is REQUIRED for a computer and refused unless it matches; ignored for a phone.

## Plan
A side (the computer already in):
1. engine/remote.js pendingDevices: pass `code_wait` (allowlisted values only).
2. deviceAllow(id, name, code): for a joining computer row, pass `--code`; server's allow route takes body.code.
3. Page: a joining-computer row shows its "ddd ddd" code ("check it matches the code on <name>") or the wait
   reason; Allow sends the shown code.
B side (the computer waiting to be allowed):
4. engine/remote.js joinStatus() (spawn, parse, page-safe fields) and joinConfirm(code); server GET/POST routes.
5. Page on a held computer: the code, a "The codes match" button, the failed and expired states. Design: Mona Lisa.

## Weakest premise
That the code the page shows on A is the code the tunnel will accept at Allow (the tunnel recomputes at Allow and
refuses a mismatch; a code that expired between showing and pressing reads as a refusal, which the page must word).

## Design (Mona Lisa, 2026-10-03 00:05 and 00:06; build to it)
One rule: the code looks identical on both screens: the Allow card's large code (.askcodebig, role=img + per-char
aria-label) on B too, NOT devCodeHtml boxes.
B (waiting computer): Settings > Kosmos+, directly under the "Waiting to be allowed" pill, in place of the
coordinator's sentence while held. Block #plus-join. One computer only (join_codes has at most one).
- code ready: "Check that <name> shows this same code." [code large] [The codes match] (.btn.uprime; aria-label
  "The codes match: <code>")
- confirmed: button goes, code stays, "Matched. Now press Allow on <name>."
- working out: "Working out the code with <name>..." (no code, no button)
- expired: "That code ran out. A new one is on its way." (no button)
- failed: "Too many tries. On <name>, press Not me on this request, then sign this computer in again."
A (computer already in): the existing request card (paintAsk askreq).
- code present: say line "Allow it if <name> shows this same code."; code large above Allow.
- code empty: quiet line in the code's place, Allow DISABLED (kept), Not me enabled. Default line: "Working out the
  code with <name>. It shows here in a moment." Per code_wait:
  attempts_used          "<name> used up its tries. Press Not me, then sign <name> in again."
  asked_another_computer "<name> is pairing with another of your computers. Allow it there, or press Not me if it is not yours."
  another_computer       "This computer is adding another computer right now. <name> waits until that one is done."
  daily_limit            "This computer has added as many computers as it can today. Try again tomorrow."
  wait_a_few_minutes     "This computer just added one. The code for <name> shows here in a few minutes."
  was_a_computer         "This started as a computer and now shows as a device, so it cannot be allowed. Press Not me."
- Allow refused because the code changed: "The code changed before you pressed Allow. Check the new one on <name>,
  then press Allow again." and the card repaints with the new code.
Shots for Mona: both screens, light and dark, plus 390.

## Review 5 (blind Opus, told to check every value against the tunnel source; all field shapes matched)
- WARNING fixed: round 4's find-and-replace had also turned seven EMAIL one-time codes in server.test.js into "123 456";
  reverted (coordinator util.rs makes those as six digits with no space).
- WARNING fixed: a page loaded after the other computer's Allow never read the pairing, so a code still up never showed.
  One read per page load when on and enrolled (PLUS_JOIN_PROBED); control arm proves only that read finds it.
- WARNING fixed: "ran out" while held cannot come from the tunnel (a held round restarts and clears expired_unconfirmed,
  pairing.rs owe_commitment). The real state is not held + confirm_expired: now shown, read every 60 s (it lasts until
  this computer pairs again). The browser check's impossible held+expired fixture now uses held:false.
- NIT fixed: not held with a code up, the line no longer tells the person to check the other screen (it shows no code).
- NITs left: the engine shape fixture pairs a code with confirm_expired (it tests field filtering, not order);
  peer_conflict and the round-lock timeout reach the page as escaped raw text.
- New lines for Mona (not yet seen by her):
  C (allowed, code still up): "If <name> showed this same code when you allowed it, press The codes match."
  D (allowed, ran out): "This computer is connected, but the code ran out before it was matched here, so it does not trust <name> yet."

## Review 6 (blind Sonnet): 0 blockers, 5 warnings, root cause one: the after-Allow endings were forced through the poll gate
- Split live from endings. LIVE (plusJoinLive: held, or a code up and unconfirmed) polls and stands in for the
  coordinator's sentence. ENDINGS after the Allow (PLUS_JOIN_NOTE: ran out, or matched) are said once for a pairing this
  page watched, never polled (each read is a signed round), never take the status line (an outage after one is still
  said), and are never claimed by the read on load (a later load shows nothing for a finished pairing).
- Not held and past the page's 10 minutes: stays live (keeps reading) and says the ending, not "a new one is on its
  way" (only a held round starts a new code); the tunnel's ran-out answer then keeps the ending up.
- The read on load counts only once a real answer arrives (a busy or failed round does not spend it); a live answer
  opens the block at once rather than on the next paint.
- "The codes match" after the Allow says "Matched with <name>." instead of vanishing.
- Browser-check arms for each, incl. a round counter (no polling in the ending) and a 502-once fixture.
- Decided: an ending is NOT shown on a later page load. Rejected: showing "does not trust <name>" permanently, because
  in slice 1 nothing reads that trust (vouches are slice 2), it would have no action to offer, and keeping it fresh means
  a signed round per load forever. Weakest premise: that the person is watching when the code runs out; a person who
  walks away and comes back never learns it. Slice 2, when trust starts to matter, should own a recovery and a durable
  notice.
- New line for Mona: E (matched after the Allow): "Matched with <name>."

## Review 7 (blind Opus, static against kosmos-relay d1216d79): 1 blocker, 1 warning, 3 nits, all fixed
- BLOCKER fixed: the past-10-minutes held arm edited the route fixture then called paintPlusJoin, which never fetches;
  the page still held the earlier not-held answer and painted the ran-out ending. The arm now sets PLUS_JOIN.held.
- WARNING fixed: a Forget never cleared the pairing (paintPlus returns early when not enrolled, before the clearing),
  so a fresh sign-in could show the old ending or the old code. plusJoinReset() runs on a real not-enrolled answer and
  on Off. A failed /api/remote read (no answer) does not reset (my call after the review, so a board blip keeps an
  ending said once).
- NIT fixed: two fixtures paired on:'homemac' with no code, a shape the tunnel cannot emit (on comes only from
  join_codes); now on:null, so the page's own fallback name is exercised.
- NIT fixed: Off then On after the read on load hid a still-up code until reload; the reset re-owes the read.
- NIT fixed: "Matched with <name>." could be lost if a paint nulled PLUS_JOIN during the confirm request; the handler
  keeps the answer it started from.

## Review 8 (blind Sonnet, every fixture checked against kosmos-relay pairing.rs): CONVERGED, 0 blockers, 0 warnings
- NITs left: sas_pending also covers "no code yet", so a code withdrawn just before the click reads as "ran out" (true
  enough, the person gets a new one); an old tunnel with no join verb is asked every 5 s while waiting-allow (one
  spawn, exit 2, nothing shown; Kitty's tunnel half ships the verb with this); the read on load is one signed round
  per Settings load (accepted in review 5); "Matched with <name>." stays until reload, a new wait, or Off.

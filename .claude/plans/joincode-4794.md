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

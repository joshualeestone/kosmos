# nopush-7448: a computer marked never to send phone notices (kosmos#7448, the board's half)

After #7446 (23:57 10-27: a demo board signed in to Josh's account pushed 8 made-up agents to his phone). The
coordinator's own mute (#7446, Ice Cream Kitty) lists one computer by id; this is the board's guard, so a demo or test
install never reaches a phone without anybody remembering to list it.

## Finished looks like
- A computer is marked by the file `no-phone-notices` in its state dir (made once by whoever sets up a demo or test
  install; kept across restarts and updates) or by KOSMOS_NO_PHONE_NOTICES=1 (for a check run).
- While marked: phonenotify.happened sends nothing; the switch never turns itself on (ensureDefaultOn); a press is
  refused with the reason; status() says noPush with the reason, shown off whatever an older file holds; Settings shows
  "Off. This computer is set never to send phone notices (a demo or test install)." with no button.
- A mark that cannot be read counts as marked (never send).

## Decisions
- The board's side, not only the coordinator's: it holds wherever the board runs, with no list to keep.
- Weakest premise: someone has to create the mark on the review board once (it lives in the kosmos-review user's
  files on Mortals). Until then the switch in that board's Settings turned off does the same for that board today.
- Not built here (coordinator, Ice Cream Kitty's lane): the account's computers list showing which are muted.

## Verify
- engine.phonenotify-nopush-7448.test.js: the file and the env var each stop every send (the 8 of #7446), turnOn is
  refused, the default never turns on, status says why; CONTROLS: unmarked it sends, and sends again once unmarked.
- The existing phone-notify tests (718, gate-718, send-4163, phonenotice-6487): 69 pass.

## Review
- Round 1 (opus): 1 blocker fixed: the mark sat in the tunnel state dir, which Forget computer empties, so a demo board
  removed and signed in again lost it and the default turned notices back on (the #7446 shape). It now sits beside
  remote.json, as the person's own off does; a test empties the state dir as Forget does and the mark holds.
  Warnings fixed: existsSync never throws, so an unreadable mark read as unmarked; now only ENOENT is unmarked. A
  turn-on in flight when the mark appears saves nothing. Nit fixed: status no longer claims offByChoice while marked.
  Not done (coordinator): retiring the token there; events the coordinator already holds.
- Round 2 (sonnet): no blocker or warning. CONVERGED.

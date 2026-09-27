# phone-offline-718: a phone with no network is told it is offline, not that the Mac is down

Card: kosmos #4086 (Liu Kang m1107), #718 state 1 from Kano's measured list
(issuecomment-5844683600). One state per PR. Built on state 3 (#4145, merged 2026-09-27), which
rewrote the same failure paths; rebased onto main after it merged.

## What happens today (measured by Kano)
Shots: ~/work/workers/kano/evidence/phone-states-718/st-offline-open--se--light--webkit.png and
st-offline-reload-*. A phone with no network, on the board through Kosmos+, shows "Kosmos is not
answering on this computer" at the top and "We cannot read your agents right now ... Something on
this computer did not answer ... (Load failed)" in the card. It blames the Mac. iOS already tells
these apart (ShellLogic.swift maps NotConnectedToInternet to .offline, "You're offline").

## Finished looks like
- Viewed through Kosmos+, with the browser saying it is offline and a read that got no answer, the
  top note says "You are offline" (no version, host or Applications-folder remedy), and the agents
  card, the projects list, the org note and the project messages say "This phone or computer is
  not connected to the internet, so it cannot reach your Mac."
- The moment the browser is back online the board asks again (the `online` event), rather than
  leaving "You are offline" up for up to five seconds.
- The Mac's own window keeps "Kosmos is not answering on this computer" when offline, because
  loopback needs no network. An online phone whose reads get no answer keeps the Mac copy too
  (that is state 2's subject).
- Unit tests fail on the old page and pass here; a browser check with those two controls.

## Approach
- `BOARD_DEVICE_OFFLINE`, set where BOARD_SIGNED_OUT is (tick and loadProjects), from
  `!answered && deviceOffline()`, and cleared by any answer.
- `deviceOffline()` = `kplusRemote() && navigator.onLine === false`. Only false counts: true means
  "has some network", which is no proof the internet is reachable.
- Checked first at every render site: no answer came, so nothing about sign-in can be known.
- paintOfflineNote keys its re-announce guard on WHICH end it is saying, so a change of end
  repaints and an unchanged one does not.

## Wording (decided, reversible)
"You are offline", matching iOS's "You're offline" without the contraction the board avoids.
"This phone or computer", the same device wording as state 3 (a laptop reaching the Mac through
Kosmos+ is the same case). "your Mac", as state 3 and the Kosmos+ copy say.

## Weakest part
navigator.onLine false is reliable, but a phone on a captive portal or a dead Wi-Fi says online
and fails every fetch; that still reads as "your Mac is not answering". State 2's copy has to
allow for that, since the page cannot tell those apart.

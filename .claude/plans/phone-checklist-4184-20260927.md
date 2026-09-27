# phone-checklist-4184: Josh's first phone test, one script

Addresses #4184 (part of #4090). Routed by Liu Kang (m1553, 2026-09-27).

## Finished means
`android/phone-test-checklist.md`: every on-device check from the cards in #4184, in the order Josh
meets them, each with what he should see and what to send if not, each traced to its card, every
step that needs the coordinator deploy marked, plain language, no em dashes. Liu Kang turns it into
Josh's document.

## Sources
Every card named in #4184 (body and latest comments), gathered 2026-09-27: kosmos #2854, #4140,
#4151, #4171, #4109, #4101, #4086, #4090, #4093, #4113, #4132, #4165, #3763, #718; kosmos-relay
#169 to #173 and the push-tap-4140 branch. Plus what I saw myself on the AVD today (the sign-in and
allow wording, the "Running in Chrome" note, the certificate note, the shade icon, the notification
tap with and without the in-app marker).

## Decisions
- Steps follow the order Josh meets them, not the card order.
- "Wait for the server update" is written into each affected step, with the before-update behaviour
  said plainly, plus one table at the end. As of #3763's last entry, relay #169, #171, #172 and
  #173 are merged and not live; Kano's push-tap-4140 has no PR yet.
- vc3 is named as Liu Kang's install note names it: Kosmos-android-test.apk, 0.1.2, in his Files.
- Three kinds of "wait": the server update (relay #169 and #171 ready; Kano's #4140 in review as
  relay #174, which also carries the Mac's gate.html half), the Mac update for the full-screen board (tunnel with relay #161), and the Mac release
  that turns phone notifications on (engine/phonenotify.js PHONE_APP_CAN_RECEIVE is false on main;
  docs/phone-push-go-live.md: "The board ships with notifications locked off").
- No "expected certificate warning" line: that note is DEV_NOTICE, shown only in dev mode, and the
  live service is not in dev mode. A certificate warning on a real address means stop.
- Not in this script: #4086's signed-out state (the 401 card). A first run will not meet an expired
  session naturally; it can be a later check.
- The pre-update notification tap matches the live service worker (read 2026-09-27): it opens
  https://<address>/?tab=detail&agent=<session> in a browser window. Liu Kang's install note says
  the same.
- The adb recipe sits at the end, marked as for us.

## Weakest part
The first draft said notifications and the certificate warning worked as seen on the emulator; both
came from the local test server, not the live one (challenge-loop iteration 1). The current steps
were checked against main and the live service, but no step has been run on the real phone. The Mac
asleep step (5) has no settled expected result on purpose. What would change my mind: anything Josh
sees that this script calls expected and that the cards do not.

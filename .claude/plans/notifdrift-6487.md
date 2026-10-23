# notifdrift-6487: the phone notification catalog matches the code, and a test keeps it so (kosmos#6487)

## Finished means
docs/phone-notifications.md says what every phone notification shows today, including the iPhone message rows
(the agent's name, the original line, the message itself), and a test fails when the page and the code drift
(the card's "done means" 3). Only the screenshot on Josh's iPhone is left on the card after this.

## The change
- docs/phone-notifications.md: "On an iPhone: the message itself" (rows, the permission-request warning, the
  picture and wait times, what happens with no answer); the DM proposal marked built in that shape; Josh's option-2
  call recorded; the older "never leave the computer" lines corrected; Where the code lives points at the iPhone code.
- web.phone-notify-catalog-6487.test.js: reads the Wording and iPhone tables and checks them against
  engine/phonenotify.js KINDS, web/sw.js notificationFor (run), engine/phonenotice.js parseId and shorten (run),
  server.js's route and answer, engine/kosmos-report-hook.js's permission text, and ios/KosmosNotice (as text).

## Decided, and why
- Check by behaviour where the code can run here (sw.js, phonenotice), by whole function bodies and ordered
  assignments where it cannot (Swift); prose matched with whitespace collapsed so a re-wrap is harmless.
- Not reached, stated in the test: the coordinator's wording lives in kosmos-relay.
- Weakest premise: that iOS keeps the subtitle on a message-style notice; not yet seen on a phone (said on the page).

## Order and rollback
Independent; docs and a test only. Rollback: revert.

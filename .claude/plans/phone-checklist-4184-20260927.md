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
- vc3 is named by its file, Kosmos-android-vc3.apk (Sub-Zero's Files per #4165); which Files it
  reaches Josh from is Liu Kang's call.
- The adb recipe sits at the end, marked as for us.

## Weakest part
Step 7's "before the server update" behaviour is inferred from Kano's no-marker control on the AVD,
not seen against the live server, so it says "may". The Mac approval code format is from two codes
seen on the AVD. What would change my mind: Josh's first run showing a different before-update tap.

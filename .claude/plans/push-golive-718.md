# push-golive-718: the phone-notifications go-live checklist

Card: #718. Assigned by Liu Kang (m458). Owner: Johnny Cage. Docs only.

## Finished means
`docs/phone-push-go-live.md` exists in kosmos: ONE ordered checklist of what turns phone
notifications on for real people, covering what Josh provides, the coordinator deploy and env, the
tunnel release, the board release that opens `PHONE_APP_CAN_RECEIVE`, the iOS and Android builds,
and for every step who does it (Josh-gated or fleet), how to verify it and how to undo it. Every
file, env var, command and log line it names exists at kosmos `main` 8c4ca1d5 / kosmos-relay
`main` 50a846b (checked). Kano's end-to-end check is referenced, not repeated.

## Sources
- Code in both repos at origin/main, read by a citation-only search and spot-checked by hand:
  the live coordinator build (`/v1/meta` = 2226c9d, without #103 or #104), the env template's zero
  push vars, the local `dist/kosmos-tunnel` rejecting `mac-request`, the gate test, every named file.
- Android facts: Sonya (m463, corrected in m464: the AAB is built and verified on her branch).
- Apple team and the MCK-scoped App Store Connect key: Josh-Brain fleet memory note, cited in the doc.

## Decisions
- **Order differs from the list in the ask:** apps reach testers (steps 4 and 5) BEFORE the board
  release that opens the lock (step 7). The lock's own rule is that it opens in the release that
  ships an app able to receive (`engine/phonenotify.js`), so an app has to exist first.
- **The coordinator is deployed with `KOSMOS_PUSH=log` first** and flipped separately (step 8), per
  Kano's plan that sending starts with the tunnel release, not before.
- **APNs settings go in the env template, not by hand,** because a hand-set var makes the next
  `INSTALL_ENV=1` deploy refuse.
- The stale local tunnel binary is called out as its own step; a board cut today would ship it.

## Weakest part
Three things are reasoned, not measured, and the doc says so where they appear: where the .p8 can
live under the unit's `ProtectHome`/`ProtectSystem`; TestFlight builds reporting `production`; and
the Android facts from Sonya's unmerged branch.

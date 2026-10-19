# storelisting-6262: the App Store listing, privacy label and screenshots for io.kosmos.app (#6262)

Splinter, 2026-10-15 22:48: prepare the iOS App Store listing. Nothing is submitted; Josh has not created the app
record yet. The copy describes the product as it will be (Josh 09-14), but only what the reviewed build does (2.3.1).

## Finished looks like
`ios/store/` holds a listing that passes `check-listing.sh`, a privacy label re-checked against today's code, and
6.9-inch screenshots of today's board in light and dark, all true to the build App Review will see. What is still
Josh's (the name, the demo account, the review contact) is named on #6262.

## Done
- listing.md: "your computer (Mac or Windows PC)" rather than "your Mac" (the Windows tunnel, engine/remote.js); the
  name recommended as `Kosmos: AI Agent Manager` (Josh's call); keywords rebalanced; Face ID kept out of the copy
  (built but switched off, `requireBiometricUnlock = false`), with one honest line for App Review.
- privacy-label.md: re-checked at 24e44896eb (Apple frameworks only). Account deletion exists and starts in the app
  (#3868; signin.html shows Delete account for IN_IOS_APP). The computer's own reports (Josh 09-14) are not on the
  iPhone label; the privacy policy names them.
- README.md: the retake, the iPhone Duo gap (no Duo simulator device on Xcode 27.0), and the home row's order.
- screenshots: retaken with ios/store/shoot.sh (queued-heavy), all eight checked by eye.
- mobile-shots.js project-room: the shot no longer scrolls the project's heading under the sticky top bar (it cut the
  title in half). It steps back by a pinned bar's height and ignores a full-screen overlay.

## Not done
- No iPhone Duo set: no device type exists on this Mac yet.
- Nothing entered in App Store Connect (no app record).

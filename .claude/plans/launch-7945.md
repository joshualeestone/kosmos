# kosmos#7945: the iPhone launch screen matches the app (no navy flash)

Josh, 11-04 08:31 CST (Kosmos, iPhone): "when I'm loading up the app it shows a flicker of the navy blue screen.
What is the base loading screen? We should design that up nice"

## What it was
`UILaunchScreen` > `UIColorName = LaunchBackground`, a single navy #17233D with no dark variant. A launch hands off
to the native sign-in or Agents screen (Today is off in shipped builds; the lock is off by default), both on
`Palette.ground` (#faf9f7 light, #0c0d0f dark), so every launch flashed navy.

## Finished looks like
- Light: the launch screen is #faf9f7 with the still KOSMOS orb (K facing) in deep gold #9c741b, 120 pt, centred.
- Dark: #0c0d0f with the orb in #e3b341.
- The hand-off to sign-in or Agents changes no colour.

## Call made
The orb's still frame (the one Reduce Motion shows), not the K app icon: Josh chose the orb as the loading mark on
11-03 (#7896), and the launch screen is the first loading moment. Rejected: the K tile from the app icon (a coloured
square on the ground reads as a splash ad, and it is the home-screen icon the person just tapped); an animated
launch (iOS launch screens cannot animate). Weakest premise: the orb vanishes at hand-off rather than settling; a
person may read that as abrupt. What would change my mind: Josh preferring the K, or wanting the orb to stay as the
first screen's loading mark.

## Measured
- Built app: check-app-assets.sh PASS, now also requiring UIImageName = LaunchOrb and LaunchOrb in Assets.car.
- Recorded a fresh install's launch on an erased iPhone 17e simulator (iOS 27.0), 20 fps frames: light goes from
  the home screen straight to (247,245,244) with the gold orb, then sign-in reading the same (247,245,244) (the
  capture's colour handling of #faf9f7; what matters is that the two frames match); dark straight to
  (11,11,13) with the bright orb, then sign-in. No navy frame in either.
- CONTROL: the same recording before the simulator was erased showed navy (17,33,61) for about a second, from iOS's
  cached launch snapshot of the old build. So the recording can see navy.
- ios/tools/render-launch-orb.sh draws the six PNGs from OrbLogic, one path per opacity group as KosmosOrb does;
  LogicTests/run-orb.sh draws them again and fails if the committed ones differ (CI runs it).

## Not measured
A real iPhone. iOS caches launch screens per app: a phone that already had the navy one may show it once more
until iOS refreshes its snapshot after the update (on the simulator only an erase cleared it).

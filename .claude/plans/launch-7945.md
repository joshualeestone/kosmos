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
  LogicTests/run-orb.sh draws them again and compares the decoded pixels with the committed ones (a few levels of
  tolerance, so another toolchain's encoding does not fail it; a changed orb does). CI runs it.
  Controls: a swapped PNG fails (63718 channels off); OrbLogic's seed 7 changed to 8 fails all six (23912 to
  228027 channels off); the real orb passes.
- run-orb.sh also reads Palette.ground and Palette.starGold from AgentsView.swift and fails if LaunchBackground or the
  renderer's golds differ, so changing the palette cannot quietly bring a flash back. Controls: ground's light side
  changed to 0xffffff fails, starGold's dark side changed by one fails, an unchanged copy passes. The launch checks run
  before the orb suite, so its VERDICT line is the last one printed.
- The pixel check allows at most 8 channels (or one in 50,000) off by more than 8 levels. Control: a single 2 px dot painted on the
  1x light PNG fails it (16 channels; the earlier budget of one in 1,000, 57 channels, would have passed it). A first
  try at this control used ffmpeg's drawbox, which left the transparent pixels unchanged, so it passed for the wrong
  reason; the dot is painted with CoreGraphics instead and the file confirmed changed.
- The launch checks also fail if AppTabs.todayTab is turned on in shipped builds (control: it fails), since the launch
  ground assumes a native first screen; a palette line the check cannot read prints its own VERDICT (control).
- It reads the catalog's own appearance tags: a dark colour that lost its tag fails, and so does a light/dark filename
  swap in LaunchOrb's Contents.json (controls); the 2 px dot still fails with the output filtered.
  Each LaunchOrb entry's file must match its scale too, and a seventh entry fails (controls: 2x/3x swapped, an
  extra entry), and the six must be light and dark at each scale (control: six light entries fail).

## Not measured
A real iPhone. iOS caches launch screens per app: a phone that already had the navy one may show it once more
until iOS refreshes its snapshot after the update (on the simulator only an erase cleared it).
A launch from a notification tap opens on the board page, which is navy (its own ground, kosmosNavy), so that path
goes from the launch ground to navy. Before this change it was navy to navy. The board page keeps its navy here;
matching it would mean the launch screen guessing which way the app opens. The plain launch (the icon) is the case
Josh named.
The pixel check's budget (8 channels, or one in 50,000) was set on this Mac; the PR's CI run on macOS-latest is its first
test on another toolchain. Red there for drift alone fails safe (red, not a false green), and the budget is one number.
The biometric lock screen (off by default) draws on the system background, not the launch ground, so with the
lock on, launch hands off with a slight shift (white vs #faf9f7). Not changed here.

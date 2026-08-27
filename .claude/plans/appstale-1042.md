# appstale-1042: the app can tell when it is the stale half (kosmos#1042)

## Why

Josh pressed Cmd+Z and Cmd+comma on 0.5.71 and both did nothing. Splinter was about to
record two defects with confident reasoning about each. After a quit and reopen, all three
shortcuts worked, Undo included. **There was never a menu bar bug.** He had been pressing
keys at an app that had never restarted.

It cost roughly an hour and produced a confident wrong conclusion from three people.

## What is actually true, measured rather than reasoned

| fact | who measured it |
|---|---|
| an update restarts the **board** and leaves the app running | Ice Cream Kitty, coordinator, 23:10:19Z: the board dropped and returned in ~11s with a fresh relay ticket |
| a quit-and-reopen restarts the **app** and leaves the board running | Kitty, 23:33-23:34, sampled every ~7s: last-contact age never climbed, no relay ticket, journal silent |
| `Bundle.main` reports the code the app is **actually running** | me, in a real `.app`, plist rewritten underneath a live process, in BOTH orders |
| a quit-and-reopen is a **non-event** on the coordinator | Kitty: same mac id, every paired device stays paired, nothing to sign in to again |

⭐ **So there is no single "version of Kosmos".** The two halves are separate processes on
independent update paths, neither ever restarts the other, and being different versions is
the NORMAL case rather than an edge case. Every version on any screen is the board's, which
is why nothing Josh could look at would have told him.

## What finished looks like

A person whose app is behind the board is told so, in a sentence that names **which half** is
old, and offered the action that fixes that half. Stated as a test rather than a feeling: the
comparison is gated at release time, and the gate fails if the comparison is wrong.

## Scope

`native-app/main.swift` and `tools/build-kosmos-bundle.sh`. **Not `web/index.html`** (Mona
Lisa is in it, and the board-side staleness is already correct via #995).

1. `runningAppVersion()` reads `Bundle.main`.
2. `checkWhetherThisAppIsBehind(port:)` asks `/api/status` **once**, after `didFinish`, never
   on a timer. The person is told at the moment the two are demonstrably out of step, not
   nagged.
3. `offerRelaunch` states both versions and offers to open Kosmos again.
4. `--kosmos-app-stale-selftest`, ten cases, wired into the bundle build.

## The three restraints, and why each is there

- **It must not say "reload".** Kitty's line, and the card turns on it: a banner saying
  "reload to update" cannot be honest, because reloading updates one half.
- **Only the direction with a measured remedy speaks.** A board BEHIND the app is a real
  mismatch with no verified fix, so it is logged and the person told nothing. Inventing
  advice for the case nobody measured is the defect this card is about.
- **It never quits until the replacement is confirmed started.** Terminating first and hoping
  leaves a person with no Kosmos at all, which is far worse than a stale menu bar. On failure
  it stays open and says so.

An unreadable version is UNKNOWN and shows nothing. No semver cleverness: a prerelease suffix
gives nil rather than a guess.

## Verification (done when)

1. The selftest passes on the real binary. **MEASURED:** 10/10, exit 0, verified without a
   pipe because a pipe eats the exit code.
2. **NEGATIVE CONTROL, run not assumed:** swapping in a lexical comparison fails EXACTLY the
   two numeric-vs-lexical rows and no others, exit 1. ⭐ `0.5.9` vs `0.5.10` is the row that
   earns the file: a string compare calls `0.5.9` the later one, so a lexical check goes
   silent precisely when the minor number gains a digit, and would have looked correct on
   every version shipped to date.
3. The gate runs **in a real bundle build**, not just the hatch run directly. **MEASURED:**
   full build, both #1032 and #1042 gates fired, floor certified, staged app boots and serves
   its page, installer emitted, zero failures.
4. Full suite; blind review; PR per house flow.
5. ⚠️ **NOT ESTABLISHED, and left open deliberately:** whether a person who is told will act
   on it. Everything here makes the state *sayable*. Whether the sentence works is a thing to
   watch after it ships, not to assert now.

## Out of scope

- Showing two versions in the footer. It is a real question ("there is no single version for
  it to show") and a design call on a surface that is not mine tonight. Card it separately.
- The board-side staleness. Already correct: the footer offers Reload (#995).

# Plan: render-room-scroll flakes under load and reds a correct release (kosmos#1712)

## Problem

`docs/browser-checks/render-room-scroll.js` fails under concurrent load and passes
on retry, on an unchanged tree. Angel characterised it across three cuts with a
stable signature (`h:4715`, `rewrote:false`, "nothing was added"). It forced a
20-minute fleet-wide quiet window before the 0.6.20 cut. It is pre-existing on
main, not anybody's diff, and it will red a correct release.

Root cause: the check measures asynchronous growth after FIXED waits. The room
paints posted messages, and an arriving line grows the thread, asynchronously.
Under concurrent load the server is contended and the paint/reflow lands after
the fixed wait, so the check reads an UNGROWN thread and calls it a failure --
then passes on retry when the box is quiet.

## Approach (the card's own direction)

Make the growth wait explicit and bounded rather than incidental, so the check
either measures a grown thread or reports that it could not, instead of measuring
an ungrown one and calling it a failure. Applied at the three loci that measure
GROWTH (the class the card names):

1. Arm 6 (an arriving line grows the thread) -- the proven flake. Replace the
   fixed 150ms after `paintRoom` with an in-page bounded poll for the repaint AND
   the growth, up to 15s, breaking early the instant both land.
2. The tab-view "room is actually scrollable" measurement -- replace the fixed
   900ms + one-shot measure with `waitForFunction(scrollHeight > clientHeight+50)`
   bounded at 15s.
3. The consolidated "room is actually scrollable" measurement -- same as (2).

The two `rewrote`-after-120ms repaint arms are a DIFFERENT measurement (the write
landed + reader position, not growth), they passed under load, and they are not
the class the card names -- left untouched to keep the diff to the reported flake.

## Must keep

The "nothing was added" / `posted >= 20` controls, untouched. That line is what
let a first-time cutter tell a setup failure from a real defect mid-release, and
Josh and Splinter both said keep it. A room/thread that genuinely never grows
still fails after the bound -- now told apart from the timing artifact.

## Checklist

- [x] Bounded poll at arm 6 (proven flake locus)
- [x] Bounded waitForFunction at the tab-view scrollable measurement
- [x] Bounded waitForFunction at the consolidated scrollable measurement
- [x] Keep the posted>=20 / "nothing was added" controls
- [x] Validate: reproduce the failure before, then clean alone, 3x concurrent, and 2x under a full yarn test suite
- [ ] Challenge-loop to convergence + proof file
- [ ] PR

## Out of scope

The unrelated fixed waits (server/setup/poll-interval settles at 237/259/261/304/
319/380/385/393) are not growth measurements and are not the flake class; not
touched.

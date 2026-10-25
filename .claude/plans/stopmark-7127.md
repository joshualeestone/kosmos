# stopmark-7127: tools/test-stopmark-6651.sh survives a leftover s6651 disk image

Card: joshualeestone/kosmos#7127 (filed by Mona Lisa).

## Problem
The full-disk case attached its image under the fixed volume name `s6651` and read the mount point back with
`awk '/s6651/ { print $NF }'`. A run stopped with kill -KILL never runs the EXIT trap, so its image stays mounted, and
macOS mounts the next one as `/Volumes/s6651 1`; `$NF` then reads `1`, and every later run writes to `./1/` and goes red
in anyone's validation. Found while fixing it: both `dd` fills were unbounded, so with a wrong DISK whose path exists
they fill the REAL disk (it happened here: ~95 GB in two minutes before it was stopped).

## Fix
- Attach at a private mount point inside the run's temp folder (`-mountpoint "$TMP/mnt"`) under a per-run volume name
  (`s6651-$$`): nothing is parsed from hdiutil's output, so no other volume can move where the run writes.
- A same-named decoy is mounted the default way first, so every run carries the collision; it is optional scaffolding
  (if it cannot be mounted, only the #7127 check says SKIP). A check asserts the writes landed on the run's own image, a
  filesystem of its own, and not in ./1/.
- Both `dd` fills are bounded to 16 MB (twice the image), so a wrong DISK can never fill a real disk.

## Not done
- Sweeping images leaked by killed runs at start. A killed run leaks two images: its own (at a private path) and the
  decoy (at /Volumes/s6651-<pid>, visible machine-wide). Neither can affect where a later run writes (pids can be
  reused, but nothing reads a decoy's mount point), so this is a resource leak until reboot or a manual detach.

## Checks
- the decoy is the ONLY guard against a return to parsing the mount point, measured both arms: with the old parse
  restored and the decoy disabled the test PASSES (the revert is invisible); with the decoy it FAILS three checks,
  including the #7127 one. Without a same-named volume mounted, the old parse reads the right path.
- cleanup never deletes under an attached image (judged by device number, not a path match against mount's
  listing, which prints /private/...); a copy whose detaches always fail left $TMP in place and named both images
- the leftover scan covers ./1 to ./9 on purpose: macOS suffixes beyond 9 need nine simultaneous leaks
- leftover ./N/ debris from an older run (its fill, the logs/ it made, or any board.stopped*) is named in a NOTE
  with its size, whether or not this Mac can mount an image, and never failed on; only N/ debris this run newly
  creates fails the #7127 check (tested: a logs-only leftover and a stranded-marker leftover both get a NOTE)
- the test passes; it passes again with a killed run's image still mounted (simulated with kill -KILL)
- two-arm control with a private name (c7127): the OLD logic goes red with the card's exact error, the new passes
- mutant (old parse back in, bounded dd): FAIL on the card's two checks and on the new #7127 check; wrote nothing

## Status
- [x] fix and checks
- [x] challenge-loop converged (12 iterations)
- [ ] full validation, PR

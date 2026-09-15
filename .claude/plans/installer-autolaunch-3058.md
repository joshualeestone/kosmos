# #3058 - post-install auto-launch: honest message + regression coverage

## The report
Josh, 0.6.64 fresh staging install on test12@Caseys-Mac-mini: "it did not launch
Kosmos on its own." A prior Kosmos held /Applications, so ours installed to
~/Applications. He was left at a terminal unsure what to do.

## What the investigation found (reproduced, not reasoned)
Drove install/setup.sh in a sandbox through the EXACT shape (fresh KOSMOS_HOME,
a foreign Kosmos.app in the system Applications folder, the recording open-stub):
- our bundle diverts to ~/Applications (correct)
- the foreign bundle is left byte-identical (correct)
- the installer DOES auto-launch our ~/Applications copy - the open-stub recorded
  exactly `<home>/Applications/Kosmos.app`, and "Opening Kosmos..." printed.

So the launch gate is correct for a genuine fresh LOCAL install. The fresh-vs-update
axis (renettilley's parked hypothesis) is a dead end, and the foreign-bundle path is
not broken either.

Most likely real cause of the observed "did not launch": the test Mac is a headless
fleet mini, so the install ran over SSH, where macOS `open` cannot reach a GUI login
session. That is the documented best-effort limit at setup.sh's launch header - not
fixable in the installer.

## The two shippable, testable defects
1. **Contradictory closing message.** The summary printed "Open the Kosmos app from
   your Applications folder" unconditionally under BOARD_OURS=yes, THEN the launch
   block auto-opened it - so the transcript told the user to open it by hand even on
   the runs where it opened itself. Fix: key the summary on the already-computed
   APP_MADE. When there is a bundle to open, promise it will open and give the manual
   step only as a fallback ("If it does not appear ..."), which is also the honest
   state over SSH/headless. Keep the bare imperative for APP_MADE=no (no bundle to
   auto-launch). No gate duplication, no ordering change.
2. **Coverage gap.** tools/test-install.sh's foreign-divert pass ran with the open
   suppressed, so auto-launch in this scenario was untested. Add a pass driving the
   open-stub through it, asserting exactly one open fires on OUR diverted bundle (not
   the foreign one) and the new summary wording.

## Weakest premise
If Josh's install was neither over SSH nor a repeat install, something machine-specific
I cannot observe suppressed the launch. But every gate I can drive fires correctly, so
this does not guess-change a working gate. Noted on the card; not blocking on his recall.

## Not done (scope)
The SSH/headless `open` no-op is a macOS constraint, out of installer scope.
Addresses #3058 (non-closing) - reporter verifies in-app after the cut.

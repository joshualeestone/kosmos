# whatsnew-0812: What's New for the next cut (0.8.13)

## Goal
The What's New window for the next cut. It was written for 0.8.12, but 0.8.12 was cut at 04:07 without it
(KOSMOS_CUT_NO_WHATS_NEW: this PR's CI rerun sat 30 minutes with no runner, and two unrelated tests flaked, #8812).
So the window is built for 0.8.13, the next cut: the cut's step 1b-ii requires web/whats-new.json to be for the cut's
version. The highlights are the same; their pool entries keep since 0.8.12, the version they first shipped in.

## Done
- release/whats-new-pool.json: `tools/whats-new-pool.js build 0.8.12` first recorded prod 0.8.11 (its five window
  highlights marked shown, lastProd 0.8.11). Then 0.8.12 entries: seven for the window's pool (ranks 8.0 to 8.4 make
  the window: old Safari #8781 with #8790's pictures and previews (merged after the 0.8.12 cut, so in 0.8.13), apostrophe #8784, remote sign-in #8785, Linux Update #8786 S1, Cloud nightly #8786 S2;
  below it: crashed session #8782 at 9.7 and the phone first-run #8787 at 9.8, both behind Starring at 9.6), and five
  notes-only entries (#8777, #8776, #8771, #8773 for Windows, and kosmos task --how).
- web/whats-new.json: built by the tool for 0.8.13, not by hand.

## Decided
- No `platforms` tag on the two Linux items: the window accepts only mac and windows, and a Linux board shows the
  untagged list. The lines name Linux or Kosmos Cloud, so a Mac reader knows they are not about them.
- The Linux Update line is for PR #8805, which merged (91b52becda) before this branch was finished.
- The sign-in line says the sign-in "counts for as long as it lasts", not "until you sign out": a sign-in also ends at
  its own expiry, Sign out everywhere, or removing the device. Two reviews asked for opposite wordings; this one is
  true of every ending, so it stays.
- The two Linux and Kosmos Cloud items (8.3, 8.4) rank above the crashed-session fix (9.7), which every platform
  gets: getting paying Cloud machines to update was tonight's priority (kosmos#8786), and the crashed-session fix is in
  every build's release notes either way.
- The Safari line says nothing about downloads: #8790's download key (#8816) may or may not land before the next cut,
  and a line about it would be wrong one way or the other. If it lands, it gets its own entry.
- Left out on purpose: the iPhone app's changes (#8793 the empty Agents tab, #8809 and #8815 Sign in again), which
  ship with the iPhone app, not in this release; #8806 (busy kosmos room refinements), which the existing notes-only
  line still describes; and changes with nothing to see (the sign-in redirect hardening, the enrolment engine side, hand-over
  internals, the new agent's brief text).

## Weakest premise
That each line describes the shipped behaviour exactly. Every line was written from the card and PR, not from using
the build.
The lead line (older Safari) is not yet tried on a real Safari before 16.4: the board's header was proven with a recording
stub, and the connector half reaches the build only through the cut's rebuild from relay main (step 1d refuses a stale one).
The first real check is the customer's iMac (kosmos#8781).
Checked by content: the relay half, kosmos-relay #854, is on relay main at 5fd421b1c0 (the board-page arm in
crates/tunnel/src/proxy.rs there, absent in its parent). The cut wrapper builds the connector from relay main and aborts
if it is not current, so this line cannot ship without it.

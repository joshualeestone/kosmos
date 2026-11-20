# whatsnew-0812: What's New for the 0.8.12 staging cut

## Goal
main had run past staging 0.8.11 beyond the gap alarm's limit (#1050). The cut's step 1b-ii requires web/whats-new.json to be for
the cut's version and built from the pool. Nothing merged since 0.8.11 added a pool entry.

## Done
- release/whats-new-pool.json: `tools/whats-new-pool.js build 0.8.12` first recorded prod 0.8.11 (its five window
  highlights marked shown, lastProd 0.8.11). Then 0.8.12 entries: seven for the window's pool (ranks 8.0 to 8.4 make
  the window: old Safari #8781, apostrophe #8784, remote sign-in #8785, Linux Update #8786 S1, Cloud nightly #8786 S2;
  below it: crashed session #8782 at 9.7 and the phone first-run #8787 at 9.8, both behind Starring at 9.6), and five
  notes-only entries (#8777, #8776, #8771, #8773 for Windows, and kosmos task --how).
- web/whats-new.json: built by the tool, not by hand.

## Decided
- No `platforms` tag on the two Linux items: the window accepts only mac and windows, and a Linux board shows the
  untagged list. The lines name Linux or Kosmos Cloud, so a Mac reader knows they are not about them.
- The Linux Update line is for PR #8805, which merged (91b52becda) before this branch was finished.
- The sign-in line says the sign-in "counts for as long as it lasts", not "until you sign out": a sign-in also ends at
  its own expiry, Sign out everywhere, or removing the device. Two reviews asked for opposite wordings; this one is
  true of every ending, so it stays.
- Left out on purpose: the iPhone app's empty Agents tab (#8793), which ships with the iPhone app, not in this
  release; and changes with nothing to see (the sign-in redirect hardening, the enrolment engine side, hand-over
  internals, the new agent's brief text).

## Weakest premise
That each line describes the shipped behaviour exactly. Every line was written from the card and PR, not from using
the build.
The lead line (older Safari) is not yet tried on a real Safari before 16.4: the board's header was proven with a recording
stub, and the connector half reaches the build only through the cut's rebuild from relay main (step 1d refuses a stale one).
The first real check is the customer's iMac (kosmos#8781).

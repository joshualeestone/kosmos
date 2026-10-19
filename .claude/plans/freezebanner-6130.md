# kosmos#6130: the freeze banner holds merges instead of calling them safe

## Change
- tools/lib/release-freeze.sh `release_freeze_notice sha build version channel`: prints
  "Merges after this line are NOT in <version>. HOLD MERGES TO MAIN until <version> serves on <channel>",
  and why (a redo freezes CURRENT main). All four arguments are required; a missing one prints nothing.
- tools/release.sh step 2b passes "$V" and "$CUT_CHANNEL".

## Decided
- Reword the banner (the card's first option), not "a redo reuses the original sha". A re-cut usually exists to
  pick up a fix merged to main, so freezing the old sha would defeat it.
- Name the channel, not "staging": the default cut is prod, and "serves on staging" would be false there.
- Keep #1369's point: the hold has a stated end (that version serving), so it cannot quietly become "never merge".

## Weakest premise
That the team rule is "hold until the version serves". Evidence: docs/releasing.md ("call a merge freeze for its
duration"), the card, and Splinter's 0.7.48 MERGE HOLD. If the rule changes, this banner changes with it.

## Evidence
- tools.release-freeze-notice.test.js, 5 tests: the hold wording; prod names prod; sha and build; every missing
  argument refuses with no output; release.sh's one call passes four arguments under the names it really uses.
- Mutants, each reds a test: the old "SAFE" wording, dropping the channel guard, a two-argument call.

## Review
1. opus: no blocker. WARNING: an abandoned cut left a hold nothing could end (the #1369 failure), so the banner now
   adds "or the cutter calls this cut off", asserted and mutant-checked. NITs taken: "NOT in this attempt at
   <version>" (merges DO ride a redo), and docs/releasing.md names the channel's pointer and the called-off end.
2. sonnet: no blocker or warning. Converged. NITs taken: review provenance moved out of the code comment and the
   test message; docs/releasing.md now says every cut holds merges, matching the banner. NIT left: the call-site
   test is a source-text match; it fails on a short call, which is its job.

# leaknames-5907: the leak guard names the allowlisted families that left nothing (kosmos#5907 follow-up 3)

## Problem
`leak_tmp_check` (tools/lib/test-leak-guard.sh) ends a run with "note: 39 allowlisted families left nothing this run;
remove any that no longer leak". It counts them but does not name them, so nobody can tell which allowlist line is
stale. #5907 needed exactly that for the `yarn` and `v8-compile-cache` families, which the local run no longer makes
since #5915 (run-tests.sh no longer runs yarn), and could not get it.

## Change
- The note names the families: `note: N allowlisted families left nothing this run (a, b, c); remove any that no longer
  leak from <file> (one clean run is not proof)`. The prefix is unchanged, so anything matching it still matches.
- tools/test-test-leak-guard-4273.sh: the unused family is named, and a family that did leak is not.

## Not done here
Deleting allowlist lines. That needs several runs' worth of these notes, since some families leak only when a test
fails (kosmos-dmfiles is listed for that reason).

## Weakest premise
That a line of up to ~40 names is readable enough in a validation log. It is one line, at the end, after the verdict.

## Checked
A probe of leak_tmp_check on a scratch root: `note: 2 allowlisted families left nothing this run (gone-family,
other-gone)`, rc 0, the used family not named.

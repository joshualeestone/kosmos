# geminihooks-8364: uninstall takes Kosmos's hooks out of Gemini's settings

Card: joshualeestone/kosmos#8364 (found in review of #8362). Built on geminiwrote-8362 (PR #8376): both edit the same
lines of install/setup.sh.

## Finished looks like

After a Mac/Linux uninstall, no Gemini settings file it looks in (~/.gemini/settings.json, or AGENT_WORKFORCE_GEMINI_HOME
as set at uninstall, and every ~/.gemini-<label>/.gemini/settings.json) holds a hook running this install's report
bridge, which the uninstall
deletes with the data folder's bin/. Everything else in those files stays: the person's own hooks, a hook sharing one
of our entries, another install's hooks, and their settings. A file that cannot be read or saved is named; with no
node, or on a re-run after the folder went, every file still pointing at the bridge is named.

## Decided

Extend the existing self-contained unwire (#5998) rather than load the installed engine: the hooks were written by
every install since #3296, and the engine present at uninstall may predate any unwire. A hook is ours when its
command names the bridge's own path, <data folder>/bin/gemini-report-bridge.js, as one string with a quote, a space or
the start before it and a quote, a space or the end after it (the real path too); the no-node fallback only names files, matching after a double quote as commandFor writes. The Claude part is unchanged in behaviour; its loop body became cleanFile(), shared.

Rejected: matching on the marker alone (another install's hooks would go); loading the engine (above).

Weakest premise: a second Kosmos install sharing the same data folder is not protected; its agents' hooks point at the
same bridge, which this uninstall deletes anyway.

Would change my mind: a hook command form whose bridge path is not quoted the way commandFor writes it.

Limits, stated: a default home wired while AGENT_WORKFORCE_GEMINI_HOME pointed somewhere else, and uninstalled without
it, is neither cleaned nor named (the Windows uninstall has the same reach). A settings file gemini accepts but
JSON.parse does not (one with comments) is named, never edited. Gemini key homes under the data folder exist only on
Windows (win32keyed.js), so this list has none.

## Change

- install/setup.sh: the unwire script takes the data folder as a third argument, cleans Gemini's files with its own
  rule, and marks Gemini's leftover files; gemini_hook_settings_left (no node / re-run) and say_gemini_hooks_left.
- install.uninstall-geminihooks-8364.test.js (7, the real setup.sh, hooks written by the real ensurePrepared).

## Results

- New 7 of 7; install.uninstall-unwire-5998 9 of 9; install.uninstall-gemini-8362 7 of 7.
- Control: with the Gemini step switched off, the main check fails.

## Challenge loop

- Iteration 1 (opus): 2 WARNINGs. The test passed the runner's AGENT_WORKFORCE_GEMINI_HOME through to the real
  uninstall, which could then edit a real file outside the sandbox: FIXED (removed from the test's environment; it was
  unset on this Mac and ~/.gemini was not touched). No check covered the override: FIXED (an arm sets it to a sandbox
  home and asserts ~/.gemini is untouched). NITs FIXED: the Gemini file list is de-duplicated (node and shell); the
  no-node fallback also matches the data folder's real path; the re-run arm asserts another install's file is not
  named. NITs noted: a KOSMOS_HOME that is not an install skips this step while bin/ still goes (as #8362's undo);
  the order check compares positions in the file.
- Validation 0 passed (before these fixes).
- Iteration 2 (sonnet): 1 WARNING: a home wired under a different AGENT_WORKFORCE_GEMINI_HOME is outside the list:
  DEFERRED, stated in the plan (Finished narrowed to the files it looks in; Limits). NITs: a commented settings file is
  named, not cleaned (stated); the order check and the .gemini-* glob noted.
- Validation 1 FAILED (I first wrote here that it passed, before reading it): tools/test-data-root-1511.sh, an
  uninstall with no runtime exited 1 silently. gemini_hook_settings_left ended its loop on an absent file; under the
  file's pipefail that status reached the pipe into awk, and set -e ended the uninstall. FIXED (an if per file), with a
  check (no node, no Gemini files) shown failing without the fix.
- Validation 2 passed (with the pipefail fix and the /bin/sh tests).
- Iteration 3 (opus): 1 WARNING: a KOSMOS_HOME that is not an install skipped the Gemini step while the data folder's
  bin/ (the bridge) is still removed, so its hooks were left pointing at nothing with no word: FIXED (the files are
  named in that branch), with a check. NITs FIXED: the unwire's comment names Gemini's rule; the fallback's variables
  are local, as its sibling's. NITs noted: the real-path arms are untested (the test's temp root is already real);
  the order check compares positions; Windows also removes hooks whose script is gone.
- Validation 3 passed.
- Iteration 4 (sonnet): 2 WARNINGs. The match tested the bridge's name and the folder separately, so a hook of the
  person's naming both apart would be taken: FIXED (the bridge's path as one string, after a quote, a space or the
  start), with a fixture that must survive. The sentence said "could not be taken out" in branches where nothing
  tried: FIXED (it now says the files still hold Kosmos's hooks, true in every branch). NITs noted (as before).
- Validation 4 passed.
- Iteration 5 (opus): 1 WARNING: on a re-run the bridge may already be gone, so "a script this uninstall removes" was not
  always true: FIXED ("removes or that is already gone"). NITs FIXED: the fallback's comment names every caller and its
  narrower match; this plan's Decided states the one-string rule. NIT noted: the fallback greps the whole file (it only
  names files).
- Validation 5 passed.
- Iteration 6 (sonnet): 1 WARNING: the match was not anchored on the right, so <bin>/gemini-report-bridge-mine.sh would
  match: FIXED (the path ends in .js, then a quote, a space or the end; the shell fallback looks for the path with its
  closing quote, plain or JSON-escaped), with a fixture that must survive. NIT: Windows-only key homes stated in Limits.

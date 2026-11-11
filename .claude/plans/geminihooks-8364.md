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
command contains gemini-report-bridge and names a path inside this data folder's bin/ (after a quote, a space, or at
the start; the real path too). The Claude part is unchanged in behaviour; its loop body became cleanFile(), shared.

Rejected: matching on the marker alone (another install's hooks would go); loading the engine (above).

Weakest premise: a second Kosmos install sharing the same data folder is not protected; its agents' hooks point at the
same bridge, which this uninstall deletes anyway.

Would change my mind: a hook command form whose bridge path is not quoted the way commandFor writes it.

Limits, stated: a default home wired while AGENT_WORKFORCE_GEMINI_HOME pointed somewhere else, and uninstalled without
it, is neither cleaned nor named (the Windows uninstall has the same reach). A settings file gemini accepts but
JSON.parse does not (one with comments) is named, never edited.

## Change

- install/setup.sh: the unwire script takes the data folder as a third argument, cleans Gemini's files with its own
  rule, and marks Gemini's leftover files; gemini_hook_settings_left (no node / re-run) and say_gemini_hooks_left.
- install.uninstall-geminihooks-8364.test.js (6, the real setup.sh, hooks written by the real ensurePrepared).

## Results

- New 6 of 6; install.uninstall-unwire-5998 9 of 9; install.uninstall-gemini-8362 7 of 7.
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

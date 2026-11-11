# geminihooks-8364: uninstall takes Kosmos's hooks out of Gemini's settings

Card: joshualeestone/kosmos#8364 (found in review of #8362). Built on geminiwrote-8362 (PR #8376): both edit the same
lines of install/setup.sh.

## Finished looks like

After a Mac/Linux uninstall, no Gemini settings file (~/.gemini/settings.json or AGENT_WORKFORCE_GEMINI_HOME, and every
~/.gemini-<label>/.gemini/settings.json) holds a hook running this install's report bridge, which the uninstall
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

## Change

- install/setup.sh: the unwire script takes the data folder as a third argument, cleans Gemini's files with its own
  rule, and marks Gemini's leftover files; gemini_hook_settings_left (no node / re-run) and say_gemini_hooks_left.
- install.uninstall-geminihooks-8364.test.js (4, the real setup.sh, hooks written by the real ensurePrepared).

## Results

- New 4 of 4; install.uninstall-unwire-5998 9 of 9; install.uninstall-gemini-8362 7 of 7.
- Control: with the Gemini step switched off, the main check fails.

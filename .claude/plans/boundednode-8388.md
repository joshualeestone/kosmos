# boundednode-8388: the uninstall's node steps are time-bounded

Card: kosmos#8388. install/setup.sh's uninstall runs the bundled node with no time limit in the steps that read the
person's own settings files. A file on a stalled mount (a home or account folder linked to a network or cloud folder),
or a hung require in the installed engine, would stop the uninstall there with no sentence. The same file already
bounds its other call into the installed engine (_kosmos_data_root) with a poll-and-exit watchdog for that reason.

## Change (after two review rounds)
- `_kosmos_wait_bounded <pid>`: a FOREGROUND poll in 0.2 s ticks, bounded by KOSMOS_UNINSTALL_NODE_SECONDS (default 10;
  non-numeric falls back to 10; leading zeros stripped, or 08 is an octal error). TERM at the limit, KILL after a 2 s
  grace, and if the process still lives (an uninterruptible read on a hard network mount) it is ABANDONED, never waited
  on: _kwb_abandoned=yes, return 143. Review 1 measured that the first version (a background watchdog then a blocking
  wait) did not bound that case at all.
- The Claude hook unwire (#5998) runs node in the background and waits through the helper, with the whole wait's stderr
  discarded (bash's own "Terminated" job line). After ANY stop (review 3: TERM working shows a stall was interruptible,
  not that it ended) nothing reads or removes a file in those folders again: the file-naming fallback is skipped, and one
  sentence says the step did not finish, whether it was stopped or left running, and where to check by hand (the
  settings.json in each Claude folder under the agent home, and any `.kosmos-unwire.<n>` copy beside it). Review 1's temp
  sweep was taken out again for the same reason.
- Residual, stated: an abandoned node may still finish later and overwrite a settings file from an old snapshot (it
  would only remove Kosmos's own entries); a node killed by another signal reads as stopped (NIT, harmless).

- The Gemini settings undo (#8362, merged in #8376; `gemini_settings_undo`) runs node in the background to a temp file
  through the same helper (review 4) and says one line on a stop; the record is kept and named by the existing
  not-finished sentence. The setting is capped at 6 digits (more falls back to 10).
- Untested, stated: the ABANDON path (no uninterruptible process can be made in a test). Review 4's NITs 2 to 5 are
  residuals, not fixed in this slice.

## Not in this slice
The Gemini hook unwire (#8364) is not on main (only gemini_settings_undo is); whoever lands it wraps its node step
with the helper.

## Tests
install.uninstall-unwire-5998.test.js (5 for this card; 14 in the file; runUninstall returns stdout and stderr): a
never-returning node (stopped, the sentence names the home, no job line, under 6 s), a TERM-ignoring node (KILLed), after
a stop nothing beside the settings is touched and the fallback does not run, a quick step not held (under 4 s), a limit
written 08. 8 mutation arms: 7 red; `no-term` survives by design (a node that obeys TERM is then stopped by KILL 2 s later;
only timing differs). bash 3.2 and dash parse the file; a reviewer ran the test file under dash too (14/14).
install.uninstall-gemini-8362.test.js: a Gemini undo that never returns (busy loop) with a 1 s limit: the uninstall
ends under 6 s, says it did not finish in 1s, leaves the settings unchanged and keeps and names the record, no job line.
Mutation: the Gemini wait made a plain `wait` reds it (held to the 90 s test timeout).

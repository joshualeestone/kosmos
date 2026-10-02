# grokrm-5074: the Grok win32 test's cleanup outlasts a just-run exe

Card: joshualeestone/kosmos#5074 (sibling of #5010, which fixed the same race in the shims test only).

## Problem
Main Windows run 37051936123: "win32: Grok unpacks ... and is vouched for" passed every assertion, then its last line
`clear('grok')` threw EPERM (syscall rm). The test's grok.exe is a copy of node.exe the prove step has just run;
Windows can hold a just-run, just-written exe briefly (image lock or a scan of a new exe).

## Decision
One `RM` options object for the file (`recursive, force, maxRetries: 10, retryDelay: 100`), used by `clear` and the
`test.after` sandbox removal. Node's rmSync retries EBUSY, EMFILE, ENFILE, ENOTEMPTY and EPERM with a linear backoff
when maxRetries is set. Same values as engine/win32apply.test.js:45 and engine/win32anchor.test.js:72.

Rejected: #5010's hand-rolled retry with a stand-in rm and mutants. It is heavier, and the reason given there ("no
test can show maxRetries is reached") holds here too: this fix rests on Node's documented behaviour, not on a test of
its own. Rejected: catching and ignoring the error (would hide a real leak; the sweep test at test.after would still
want the folder gone).

Weakest premise: the hold clears within about 5.5 s (10 retries, delays 100..1000 ms). An antivirus scan could take
longer. Only further Windows runs show it.

## Product side (checked, no change)
engine/runners.js already retries rename/rm on win32 for EPERM/EBUSY/EACCES (renameRetrying / rmRetrying, ~1084-1110)
and its other removals fall back to a later sweep. So a person removing Grok right after install is covered.

## Verification
- The test is win32-only (skipped on macOS/Linux), so local runs cannot exercise it. The PR's Windows CI shows no
  regression; the race is intermittent (1 red in 13 main runs), so closing needs several clean Windows runs.

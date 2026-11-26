# #9093 part 1: a download macOS refuses in a window replaced by an update offers Restart Kosmos

## Problem (measured on Josh's Mac, 11-25)
Download said macOS did not let Kosmos save to Downloads (Operation not permitted).
- The window open was 0.8.11, open since 11-19, while the app on disk was 0.8.24 (installed 16:13).
- `codesign --verify <pid>` answered "No such file or directory": the running executable's file is gone.
- The window last moved itself onto a new version at 0.7.94 (defaults kosmos.relaunchedAtVersion). It has missed 13 versions.
- Signing is stable (team 864QZ69GF2), so this is not a signing change.
The alert pointed at Settings and the Save panel, and neither fixes it. Restarting onto the new app does.

## Change (native-app/main.swift)
- At launch, read the executable's device and inode.
- On an EPERM refusal where the file at the executable's path is now another file, or none, ask
  "Kosmos was updated or moved while it was open" with three answers:
  - **Restart Kosmos**: through the existing stale-app relaunch, which asks the page first and names words not yet sent.
  - **Choose Where to Save...**: through one shared guard (saveElsewhereRequest), voided if the page changed while the person decided.
  - **Cancel**: titled so Escape answers it.
- A same-version replacement clears relaunchedAtVersion, so #1182 does not read it as a failed reopen.
- Words: not "your agents keep running" (a connect computer, #4356); "did not let... should let it save again".

## Rejected
- Changing signing: it is already stable.
- Part 2 as first planned (let a saved draft stop blocking the silent restart). It is retracted on the card (issuecomment-7180675141): page drafts are kept only in page memory and are lost on a reload, so updateNothingToLose is right to wait. That needs its own change (keep drafts across a reload first), and its premise (that a draft is what holds this window) is unmeasured.

## Weakest premise
That the replaced executable is the cause of the EPERM. My first theory for the dead Save panel (the
replaced binary) failed its own test: the panel showed in both arms. This change only offers Restart
when the replacement is detected, so a window whose file was not replaced sees the old alert unchanged.

## Tests
- Selftest 329/329 (a real rename-over, checked). JS 38/38 in native-app.download-5167.test.js, with
  pins for alertsOnScreen, Return and Escape, the #1182 marker clearing, the page answer and the page check.
- Removal controls go red.
- 2 blind review rounds, all fixed.

Addresses #9093 (does not close it: part 2 is open).

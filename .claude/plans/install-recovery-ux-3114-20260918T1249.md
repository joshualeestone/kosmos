# install-recovery-ux-3114 -- recovery UX when Kosmos was mis-installed for another account

kosmos#3114 residual (Josh's fresh-Mac test blocker, 2026-09-18). App-side recovery for the case where a multi-account session installed Kosmos for the CONSOLE holder instead of the invoker. Baron owns the pkg-script root fix (install-user resolution); THIS is the recovery when a mis-install already happened -- Josh's current stuck state AND any user who hit it before Baron's fix ships. Both land in the same .pkg cut.

## Two dead-ends fixed (recovery UX only -- the refusal logic, resolveInstall, is correct and untouched)

### (a) The "installed for another user" alert (native-app/main.swift, showForeignAccountAlert)
Was: NSAlert with the right recovery TEXT but only an "OK" button, so OK dismissed to a blank window (the caller `return`s straight after) -- a dead end.
Now: "Download Kosmos" (default) opens installkosmos.com then quits; "Quit" quits. Either button quits, so the foreign-account app never sits on a blank window. Trimmed the now-redundant "open installkosmos.com and click Download" from the informative text (the button does it).

### (b) installing.html forever-wait (install/pkg-scripts/installing.html)
Was: the board-probe (img.onerror) already showed a "still going" #late message at 180s, but with NO recovery path -- if the board never comes up (Josh's account's board never starts because the install went to the wrong account), the page waits forever with only "be patient".
Now: at the same 180s mark, also show a soft #stuck advisory offering a real path -- open Kosmos from Applications, or install your own copy from installkosmos.com. Purely advisory: NEVER says "failed"/"error" (the ~214MB runtime download is genuinely slow on a fresh Mac, so a still-working install must not be told it broke), and the spinner stays alive (no settle()), so a board that arrives late still resolves normally. Under-alarm > false-alarm (Splinter-approved calibration).

## Tests
- `install.installing-page.test.js`: new #3114 test -- #stuck is hidden by default, carries the Applications + installkosmos.com paths, never claims failure, is gated behind the 180s timeout (does not fire before), and the onerror path never calls settle() (spinner stays alive). `node --test` -> 20 pass, 0 fail (all existing + new).
- main.swift: `swiftc -parse` clean. Native Swift is compiled by the cut, so full type-check rides the cut; the APIs used (NSAlert buttons, NSWorkspace.shared.open, NSApp.terminate, .alertFirstButtonReturn) are standard AppKit.

## Verify (Josh's fresh-Mac re-test, in the same cut as Baron's root fix + Mona's copy)
The alert now offers a one-click download + never leaves a blank window; the installing page surfaces the recovery path after 3 minutes instead of waiting forever. Full alert verify is the cut + Josh's fresh Mac (a foreign-account launch).

## Weakest premise
The alert change is verified only to swiftc -parse locally (native Swift needs the cut for a full build); the button wiring + quit behavior are confirmed by the cut + Josh's re-test. The 180s threshold reuses the existing #late timing (already shipped), so it introduces no new timing risk.

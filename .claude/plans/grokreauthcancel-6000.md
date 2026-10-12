# #6000: removing a Grok account cancels its own unfinished "Sign in again" (the #5994 shape)

**Branch:** `grokreauthcancel-6000` · **Card:** kosmos#6000 · **Mirrors:** #5994 (branch reauthcancel-5994, 3a5e59a2, not yet merged)

## The defect
Pressing Sign in again on a Grok subscription account reserves the account's folder (`activeGrokDirs`). While
reserved, `forgetAccount` and `removeAccount` refused with "a sign-in for that account is still in progress; finish or
cancel it first". A person who walked away from the sign-in had no cancel they could reach from Settings, and was
refused until the watchdog ended it (`grokLoginTimeoutMs`, 5 minutes).

## The rule (the same as #5994's for OpenAI)
A remove or forget that passes every other guard cancels the account's own reauth(s), settled or not, drops their hold
on the live folder, and goes ahead. Any other hold still refuses with the old sentence.
- The cancel happens AFTER the move or delete succeeds, and in the already-gone branch, so a refused or failed call
  (the #2570 pre-flight with agents on the account, no free name, a rename that fails) cancels nothing.
- Cancelling settles the session, and the exit handler promotes only an unsettled session, so the dying child cannot
  write into the folder being removed.
- The staging slot stays reserved until the child exits, as on any cancel.
- `reauthReleased` on the cancelled session stops its late exit from releasing a hold a NEW sign-in has since taken on
  the same path; `holdFreed` keeps a session whose child already exited from counting as a hold.

## Decided, not missed
- Ported before #5994 merges (the card asked to wait): #5994's branch is pushed and its plan is final enough to copy;
  waiting would idle the card. If #5994 changes in review, mirror the change here. Rebase onto main after it lands.
- The default ~/.grok stays refused before any of this (Grok's own divergence from OpenAI: it is the machine's CLI
  home), so this changes nothing for it.

## Weakest premise
That a live account folder is never also a sign-in's staging folder. resolveFreshGrokDir refuses a named dir that
holds credentials and nextWorkDir skips one; pinned by the premise test.

## Tests (engine/grokaccounts.reauthcancel-6000.test.js, 10)
premise; remove cancels and deletes; forget cancels and moves (the moved account keeps its sign-in); a refused call
(agents) cancels nothing; the late exit does not release a new sign-in's hold (child kept alive with a TERM trap so
the window is real); a forget refused for no free name cancels nothing; a forget whose rename fails (read-only home)
cancels nothing; already gone still cancels; a reauth cancelled a moment ago does not refuse; any other hold refuses.
engine/grokaccounts.reauth-3391.test.js: the old "forget/remove refuse while held" assertions removed (now cancel).
Mutants (each red, the first by timeout): no release in remove; late exit ignores the flag; any hold counted as own;
release before the move; settled reauths filtered out; no release when already gone.
Wider: engine/grokaccounts*.test.js 68/68; server.grok-subscription-3391, server.provider-accounts-3296,
server.disconnect-stop-2570, engine.reachable 72/72.

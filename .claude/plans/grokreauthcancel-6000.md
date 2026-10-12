# #6000: removing a Grok account cancels its own unfinished "Sign in again" (the #5994 shape)

**Branch:** `grokreauthcancel-6000` · **Card:** kosmos#6000 · **Mirrors:** #5994 (branch reauthcancel-5994 at 28ff774e, not yet merged; first ported from 3a5e59a2, synced in challenge iteration 1)

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
- A delete that fails PART WAY (auth.json already gone) cancels the sign-in so it cannot finish into the remains; a
  failed delete of a still-whole account cancels nothing (as #5994's iteration 8).
- releaseOwnReauth keeps the hold if another live sign-in is staging into that same path (never expected; as #5994).
- `reauthReleased` on the cancelled session stops its late exit from releasing a hold a NEW sign-in has since taken on
  the same path; `holdFreed` keeps a session whose child already exited from counting as a hold.

## Decided, not missed
- Ported before #5994 merges (the card asked to wait): #5994's branch is pushed and its plan is final enough to copy;
  waiting would idle the card. If #5994 changes in review, mirror the change here. Rebase onto main after it lands.
- The default ~/.grok stays refused before any of this (Grok's own divergence from OpenAI: it is the machine's CLI
  home), so this changes nothing for it.
- A sign-in the reaper has already dropped from grokSessions while its child still lives is not seen as the
  account's own, so its hold refuses as before. Accepted as #5994 does: it needs grokForceKillMs >= grokSessionTtlMs
  (defaults 3 s and 2 min) or a child that survives SIGKILL; no guard in setGrokTimers, which only tests call.
- The test file's finally blocks reset forceKill to the literal 3000, as #5994's suite does.

- MERGE ORDER: this merges only AFTER #5994 has merged, and after one more sync of its final engine diff
  (`git diff <last synced sha> origin/main -- engine/openaiaccounts.js`), then a rebase. Until then it waits as an
  open PR, so the two engines never carry different cancel rules on main.
- The part-way-delete check looks at auth.json only, as #5994 does. A Grok API-key account keeps its key in another
  file, but such an account has no Sign in again (reauthTarget requires a subscription identity), so it never has an
  own reauth to cancel. If reauthTarget ever allows key accounts, use holdsCredentials there.
- Mutants are reproducible with a script that swaps one line at a time and runs this test file with a 60 s cap per run
  (a timeout counts as red); the eight swaps are listed under Tests.

## Weakest premise
That a live account folder is never also a sign-in's staging folder. resolveFreshGrokDir refuses a named dir that
holds credentials and nextWorkDir skips one; pinned by the premise test.

## Tests (engine/grokaccounts.reauthcancel-6000.test.js, 13; the chmod ones skip as root, as #5994's do)
premise; remove cancels and deletes; forget cancels and moves (the moved account keeps its sign-in); a refused call
(agents) cancels nothing; the late exit does not release a new sign-in's hold (child kept alive with a TERM trap so
the window is real); a forget refused for no free name cancels nothing; a forget whose rename fails (read-only home)
cancels nothing; a part-way delete cancels; a failed delete of a whole account cancels nothing; already gone still cancels; a reauth cancelled a moment ago does not refuse; any other hold refuses.
engine/grokaccounts.reauth-3391.test.js: the old "forget/remove refuse while held" assertions removed (now cancel).
Mutants (each red, the first by timeout): no release in remove; late exit ignores the flag; any hold counted as own;
release before the move; settled reauths filtered out; no release when already gone; no release on a part-way delete;
release on any failed delete.
Wider: engine/grokaccounts*.test.js 68/68; server.grok-subscription-3391, server.provider-accounts-3296,
server.disconnect-stop-2570, engine.reachable 72/72.
Added in iteration 2: a dying sign-in that writes a valid auth.json on SIGTERM does not promote into a folder put back
at the path; the part-way delete test skips when the filesystem lists sessions/ first (as #5994's iteration 9). Route
level: server.disconnect-stop-2570.test.js, the Grok DELETE route refuses with an agent on the account (cancels
nothing) and, once the agent is gone, deletes and cancels; red when own-reauth detection is broken.
Filesystem note: the part-way delete test skips where the directory listing puts sessions/ before auth.json (rmSync
stops at the first error), so on such a filesystem that arm and its mutant are not exercised; on APFS here it runs.

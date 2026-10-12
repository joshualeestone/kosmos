# #5994: removing an account cancels its own unfinished "Sign in again"

**Branch:** `reauthcancel-5994` · **Card:** kosmos#5994 (a user hit it today; Splinter asked 15:31).

## The defect
Pressing Sign in again on a ChatGPT account reserves the account's folder (`activeChatgptDirs`). While reserved,
`forgetAccount` and `removeAccount` refused with "finish or cancel it first". A person who walked away from the sign-in
had no cancel they could reach from Settings, and was refused until the watchdog ended it (5 minutes; 14 for the
Windows device-code sign-in). Measured: refused while abandoned, removed:true once the watchdog fired.

## The rule
A remove or forget that passes EVERY other guard cancels the account's own unsettled reauth(s), drops their hold on
the live folder, and goes ahead. Any other hold still refuses with the old sentence.
- The cancel happens AFTER the move or delete succeeds (review 1: before it, a failed rename/rm returned ok:false
  with the sign-in already cancelled), so a refused or failed call cancels nothing. That keeps #2570's pre-flight (a call with agents on the account, which must change nothing) safe.
- Cancelling settles the session (state cancelled), and the exit handler promotes only an unsettled session, so the
  dying child can never write into the folder that is being removed.
- The staging slot stays reserved until the child exits, as on any cancel.
- The cancelled session is marked `reauthReleased`, so its late exit does not release a hold a NEW sign-in has since
  taken on the same path (a labelled sign-in with the removed account's name). A flag, not clearing reauthDir:
  clearing it changed how the exit cleans the staging slot (review 1).
- A reauth already settled (watchdog, or a cancel just pressed) whose child has not exited still counts as the
  account's own hold, so it no longer refuses in that window.

## Rejected
- Waiting for the child to exit before removing: forget and remove are synchronous and called by several routes;
  settling the session already removes the only write the child could make into the live folder.
- Only rewording the refusal: the person would still be refused for minutes for something they asked for.

## Not here
Grok has the same refusal (engine/grokaccounts.js forget/remove while its own reauth runs): carded as #6000, to
port this once it merges so the two stay the same shape.

## A delete that fails part way (review 8)
If `rmSync` throws after it has already taken auth.json (checked by the file's existence, not by identityOf, so a
corrupt auth.json that is still there cancels nothing), the folder is no longer an account, so its own sign-in is
cancelled too (it must not finish into the remains). If it throws with the account still whole, nothing is cancelled,
like any failed call. Neither path is reachable from the #2570 pre-flight, which stops at the agents guard.

## Weakest premise
Accepted residual (reviews 4, 6, 8, 10): a session reaped from chatgptSessions (sessionTtlMs after it settles) whose
child still lives keeps its hold and is no longer seen as the account's own, so the old refusal returns. It needs
forceKillMs >= sessionTtlMs (3 s against 2 min by default) or a child that survives SIGKILL, and it fails toward
refusing, never toward deleting. Keying holds by owner would close it; not done here.

That a live account folder is never also a sign-in's staging folder. It holds an auth.json, and
resolveFreshChatgptDir refuses a labelled dir with one while nextWorkDir skips it. If that ever changes, a remove could
cancel a reauth while a staging sign-in still writes into the folder.

## Tests (engine/openaiaccounts.chatgpt-reauth-2584.test.js; the old "refuse while a reauth is in flight" test is replaced)
- remove during own reauth: removed, reauth cancelled, staging slot freed, folder not brought back by the late exit.
- forget during own reauth: forgotten (moved aside), reauth cancelled.
- a refused remove/forget (agents on the account) cancels nothing.
- the late exit does not release a new sign-in's hold on the same path.
- any other hold (a new sign-in staging into that name) still refuses.
- a forget that FAILS at the move (no free name) cancels nothing.
- The mock codex execs its sleep, so a kill reaches it (the file took 30 s with a surviving sleep; now under 1 s).
- an account already gone from the disk still has its own reauth cancelled (review 2: that success branch skipped it).
- a reauth cancelled a moment ago, its child not exited yet, does not refuse the remove (review 2).
- any other hold refuses for forget as well as remove.
- server.disconnect-stop-2570: the real route, an own unfinished reauth plus a registered agent: a request without
  stopAgents is refused and cancels nothing; stopAgents stops, deletes and cancels (review 2). That the #2570
  pre-flight inside it cancels nothing is pinned at engine level, where it can be seen.
- a cancelled reauth whose child writes a VALID auth.json as it dies (exit 0) does not promote into a folder put back
  at that path before it finishes (reviews 7 and 9: without the folder a late promote fails on its own).
- the partial-delete test skips itself on a filesystem that lists sessions/ before auth.json (review 9).
- a rename or delete that THROWS (home made read-only) cancels nothing (review 7: the free-name test returns earlier).
- every sign-in a test starts is cancelled after it, so a failing assertion leaves no child; the sandbox is removed
  when the file ends (it was left behind on every run, 62 found on this Mac).
- a delete that fails part way after auth.json is gone cancels; one that fails with the account whole does not
  (read-only account folder); a failed forget (read-only home) does not. Both read-only tests skip as root.
- Mutants, all red: no release in remove (3 fail); late exit ignores the flag (1); any hold counted as own (1);
  release before the agents guard (2); release before the move (1); settled reauths filtered out (1); no release
  when already gone (2); own reauth never counted (the route test, 1); kill without settling the session (4); release moved to just before
  the rename/delete (1); no cancel on a partial delete (1); cancel on any failed delete (1).
- Wide run: 31 files (openaiaccounts*, server account/disconnect/openai/chatgpt, engine.reachable) 359 pass 0 fail.

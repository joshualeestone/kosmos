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
- The cancel happens after the agents, existence and identity guards, at the mutation, so a REFUSED call cancels
  nothing. That keeps #2570's pre-flight (a call with agents on the account, which must change nothing) safe.
- Cancelling settles the session (state cancelled), and the exit handler promotes only an unsettled session, so the
  dying child can never write into the folder that is being removed.
- The staging slot stays reserved until the child exits, as on any cancel.
- `reauthDir` is cleared on the cancelled session, so its late exit does not release a hold a NEW sign-in has since
  taken on the same path (a labelled sign-in with the removed account's name).

## Rejected
- Waiting for the child to exit before removing: forget and remove are synchronous and called by several routes;
  settling the session already removes the only write the child could make into the live folder.
- Only rewording the refusal: the person would still be refused for minutes for something they asked for.

## Weakest premise
That a live account folder is never also a sign-in's staging folder. It holds an auth.json, and
resolveFreshChatgptDir refuses a labelled dir with one while nextWorkDir skips it. If that ever changes, a remove could
cancel a reauth while a staging sign-in still writes into the folder.

## Tests (engine/openaiaccounts.chatgpt-reauth-2584.test.js; the old "refuse while a reauth is in flight" test is replaced)
- remove during own reauth: removed, reauth cancelled, staging slot freed, folder not brought back by the late exit.
- forget during own reauth: forgotten (moved aside), reauth cancelled.
- a refused remove/forget (agents on the account) cancels nothing.
- the late exit does not release a new sign-in's hold on the same path.
- any other hold (a new sign-in staging into that name) still refuses.
- Mutants, all red: no release in remove (3 fail); reauthDir not cleared (1); any hold counted as own (1); cancel
  moved before the agents guard (1).
- Wide run: 31 files (openaiaccounts*, server account/disconnect/openai/chatgpt, engine.reachable) 359 pass 0 fail.

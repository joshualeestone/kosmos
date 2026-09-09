# Plan: #2584 - chatgpt reauth-in-place driver mode

Splinter-routed 2026-09-09. The prereq for the OpenAI "Sign in again" affordance omitted from #2568.

## Problem
There is no way to sign in again AS an existing chatgpt subscription account. `startChatgptLogin` only ever allocated a FRESH dir, so a reauth would either duplicate the account (#1492) or, if it reused the live dir, let the anti-litter (`dropDirIfOurs`) delete the dir/auth.json on any cancel/timeout/error and destroy the live account.

## Approach: STAGE-AND-PROMOTE
Keep the live account entirely out of the failure path.
- `startChatgptLogin({ ..., reauthDir })`: when `reauthDir` is set, run `codex login` into a FRESH throwaway staging dir exactly like a new sign-in (reusing the existing fresh-dir + anti-litter machinery unchanged).
- On a clean exit AND an identity match, PROMOTE the staging `auth.json` into the live dir via an atomic `renameSync` MOVE (`promoteReauth`): the staging file is the source, no temp copy; the rename replaces the live file whole and removes the staging copy in one syscall. The live dir is written ONLY here, only after full validation.
- forgetAccount/removeAccount refuse while a reauth of that account is in flight (its dir is reserved in activeChatgptDirs), so a Disconnect/Remove cannot pull the live dir out from under a pending promote.
- On any failure/cancel/timeout, nothing is promoted; the staging dir is the disposable one (cleaned by the existing anti-litter). The live account is byte-identical.
- A sign-in that lands a DIFFERENT account (email mismatch vs the live account) is refused; the live account is left unchanged. This signs in again AS the account, it never swaps it.
- `reauthTarget()` validates the target is a real chatgpt account on this computer (same name-guard as `forgetAccount`; refuses arbitrary paths and api-key accounts), so the route can pass `reauthDir` straight through from the body.

## Scope
- Driver mode + `reauthTarget`/`promoteReauth` helpers in engine/openaiaccounts.js.
- `/api/accounts/openai/subscription/start` accepts `reauthDir` (empty/absent -> a normal add).
- Unit tests: engine/openaiaccounts.chatgpt-reauth-2584.test.js (mechanism + the live-untouched safety properties); a route-level reauthDir-threading test in server.openai-subscription-2338.test.js.
- NO web/index.html change: the UI "Sign in again" affordance is the follow-on that closes #2568, now unblocked by this driver.

## Weakest premise
That codex writes `auth.json` only into its `CODEX_HOME` (the staging dir) and never touches the live dir. True by construction (each sign-in gets its own `CODEX_HOME`); the promote is the only writer of the live dir. The end-to-end verify against a REAL ChatGPT Pro subscription stays on the Phase-5 gate (#2338); the driver logic itself is unit-tested without one.

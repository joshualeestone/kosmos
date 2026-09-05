# #1959 residual NIT: an UNCHECKED current account is not "signed out"

## The defect
`paintAccountPicker` (web/index.html) derived the move-UI trigger as:

```js
const signedOut = !!(acctLive && acctLive.connection && !acctUsableLogin(acctLive));
```

`acctUsableLogin` returns false for a genuinely signed-out / rejected account AND
for an UNCHECKED one (a live check we could not read: badge `unchecked`, state
`unknown`). So an account whose liveness we could not read rendered the definite
sentence "The account this agent runs on is signed out, so it cannot run." That is
a definite claim about a state we do not know, which is the #2023 rule this codebase
already enforces everywhere else (an unreadable state renders as could-not-read,
never a definite position; see also the board-summary count at ~20309, which already
splits unknown out via `anyUnknown`).

## The class check (fix the class, not the instance)
Grepped every `!acctUsableLogin` derivation in web/index.html. Two sites:
- The board-summary count (~20309): already handles unknown via `anyUnknown` (~20321). Correct.
- `paintAccountPicker` (24856): the only site deriving a definite claim without excluding unknown.

So this is a single-instance class. The fix is complete at the picker.

## The fix
1. Exclude unknown from `signedOut`:
   `!acctUsableLogin(acctLive) && !acctUnknownLive(acctLive)`.
2. Add `unknownLive` and a message branch that says only what is true (could not
   check), makes no cannot-run claim, and leaves the move dropdown live (opening it
   and seeing where you are is itself the answer to "can I move this").

## Verification
- Extended docs/browser-checks/render-observed-consumers-1959.js Arm 3 with an
  UNCHECKED-current-account case (asserts NOT "signed out" AND reads could-not-check).
  Hermetic file:// on chromium + webkit: 26/26 pass on the fix.
- Proven RED on the pre-fix line (perturbed the guard away): the unchecked arm
  FAILS with "signed out, so it cannot run", 24/26. Restored via edit, not git.
- Targeted node --test (acct-picker-1917, conn-live, picker-provider-2097,
  create-account, accounts-add, switch-account-1373): 46/46 pass, 0 cancelled.
- Full suite gated until the box frees (release 0.6.34 hold to 04:23 CDT); run then.

## Weakest premise
That the message copy is right for the unknown state. It is a design call I made
solo (could-not-check, reopen to retry). If Josh wants different wording, it is a
one-line string change; the logic split is the load-bearing part.

## Scope NOT taken
The larger #1959 residual (subscription.js computeMachine machine-banner plumbing,
server->engine observed-verdict) stays open under needs-browser. This PR is the
self-contained copy/logic NIT only.

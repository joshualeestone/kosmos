# company-policy-retry-6240 -- retry a stuck agent's cleared-policy hand-over without a board restart (#6240)

## Problem (verified on this base)

#6232 (merged, PR #6242) hands every agent the change at the moment a company enrollment ends
(`orgEnrollmentEnded` -> `companyPolicySync`). But an agent that CANNOT be told at that moment (its
session gone, its policy file not writable) keeps the company AI-policy text, and nothing retries it:

- `companyPolicySync` retries a stuck agent only on the NEXT org ask.
- Once nothing is enrolled, `orgEnrollRefresh` returns at its first guard (server.js: `if
  (!oe.readEnrollment() && !oe.leavePending() && !oe.joinUnknown()) return;`) and never reaches
  `companyPolicySync` again. A board in no company asks nothing more.

So the stuck agent kept the old company text until a board restart. The #6232 code documents this
exactly, as a known residual (the comment above `orgEnrollmentEnded`, review 11). Enforcement is NOT
affected: the applied company policy is cleared at the ending (`clearEnrollment` -> `orgpolicy.clear()`);
only the policy TEXT the stuck agent was handed lingers. #6242 only REFERENCES #6240 as its deferred
follow-up (its branch is `removedpush-6232`); it did not implement this.

## Design (the narrower shape the card proposes; Liu Kang m5828)

While nothing is enrolled AND a company-text hand-over is still owed to a stuck agent, retry
`companyPolicySync` at most once an hour, on the same five-minute `orgRefreshIfDue` tick, until the agent
is told.

- `companyPolicyClearOwed()`: a clear is owed iff a company text was recorded as last-handed
  (`COMPANY_POLICY_SEEN` is a `[name,text]` string) AND the applied policy no longer carries one
  (`policyEngine.companyEntry()` is null). A null/undefined `SEEN` (never joined, or already cleared and
  all told) or the boot `COMPANY_POLICY_RETRY` symbol is nothing owed.
- `companyPolicyRetryIfOwed(now)`: if owed and `now >= ORG_POLICY_RETRY_AT`, set the next allowed time to
  `now + ORG_POLICY_RETRY_MS` (one hour) and run `companyPolicySync()`; returns whether it ran.
- Wired into `orgRefreshIfDue(now)` before the company-ask due-check, so it rides the existing five-minute
  tick with the clock, independently of the ask schedule.

It runs through a path with NO live-execution gate on purpose: `companyPolicySync` is a LOCAL roster sync
(no company call), unlike `orgEnrollRefresh`'s ask, so it needs no gate and cannot hang on the network.

## Done when (from the card, refined by Liu Kang m5828)

1. An agent untold at an ending is handed the cleared policy without a board restart, within a stated
   bound. -> the retry on the five-minute tick; test "a stuck agent ... until it is told".
2. One retry an hour, no more. -> `ORG_POLICY_RETRY_AT` gates it hourly even though the tick is
   five-minutely; test asserts a second within-the-hour tick does not retry.
3. A board that never joined a company does nothing extra. -> `SEEN` is null, not owed; test
   "a board that never joined a company is quiet".
4. A board whose seen text was already cleared also stays quiet (Liu's added partner). -> after a clean
   hand-over `SEEN` is null, not owed; test "already cleared and fully told stays quiet".

## What bounds it (said plainly, per Liu)

1. At most one retry per `ORG_POLICY_RETRY_MS` (one hour) -- the same bound the hourly company ask uses.
2. Self-terminating: `companyPolicySync` clears `COMPANY_POLICY_SEEN` to null once every agent is told,
   after which `companyPolicyClearOwed()` is false and no retry fires.
3. Never starts for a board that never joined, or whose text was already cleared (SEEN null/undefined), or
   at boot (the RETRY symbol).
4. No company call -- a local roster sync -- so it cannot hang and needs no live-execution gate.

## Tests (engine-level, in server.orgenroll-5531.test.js, mirroring the #6232 companyPolicySync tests)

Monkey-patch `policy.companyEntry` + `policy.syncEveryone` (count syncs; a stuck row = state != TOLD.TOLD),
drive `orgRefreshIfDue(now)` on a fake clock, with no live execution allowed so `orgEnrollRefresh` is inert
and the only `companyPolicySync` calls are the retry's:
- the stuck-agent retry cadence (one at the ending, one per hour, none within the hour, stops when told);
- never-joined stays quiet;
- already-cleared-and-told stays quiet.

## Weakest part of my reasoning (named)

The owed predicate keys on `typeof COMPANY_POLICY_SEEN === 'string'`. This is correct for the states
`companyPolicySync` actually produces (a `[name,text]` string when a company text is handed; `null` when
there is no company; the `COMPANY_POLICY_RETRY` symbol only transiently at boot). The risk would be a
state I have not accounted for that leaves `SEEN` a string while no clear is genuinely owed; I guard the
second half with `!companyEntry()` so the retry only fires when the applied policy is actually gone, and
the tests pin the three real states. The boot `RETRY`-symbol-while-not-enrolled case is deliberately out
of scope (boot has its own policy path at start()); this change is the RUNTIME ending.

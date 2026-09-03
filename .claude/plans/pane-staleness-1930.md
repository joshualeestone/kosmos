# Plan: kosmos#1930 -- a fixed agent still shows its old failure (stale 401s haunt the board)

## The mechanism (measured)
The board polls `/api/status` every 5s -> `snapshot()` -> per-agent `capturePane` (40 rows,
`-S -40`) -> `classify()`, which narrows to the bottom 25 rows (`engine/status.js:2247`) and
matches auth/error patterns. The bound is POSITIONAL only, never temporal. `reconcileReport`
rule 3b (`engine/status.js:4036`) makes a scraped `auth_failed` OVERRIDE even a report. So a
repaired agent whose old `401 OAuth access token has expired` still sits in the bottom rows
keeps classifying `auth_failed` on every poll. The auth was fixed OFF-PANE, so the pane's
bytes are identical before and after -- reading it harder cannot help, by construction.

## The wrong fix (ruled out with proof)
A tempting fix: gate rule 3b on self-report freshness (mirror rule 3c's rate-limit half) --
"a fresh report beats a scraped auth_failed." **This is UNSAFE and the existing suite proves
it.** `#966` deliberately pins "a fresh report does NOT beat a scraped auth_failed -- a fresh
report suppressed a dead token." The reasoning: an auth failure REFUSES the request, so the
reporting hook cannot fire DURING one; therefore a "fresh" report is necessarily from BEFORE
any current failure and cannot vouch for NOW. "Reported working, THEN auth failed 30s ago" (a
CURRENT failure) and "auth repaired, THEN reported" (a stale error) BOTH look like {fresh
report + scraped 401}. Report-freshness cannot tell them apart -> the gate would ship false
calm over a genuinely-current failure. (Rate-limit is the opposite: a limit does not stop the
hook, so a fresh report CAN be concurrent with it and vouch for now -- which is why 3c allows
it and 3b does not.) The freshness gate reds `#966`, `#886`, `#1884`, `#1259`, `#1233`.

## The correct fix (design B): a live auth-CONDITION check, per-account, cached, async
The only signal that distinguishes a stale 401 from a current one is the actual auth
condition -- `claude auth status` -- which is authoritative. It must come from OUTSIDE the
pane. `subscription.checkLive({configDir})` (`engine/subscription.js:325`) already provides it,
returning `{state, plan, checkedLive, because}`. #1885 keeps it OFF the 5s tick (a subprocess
per agent per tick is too costly). We respect that with a PER-ACCOUNT, CACHED, ASYNC check:

1. **Resolve agent -> account config dir**: `create.readJob(name).configDir` (used by
   `accountForAgent`, `server.js:697`). Agents share accounts, so key the cache by config dir.
2. **Per-configDir live-auth cache** (`Map<dirKey,{state,at,checking}>`), TTL ~30s, a
   `checking` debounce so one check per account is in flight at a time.
3. **Async populate**: when snapshot sees a scraped `auth_failed` for an agent, if the cache
   for its config dir is stale/absent and not checking, KICK OFF `checkLive` fire-and-forget
   (never awaited on the tick) and update the cache on completion. The result is consulted on
   a LATER tick.
4. **Consult in reconcile**: a scraped `auth_failed` is SUPPRESSED only when the cached
   live-auth for that account is POSITIVELY HEALTHY and fresh. Then the state derives from the
   report (or a recovered state) with the staleness surfaced: "its screen shows an old sign-in
   rejection, but the account's sign-in is currently valid (checked Ns ago)" -- recovery made
   visible (done-looks-like #1, #3). EXPIRED / UNKNOWN / no-cache / stale -> `auth_failed`
   stands, unchanged (done-looks-like #2: bounded by a real condition, never mere text).

### The safety property (no false calm -- the whole point of rule 3b)
Suppress ONLY on positive live-healthy evidence. A genuinely-expired account -> checkLive says
expired -> `auth_failed` stands. An unchecked account -> `auth_failed` stands until the async
check confirms healthy. So a real auth failure is NEVER suppressed. This is the same trust
model as `#1885`/`verify-manifest.sh`: the live condition check is authoritative.

## Done looks like (card) -> coverage
1. A displayed failure carries when it happened / is visibly stale -> the "checked Ns ago,
   sign-in currently valid" evidence line on a suppressed stale 401.
2. State from a timestamp/liveness/condition, not mere text -> the live-auth cache verdict.
3. Recovery visible -> a repaired account's agents stop reading `auth_failed` once the cached
   check confirms healthy (no operator action needed; the card's "or a clear affordance" is
   the weaker alternative Splinter dispreferred -- a clear button asks a person to assert
   something they cannot verify).
4. A control that returns the dangerous answer: a scraped `auth_failed` + a cached-HEALTHY
   account must NOT read `auth_failed` (it does today); and the guard -- a cached-EXPIRED (or
   unchecked) account MUST still read `auth_failed`, so the fix cannot ship false calm.

## Tests
- `reconcileReport` gains the live-auth verdict as an input; test (with an injected verdict):
  auth_failed + healthy -> suppressed (report/recovered, conflict surfaced); auth_failed +
  expired -> auth_failed; auth_failed + unknown/absent -> auth_failed. `#966`/`#886`/`#1884`
  must still pass (report-freshness alone never suppresses).
- The cache/async layer: injected `checkLive` seam; a stale/absent entry triggers a check and
  is not awaited; a fresh healthy entry is consulted without a new check; the debounce holds.

## Scope note
This is a cross-module change (status.js reconcile + a cache + accounts/subscription wiring +
server roster). It is the high-stakes "false calm" area, so the guard arm (expired/unchecked
still reads auth_failed) is load-bearing and perturbation-verified. Base origin/main; Kosmos.
</content>

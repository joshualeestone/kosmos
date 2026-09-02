# #1922: "Sign in again" on the DEFAULT account writes the credential where nothing reads it

**Branch:** `reauth-default-1922` · **April, 2026-09-02**

## The defect, in one line

`/api/connect/start` with an `accountDir` passed `connect.start({ configDir: known.dir })`
**unconditionally**. For a labelled account that is correct. For the **default** account it is the
one thing the rest of this codebase deliberately never does.

## Why the default is different, and it is measured rather than argued

| | |
|---|---|
| the default account's config file | `<HOME>/.claude.json`, a file **beside** `<HOME>/.claude` |
| what `CLAUDE_CONFIG_DIR=<HOME>/.claude` makes the real CLI use | `<HOME>/.claude/.claude.json`, a **different file holding a different account** |

**Three independent measurements, none of them mine, none requiring a credential:**

1. **`engine/accounts.js:287-299`**, written by whoever built `listLive`: *"confirmed live on this
   machine, `CLAUDE_CONFIG_DIR=<HOME>/.claude` makes the real `claude` binary read
   `<HOME>/.claude/.claude.json` instead."*
2. **A canary run on this Mac 2026-09-02** (recorded in `~/.claude/bin/which-account.sh`): a launch
   under `CLAUDE_CONFIG_DIR=$HOME/.claude` **bumped `~/.claude/.claude.json` at 11:04:33 and never
   touched `~/.claude.json` (09:46)**. Two files, one launch, timestamps showing which moved.
3. **Both files exist on this Mac** at different sizes (`141259` vs `51732` bytes when measured at
   17:57), and `install/setup.sh:2132` enumerates them as two separate files.

⭐ **This fleet was bitten by the identical root cause earlier the same day**, in `which-account.sh`,
where it produced false account-drift reports. **Treating `$HOME/.claude` as if setting
`CLAUDE_CONFIG_DIR` to it were a no-op is not a novel theory here; it is a repeat.**

## The asymmetry, which is the whole defect

```
server.js:4663  add-another    connect.start({ configDir: prep.dir })   always a NEW labelled dir
server.js:4665  first sign-in  connect.start({ })                       no configDir
server.js:4637  RE-AUTH        connect.start({ configDir: known.dir })  UNCONDITIONAL <- the defect
```

Both other consumers of an account scope the default correctly and say why:
`accounts.listLive` (`row.isDefault ? checkLive() : checkLive({configDir: row.dir})`) and
`/api/agent/:name/account-status`. 🛑 **The `listLive` comment is a warning against doing exactly
what the re-auth route does, and it ends "reintroduced by the fix meant to catch it."**

## Why the user sees a GREEN CHECK

📌 **The green check is a SEPARATE defect (#1916, Angel) and is not evidence about this one.**
Measured by Angel: `checkLive` shells `claude auth status --json`, which returns `loggedIn` plus
account metadata and **no validity field**, so it reports that a login EXISTS and never that it
WORKS.

⇒ **It would have gone green even if this write had succeeded.** That matters for triage: the green
check does not corroborate my diagnosis and its absence would not have refuted it. **The two cards do
not collapse into each other** -- this is the write path, #1916 is the read path.

## The fix

One routing decision, mirroring the shape `listLive` already uses:

```js
const targetDir = known.isDefault ? null : known.dir;
return connect.start({ ...(targetDir ? { configDir: targetDir } : {}), requireInstallConfirm: true, installConfirmed });
```

## Verification: a two-arm control that needs no credential

🛑 **NOTHING IN THIS BRANCH MINTS, CAPTURES OR PRINTS A CREDENTIAL.** The assertion is which
directory the route **targets**, read from `publicView`'s `configDir`. That is checkable statically
and **cannot be fooled by the credulous green check**, which is precisely why it is the right
instrument here.

```
                                        BEFORE FIX      AFTER FIX
DEFAULT account   -> configDir null       RED            green
LABELLED account  -> configDir its dir    green          green
```

⭐ **The control arm is load-bearing, not decoration.** Without it, the first arm is satisfied by
simply deleting `configDir` from the route -- which would make re-auth sign in to whatever the
ambient default is, **a worse bug than the one being fixed.** The pair is what pins the behaviour.

⭐ **The failing arm was confirmed RED before the fix**, with the actual value being the
decoy-producing path. A test written after a fix that has never been seen to fail proves nothing.

## Falsifiable prediction, published so it can be checked against a real user

**Re-auth should FAIL on the DEFAULT account and WORK on a labelled one.** Ben has exactly two
accounts, and the one with the greyed Disconnect (Kitty's finding, #1917) is the default. ⇒ **If a
tester reproduces this on a LABELLED account, this diagnosis is wrong.**

## The layer below the fix, checked because a routing fix can be right and still lose the write

**`engine/connect.js:1821`:** `const launchDir = owner.configDir || process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR;`

With `configDir` null -- the default-account path this fix creates -- the launch directory falls back
to that env var. **If it resolved to something on a real machine, the routing fix would be correct
and the credential would still go astray, one layer down.** Measured:

| checked | result |
|---|---|
| setters anywhere in the repo | **one**, `docs/browser-checks/live-connect.js:29` (a browser-check sandbox) |
| `install/`, `bin/`, `deploy/` | none |
| launchd plists on this machine | none |
| the ambient environment here | unset |

⇒ **It is a test and browser-check seam, not production configuration.** With both absent,
`if (launchDir)` is false and **no `CLAUDE_CONFIG_DIR` is pushed at all**, so the CLI uses its own
default resolution -- which is precisely what `accounts.listLive` depends on and describes as landing
on the real account. **The fix holds at the launch layer.**

📌 **A separate normalization question, settled by Splinter rather than by me:** `configDir: null` and
omitting the key entirely are equivalent, because `connect.js:911` demands
`typeof opts.configDir === 'string' && opts.configDir`, the same normalization `subscription.js:325`
uses. So mirroring `listLive`'s omit-the-parameter shape with a null does not diverge from it.

🛑 **A LIMIT OF THE TEST, STATED SO IT IS NOT DISCOVERED LATER.** The harness SETS
`AGENT_WORKFORCE_CLAUDE_CONFIG_DIR` (`server.connect.test.js:40`), so inside the suite `launchDir`
resolves to the sandbox rather than to undefined. ⇒ **These arms assert the ROUTING decision
(`configDir` null vs the account's dir), which is the thing this card is about. They do NOT assert
the launch-layer consequence**, and could not without unsetting a seam the whole file depends on.
The launch layer is covered by the measurement above, which is evidence of a different kind and
weaker: it is true of this machine today rather than enforced by a test.

## What I have NOT established

- **Why `~/.claude/.claude.json` on this Mac is 51KB and freshly written**, where the build-box
  measurement quoted in `accounts.js` says 464 bytes and stale. Consistent with this bug firing;
  equally consistent with agents launching under `CLAUDE_CONFIG_DIR=~/.claude` for ordinary reasons.
  **I am not claiming which, and the fix does not depend on it.**
  📌 Kitty corrected the record herself: her 464 figure was **quoted from the `accounts.js` comment,
  not measured by her**. The live figure is the authoritative one for this machine, and the 464
  should not be inherited as current state.
- **Whether the same unconditional-configDir shape exists anywhere else.** The three `connect.start(`
  call sites are swept above; other consumers of `known.dir` are not.

## Process note against myself

**The code was written before this plan**, inverting the convention, because the card asked for a
specific measurement first and I ran it. Recorded rather than papered over, as on `becomestuck-arm-1633`.

## Findings from challenge-loop iteration 1

**Three WARNINGs, one CONVENTION, three NITs, no BLOCKER. Two of the three WARNINGs found real
defects in my reasoning, and one of them meant the fix was NOT sufficient on its own.**

### 🛑 THE FIX ALONE DOES NOT RESOLVE THE USER'S SYMPTOM, AND THE PLAN SAID IT DID

With `configDir` null, `start()` runs `subscription.check(undefined)` against the REAL default record.
If that names a paid plan and `checkLive` does not return `NONE`, **`start()` takes its connected
early exit and the sign-in never launches at all.**

⚠️ **That is the card's exact machine state.** Default account, credential dead, row painted green.
And `subscription.js:393` maps `parsed.loggedIn === true` straight to `CONNECTED`, while Angel
measured that `claude auth status` reports `loggedIn: true` for a dead token. ⇒ **After this fix,
"Sign in again" on that machine can answer "connected" instantly and do nothing.**

**Pre-fix the default row always fell through**, because its scoped read hit the missing decoy. **So
this is a behaviour change this branch introduced**, converging the default row onto the same #1560
gate every labelled row already sits behind. Defensible, and it was unstated.

⭐ **THE CONSEQUENCE FOR TRIAGE, AND IT IS THE IMPORTANT PART: #1922 IS NECESSARY BUT NOT SUFFICIENT.
The write path is fixed here; the person still cannot recover until the credulous check (#1916) is
fixed too**, because that check is what lets a dead credential hold the #1560 gate shut. Shipping
this alone and calling the symptom resolved would be wrong.

✅ **Both arms now drive the live check signed-out via `subscription.setRunner`**, which is both the
card's real state and what pushes them past the early exit, and the default arm additionally asserts
`phase !== 'connected'` -- so "routes correctly but runs nothing" now fails the test.

### 🛑 MY LAUNCH-LAYER CONCLUSION CHECKED THE WRONG VARIABLE

I swept `AGENT_WORKFORCE_CLAUDE_CONFIG_DIR`, found it a test-only seam, and concluded "no
`CLAUDE_CONFIG_DIR` is pushed, so the CLI uses its own default resolution".

**Not pushing a variable is not the same as the child not having it.** The launch builds
`['env', <bin>]` with no `-u`, so the CLI **inherits whatever `CLAUDE_CONFIG_DIR` the environment
carries** -- and on a Kosmos-managed machine that is routinely a different account. This very shell
carries one.

⭐ **The codebase already states the rule on the read side** (`subscription.js:336-338`): it builds
its env and `delete env.CLAUDE_CONFIG_DIR` **"rather than trusting it to be unset"**. ⇒ **The reader
deleted; the writer merely omitted.** Fixed: the no-launch-dir branch now pushes `-u
CLAUDE_CONFIG_DIR`, so the writer matches the reader.

**Measured, with a control proving the leak was real:**

```
env -u CLAUDE_CONFIG_DIR sh -c ...   -> UNSET
env sh -c ...            (control)   -> /tmp/leaky     <- the inheritance
```

📌 **This also repairs the plain first-sign-in path**, which has carried the same exposure since it
was written and which my change did not touch.

⚠️ **AND IT IS UNGUARDED BY A TEST, STATED PLAINLY.** Both harnesses
(`server.connect.test.js:40`, `engine/connect.test.js:27`) SET the seam, so `launchDir` is always
truthy and the new `else` branch never executes in either suite. **Guarding it means unsetting a seam
the whole file depends on.** The evidence for it is the shell control above plus the read-side
precedent -- weaker than a passing arm, and named as such rather than left to be discovered.

### The third WARNING: my arms measured less than they read as

Both arms early-exited before any launch decision (`phase: connected` on the default,
`phase: idle` on the control), so neither reached the code the routing feeds. **The arm was not
vacuous** -- the reviewer confirmed it goes red against `origin/main` -- **but the docblock claimed
more than the assertion covered.** Fixed by the `setRunner` change above.

### The rest

- **CONVENTION:** both arms skipped the cleanup every neighbour performs (`resetForTests()`, removing
  the config file). Benign only because the next test overwrites it. Fixed.
- **NIT:** a dead `work1` binding in the default arm, created only to be removed. Gone.
- **NIT:** the plan claimed three `connect.start(` sites; there is a fourth in
  `docs/browser-checks/live-connect.js:90` (takes no options, unaffected). And "both other consumers"
  undercounts: `engine/create.js:741`, `:776`, `:2050`, `:2310` do the same thing.
- ⭐ **The reviewer completed the sweep I had listed under "what I have NOT established" and it came
  back clean:** every other place that turns an account into a `configDir` already scopes the default.
  **There is no second instance of this defect in the tree.** That was my largest open question and I
  did not have to run it myself.

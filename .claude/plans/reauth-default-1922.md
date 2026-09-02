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

🛑 **I WROTE "pre-fix the default row ALWAYS fell through, because its scoped read hit the missing
decoy". BOTH HALVES WERE WRONG.**

1. **Wrong mechanism.** `subscription.check({configDir})` resolves through `accounts.configFile()`
   (`subscription.js:123-124`), which special-cases the default to `<HOME>/.claude.json` -- **the
   REAL file, not the decoy.** It is `checkLive({configDir})` that exports `CLAUDE_CONFIG_DIR` and
   therefore reaches the decoy. I attributed the decoy read to the wrong function.
2. **"Always" is unestablished, and this plan contradicts it two sections down.** A decoy holding a
   live login makes pre-fix `checkLive` answer CONNECTED and take the same early exit -- and the decoy
   on this Mac is 51KB and freshly written, which is exactly the state that would do that.

⇒ **The honest statement: pre-fix behaviour is MACHINE-DEPENDENT, and neither pre- nor post-fix
behaviour on the reporter's machine has been measured.** So "a behaviour change this branch
introduced" is conditional, not established.

⭐ **Note the direction of the error: an unqualified universal, derived from one machine's state, in
the same document that elsewhere refuses to claim that state.** It would have led a maintainer to
size the change wrongly, in the direction of closing a question.

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

🛑 **I CALLED THIS UNGUARDABLE AND IT WAS NOT. THE GUARD EXISTS NOW.** Both harnesses SET the seam,
so `launchDir` is always truthy and the `else` branch never fires -- and I concluded a test would
have to remove that seam. **Wrong observation point, not an absent one:** `engine/connect.test.js`
already intercepts the tmux runner, so the launch ARGV is directly observable without touching the
seam at all.

⭐ **The general form, and it is the most reusable thing on this branch: when a test looks
unguardable, ask whether you are trying to DELETE A CONDITION when you could be OBSERVING AN EFFECT.
"Unguardable" is very often "I picked the harder observation point."**

✅ Two arms in `engine/connect.test.js`, both proven by mutation: removing the `-u` push reddens the
DEFAULT arm while the LABELLED control stays green (and the control would red if `-u` were pushed
unconditionally, which would strip a labelled account's own dir).

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

## Findings from challenge-loop iteration 2

**Four WARNINGs, two NITs, no BLOCKER.** The reviewer measured rather than read: it perturbed the
#1560 guard to confirm my `phase` assertion was not vacuous, drove the `-u` change through the REAL
tmux on this machine to confirm the leak and the fix, and independently ran the second-instance sweep.

### ⭐ THE BEST FINDING REPLACED THE FIX I WAS ABOUT TO BUILD, AND IT IS CHEAPER

Splinter, Angel and I had all converged on the same next step: wire `claudeAccountLive` into the
#1560 early exit so the gate does a real validation. **The reviewer proposed something narrower and
better:**

> an explicit `accountDir` press is a positive statement of intent that a file-plus-credulous-live-check
> should not be allowed to overrule.

⇒ **The re-auth path now BYPASSES the gate rather than newly converging onto it.** No probe, no
per-start latency, no dependency on another card, and it does not change what the check reports --
it declines to let the check veto a person naming an account.

🔑 **The in-repo evidence for it is #874, not another agent's card.** `web/index.html:13855-13857`
already records the measurement with its consequence: *"this badge cannot see a REJECTED token:
`claude auth status` answers loggedIn:true for a transparently invalid one"*, against *"a green row
and a token being 401'd ten times in a row"*. **Citing that makes the argument stand on this repo's
own evidence** rather than on #1916, which matters because it is the argument that decides whether
this branch resolves the symptom.

✅ **New arm, proven red by mutation:** with the live check forced to `loggedIn: true` -- the
credulous answer, the card's exact state -- a re-auth press must still run the sign-in. Removing the
bypass reddens it.

### 🛑 BOTH HALVES OF MY "PRE-FIX ALWAYS FELL THROUGH" CLAIM WERE WRONG

Recorded in full where the claim was made. In short: I attributed the decoy read to
`subscription.check`, which actually resolves through `accounts.configFile()` to the **real** file;
it is `checkLive` that reaches the decoy. And "always" is contradicted by this plan's own note that
the decoy here is 51KB and freshly written.

⚠️ **The direction matters more than the error: an unqualified universal, derived from one machine's
state, in the same document that elsewhere refuses to claim that state.** It would have led a
maintainer to size the behaviour change wrongly, toward closing a question.

### A real teardown defect

Both arms called `resetForTests()` BEFORE `/api/connect/cancel`, inverting the order the `#1585`
sibling documents **and explains**: these arms reach the fall-through and launch an un-awaited
`runFlow`, and `resetForTests` nulls the driver, so a later cancel has nothing to act on and the
session is never killed. Harmless only because the suite uses a fake tmux. Swapped, with the reason
at both sites.

### The rest

- **My "unguardable" claim was false** and is corrected where it was made.
- **The route's conditional spread was a third spelling** of a decision `engine/create.js` writes as
  a one-liner in four places. Now matches them. The repo's own rule, at `accounts.js:80-86`: *"Two
  derivations of one fact is this codebase's most expensive habit."*
- **The fixture splits across two sandbox files what production keeps in one.** Inherited from the
  harness rather than introduced here; now stated in the docblock.

### 🛑 AND THE SUITE WENT RED FOR A REASON THAT IS NOT MINE

`engine.reachable.test.js` fails: `engine/create.js exports setClaudeProbe`, a test seam that is
exported, exercised by its own tests, and referenced by nothing else.

✅ **Control: a clean `origin/main` checkout fails identically** (`rc=1`, same single assertion), and
this branch touches neither file. ⇒ **Inherited from the #1916 merge, not introduced here.** Raised
with its owner before he cut 0.6.23 on a red main; he is fixing it himself, which is right because a
one-line excuse in that guard is *"a claim someone can check"* about his code.

📌 **Recorded as inherited-red, NOT as green.** My five arms pass; the suite does not, and those are
different statements.

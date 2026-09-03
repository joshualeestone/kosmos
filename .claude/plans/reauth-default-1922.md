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
3. ~~**Both files exist on this Mac** at different sizes, and `install/setup.sh` enumerates them as
   two separate files.~~ **DOWNGRADED at iteration 8: this is not a third independent measurement
   and should not have been counted as one.** Two files existing at different sizes is consistent
   with the redirect but does not demonstrate it, and `install/setup.sh` enumerates
   `$HOME/.claude.json` and `${CLAUDE_CONFIG_DIR:+"$CLAUDE_CONFIG_DIR/.claude.json"}`, which are
   the two files under discussion **only when `CLAUDE_CONFIG_DIR` is already `$HOME/.claude`** --
   the very thing being established. ⇒ **The claim rests on measurements 1 and 2, which carry it on
   their own.** Kept visible rather than deleted, because "three measurements" appeared in this
   plan's own summary and a silent drop to two would leave that number unexplained.

⭐ **This fleet was bitten by the identical root cause earlier the same day**, in `which-account.sh`,
where it produced false account-drift reports. **Treating `$HOME/.claude` as if setting
`CLAUDE_CONFIG_DIR` to it were a no-op is not a novel theory here; it is a repeat.**

## The asymmetry, which is the whole defect

```
add-another    (the `another: true` branch)  connect.start({ configDir: prep.dir })   always a NEW labelled dir
first sign-in  (the fall-through)            connect.start({ })                       no configDir
RE-AUTH        (the `accountDir` branch)     connect.start({ configDir: known.dir })  UNCONDITIONAL <- the defect
```

**Reproduce the three sites:** `grep -n 'connect.start(' server.js` **returns FOUR lines; the one at
4616 is prose inside a comment.** (The same caveat this plan already carries for the `create.js`
grep, and it was missing here for four iterations. **A reproducing command is only better than a
line number if its output is described accurately** -- otherwise it just moves the drift from the
number to the count.) **The launch:** `grep -n 'const launchDir' engine/connect.js`.

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

## The fix, and what it does NOT fix

**Two changes, both mechanical, both tested:**

```js
// server.js -- the routing decision, the one-liner engine/create.js writes in four places
connect.start({ configDir: known.isDefault ? null : known.dir, requireInstallConfirm: true, installConfirmed })

// engine/connect.js -- the launch, matching the read side's `delete env.CLAUDE_CONFIG_DIR`
} else { cmd.push('-u', 'CLAUDE_CONFIG_DIR'); }
```

🛑 **THESE FIX THE WRITE PATH. THEY DO NOT MAKE THE PERSON'S BUTTON WORK, AND THAT IS NOT A HEDGE --
IT IS MEASURED.** The press is still refused by `start()`'s connected early exit whenever the stored
file plus a credulous `claude auth status` say CONNECTED, which is the reporter's exact state.

⭐ **AND OPENING THAT GATE IS NOT THE REMEDY EITHER, WHICH IS THE THING I GOT WRONG.** I built the
bypass, and a review measured what lies behind the gate: `launchSignin` launches a **bare `claude`**
with no login argument, and the repl arm then re-reads the SAME config that already said CONNECTED
and calls `finishConnected`. **The press ends at "already connected" about a second later with
nothing repaired.** ⇒ **A gate was opened without checking that the machine behind it could do the
thing the gate was blocking.** The bypass is removed; the reasoning is recorded at the gate so it is
not re-proposed on its own.

⚠️ **THIS AFFECTS MORE THAN THIS BRANCH.** #1918 has just merged a `#d-reauth` "Sign in again" button
on the agent detail page, whose whole purpose is giving a broken sign-in a reachable remedy. **That
button leads into the same flow**, so the remedy it makes reachable cannot currently repair a
credential either.

### ⚠️ THE SYMPTOM A TESTER SEES CHANGES DIRECTION, AND THIS BELONGS IN THE PR BODY

**On a machine whose decoy `<HOME>/.claude/.claude.json` reads signed-out**, the press used to run the
whole OAuth flow (into the wrong file). **After this fix `checkLive` reads the REAL account, the
credulous check reports CONNECTED, and the press returns instantly with nothing opened.**

```
BEFORE   a flow that runs and lands nowhere
AFTER    a button that appears to do nothing
```

🛑 **Both are broken and the second is quieter, so it is the one that gets re-filed as a fresh
regression by whoever sees it next.** Naming it here and in the PR body costs one sentence and stops
that. ⇒ **A fix that trades a loud wrong behaviour for a silent one has to say so**, even when the
trade is correct -- and this one is correct, because the loud version was writing a credential
somewhere nothing reads.

**What would actually fix it, and neither is in this branch:** launch an explicit login the CLI
cannot ignore, or invalidate the stored credential before launching so the re-check honestly reports
NONE. **Both need to land together with re-opening the gate, as one change with a test that can only
exist once the launch works.** *Changes my mind about removing the bypass:* a launch that
re-authenticates, in the same commit.

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

🛑 **RETIRED AT ITERATION 11. THE ORIGINAL CRITERION CANNOT DISCRIMINATE, UNDER EITHER READING**,
and it sat here above the iteration log for ten rounds where a reader meets it first.

~~Re-auth should FAIL on the DEFAULT account and WORK on a labelled one. If a tester reproduces
this on a LABELLED account, this diagnosis is wrong.~~

- **Read as "the button does nothing":** a LABELLED account whose credential is dead-but-present
  still names a plan in its own config, still gets `loggedIn: true` from the credulous live check
  (#1916), and so takes the SAME #1560 early exit. A tester would reproduce it there and falsely
  refute a correct routing diagnosis.
- **Read as "the decoy-file write":** a labelled account cannot reproduce that by construction, so
  the criterion is vacuous.

✅ **REPLACEMENT, which is machine-independent and checks the thing this card actually fixes -- WHERE
THE CREDENTIAL LANDS, not whether the button appears to work:**

> After a DEFAULT-account "Sign in again" that completes, `~/.claude.json` must be the file that
> changed, and `~/.claude/.claude.json` must NOT have been written.
> ⇒ **If the refreshed credential lands in `~/.claude/.claude.json`, this fix did not work.**

**Why it discriminates where the old one did not:** it does not depend on what the button appears to
do, on whether a decoy file exists, or on which account type is used. It observes the write.

## The layer below the fix, checked because a routing fix can be right and still lose the write

**`grep -n 'const launchDir' engine/connect.js`:** `const launchDir = owner.configDir || process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR;`
(Cited by the reproducing grep, not by a line number. The number here read `1821` and had drifted to
1865 by iteration 7, inside the very section iteration 6 recorded as repaired.)

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
`typeof opts.configDir === 'string' && opts.configDir`, the same normalization
`grep -n "typeof opts.configDir" engine/subscription.js` finds in `checkLive`. So mirroring `listLive`'s omit-the-parameter shape with a null does not diverge from it.

🛑 **A LIMIT OF THE TEST, STATED SO IT IS NOT DISCOVERED LATER.** The harness SETS
`AGENT_WORKFORCE_CLAUDE_CONFIG_DIR` (`server.connect.test.js:40`), so inside the suite `launchDir`
resolves to the sandbox rather than to undefined. ⇒ **These arms assert the ROUTING decision
(`configDir` null vs the account's dir), which is the thing this card is about. They do NOT assert
the launch-layer consequence**, and could not without unsetting a seam the whole file depends on.
The launch layer is covered by the measurement above, which is evidence of a different kind and
weaker: it is true of this machine today rather than enforced by a test.

🛑 **STALE AS OF ITERATION 6, CORRECTED AT ITERATION 10. The launch layer IS enforced by a test
now** -- two arms in `engine/connect.test.js` (the default arm asserts the `-u` push and its
ordering; the labelled control asserts the assignment and that nothing strips it). ⚠️ **This
paragraph is in the VERIFICATION section, which a reader consults BEFORE the iteration log**, so it
was the most load-bearing stale sentence in the file and survived four sweeps.

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
already intercepts the tmux runner, so the launch ARGV is directly observable.

🛑 **CORRECTED AT ITERATION 10: this said "without touching the seam at all", and the shipped arm
touches it** (`delete process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR`). Removing the seam is
REQUIRED, since the `else` branch is unreachable while it is set. **My original conclusion was
right; what was wrong was the belief that removing it would not be ENOUGH.** It is enough once the
observation point is the launch ARGV rather than a config file. ⇒ **I retracted a correct conclusion
and kept the wrong half of it**, which is a new direction for this branch's claim defect.

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
  undercounts: `engine/create.js` does the same thing in **four** places, which
  `grep -n 'isDefault ? null :' engine/create.js` reproduces -- it returns **five** lines, one of
  them prose inside a comment, so the reader discounts one hit. ⚠️ **Two of the four line numbers
  originally quoted here pointed at unrelated code, and an independent reviewer checking them got a
  different pair from mine** -- which is the argument for the command rather than for better digits.
- ⭐ **The reviewer completed the sweep I had listed under "what I have NOT established" and it came
  back clean:** every other place that turns an account into a `configDir` already scopes the default.
  **There is no second instance of this defect in the tree.** That was my largest open question and I
  did not have to run it myself.

## Findings from challenge-loop iteration 2

🛑 **SUPERSEDED BY ITERATION 3. The bypass this section describes in the present tense WAS REMOVED.**
Read the iteration-3 section before acting on anything below: the `reauth` flag, the arm that tested
it, and the "✅ proven red by mutation" beside it all describe code that is not on this branch. Left
in place because the reasoning that produced it is worth reading; marked here because **an
append-only log puts the retraction AFTER the claim, and a reader may never reach it.**

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

🔑 **The in-repo evidence for it is #874, not another agent's card.** `web/index.html` already
records the measurement with its consequence (find it with
`grep -n 'cannot see a REJECTED token' web/index.html`): *"this badge cannot see a REJECTED token:
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

- **My "unguardable" claim was false** and is corrected where it was made. ⚠️ **That sentence was
  itself false until iteration 10:** the Verification section's copy stood unannotated for four more
  rounds. **"Corrected where it was made" is a claim about a sweep, and I wrote it having corrected
  one site.**
- **The route's conditional spread was a third spelling** of a decision `engine/create.js` writes as
  a one-liner in four places. Now matches them. The repo's own rule, at `accounts.js:80-86`: *"Two
  derivations of one fact is this codebase's most expensive habit."*
- **The fixture splits across two sandbox files what production keeps in one.** Inherited from the
  harness rather than introduced here; now stated in the docblock.

### 🛑 AND THE SUITE WENT RED FOR A REASON THAT IS NOT MINE

📌 **RESOLVED SINCE: this no longer reproduces.** The `setClaudeProbe` excuse merged, the contending
Playwright run finished, and the full suite is green on this branch (`tools/run-tests.sh` exit 0,
3834/3834 js, shell half passing). **Kept as a record of how it was ruled out, not as a live
condition** -- the retraction is placed at the head for the reason this plan gives elsewhere: an
append-only log puts it after the claim, where a reader may never reach it.

`engine.reachable.test.js` fails: `engine/create.js exports setClaudeProbe`, a test seam that is
exported, exercised by its own tests, and referenced by nothing else.

✅ **Control: a clean `origin/main` checkout fails identically** (`rc=1`, same single assertion), and
this branch touches neither file. ⇒ **Inherited from the #1916 merge, not introduced here.** Raised
with its owner before he cut 0.6.23 on a red main; he is fixing it himself, which is right because a
one-line excuse in that guard is *"a claim someone can check"* about his code.

📌 **Recorded as inherited-red, NOT as green.** My five arms pass; the suite does not, and those are
different statements.

## Findings from challenge-loop iteration 3

**One BLOCKER, five WARNINGs, two NITs. The BLOCKER was right and it cost me my own fix.**

### 🛑 I OPENED A GATE WITHOUT CHECKING WHAT WAS BEHIND IT

Recorded in full in *The fix, and what it does NOT fix*. In one line: the flow the gate guards
launches a **bare `claude`** with no login argument, and the repl arm re-reads the same config that
already said CONNECTED, so the press ends where it started. **The bypass is removed.**

⭐ **The class, and it is the reusable half: a gate was opened without checking that the machine
behind the gate could do the thing the gate was blocking.** Every check I ran was about whether the
bypass was *reachable* and *safe*; none asked whether the flow it unlocked could *repair anything*.
**"Is this change correct?" and "does this change accomplish the thing?" are different questions and
I only asked the first.**

### Three false claims of mine, and one is a new shape

- **A comment I wrote was silently falsified by my own later commit on the same branch.** The
  `setRunner` rationale said forcing signed-out was load-bearing "or the arm takes the early exit" --
  true when written, then the bypass made it irrelevant, and **the docblock renders identically
  either way.** ⇒ **A later commit can invalidate an earlier commit's stated reasoning with no
  signal at all.** (The bypass's removal makes it true again, which is luck, not process.)
- **An arm named "runs the sign-in" never ran one.** It returns at the install-confirm guard with
  `phase: idle`; its only assertion, `notEqual(phase, 'connected')`, is satisfied by almost every
  state. It did discriminate on the flag, so it was not vacuous -- but **a negative assertion cannot
  carry a positive claim**, and the plan's sentence about it was false. Arm removed with its subject.
- **My teardown reasoning cited a window these arms never reach.** They return before a driver is
  claimed, so there is no un-awaited `runFlow` and the cancel is a no-op. Corrected at both sites
  rather than deleted, because a reader would otherwise inherit the false reason.

### ⚠️ THE BLOCKER REACHES BEYOND THIS BRANCH

**#1918 merged a `#d-reauth` "Sign in again" button on the agent detail page** whose entire purpose
is giving a broken sign-in a reachable remedy. **It leads into this same flow.** So the remedy it
makes reachable cannot currently repair a credential either. Raised with the PM rather than assumed
known.

### Suite state, stated as two claims rather than one

📌 **RESOLVED SINCE -- the contention cleared and the suite is green end to end.** Kept because the
method of ruling it out is the reusable part.

```
js half     3834 pass, 0 fail          <- covers everything this branch changes
shell half  3 FAILURES, EXIT_CODE=1    <- another agent's live Playwright run (pid 71512)
```

✅ **Control: `origin/main` fails identically** (`rc=1`, same three assertions, same live pid), and
this branch touches none of the files that test reads. **Recorded as environment, NOT as green.**

## Findings from challenge-loop iteration 4

**Zero BLOCKERs, four WARNINGs, one CONVENTION, three NITs.** Both production changes were put
through five mutations and hold in both directions.

### 🛑 I PUBLISHED A CODE-READ CONCLUSION UNDER THE WORD "MEASURED", IN SHIPPED SOURCE

The comment at the #1560 gate said *"MEASURED, IT IS NOT"* about the claim that opening the gate
buys nothing. **It was read from the control flow.** Every link verifies in source except the one it
rests on: **what a bare `claude` shows when the stored credential has been REJECTED. Nothing in this
repo measures that.**

⚠️ **And the direction is the dangerous one. If the interactive CLI PROMPTS on a dead token**, the
pane classifies as login-method/browser-open, the driver walks the sign-in, **and opening the gate
WOULD repair** -- inverting this branch's central scoping decision.

📌 #874 measures `claude auth status --json`, the READ side. The "Please run /login" string comes
from `claude -p`, not the interactive REPL. **Neither measures the interactive pane.** The earlier
review that established the chain drove a pane to chosen content; it never ran a real dead
credential.

🛑 **BOTH SENTENCES IN THAT PARAGRAPH ARE FALSE. Corrected at iteration 7; left standing above so the
correction is legible rather than silent.** The repo DOES hold the measurement, in a file this
branch never touches: `engine/status.js` (AUTH_FRIENDLY_MESSAGE, #1884) carries a real external
tester's pane verbatim, pinned as a classifier input in `engine/status.test.js`, and
`bin/agent-supervisor.sh` launches agent panes as `claude --dangerously-skip-permissions`, with **no
`-p` on any arm** -- so the line came from an INTERACTIVE session, not print mode.

⭐ **And the error ran AGAINST my own conclusion, which is the part worth keeping.** A rejected
credential in a running interactive session prints an error line rather than offering a login
chooser, which SUPPORTS keeping the gate shut. I wrote "nothing measures it" and thereby understated
my own case. **The direction of an error is not evidence about its cause: I was not shading toward a
convenient answer, I simply did not look outside the files I was editing.**

✅ **What survives, narrowed to what is genuinely unmeasured:** Ben's token expired UNDER a live
session ("has expired"). `launchSignin` performs a COLD start, and no capture exists of a cold
interactive `claude` against an already-dead credential. That distinction, not the original one, is
what the gate turns on, and it is now what the comment and #1937 say.

✅ **Corrected in place: the comment now says it is read from the control flow, names the untested
premise, and says what would settle it.** The gate stays shut **for want of evidence, not because
opening it is known useless** -- which is a different and weaker claim than the one I shipped.

⭐ **Why this one matters more than an ordinary overclaim: it is shipped source telling the next
person NOT to try a fix.** A confident wrong "measured" there costs whoever reads it the option of
checking.

### The same inflation, three more times, all mine

- **A docblock claimed a benefit its arm does not obtain.** "Without `setRunner` the arm returns
  before any launch decision" -- measured, it returns there **either way**, at the install-confirm
  guard. `setRunner` is load-bearing only for the connected-gate assertion. Rewritten to say what it
  was measured to buy.
- **An assertion message described the PASSING state.** `notEqual(phase, 'connected')` passes on
  `idle`, and `idle` is exactly "no sign-in ran" -- so the failure text sent a debugger at the wrong
  mechanism. Reworded to claim only what it can see.
- **The iteration-2 section still reasoned from the removed bypass in the present tense**, with an
  unqualified ✅. Now marked superseded **at its head**: an append-only log puts the retraction after
  the claim, and a reader may never reach it.

### Two things that got better rather than merely corrected

- **The launch control asserted presence, not absence of a later strip.**
  `env CLAUDE_CONFIG_DIR=<dir> -u CLAUDE_CONFIG_DIR <bin>` satisfied the old equality. Now asserts
  the slice plus no `-u`; mutation-proven red on exactly that shape.
  🛑 **This entry said "and still stripped the variable" and certified it as mutation-proven. FALSE,
  corrected at iteration 8:** that argv strips nothing, it **exits 127** before `claude` runs. The
  assertion was right; its stated reason was wrong in the same way the sibling arm's was.
- **The sandbox warning fired on every green run**, which this file's own header says trains people
  to ignore warnings. Deleting both seams was the obvious fix and **breaks the arm** (measured: the
  flow never reaches a launch). So the warning is **captured and asserted** instead: the noise became
  coverage, and it now also guards the warning against silent removal.

### And the repo caught me deferring work to a card number

`comment-deferral.test.js` (#147) failed on my *"#1937 owns that"*. Its rule: **a number in a comment
reads as owned and appears on no list** -- seven such comments once orphaned three real features for
days. ⇒ **The guard does not care that the card is real and assigned; a comment cannot own work.**
Removed, and swept the whole diff for the shape.

### Suite state

```
js half     3834 pass, 0 fail
shell half  3 FAILURES  <- another agent's live Playwright run
```

✅ **Control run at the same moment: `origin/main` failed identically (rc=1, same three checks).**
Recorded as environment, not green. 📌 **Since resolved: the neighbour's run finished and the full
suite is green.**

## Findings from challenge-loop iteration 5

📌 **RESOLUTION NOTE, added at iteration 16 per this plan's own convention.** The absolute recorded
in this section was retracted later; the correction lives in the iteration-15 section. It is left
standing here rather than edited so the sequence is legible, but a reader arriving at this section
first should not take it as current.

**Zero BLOCKERs, three WARNINGs, two NITs, and the suite is green end to end** (`tools/run-tests.sh`
exit 0, js 3834/3834, shell half passing) now that the neighbouring Playwright run finished.

### 🛑 THE `-u` FIX IS RIGHT AND THE MECHANISM I GAVE FOR IT WAS WRONG

I wrote that the leak was "whatever `CLAUDE_CONFIG_DIR` **this process** carries", and that `env`
without `-u` hands the child **the caller's** environment.

**This launch is `tmux new-session` on the shared socket with no `-e`.** And
`tools/witness-pane-env.sh` already records, as measured on tmux 3.6a: *"tmux does NOT hand a
client's environment to a session it makes on an already-running server"* -- the pre-#586 pane saw
the **server's** account while the client carried a different one.

⇒ **The value that leaks is whichever account STARTED THE TMUX SERVER**, which this process cannot
inspect. **That is worse than what I described, not better.** Corrected at all three sites, including
an assertion message that named a source the arm cannot see.

⭐ **The class, and I hit its sibling earlier on this branch: A CONTROL PROVES ONLY THE ARM YOU AIM
IT AT.** My supporting measurement (`env -u sh -c` versus `env sh -c`) was a REAL measurement of the
WRONG SUBJECT -- aimed at `env`, where the code path is `tmux new-session -> env`. It produced the
right conclusion for a reason that does not hold, which is the most durable kind of wrong.

📌 **The fix survives the correction intact, and is stronger than its old rationale:** `env -u` runs
INSIDE the pane, so it strips the variable whatever layer leaked it. It does not depend on knowing
the source -- which is exactly why the wrong rationale went unnoticed.

### Stale-as-live, twice, and one of them was the suite

- **Two sections described a red suite in the present tense** that no longer reproduces. Both now
  carry a resolution note **at the head**, per this plan's own rule about append-only logs.
- **Two of four `create.js` citations pointed at unrelated code**, the #874 quote had drifted, and
  the `server.js` / `connect.js` numbers were pre-fix.
  🛑 **AND THIS ENTRY WAS ITSELF A FINDING RECORDED AS ADDRESSED WHILE THE ARTIFACT STILL SHOWED IT:
  iteration 5 stated the remedy and applied it only to the `create.js` citation.** The `server.js`
  and `connect.js` numbers stayed pre-fix for another round, and a reader of this section would have
  concluded they were repaired and not re-checked. ⇒ **Recording a remedy is not applying it, and the
  record is what stops the next person looking.** ⭐ **An independent reviewer re-checking my
  citations got a different pair than I measured** -- so the fix is a reproducing command
  (`grep -n 'isDefault ? null :' engine/create.js`), not better digits. **When two readers disagree
  about line numbers, the line numbers are the wrong artifact.**

### Two arms made genuinely stronger

- The `-u` assertion was **order-dependent** (a slice equality requiring `-u` first), so an unrelated
  future assignment would have reddened it. Now order-independent, **plus a new assertion that
  nothing re-assigns the variable afterwards** -- both re-proven by mutation after the rewrite,
  because a rewritten assertion is a new assertion.

📌 **Adopted mid-round from a fleet warning (kosmos#1923): no `cd <dir> && <tool> <relative-path>`.**
A deny rule cannot resolve a relative path after a `cd`, so it escalates to a human and the agent
cannot answer the dialog blocking it. `git -C <abs>` and absolute paths instead -- which the worktree
rule wants anyway, since the Bash tool resets cwd between calls. **The rule now goes into every
subagent prompt too: a subagent inherits none of it.**

## Findings from challenge-loop iteration 6

**Zero BLOCKERs, two WARNINGs, three NITs, both warnings documentation-level.** Every arm was
independently mutation-proven by the reviewer, and every machine measurement in this plan was
re-verified (both config files at the stated divergent sizes, the canary script's mtime matching the
recorded time, `live-connect.js` still the only non-test setter of the seam).

### 🛑 A FINDING RECORDED AS ADDRESSED WHILE THE ARTIFACT STILL SHOWED IT

Iteration 5 recorded that the `server.js` and `connect.js` line citations were pre-fix, **and stated
the remedy** ("a reproducing command, not better digits"). **I applied that remedy only to the
`create.js` citation.** The other four numbers stayed pre-fix for another whole round.

⭐ **Why that is worse than simply leaving them wrong: the record is what stops the next person
looking.** A reader of the iteration-5 section concludes citations were repaired. **Recording a
remedy is not applying it**, and the recording actively suppresses the re-check that would have
caught the gap. ✅ Now applied: the site table names branches instead of numbers and ships the
`grep` that reproduces them.

📌 **Third instance of this class on this branch** (an earlier round claimed a paragraph "Cut" that
had been rewritten, and another claimed two NIT fixes that a fail-fast helper had silently skipped).
**All three were caught by a reader, never by me.**

### The interim symptom changes DIRECTION, and that is now PR-facing

On a machine whose decoy reads signed-out, the press used to run the whole OAuth flow into the wrong
file; it now returns instantly with nothing opened. **"A flow that runs and lands nowhere" becomes
"a button that appears to do nothing."** Both are broken; **the second is quieter, so it is the one
that gets re-filed as a fresh regression.** One sentence in the PR body prevents that, and the plan
now carries it.

### NITs, all real

- `!made.includes('-u')` scanned the **entire** tmux argv rather than the `env` slice, unlike its
  sibling. An unrelated future `-u` would have reddened it for reasons unconnected to this card.
- The `console.warn` replacement swallowed **everything** for the arm's duration. Now it suppresses
  only the warning the arm deliberately provokes and asserts, and passes the rest through -- so a
  global replacement cannot hide an unrelated warning.
- The reproducing `grep` returns **five** lines, one of them prose in a comment. The command is still
  the right artifact; the count needed the caveat.

**Control re-proven after both assertion rewrites**: pushing `-u` unconditionally still reddens the
labelled control, and dropping the push still reddens the default arm.

📌 **Rebase note, and the control is the point.** After rebasing onto 13 new commits from main, my
first overlap check returned EMPTY and would have said "nothing my arms read changed, the previous
green survives". **A positive control (what did those commits touch at all?) returned 37 files
including `server.js`** -- one of the files my arms read. **The empty result was my ref range, not
the repo.** ⇒ **A rebase orphans every recorded run, and the check that tells you whether the
measurement survives can itself be the thing that is broken.** Re-ran the suite: green on the rebased
head, 3897 pass / 0 fail / exit 0, all four shell blocks, all four arms.

## Findings from challenge-loop iteration 7

**Context: this iteration was run twice.** The first run's results were lost when the session was
restarted mid-flight, so nothing from it survives; this is a fresh blind pass over the same head.

### 🛑 A SHIPPED COMMENT TOLD THE NEXT PERSON A QUESTION WAS UNMEASURED. THE REPO ANSWERS IT.

The gate comment in `engine/connect.js` said, of what a `claude` shows on a rejected credential,
**"Nothing in this repo measures it"**, and attributed the `Please run /login` line to `claude -p`.
Both false, and the reviewer found them in one pass by looking in files this branch never touches:

| claim I shipped | what the repo holds |
|---|---|
| nothing measures the interactive pane | `engine/status.js` AUTH_FRIENDLY_MESSAGE (#1884) carries a real tester's pane verbatim; `engine/status.test.js` pins it as a classifier input |
| the string comes from `claude -p` | `bin/agent-supervisor.sh` launches agent panes as `claude --dangerously-skip-permissions`, **no `-p` on any of its four arms** |

⭐ **The error ran AGAINST my own conclusion, and that is the part worth keeping.** A rejected
credential in a RUNNING interactive session prints an error rather than offering a login chooser,
which supports keeping the gate shut. I understated my own case. ⇒ **The direction of an error is
not evidence about its cause.** My iteration-4 note said every error of mine ran toward CLOSING a
question; this one ran the other way and had the same single cause, which is the honest reading:
**I did not look outside the files I was editing.** A premise about the product cannot be settled
from the diff.

✅ **What survives, and it is narrower and sharper.** Ben's token expired UNDER a live session
("has expired"). `launchSignin` performs a **COLD** start. **No capture exists of a cold interactive
`claude` against an already-dead credential**, and that, not the original claim, is what the gate
turns on. Corrected in the comment, in the plan's iteration-4 section, and on #1937.

### 🛑 AN ASSERTION I DELIBERATELY LOOSENED PERMITTED A LAUNCH THAT CANNOT RUN

Iteration 6 made the default launch arm order-independent, with this rationale: *"a future launch
adding another assignment ahead of `-u` would redden a slice-equality for a reason unrelated to this
card."* **Measured, three arms, on this machine:**

```
env -u LEAK sh -c ...        -> LEAK=[UNSET]                  exit 0
env FOO=1 -u LEAK sh -c ...  -> env: -u: No such file or dir  exit 127   <- NOT "unrelated"
env -u LEAK FOO=1 sh -c ...  -> LEAK=[UNSET] FOO=[1]          exit 0
```

`env` stops option parsing at its first operand, so an assignment ahead of `-u` does not reorder the
launch, **it kills it (exit 127)**. The loosened assertion passed on exactly that argv.

⭐ **So the rationale was not merely wrong, it was wrong in the direction of removing a guard**, and
it read as principled test hygiene while doing it. **Mutation-proven both ways:** pushing
`PERTURB=1` ahead of `-u` now reddens the arm and prints the offending argv; the pre-fix assertion
evaluates true on that same argv (`i=0`, `u=2`, `made[3] === 'CLAUDE_CONFIG_DIR'`). Restored, 54/54
green.

### The residual now lives in the artifact, not only in the plan

The reviewer flagged that the branch trades a loud wrong behaviour for a quiet one (a press that
used to run the whole flow into the wrong file now returns instantly doing nothing) and that
**nothing shipped named the residual or a follow-up**. The follow-up does exist and is
**kosmos#1937**, which the reviewer had no way to see. Named now in the source comment and here,
and it is PR-body material.

### Corrected, all in this iteration

- `engine/connect.js` gate: both false sentences replaced; premise narrowed to a COLD launch, with
  the three supporting sites cited by name.
- `engine/connect.js` leak comment: struck the clause "agent panes are forwarded a
  CLAUDE_CONFIG_DIR". `bin/agent-supervisor.sh` forwards it with `tmux -e`, which populates **that
  session's** environment, not the server's, so it was never evidence for a server-level value. The
  core claim stands on `tools/witness-pane-env.sh`, which measured it directly.
- `engine/connect.js` launch: states that `-u` sits after `env` in the tmux argv and is therefore
  the command's, not tmux's, **because tmux's getopt does not permute** (live on 3.6a), and states
  plainly that **no test covers this** since the fake terminal cannot see tmux's parser.
- `engine/connect.test.js`: default arm bounded to the `env` slice like its sibling; the two arms'
  contradictory rationales reconciled (the constraint is one-sided: an assignment MAY sit first,
  `-u` may NOT sit after one).
- `server.connect.test.js`: "BOTH ARMS DRIVE THE LIVE CHECK TO SIGNED-OUT" overstated the control.
  Now says installed-is-not-invoked, and why the labelled arm never reaches `checkLive`.

## Findings from challenge-loop iteration 8

### 🛑 MY ITERATION-7 CORRECTION WAS A PARTIAL SWEEP, WHICH IS THE CLASS THIS PLAN NAMES THREE TIMES

Iteration 7 corrected a false `env` mechanism in the default launch arm. **The identical false
sentence sat in the sibling control arm and in this plan's iteration-4 record, and I did not sweep
either.** Both said `env CLAUDE_CONFIG_DIR=<dir> -u CLAUDE_CONFIG_DIR <bin>` "still strips the
variable"; it strips nothing, it **exits 127**.

⭐ **The damning detail: at iteration 7 I inserted a new paragraph DIRECTLY BENEATH the false
sentence in the control arm, and did not read the two lines above my own insertion point.** Editing
adjacent text is not reading it.

⭐ **And the plan entry certified the false mechanism as "mutation-proven".** The mutation proof was
real; it proved the assertion goes red on that argv. **It never proved WHY, and I wrote the why from
belief and attached the proof's authority to it.** ⇒ **A mutation proof establishes that an
assertion discriminates, never that your explanation of the mechanism is right.** That is the fourth
instance of the recording-a-remedy class on this branch and the first where the false part was the
*reason* rather than the *action*.

✅ **Fixed at all three sites in one edit**, checked by grep rather than by memory this time.

### ✅ AN UNREPEATABLE CITATION REPLACED WITH A DURABLE ONE FROM THIS REPO

The tmux non-permuting property was cited as "verified live on tmux 3.6a", which **nobody can
re-run**. The reviewer found standing evidence in-repo, and it is strictly better:

`bin/agent-supervisor.sh` launches every codex pane as

```
tmux new-session -d -s <s> -c "$WORKDIR" ... "$CLAUDE" ... -c "$NOTIFY_CFG"
```

**`-c` IS a real `tmux new-session` flag** (`new-session [-c start-directory]`, confirmed in
`man tmux`), and there are **two** of them: tmux's own before the command operand, the runner's
after it. If tmux permuted, the second would be swallowed as a start-directory and the notify config
would never reach the child. **It reaches it, in production, on every codex agent.**

### ⚠️ AND THE COVERAGE GAP IS WIDER THAN THE COMMENT ADMITTED

I had written that the fake terminal cannot see tmux's parser. True, and not the whole gap:
`docs/browser-checks/live-connect.js`, the only real-tmux real-CLI exerciser, **sets
`AGENT_WORKFORCE_CLAUDE_CONFIG_DIR`**, so `launchDir` is always truthy there and it takes the
assignment branch every time. ⇒ **Nothing exercises the `-u` arm against a real tmux.** Now stated
in the source.

🛑 **THIS SENTENCE SHIPPED AS "the `-u` branch is the ONLY production-reachable arm" AND THAT IS
FALSE. Caught at iteration 9, in three sites again.** The assignment arm is reached in production
whenever `owner.configDir` is set: every labelled-account re-auth, and every "add a second account"
press (`server.js`, the `{ another: true }` path). **This branch's own CONTROL arm exists to pin
that arm**, so the claim was contradicted by my own test file. The true, narrower statement:
`AGENT_WORKFORCE_CLAUDE_CONFIG_DIR` is never SET outside tests and `docs/browser-checks`, so the
seam is the only route by which `live-connect.js` reaches the assignment arm.

### The third "measurement" was not one

The plan claimed three independent measurements that `CLAUDE_CONFIG_DIR=$HOME/.claude` redirects the
CLI. The third (both files exist at different sizes; `install/setup.sh` enumerates them) is
consistent with the redirect but does not demonstrate it, and the setup.sh enumeration only names
those two files **when `CLAUDE_CONFIG_DIR` is already `$HOME/.claude`** -- the thing being
established. Downgraded in place rather than deleted, so the "three" in the summary does not go
unexplained. **The claim rests on 1 and 2, which carry it.**

### Deferred, with reasoning

- **The default arm asserts a mismatch warning that is not #1922's subject**, so removing that
  warning would redden a #1922 arm. **Kept:** deleting the DIR seam is how the arm reaches the
  no-launch-dir branch, and the warning firing is the only observable proving it got there. Without
  it the arm could silently drift onto the assignment branch and still pass. The comment now says to
  replace it with another positive signal rather than simply delete it.

## 🛑 PR BODY: REQUIRED SENTENCE, DO NOT DROP IT

Two reviewers have now independently said this must reach the PR body, so it is recorded here as an
obligation rather than as prose:

> On a machine whose stored default reads connected, "Sign in again" now returns almost immediately
> having opened nothing, where it previously ran the whole OAuth flow into the wrong file. Both are
> broken; the routing is no longer the reason. The flow behind the #1560 gate still cannot repair a
> dead credential (bare `claude`, no login argument): that is **kosmos#1937**, not fixed here.

**Why it is load-bearing:** the new failure is QUIETER than the old one, so without this sentence it
gets re-filed as a fresh regression against this PR.

### ⚠️ THE ITERATION-8 VALIDATION RED WAS CONTENTION, AND IT IS RECORDED RATHER THAN WAVED AWAY

`validation_log_run_or_skip` exited 1 on the iteration-8 head. **The node half was 3897 pass / 0
fail;** the red was entirely in the shell half, in `tools/test-browser-run-guard.sh`, which refuses
while another Playwright run is live.

**Controlled in both directions on an unchanged head, which is what makes it a diagnosis rather than
an excuse:**

| machine state | `tools/test-browser-run-guard.sh` |
|---|---|
| contender pid 15354 live (`bash tools/browser-checks.sh`, 13:22 elapsed, full chromium stack) | **3 FAIL** |
| no contender | **11 PASS, exit 0, "all clear"** |
| contender pid 97129 live (ppid 97115, 23s old, another agent's) | **3 FAIL again** |

⇒ The failing arms fail **only** while another run is live and pass when none is, on the same
commit. And this branch touches **six files (five when this was written; the PR-body draft was
added at iteration 14), none under `tools/` or `docs/`** (`git diff
--name-only origin/main...HEAD`), so it cannot reach that harness at all.

📌 **Two instrument notes worth keeping.** (1) The contender pid CHANGED between runs (15354 then
97129), so "the same failure" was two different agents' runs, not one persistent one. (2) I checked
the contender was not my own process before attributing it: ppid 97115, my shell 98591. **On a box
with sixteen agents, "another run is live" is a claim about someone else and deserves that check.**

🛑 **This does NOT license shipping on a red.** The proof file requires a genuinely clean run, and a
clean full run on an idle box is still owed before the gate closes. What is settled is the CAUSE.

## Findings from challenge-loop iteration 9

### 🛑 A FALSE UNIVERSAL, WRITTEN WHILE FIXING A FALSE UNIVERSAL, AND MY OWN TEST FILE REFUTED IT

Iteration 8's correction introduced: *"the `-u` branch is the only production-reachable arm."*
**False.** The assignment arm is reached in production whenever `owner.configDir` is set, which is
every labelled-account re-auth and every "add a second account" press (`server.js`, the
`{ another: true }` path, verified in source).

⭐ **The refutation was already inside this branch.** The CONTROL arm in `engine/connect.test.js`
exists precisely to pin the assignment arm. **I wrote "nothing reaches this in production" about a
path my own control arm was written to cover**, in the same iteration where I was correcting a
different false universal.

⭐ **The generating mistake is now legible and it is the same one three times:** I observed something
narrow and true (`live-connect.js` sets the seam, so it never takes the `-u` arm) and published it
as a claim about **production**. ⇒ **A statement about what a TEST HARNESS reaches is not a
statement about what PRODUCTION reaches, and "only" is the word that silently converts one into the
other.** Same shape as "nothing in this repo measures it" (iteration 7) and "still strips the
variable" (iteration 8): the observation was fine, the quantifier was invented.

📌 **And it was in three sites again** (source, plan, commit message `7aed4b7d`). Source and plan
corrected; **the commit message cannot be, since it is pushed, so it is recorded here instead** --
anyone reading `7aed4b7d`'s body should read this section.

### The gate comment was trimmed under this file's OWN rule

`engine/connect.js` states, about 26 lines above the gate (it is the two LAUNCH-SITE blocks that
sit ~800 lines BELOW it -- an earlier version of this sentence transposed the two distances), the
rule a prior branch wrote for itself
after two reviewers flagged 25 lines of non-operative archaeology in a hot path: **HISTORY MOVES TO
THE PLAN, THEN TRIMS. Never trim first.** My gate comment had grown to ~45 lines, most of it a
running retraction log ("an earlier version said...", "BOTH WERE WRONG", "that clause is struck").

✅ **Moved, then trimmed: ~45 lines to ~24.** What stays is operative (why the gate is shut, the one
unmeasured premise, what would settle it, the citations). The history is already carried here at
iterations 4, 7 and 8 and on #1922/#1937. ⚠️ **The comment points at CARD NUMBERS, not at this plan's
filename**, per the same paragraph's warning that a dated plan file is a branch artifact.

⭐ **Worth noting against myself: the rule was in the file I was editing, and I read past it four
times.** A convention does not bind by existing nearby.

### Also corrected

- `engine/connect.test.js`: a comment claimed a block was "bounded to the `env` slice" when only the
  `-u` search is bounded; the no-re-assignment assertion scans the whole argv **deliberately** (a
  tmux-level `-e CLAUDE_CONFIG_DIR=...` would put the value back and IS this card's business). The
  assertion was right; the description was wrong. Same shape as iteration 8's finding.
- The last drifted line citation in this plan (`subscription.js:325`, actually 326) replaced with its
  reproducing grep. Iteration 9 checked the neighbouring citations and found them exact.

## Findings from challenge-loop iteration 10

### 🛑 I APPLIED A RULE TO ONE BLOCK AND NOT TO ITS TWO SIBLINGS, IN THE SAME COMMIT

Iteration 9 trimmed the gate comment under this file's own MOVE-THEN-TRIM rule. **The two launch-site
blocks 800 lines below carried exactly the same retraction archaeology and I left them** ("An earlier
draft supported that with...", "An earlier version of this comment cited a live 3.6a run", "An
earlier version said `-u` was ... FALSE").

📌 **The overwhelming majority of the added source lines across `engine/connect.js` and `server.js` are
comment**, for a two-token behaviour change and a ternary. ⚠️ **A bare "102 of 109" stood here and
went stale twice**: the pair is re-measured below by command, and iterations 12 to 14 each moved it
again. **Do not quote a figure from this paragraph; run the command.** **What was removed is the correction LOG, not the
reasoning** -- the operative claims, the citations and the honest coverage gap all stay.

⚠️ **MEASURED, because my first draft of this entry cited the two blocks' before/after sizes and
those overstate the result.** The replacements add text back, so the net is smaller than the block
counts suggest: **82 added lines before the trim, 70 after.**

🛑 **STOP QUOTING A BARE TOTAL HERE. IT HAS BEEN WRONG THREE TIMES FOR THREE DIFFERENT REASONS:**
109 -> 100 (described instead of measured) -> 97 (wrong diff BASE) -> and 97 was stale by iteration
12, because iteration 11 added five comment lines to `server.js` AFTER the number was written.
⇒ **The third failure is not arithmetic and not the base. It is that a number in a document is a
measurement frozen at a MOMENT, in a file that keeps changing.**

✅ **So it is recorded as a command and a commit instead of a figure**, which cannot go stale
silently:

```
git diff --numstat origin/main...HEAD -- engine/connect.js server.js
```

At `63c4f389` that gives `70` and `32` (source total 102, of which the overwhelming majority is
comment). Re-run it rather than trusting any number written here.

📌 The original point stands and is why the entry exists: **100 was wrong.**
I measured with `git diff --numstat origin/main` -- **TWO dots** -- which compares against the
current tip of main. Main has moved **12 commits** since my merge-base and **those commits touch
`server.js`, which my branch also touches**, so the two-dot form folded another lane's changes into
my count and read 30 for `server.js` instead of 27. The three-dot form
(`origin/main...HEAD`, merge-base) gives **70 + 27 = 97**.

⭐ **So the entry written to correct an inflated number was itself inflated, by three lines, via the
diff base rather than via the description.** ⇒ **A number is only as good as its BASE, and on a
shared repo the base moves under you.** This is the same hazard the challenge-loop skill warns about
for the proof hash (#1472): a base that silently absorbs other lanes' commits. ⇒ **A trim is a claim about a
NET, and quoting the part you deleted without the part you added inflates it.** Ninth claim on this
branch corrected by measuring the thing rather than describing it.

⭐ **This is the partial-sweep class for the fourth time, and the tell was available:** I performed a
sweep for a false SENTENCE at iteration 9 and never asked whether the PATTERN I was fixing had
siblings. **A sweep aimed at a string cannot find a sibling that says something different in the same
bad way.**

### 🛑 I RETRACTED A CORRECT CONCLUSION AND KEPT THE WRONG HALF

The docblock said the fix was to observe the launch ARGV "rather than to remove the condition that
hides it", and the plan said the ARGV was observable "without touching the seam at all".
**The shipped arm deletes the seam** (`delete process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR`), and
must: the `else` branch is unreachable while it is set.

⭐ **My original instinct ("a test would have to remove that seam") was RIGHT.** What was wrong was
only the belief that removing it would not be ENOUGH. I then wrote a retraction that discarded the
true half and kept the false one. ⇒ **A new direction for this branch's defect: not an invented
quantifier, but a correction that over-corrected.**

### The most load-bearing stale sentence was in the section a reader reaches FIRST

The Verification section still said the launch layer "is true of this machine today rather than
enforced by a test". **Two arms have enforced it since iteration 2.** It survived four sweeps, and it
sits ABOVE the iteration log, so a reader consults it before any of the corrections.

📌 **And the plan separately asserted that my "unguardable" claim "is corrected where it was made".
That sentence was itself false** -- I wrote it having corrected one site. **"Corrected where it was
made" is a claim about a sweep and deserves the same suspicion as "nothing", "only" and "every".**

### Two mechanism corrections, same class as iterations 8 and 9

- **The leak comment generalized past its measurement.** `tools/witness-pane-env.sh` measures on a
  **private** socket with `-f /dev/null`, deliberately, so that no config can mask the mechanism; my
  comment stated the property of **the shared socket** as established. Now labelled as an inference
  from the measured mechanism rather than a second measurement. **The fix is unaffected: `env -u`
  strips inside the pane whatever leaked it.**
- **`server.connect.test.js` credited `/bin/echo` for `haveBinary` being false.** `/bin/echo` makes
  `claudeResolved.present` TRUE; the dry-run probe refusal is what flips it
  (`if (!probe.ok || probe.dryRun) haveBinary = false`). **The file's own header said so 400 lines
  above, so it carried two accounts of one fact.** Corrected to match.

## Instrument finding: the validation helper can record a pass it never ran (kosmos#1961)

Found on this branch at iteration 7, escalated the same evening because it reached a live release
path, filed as **#1961**. Recorded here because the challenge-loop validation route is one of the
two exposed callers, so anyone re-running this loop needs it.

**The mechanism, read from `~/.claude/scripts/lib/validation-log.sh`:**

1. `validation_log_run_or_skip` hashes `git diff origin/<default>...HEAD` -- **committed state
   only**. Uncommitted fixes do not move the hash, so it matches the previous entry and SKIPS,
   printing a pass for a run that did not happen.
2. **The dirty-tree guard exists and the skip jumps over it.** Line 619 refuses a dirty worktree
   ("validation succeeded but worktree is dirty") and returns 1. **The skip returns at line 495,
   124 lines upstream.** The guard's own comment says its purpose is forcing a commit before the
   PR, which is exactly what the skip lets through. ⇒ **A guard that cannot be reached from the
   dangerous path reads as protection to everyone who greps for it and finds it present.**
3. **The only IN-BAND tell is on stderr** (line 493, `>&2`). A caller capturing stdout to a log
   keeps the exit 0 and loses the sentence. ⚠️ **"Only tell" overstates it and is contradicted by
   this section's own evidence:** `validation_log_skip_record "skipped"` also writes a
   `status: skipped` row to `~/.cache/claude-validation-proofs/<branch>.jsonl`, which is the
   artifact the recorded instance below is read FROM. The row is out-of-band and after the fact;
   the stderr line is the only thing the caller sees at the time.
4. **Skips chain and never re-lock:** the unlock condition is `last_status = clean OR skipped`, so
   one skip unlocks the next.

**Recorded instance, this branch's own log** (`~/.cache/claude-validation-proofs/<branch>.jsonl`):

```
1  clean    08630dd73064  01:41:34Z
2  SKIPPED  08630dd73064  01:57:11Z   <- 16 min of editing, 5 modified files, IDENTICAL hash
3  clean    d0a7adf348b5  02:00:27Z   <- after committing: new hash, genuinely ran
```

✅ **How it was caught, which is the part worth reusing: nothing failed and nothing looked wrong.
The hash printed in the output was the one from BEFORE my edits.** A value was stale in a line I
had no particular reason to read.

✅ **THE TWO CHECKS, either sufficient:** `git status --porcelain` empty before validating, or
capture stderr and require the ABSENCE of `validation-log: skipping`. **A pass with that line
present measured nothing.**

📌 **Audited for this branch: no iteration was certified on a skip.** Row 2 carries the same hash as
row 1, so it certified nothing new and was replaced by a genuine run at a new hash. The later
`failed` rows are the contention reds; the final `clean` (`7ea8aea49648`) ran at an idle window and,
because the hash is cumulative, covers every commit up to `3e23cc1a`. ⚠️ **NOT every commit on the
branch:** that run necessarily predates `0ff1b467`, the plan-only commit adding this very section.
Harmless in substance (the trailing commit touches no code) and corrected anyway, because a loose
claim about coverage is precisely the defect this section documents.

## Findings from challenge-loop iteration 11

### 🛑 THE ORDERING ASSERTION I ADDED AT ITERATION 8 GUARDED THE LOUD FAILURE AND MISSED THE SILENT ONE

Iteration 8 established that `env` stops option parsing at its first operand, and I asserted that
`-u` precedes any **assignment**. **An assignment is not the only operand: the BINARY is one too.**

```
['env', <bin>, '-u', 'CLAUDE_CONFIG_DIR']
```

satisfies every assertion that arm had -- `-u` present, followed by the right name, no `NAME=`
token anywhere -- and is exactly the failure the arm's own table describes.

**Measured, both bad forms, and the asymmetry is the point:**

```
env FOO=1 -u LEAK sh -c ...   -> "env: -u: No such file..."   exit 127   LOUD
env sh -c '...' -u LEAK       -> LEAK=[present]               exit 0     SILENT
```

⇒ **The operand form LAUNCHES.** `claude` gets `-u CLAUDE_CONFIG_DIR` as junk argv, the variable is
never stripped, and the sign-in writes to the leaked account. **That is the #1922 defect itself,
reinstated, wearing a green test.**

✅ **Mutation-proven both ways:** moving `cmd.push(claudeBinPath())` ahead of the `-u` push reddens
the new assertion and prints the offending argv; **the pre-existing assertions all passed on that
same argv** (53 of 54 green, only the new one red), which is what proves it closes a hole rather
than restating one.

⭐ **The lesson generalises past this card: I derived a rule from a measurement ("`-u` must come
first") and then guarded the INSTANCE I had measured rather than the RULE.** The measurement was
about operands; I wrote the assertion about assignments, because assignments were what I had in
front of me.

### The falsifiable prediction could not falsify anything, and it sat where a reader meets it first

"Re-auth should FAIL on the DEFAULT account and WORK on a labelled one" fails under both readings: a
labelled account with a dead-but-present credential takes the same #1560 early exit (so a tester
would falsely refute a correct diagnosis), and under the narrow reading a labelled account cannot
reproduce the decoy write at all (so it is vacuous). **Ten iterations, never revisited.**

✅ Replaced with one that observes the WRITE rather than the button: after a completed default-account
re-auth, `~/.claude.json` must be the file that changed and `~/.claude/.claude.json` must not have
been written. Machine-independent, and it tests what the card fixes.

### A number I corrected was still wrong, and the cause was the DIFF BASE

The iteration-10 entry existed to replace an inflated trim figure with a measured one. **The
measured one was also wrong: 100, actually 97.** I used `git diff --numstat origin/main` (two dots),
which compares against main's CURRENT tip. **Main has moved 12 commits since my merge-base and those
commits touch `server.js`, which my branch also touches**, so another lane's changes were folded into
my count (30 for `server.js` instead of 27).

⇒ **A number is only as good as its base, and on a shared repo the base moves under you.** Same
hazard the challenge-loop skill flags for the proof hash (#1472).

📌 **Also corrected in the #1961 section:** "the only tell is on stderr" overstated it (the
`status: skipped` jsonl row is an out-of-band tell, and is the artifact my own recorded instance is
read from), and "covers every commit on the branch" was off by one (it covers up to `3e23cc1a`, not
the plan-only commit that added the section).

### Merge readiness, per this iteration's reviewer

**Yes, after the test hole above** -- now closed. The reviewer independently verified every
out-of-diff citation, both control arms' load-bearing-ness, and the whole #1961 section line by line
against `validation-log.sh`. Remaining findings are documentation accuracy and commentary density.

## Rebased onto current main after iteration 11, and every recorded run is now orphaned

`origin/main` had moved **12 commits** ahead of my merge-base. `merge-tree --write-tree` predicted a
clean merge (exit 0, no conflicts), and the rebase confirmed it: **17 ahead, 0 behind, clean tree.**

🛑 **THE PREVIOUS GREEN DOES NOT SURVIVE, AND I CHECKED RATHER THAN ASSUMED.** Two questions, both
answered:

```
merge-base --is-ancestor 3e23cc1a HEAD                 -> ORPHANED
git diff --name-only <old-base>..origin/main -- <the files the runs execute>
                                                       -> server.js
```

⇒ The second is the one that matters. **An orphaned sha whose executed bytes are unchanged is still
a valid measurement; here the bytes changed** -- main edited `server.js`, which both route arms
load. So the clean run at `7ea8aea49648` measured a different artifact and is retired, not merely
re-parented.

📌 **Commit shas cited in the iteration sections above (`594c0605`, `7aed4b7d`, `62dc5f78`,
`3e23cc1a`, `0ff1b467`, `fc1ed387`) are all pre-rebase and no longer resolve to ancestors of HEAD.**
They are left in place deliberately: the correction is to the COLUMN, not to the rows, and deleting
them would destroy the record of what was found when. **What they name is still findable by message.**

✅ **DISCHARGED at 03:38:51Z.** Full validation on the rebased head: **exit 0, ran rather than
skipped** (`validation-log: running validation sequence`, the #1961 check), hash `07356482aa9d`
matching the current diff hash byte for byte with a clean tree, **3899 pass / 0 fail**, zero
FAIL-shaped lines, `all clear` on the shell half.

📌 The node count rose 3897 -> 3899 across the rebase. **Not mine:** `engine/connect.test.js` still
reports 54 and `server.connect.test.js` still reports 40, unchanged, so the two extra tests came in
with main's 12 commits. I have not pinned which commit added them and do not need to; what mattered
was establishing they were not mine.

## Findings from challenge-loop iteration 12

**No BLOCKER and no code defect.** The reviewer reproduced the four `env` arms independently rather
than accepting them, verified every out-of-diff citation, and checked the whole #1961 section line by
line against the live `validation-log.sh`. Both remaining WARNINGs were claims-about-claims.

### 🛑 A PLACEMENT DECISION THAT IS RIGHT, WITH A REASON THAT IS WRONG THREE WAYS

The docblock said the launch arm lives in `engine/connect.test.js` rather than the route suite
because "both route harnesses SET `AGENT_WORKFORCE_CLAUDE_CONFIG_DIR`". Measured:

| the claim | what is true |
|---|---|
| "both route harnesses" | **ELEVEN** `server.*.test.js` files set that seam |
| the seam is what blocks a launch arm there | **the DRY RUN is.** `server.connect.test.js` sets `AGENT_WORKFORCE_DRY_RUN='1'` at MODULE SCOPE, so `start()` returns at the install-confirm guard and never reaches a launch decision |
| the seam cannot be worked around | **this arm deletes it at line 27**, so the reason is self-defeating |

⭐ **The third row is the sharpest: my own arm is the counter-example to my own stated reason.** The
sibling docblock 130 lines away in the same diff already said the dry run was what stopped it.

### The trim figure was wrong a THIRD time, for a third kind of reason

109 -> 100 (described rather than measured) -> 97 (wrong diff BASE) -> **97 was stale**, because
iteration 11 added five comment lines to `server.js` after the number was written. ⇒ **Not
arithmetic, not the base: a number in a document is a measurement frozen at a MOMENT, in a file that
keeps changing.** Replaced with the command and the commit it was taken at, which cannot go stale
silently.

### An assertion that was correct today and scheduled to break

`u + 1 < envSlice.length - 1` says "the `-u` pair is not the final two elements". That equals the
property wanted ONLY while the launch pushes exactly one operand, last. **kosmos#1937's stated
remedy is to add a login argument after the binary**, which breaks the invariant.

✅ Replaced with a walk of `env`'s argument grammar to find the FIRST OPERAND, asserting `-u`
precedes it. **Mutation-proven on both shapes, and the second is the point:**

```
['env', bin, '-u', 'CLAUDE_CONFIG_DIR']              old: RED    new: RED
['env', bin, '-u', 'CLAUDE_CONFIG_DIR', '--login']   old: PASSES new: RED   <- the #1937 shape
```

⭐ **The old assertion would have gone green on the exact argv the next card is going to write.**
A guard can be correct against every mutation you can think of today and still be scheduled to fail.

### Deferred, with reasoning

- **Six retraction-archaeology passages remain in the two test files and `server.js`.** The reviewer
  filed this as a NIT rather than a convention violation deliberately, because the same pattern
  pre-exists in `server.js` at lines 781, 1553 and 4995, **outside this diff**. ⇒ House-consistent,
  not introduced here. Trimming shipped comments that match surrounding style is a bigger change than
  it looks and belongs to a sweep of the file, not to this card. The three `engine/connect.js` blocks
  the MOVE-THEN-TRIM rule actually named ARE clean.

### Merge readiness

Reviewer: **ready to merge, no BLOCKER, no code defect.** The routing ternary matches the two
siblings it cites, `null` normalizes identically to an omitted key, and the `-u` push is correct at
the launch layer with load-bearing controls on both sides.

## Findings from challenge-loop iteration 13

**Verdict again: ready to merge, no BLOCKER, no code defect.** The reviewer ran 15 argv shapes
through the four launch assertions and found no leaking form that passes, corroborated the
operand-ends-option-parsing premise against this machine's `env(1)` synopsis, and re-checked the
whole #1961 section line for line. **It still found a real one, and it was mine from one round
earlier.**

### 🛑 I DIAGNOSED AN ABSOLUTE AND REPLACED IT WITH A NEW ABSOLUTE, ONE ROUND LATER

Iteration 12 replaced *"both route harnesses SET the seam"* (wrong, not the blocker,
self-defeating) with *"a launch arm CANNOT live there whatever the seam does."*

**That carries the identical flaw.** `connect.setDryRun` is exported; the arm directly below escapes
the module-scope dry run with it; and the route suite already requires the same module and calls
`resetForTests()`. **So it could do exactly that.** Verified in source, not argued.

⭐ **The shape is worth more than the instance: I correctly identified my predecessor's error as
"asserting an impossibility from one harness's configuration" and then committed that exact error in
the sentence that replaced it.** Recognising a class does not stop you reproducing it, because the
recognition happens while reading and the reproduction happens while writing.

✅ Rewritten to name the configuration rather than a law ("as that harness is currently
configured"), with both prior versions kept struck so the pattern is legible.

### ⚠️ AND IT FORECLOSED A REAL COVERAGE GAP, WHICH IS NOW STATED IN SOURCE

Because the docblock asserted an impossibility, it discouraged the composition test that IS possible:
**nothing exercises the route's `known.isDefault ? null : known.dir` through to the launch argv.**
Route arms stop at the install-confirm guard; the engine arms call `connect.start()` directly. **Both
halves are covered; their composition is not.** A wrong "cannot" does not merely misinform, it
removes an option from the next person.

### The `-u` is one key, not pane sanitisation

`env -u CLAUDE_CONFIG_DIR` strips exactly that variable, mirroring the read side's single `delete`.
Other inherited variables that steer the CLI (`ANTHROPIC_*`) still reach the pane. **The comment read
as sanitisation to a skimmer.** Now scoped explicitly, with the reason the narrow scope is correct
for this card and what a general scrub would need.

### Deferred, now independently confirmed

The retraction archaeology in `server.js` was deferred at iteration 12 on house-consistency grounds.
**Iteration 13 checked that defence rather than accepting it** and found the identical shape at
`server.js:781`, `:1553` and `:4995`, all outside this diff. The deferral stands on measured grounds
rather than on my say-so.

### Outstanding and procedural, not code

**The mandated PR-body sentence has not landed anywhere yet**, because no PR exists. It is recorded
above under "PR BODY: REQUIRED SENTENCE" and must go in the PR body when it is opened, or the
quieter new failure gets re-filed as a fresh regression against this PR.

## Findings from challenge-loop iteration 14

**Ready to merge, no BLOCKER, no code defect.** The reviewer reimplemented all four launch
assertions and drove **13 argv shapes** through them, confirming every leaking or non-launching form
is caught and that the four assertions are complementary rather than restating each other (each
catches a shape another passes). All five findings are documentation.

### 🛑 THE PARTIAL SWEEP AGAIN, ON THE CORRECTION THAT WAS ITSELF A PARTIAL-SWEEP FIX

Iteration 10 added the private-vs-shared socket qualifier to `engine/connect.js`: the witness runs on
a **private** socket with `-f /dev/null`, so applying it to this launch's **shared** socket is an
inference, not a second measurement. **The sibling docblock in `engine/connect.test.js` states the
witness result and "this launch uses the shared socket" side by side with no qualifier**, so a reader
concludes the shared case was measured.

⭐ **Fourth instance, and the pattern is now specific enough to act on: when I correct a CLAIM, I
correct the instance I am looking at and not the claim's other homes.** The remedy is mechanical and
I have not been doing it: **after correcting a sentence, grep a short token from it across source,
tests and plan before moving on.**

### A rationale that argued for the opposite of its assertion

The control arm's stated reason was *"an assignment MAY sit first, so pinning it at i+1 costs
nothing"*. **That argues for PERMITTING other assignments, not for pinning this one** -- and the
sibling arm was deliberately made order-independent against exactly that hypothetical. Replaced with
the honest reason: the launch emits the account's own directory first, pinning the position is the
strictest statement of that, and a red here is fail-safe.

### The walk's description was wider than the walk

The comment said "options and assignments may precede the first operand". **The walk recognises
exactly `-u NAME` and `NAME=value`.** Any other legal `env(1)` option (`-i`, `-0`, `-C`, `-P`, `-S`,
`--`) is classified as the operand and would redden the arm. The launch emits none of them and the
error direction is fail-safe, so it is a maintenance signal rather than a hole -- now stated as
exactly that.

### Two more figures that describe rather than measure

- **"102 of the 109 added source lines"** is the pre-trim pair; at HEAD it is 77 + 32 = 109 again for
  a different reason. The headline no longer quotes a figure at all and points at the command.
- **`grep -n 'connect.start(' server.js` returns FOUR lines, not three** (4616 is prose in a
  comment). This plan already carries that caveat for the `create.js` grep and not for this one.
  ⇒ **A reproducing command is only better than a line number if its output is described accurately;
  otherwise the drift just moves from the number to the count.**

### The deferral was checked again, not re-accepted

Commentary density: the reviewer independently re-verified the house-consistency defence
(`server.js:781`, `:1553`, `:4995`, all outside this diff) rather than taking iteration 12's word or
mine. Deferral stands on measured grounds for the third round running.

## Findings from challenge-loop iteration 15

**Ready to merge; everything found is documentation-level.** The reviewer enumerated the argv shapes
satisfying all four launch assertions and could not construct a realistic leaking one, re-verified
~12 out-of-diff citations exactly, re-checked the #1961 claims against the live file, and confirmed
the branch holds a genuine clean validation at HEAD's exact diff hash with a clean worktree.

### 🛑 THE FIFTH ABSOLUTE, AND THIS ONE WAS SOURCED TO A MEASUREMENT

The comment said: *"THE SOURCE OF THE LEAK IS THE TMUX SERVER, NOT THIS PROCESS ... a value this
process cannot inspect."* **False on the cold-server path**, which is the ordinary first-run case
this feature exists for.

| case | what happens | measured? |
|---|---|---|
| **WARM** server already running | the pane inherits whichever account STARTED the server; this process cannot inspect it | **yes**, #586 witness, tmux 3.6a |
| **COLD**, no server | `new-session` **starts** one, and a fresh server inherits its launching client's env, so the leaked value is **THIS process's own and IS inspectable** | **no** |

⭐ **The failure is new in kind and worse than the previous four.** The earlier absolutes were
unsourced. **This one carried a citation, and the citation was real** -- it just measured something
narrower than the sentence claimed. `tools/witness-pane-env.sh` **seeds a server before measuring**
(`new-session -d -s seed 'sleep 60'`, then the measured session on that server), so **it can only
ever answer the warm case, by construction**, and its own header says so.

⇒ **A citation raises the cost of checking without raising the truth of the claim.** A reader who
verifies that the witness exists and says what I said it says still learns nothing about whether my
sentence is scoped to it. **The check that catches this is not "does the source support the words"
but "does the source's SCOPE cover the sentence's scope".**

✅ Corrected at both sites, and the cold path is now stated as unmeasured rather than absent. The
fix is unaffected: `env -u` strips the key inside the pane whichever layer leaked it.

### Two more correct-assertion-wrong-reason findings

- **The whole-argv scan** was justified by "a tmux-level `-e CLAUDE_CONFIG_DIR=...` would put the
  value back". **It would not:** `-e` populates the session environment and the `env -u` runs inside
  the pane afterwards, so the key is stripped before `claude` is exec'd. The scan is kept for being
  fail-safe and free; the reason is corrected.
- **`envSlice.indexOf('-u')` takes the FIRST `-u`**, so "order-independent for detection" holds only
  while the slice carries one. Now stated, with the fail-safe direction, matching the convention the
  grammar walk already uses for unrecognised options.

### The PR body was reviewed as a shipped artifact, and it needed it

- The route is `/api/connect/start`, not `/api/connect`.
- "the proof file is in `.claude/plans/`" asserted as present something that will not exist until the
  loop converges. Reworded to say when it is written.
- **"3899 pass / 0 fail" came from a run predating three commits.** The branch IS validated at HEAD,
  but that row carries no count, **so the number and the head it described were from different
  moments.** Now cites the hash-match and the ran-not-skipped check instead of a count from
  elsewhere. ⭐ **Same defect as the trim figure, in the artifact reviewers actually read** -- which
  is why the PR body went into review scope rather than being written at the end.

## Findings from challenge-loop iteration 16

**A BLOCKER, in the one artifact that ships publicly.** The code was again found clean: the reviewer
re-implemented the four launch assertions and drove **12 argv shapes** through them, reproduced the
`env(1)` table via `spawnSync` including the silent operand-first arm, recomputed the validation hash
under the helper's exact command, and re-checked every out-of-diff citation. All exact.

### 🛑 THE PR BODY SHIPPED THE ABSOLUTE THIS BRANCH HAD ALREADY RETRACTED

Iteration 15 corrected *"a value this process cannot inspect"* in `engine/connect.js` and
`engine/connect.test.js`. **The PR body carried it verbatim, unqualified.**

⭐ **Sixth partial sweep, and the worst-placed one: every previous instance was in a file only this
team reads. This one was in the artifact reviewers read FIRST and the only one that leaves the
repo.** ⇒ **The correction reached the two files I was editing and not the file I had written for
other people.** That is the same asymmetry as the whole night's claim defect, one level up: I fix
what I am looking at.

### 🛑 AND INSIDE ONE COMMENT, THE CONCLUSION UNDID ITS OWN PREMISE

`engine/connect.test.js` had the warm/cold split in its premise paragraph and, **three lines later**,
concluded: *"So the pane inherits whichever account started the server -- routinely a DIFFERENT one
on a Kosmos machine."* On the cold path the server was started by **this very process**, so it is not
a different account.

⇒ **A partial sweep within a single comment, across three lines.** The premise was corrected and the
sentence that reasons from it was not. ⚠️ *"Routinely"* was also an unmeasured empirical claim about
typical machine state, stated flatly **inside the comment whose subject is the measured/unmeasured
distinction**. Both fixed. ⚠️ **"the ordinary first-run case" was labelled unmeasured in the TEST ONLY, and this
sentence claimed both. Caught at iteration 17; the source copy is now hedged too.** ⇒ **A sentence
recording a sweep is itself a claim, and this is the second time one of mine asserted a completeness
I had not reached.**

### The PR body's validation paragraph could not stay true

Two defects, both of the go-stale-silently kind:

- It said the recorded hash byte-matches `origin/main...HEAD`. **The helper hashes that diff MINUS
  the proof file** (`:!.claude/plans/<branch>-pre-challenge.md`), so the two are equal only while no
  proof file exists -- and the same paragraph asserted the proof file IS committed. **The sentence
  was self-falsifying.**
- Perfect-tense claims about convergence and a committed proof file, written before either existed.

✅ Replaced with **the check a reader can run** (`validation_log_current_diff_hash`, compare to the
newest jsonl row, require `clean` not `skipped`) plus the pathspec caveat. ⇒ **A figure in a document
goes stale silently; an instruction to measure does not.**

### Also

- The PR body called two different arms in two different files "the labelled control". Now named.
- "this branch touches five files" is six at HEAD.
- The iteration-5 section now carries the resolution note at its head, per this plan's own
  convention, so a reader arriving there does not take a retracted absolute as current.

## Findings from challenge-loop iteration 17

**No code defect, no security issue, no regression.** The reviewer enumerated the argv shapes again
and could not construct one satisfying all four launch assertions while leaking; confirmed both
controls load-bearing in opposite directions; verified the four `create.js` sites, the `null`
normalization, the `account-status` sibling, and that nothing in `web/index.html` reads the connect
state's `configDir`. **All four findings are claims, and three are the exact class this branch keeps
failing on.**

### 🛑 A SENTENCE RECORDING A SWEEP IS ITSELF A CLAIM, AND MINE WAS FALSE FOR THE SECOND TIME

Iteration 16's entry said *"'the ordinary first-run case' is now labelled unmeasured as well"*.
**It was labelled that way in the TEST only.** `engine/connect.js` still stated it flat, inside the
comment whose subject is the measured/unmeasured distinction.

⭐ **This is the second time one of my sweep-recording sentences asserted a completeness I had not
reached** (the first: "corrected where it was made", iteration 10). ⇒ **"I fixed it everywhere" is a
claim about a set, and it deserves the same suspicion as "only", "every" and "nothing". It is
CHEAPER to check than those, because the sites are grep-able, and I still did not check.**

### 🛑 A FALSE IN-FILE CITATION, IN SHIPPED SOURCE, WITH BOTH HOMES WRONG

`server.connect.test.js` said the probe-refusal mechanism *"is also what the header of this file says
400 lines above"*. **The header says no such thing** -- it says only that `/bin/echo` is all "Claude
is installed" means to `start`. The passage that does state the mechanism is the
`#1568/#1571` test, roughly 440 lines **BELOW**. **Wrong content, wrong direction, and the same
sentence was in the plan.**

✅ Re-cited **by test name rather than by a line offset**, since the offset is precisely what drifted.

### The PR body again, twice

- **It attributed to a measurement what both code homes call an inference.** The witness runs on a
  PRIVATE socket with `-f /dev/null`; this launch uses the SHARED socket. Both `engine/connect.js`
  and `engine/connect.test.js` carry that qualifier and one of them explicitly names its omission as
  "the partial-sweep shape this branch keeps producing". **The PR body did not carry it.** Seventh
  partial sweep, second one landing in the only artifact that leaves the repo.
- **The perfect-tense convergence sentence survived** the iteration-16 edit that recorded its
  removal. It sat directly above the runnable check that replaced it. Removed.

### Two absolutes and a stale ratio

- *"the sole `checkLive` call"* -- there are **two** in `engine/connect.js` (`start()` and
  `runFlow()`). The conclusion holds for a different reason: these arms return at the
  install-confirm guard before `runFlow` is entered.
- *"tmux's getopt does not permute"* -- **permutation is a libc property, not a tmux one.** glibc
  permutes by default, BSD does not. The claim is true for the platform this ships on, which is
  where the standing evidence was taken; the sentence's scope was wider than the evidence's.
- *"ELEVEN of the 34"* is correct today and goes stale silently. Replaced with the re-count command.

## The loop's own shape, measured at iteration 17, and the wrong conclusion I nearly drew

**Every one of iteration 17's four warnings points at prose I added in an earlier FIX commit**
(`bc4a2c00`, `a9904cb0`, `6d78877f`, `650dbb6d`), not at the implementation. Measured with
`git log -S` per site.

| rounds | code defects | claim defects |
|---|---|---|
| 7-11 | **yes** (the silent argv leak; the operand hole) | yes |
| 12-17 | **zero** | yes, all in prose added while fixing |

⚠️ **This is the moving-target shape, and the standing bulletin is explicit that it is NOT permission
to stop** -- its own author rejected that reading, because his rounds 4-8 still produced real code
findings. Mine stopped at 11. **So the loop continues; what changes is what I do at the fix step.**

### 🛑 AND MY FIRST PROPOSED CHANGE WAS WRONG. I CHECKED BEFORE ACTING AND IT DID NOT SURVIVE.

I was about to strip the retraction archaeology ("an earlier version said X") out of shipped source
under this file's MOVE-THEN-TRIM rule, reasoning that my own additions were generating the findings.
**Measured first:**

```
sites matching that idiom in the four files:  22
  added by this branch (mine):                 9
  PRE-EXISTING:                               13
```

⇒ **The idiom is house style, by a majority I did not put there. Trimming mine would have made this
branch the OUTLIER**, which is the opposite of the consistency I was invoking the rule for. Three
reviewers had already checked that deferral independently and it held; I nearly overturned it on a
hunch about my own diff.

### ⭐ So the actual cause, stated correctly

**The findings are not caused by archaeology existing. They are caused by individual claims inside it
being wrong** -- a citation I never opened ("the header 400 lines above"), a hedge applied to one of
two sites, a ratio with no re-count command. **Every one was checkable at the moment I wrote it, in
seconds, and I checked none of them.**

✅ **The change at the fix step, and it is a discipline rather than a deletion: every sentence I add
that contains a CITATION, a NUMBER, or a SCOPE claim gets verified before the commit that carries
it.** That is the same standard I apply to the code, applied to the prose about the code -- which is
where six consecutive rounds of findings have lived.

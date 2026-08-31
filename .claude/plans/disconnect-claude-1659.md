# #1659: build the Claude half of account removal

## What finished looks like

A person with MORE THAN ONE Claude account can remove one from Settings, its
button is not disabled,
and it behaves the same way the OpenAI Remove beside it already does: it refuses
while agents are running on that account and names them, it forgets rather than
deletes, and it says which of those two it did.

## Why this was open

Josh, 2026-08-31 09:19: the button answered "Disconnect is not built." That was
honest rather than forgotten. `web/index.html` carried the reason in its own
title text: disconnecting "has no way to tell agents on it to stop first".

**That reason stopped being true when #1372 shipped.** The OpenAI route already
enumerates the agents on an account and refuses while any is on it. The card
framed this as an open design question; it was a design question that had
already been answered on the other provider and never carried across.

## The call I made, and what I rejected

The card offered three behaviours. I first chose "disconnect and stop those
agents", then **reversed it after reading the code**: the OpenAI half ships
"refuse and name them", and two buttons in one row builder, under one word,
must not mean two different things depending on a provider the person is not
thinking about. Consistency beat my abstract preference.

Rejected:
- **Stop the agents.** Diverges from the shipped sibling for no gain.
- **Leave them running.** Fails in the quiet direction: agents keep working
  authenticated against a thing that was removed, and fail later, elsewhere,
  unattributably.

## The one deliberate asymmetry

`forgetAccount` **refuses the default `~/.claude`** where the OpenAI one allows
`.codex`. Measured: `prepare()` symlinks every account Kosmos makes at
`~/.claude/projects`, and on the fleet machine two other accounts had both
`projects` and `settings.json` linked into it. Moving the default strands the
history of accounts nobody asked to remove, and the button that did it cannot
undo that.

## Shape

- `engine/accounts.js` : `forgetAccount(dir, usedBy)`, renames to
  `.removed-claude-<label>` with a collision loop so a second removal of the
  same label cannot clobber the first one's sign-in.
- `server.js` : `DELETE /api/accounts/claude`. The enumeration is **copied**
  from the OpenAI route, not re-derived, so Renet Tilley's #1447 fail-closed
  fix comes with it.
- `web/index.html` : both buttons carry `data-forget-provider`, one handler
  reads the endpoint off the button. No second handler to drift.

## What the review added, beyond the original shape

The plan below described what I set out to build. Three things the challenge
loop added are recorded here because a plan that omits them reads as a smaller
change than shipped:

- **The default row renders a PERMANENTLY disabled Disconnect.** The engine
  refuses `~/.claude`, and `list()` always emits that row first, so a live
  button there is one every user sees and none can use.
- **The OpenAI control was relabelled from "Remove" to "Disconnect".** That is a
  user-visible change to an already-shipped feature. One act, one word, in one
  row builder, which is this card's own argument applied one layer up.
- **The refusal copy was rewritten twice.** The first version named two
  remedies and neither was reachable: "remove the other accounts first" implies
  the button then works (it never does), and "sign out of this one" names an
  affordance the product does not have (measured: no sign-out control exists on
  the page). It also asserted that other accounts keep their history there,
  which is false on a single-account machine. The reason is now unconditional,
  because the refusal is.

## 🔴 A DIVERGENCE THAT MERGES CLEAN, AND IT MUST BE PORTED BEFORE THIS LANDS

**This route's enumeration is a VERBATIM COPY of the OpenAI one, and kosmos#1693
fixes the original.** Measured: the two enumeration bodies are line-for-line
identical on this branch, the routes are 114 lines apart in `server.js`, and
#1693 ("account removal: count stopped agents, not only running ones") touches
that file.

⇒ **After #1693 lands, OpenAI counts stopped agents and Claude does not. Nothing
conflicts, nothing goes red**, and the two buttons on one screen behave
differently again, which is the divergence this card exists to close.

🛑 **AND THE FIX LANDS WHERE IT MATTERS LESS.** A stopped OpenAI agent loses its
key, which presents as a sign-in problem. A stopped Claude agent comes back
signed out AND with a blank transcript tree, because Claude transcripts live
under the config directory. That asymmetry is the whole argument of #1689.

✅ **DECISION: #1693 lands first, then this branch rebases and adopts its
enumeration.** Not copying an unmerged PR's approach, because if it changes in
review this ships a third variant of one function.

⚠️ **DO NOT LAND THIS BRANCH WITHOUT CHECKING.** One command:
`git show origin/main:server.js | sed -n '/accounts\/openai. && req.method === .DELETE/,/^  }/p' | grep -c 'disabledJobs\|known('`

🛑 **BOTH ARMS, BECAUSE AN EARLIER VERSION STATED ONLY ONE AND A READER TOOK THE
SILENCE FOR CLEARANCE:**

- **NON-ZERO** -> #1693 has landed -> **the port is owed NOW.** Adopt its
  enumeration before this merges.
- **ZERO** -> #1693 has NOT landed -> **the decision above applies: WAIT.**
  Landing now ships the pre-fix copy and recreates the divergence, cleanly and
  with nothing red. **Zero is not clearance.**

📌 If waiting is not acceptable, the other honest route is to land and convert
the decision into kosmos#1697 explicitly, saying so in the PR body. **What is not
available is landing on a zero and treating the check as satisfied.**

📌 The footprint exercise found the FILE. Only reading the code found the
DIVERGENCE. A file-overlap map cannot see same-file, different-line, opposite-
behaviour collisions.

## The landing criterion, in its mechanical form

**Do not use "does the Claude button have a confirm?"** That question is answered
YES by reading the file: #1702 adds a confirm bound generically over
`[data-forget]`, and on main that attribute is emitted ONLY on the `isOpenai`
branch. **A guard that exists is not this gap guarded** - and stated as a release
criterion, that is where the error costs something.

✅ **THE CRITERION IS ONE GREP ON THIS BRANCH'S DIFF: does the LIVE Claude row
emit `data-forget`?** Verified by executing the ternary, not by grepping it:

```
DEFAULT row   data-forget: false   aria-disabled: true
LIVE row      data-forget: true    aria-disabled: false
```

⇒ **The live row inherits #1702's confirm; the default row deliberately carries
neither**, because `forgetAccount` refuses `~/.claude` unconditionally and a
confirm on a control that can never act is worse than none. **The absent
`data-forget` is what makes that refusal structural rather than a check somebody
could delete.**

⚠️ **AND THE ORDERING IS CONDITIONAL, WHICH AN EARLIER VERSION OF THIS SECTION
GLOSSED: #1702 IS OPEN, NOT MERGED.** "Claude inherits the confirm" is true only
once it lands. **If this branch lands first, BOTH providers are unconfirmed** -
OpenAI is already live-and-unconfirmed on main, and this makes Claude the same.

🛑 **AND WE CONFLICT ON THE SAME LINES, WHICH IS THE SAFE OUTCOME.** Both edit the
body of `for (const btn of box.querySelectorAll('[data-forget]'))`. Resolution is
mine: keep his arming, keep the provider guard, and **the guard must run BEFORE
the arming** so an unmarked button cannot arm.

## Verification

- 19 tests: 9 on the engine function, 10 on the route.
- **6 perturbation arms**, each breaking one guard and confirming the matching
  test goes red, then restoring clean: default refusal, usedBy refusal, path
  guard, collision loop, runner filter, fail-closed.
- A route DISCRIMINATOR arm: an agent on a **different** account must not
  block, or the button would be unpressable on a busy machine.
- Full suite: 3281 pass, 0 fail (re-measured at iteration 10).
- ⚠️ **These counts are a timestamp.** The previous version of this line said 13
  and 3267 and was stale within two iterations, which is the same defect this
  plan records elsewhere: a number written once and read as current.

## Consequences of the default refusal, recorded rather than left in a comment

**On a single-account machine the capability this card was opened for is
unreachable.** `list()` emits the default row whenever `~/.claude.json` carries
an `oauthAccount`, and on the common install that is the only row, so its
Disconnect is permanently disabled and there is no other path (#1492's "Sign in
again" re-auths the same identity rather than replacing it).

**That is a deliberate call and it is defensible** (removing the only account
leaves Kosmos with none, and `prepare()` symlinks other accounts' history into
that folder), **but it was not written down anywhere**, and a plan that
justifies the refusal without naming who it leaves with nothing reads as more
complete than it is.

**A stopped agent is invisible to the refusal.** `safeRoster()` reports agents
the live roster knows (`listPanes()` plus `panelessKeys()`, the latter gated on
`liveness.alive`). An agent that exists but is not running keeps a launch file
naming this config dir, so removal proceeds and its next start points
`CLAUDE_CONFIG_DIR` at a renamed directory. It bites harder on Claude than on
OpenAI because transcripts live under the config dir. Inherited from the OpenAI
route, named in the route docblock, and now named here too: a data-visible
failure mode recorded only in a code comment is recorded for nobody.

**The refusal is announced AND focusable, and both halves shipped.** The reason
rides the `aria-label` rather than only the `title`, because a `title` on a
disabled control is not announced; and the control is `aria-disabled="true"`
rather than natively `disabled`, so it stays in the tab order and a keyboard user
reaches it.

⚠️ **THE SECOND HALF WAS MISSED FOR ONE ITERATION AND THAT IS THE INSTRUCTIVE
PART.** Making the control focusable also made it PRESSABLE, and the shared
handler binds only `[data-forget]`, which this branch deliberately lacks. So for
one iteration Enter and Space did nothing at all, with no feedback: the
accessibility fix created a fresh instance of the exact
nothing-that-looks-live-may-do-nothing shape it was meant to serve. A no-op
handler now writes the button's own `title` into the accounts message line, so a
press produces the reason on every input path, and it reads the title rather than
repeating the sentence so it does not become a third copy.

🛑 **AND THE SAME EDIT SILENTLY BROKE TWO GUARDS, WHICH IS WHY THIS SECTION IS
LONG.** `b.disabled` in the browser check is the IDL property and reflects only
the native attribute, so the arm asserting it went red; and the node floor
`/disabled/` matched the substring inside `aria-disabled`, so it stopped
discriminating and did not catch the first. **One markup change, two guards
quietly retired, in opposite directions.** Both are re-anchored on the exact
spelling and perturbation-checked in both directions.

## The browser gate: RUN, and the gap is closed

🛑 **THIS SECTION SAID FOR ELEVEN ITERATIONS THAT THE GATE COULD NOT RUN HERE.
THAT WAS MY OWN BAD MEASUREMENT.** I tested `require('playwright')` from the
worktree, which throws, and concluded the box could not run it. **The harness
resolves playwright itself**: `browser-checks.sh:175 resolve_pw` searches
`KOSMOS_PW_NODE_PATH`, a runtime dir and the npx cache, then exports `NODE_PATH`.
It resolves from `~/work/pw-runtime/node_modules` (control: an impossible module
still fails). **A stated gap I never retested is worse than an unstated one,
because it reads as diligence.**

✅ **RUN TWICE ON THIS BRANCH. The three new arms EXECUTE and PASS, with the DOM
as evidence rather than a source assertion:**

```
default row   ariaDisabled:true   forgets:false   row "main@example.com ..."
walk row      ariaDisabled:false  forgets:true    row "walk@example.com ..."
openai row    ariaDisabled:false  forgets:true    label "Disconnect"
```

⇒ **The source-level floor and the browser agree**, which is what the floor was
built to stand in for.

### The first run was RED, and it did not reproduce

```
18:34  sha=1e6da83c  ran=56  retried=1  failed=1  render-boot-no-flash
18:50  sha=1e6da83c  ran=56  retried=0  failed=0
```

**Same sha, same tree, same machine.** Not a regression from this branch, and
three independent reasons it could not be: the check boots `$sb7` while every
account this branch seeds writes to `$sb4/home` (shared paths: 0); the check
contains zero terms from this diff (control: 7 `boot-cover` refs); and its
failing assertion is a LAYOUT property (`getBoundingClientRect` vs
`window.innerWidth`) measured inside a deliberately stalled `page.route` window,
which is inherently timing-sensitive.

⚠️ **"Did not reproduce" is not "cannot happen".** One flake in two runs of a
timing-sensitive check is exactly what the harness's own summary calls "a flake
to fix, not to accept". It is not this card's to fix, and it is recorded here so
the next person who sees it red has the two data points.

## Known gap, narrowed

**The browser check now covers the Claude control's STATE but not a click.**
The diff adds three arms and seeds two Claude accounts in sandbox 4 so they are
exercised rather than dormant: the OpenAI control is live, a non-default Claude
control is live, and the default one is disabled. What is still not covered is
pressing the Claude button end to end, the way the OpenAI flow is pressed.

**I did not add that press, and the reason has changed.** The original reason
was that the gate could not run here. **That was wrong** (see the section above:
`resolve_pw` exports `NODE_PATH` and it resolves). The gate runs, this branch
passes it, and the three new arms execute.

⇒ **The honest remaining reason is smaller and is a scope call:** a press flow
that removes an account changes shared board state for every arm after it in the
same file, and adding a second removal alongside the OpenAI one is the confirm
work that belongs to kosmos#1683. **It is deferred, not blocked**, and anyone
taking #1683 can now verify it here rather than at a cut. and an unverified press flow in a file that has already taken down three
release cuts is a worse trade than a stated gap. The repaint ordering is
inherited rather than re-derived, because both providers share one handler.

⚠️ **And the earlier version of this section was stale within one iteration:**
it said "no browser check" after the diff had already modified the browser
check, which read as more honest than it was.

## Challenge loop, iteration 16 (2026-08-31)

Four NEW findings, so this iteration did NOT converge. Three applied, one
deferred with its reason stated rather than quietly dropped.

**APPLIED. `engine/accounts.js` isDefaultDir and configFile now resolve BOTH
sides.** They compared a resolved left against an unresolved
`path.join(homeDir(), '.claude')`, so under a relative `AGENT_WORKFORCE_HOME`
the exported helper answered FALSE for a directory that IS the default, while
`forgetAccount` refused it correctly because it compares resolved paths. Two
halves of one feature answering one question differently, which is the exact
habit the helper's own docblock exists to end. Measured three arms:

```
before, relative home : isDefaultDir(<abs>/rel/.claude) = false   <- the bug
after,  relative home : true
control, absolute home: ~/.claude true, ~/.claude-x false          <- unchanged
```

**APPLIED. `web/index.html` moves focus after the repaint.** `paintAccounts()`
destroys the button the person just pressed, so focus fell to `<body>` and a
keyboard or screen reader user lost their place. The result line now carries
`tabindex="-1"` (the file's own idiom, from the `h1.vh` above) and takes focus
with `preventScroll` so it does not fight the existing `scrollIntoView`. This
is a WCAG AA obligation on this card, not a nicety.

**APPLIED. `server.js` comment now names the SECOND blind spot.** It described
only the stopped-agent gap (#1689), so a reader concluded the boundary was
narrower than it is. A Claude session Kosmos did not create is in the roster
and on the board, but has no launch file, so the loop continues without
setting `complete = false` and removal proceeds under a live process.

**DEFERRED, and this is the reason rather than an omission: the user-facing
copy does not mention that an agent configured on the account but not running
will come back signed out with a blank transcript tree.**

- The call: leave the copy alone for now.
- Rejected: adding a sentence like "agents set up on this account will need
  reconnecting". It is probably true and I have NOT measured it myself. The
  reviewer derived it from reading the code, which is exactly the standard
  this branch has been holding other claims to, and shipping user-facing copy
  that asserts a behaviour nobody has run is the wrong way round.
- Weakest premise in my own reasoning: that "probably true" is not good
  enough. If it IS true, the person pressing the button is currently not told
  a real consequence, and that is a live honesty gap, not a cosmetic one.
- What would change my mind: measuring it. Stop an agent, disconnect its
  account, start it again, and look at what it comes up as. That is a
  twenty-minute experiment and it belongs on #1689, which already owns the
  underlying gap, rather than in a branch that is currently on the critical
  path of an unserved release.

⇒ **NOT CONVERGED. Iteration 17 is owed**, and this deferral is not a dedup:
it stays open and blocks convergence until it is measured or the answer lands.

## Challenge loop, iteration 17 (2026-08-31)

Eight WARNINGs and one CONVENTION, every one measured in a sandbox rather than
argued. Five applied in 75d4e865. Three remain open, so this iteration did NOT
converge.

### The one worth reading twice: my own fix was vacuous too

Iteration 16 replaced a vacuous plist assertion. The replacement counted
`<string>` arguments. Measured:

```
plistFor(..., null)     -> 16 entries
plistFor(..., 'claude') -> 16 entries      and === the null output, EXACTLY
plistFor(..., 'codex')  -> 18 entries
```

So the count passes identically whether the fixture is seeded `null` or
`'claude'`, which is the one distinction it claimed to make. The only
substitution it could catch is codex, already caught by the 400 assertion.

⭐ **The comment three lines above the assertion already said the two are
byte-identical.** I wrote past a stated fact twice in one session, in a commit
whose subject was removing a vacuous assertion.

⇒ The fixture's "pre-runners" property is **unprovable from the plist by
construction**. It now asserts the mechanism instead (`readJob` normalises a
missing runner to `'claude'`), and the perturbation confirmed **that specific
assertion** is the one that reds, which is the check I skipped last time.

### Still open, so convergence is blocked

**1. The "Disconnect" relabel removed a disambiguation axis. Mine.**
Both providers' buttons now build `aria-label="Disconnect " + who + qual`. A row
yielding neither an email nor a keyTail gets `qual = ''` and falls back to the
label, so `~/.claude-work1` and `~/.codex-work1` both render exactly
`Disconnect work1`. Before this branch they read `Disconnect work1` and
`Remove work1`, so the verb was doing accidental disambiguation work.

- Not created by me: `accountQualifiers` documents this in-code as deferred
  finding 8, and says outright that a row yielding neither key makes it live.
- Made worse by me: I removed the accident that was masking it.
- The fix: fall back to the PROVIDER when `qual` is empty, so the parenthetical
  is always present and always distinguishes.
- Why it is not in this commit: it touches three render sites plus the test that
  pins the exact source expression, and it is not on the release critical path.
  Deliberately parked, not dropped.

**2. The stopped-agent consequence is still absent from user-facing copy.**
Re-raised independently this iteration, which is confirmation rather than new
information. Unchanged from iteration 16: I will not ship copy asserting
behaviour I have not measured, and measuring it belongs on #1689.

**3. `configFile` returning a relative path** was fixed, but the broader point
stands that this file had three derivations of one fact and the branch only
found them because a reviewer went looking. The docblock's claim that the helper
makes re-derivation impossible is aspirational, not enforced.

## The twice-deferred finding is resolved by BEHAVIOUR, not by copy (2026-08-31)

Iterations 16 and 17 both raised it: the screen does not tell the user that an
agent configured on this account but not running will come back signed out with
a blank transcript tree. I deferred it twice, both times because I would not
ship copy asserting behaviour I had not measured.

**#1693 landed and #1697 named my route as the last one still counting running
agents only.** So the right fix was never the copy. It was to stop the thing the
copy would have had to apologise for. The Claude route now unions the running
roster with `register.known()`, minus removed agents, exactly as the OpenAI
route does rather than as a second derivation of it.

⇒ **The consequence the copy failed to disclose no longer happens**, so there is
nothing to disclose. Closing a gap beats documenting it.

### 🛑 And the regression coverage is honestly absent, which I nearly faked

I wrote an arm for the port. It passed. **Then I perturbed the port away and it
passed again.** Verified the mutation had actually applied, and printed the
response: the route still answered `usedBy:["ghost"]` with the union removed.

The arm was vacuous, and it was the *third* vacuous assertion I have written on
this branch in one session, after the plist regex and the argument count.

**Why it cannot be fixed cheaply, measured rather than guessed:**

```
standalone, profile + launch file + NO pane:
  snapshot()        []          <- the gap is REAL
  register.known()  ["ghost"]   <- the union catches it

inside this suite's harness, same fixture:
  safeRoster() already returns ghost, because it sees the launch file
  => roster-only and the union agree on EVERY fixture the suite can build
```

An agent with a profile and no launch file cannot be attributed to an account by
either path, since `readJob` returns null. So the discriminating state is
unreachable in this harness.

**The port stays, its justification is the standalone measurement and #1697, and
the missing coverage is written into the code rather than implied by a passing
test.** Anyone strengthening it should start by making the harness's roster
reflect panes rather than launch files.

⭐ The lesson I keep paying for today: **a test that passes under its own
perturbation is not weak coverage, it is ZERO coverage wearing the costume of
coverage.** Deleting it was the honest move; keeping it would have made the next
reader believe the port was guarded.

# Iteration ledger, kosmos#1659

🛑 **NOT FOR A BLIND REVIEWER.** This is the orchestrator's record of what each
challenge-loop pass found. It is split out of the plan file because the plan is
what reviewers are told to read, and a reviewer who reads prior findings
confirms them instead of discovering new ones.

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

## Challenge loop, iteration 19 (2026-08-31)

Five WARNINGs, five NITs. NOT converged, and this is the fifth consecutive
non-empty pass. **Two of the five were defects I introduced in iteration 18**,
which is this branch proving its own recurring lesson: the fix is the
least-reviewed code in the tree.

### The one that should not have needed a reviewer

I documented the #1697 port as honestly uncovered and gave a mechanism for why a
guard was impossible here: *"safeRoster() already returns any agent that has a
launch file"*. **It reads PANES.** Every fixture wrote one because the `agentOn`
helper appends a pane line, so roster-only and the union agreed on everything the
suite could build.

⇒ **A correct conclusion (uncovered) from a false mechanism, and the false
mechanism is what made me stop looking.** The guard was four fixture lines away.

There is now a `registeredNotRunning()` helper (plist + profile, no pane) and an
arm that reds BY NAME when the union is removed. Verified by perturbation with
the mutation confirmed applied first.

### And I broke a different accessibility rule while fixing one

Iteration 18 made the armed state reach the accessible name. That name read
`"Disconnect <who>, press again to remove"` while the button visibly said
`"Remove it?"`, so the name did not contain the visible words: **WCAG 2.5.3 Label
in Name, Level A.** A speech-input user saying "click Remove it?" could not
operate the confirm step of a destructive control.

⇒ **I closed one accessibility gap and opened another on the same element, one
iteration later.** The armed name now leads with the visible words.

### The rest

- The refusal said `"<name> is running on this account"`, which my own #1693 port
  made untrue: the union includes stopped agents, so it sent people looking for a
  running agent that is not running. Reworded on BOTH providers.
- The uninstall transcript printed the disconnected-account paragraph
  unconditionally, telling the common machine about a state it has never been in.
- A scope paragraph still said only the OpenAI row is live and #1659 is unmerged.
  #1659 is this branch. **A stale scope note is worse than none: it is the
  sentence somebody uses to decide what NOT to test.**
- The provider guard ran AFTER the arming while this plan said it must run
  before, so an unmarked button armed on the first press and refused on the
  second, promising a pending action that did not exist. Moved, both arms
  measured, and guarded. **A decision recorded only in a plan is a stale comment
  with extra steps.**

### Still open

- `movedTo` is returned by `openaiaccounts.forgetAccount` and dropped by its
  route, so the same act now gives a recoverable answer on one provider and not
  the other. Cross-provider, belongs on its own card rather than in this branch.

## Challenge loop, iteration 20 (2026-08-31)

Five WARNINGs, six NITs. NOT converged. Sixth consecutive non-empty pass.

### A real logic bug in iteration 19's fix

Iteration 19 made the uninstall transcript's disconnected-account paragraph
conditional. **One flag gated two sentences that assert opposite things**: "for a
folder you still use, the mark applies" claims a LIVE mark, and the next line
claims a REMOVED one. On a machine whose ONLY marked config belongs to a
disconnected account, the first sentence is false, and the header above it is
false of every file it lists.

Reachable rather than theoretical: this block's own comment records 19 of 22
configs on the fleet machine carrying `false`. Two flags now, `_trust_live` and
`_trust_removed`, each sentence on its own, all arms measured.

### A comment whose wrong mechanism invited deleting live code

The `aria-disabled` justification said the default row is safe because "there is
no listener to fire". **There is one**: the same diff binds a click handler to
`.acct-disconnect[aria-disabled="true"]` so a press says WHY instead of doing
nothing. What actually makes it safe is that the row carries no `data-forget`, so
the removal handler never selects it.

⇒ Not pedantry. A reader who believed the old sentence would delete the no-op
refusal as dead code, which is exactly the pressable-but-silent failure that
handler exists to prevent.

### I took the reviewer's challenge to my own deferral

I had deferred surfacing `movedTo` on the OpenAI route to a separate card. The
reviewer pointed out the deferral was weaker than the precedent I had set IN THE
SAME DIFF: this branch already edits `openaiaccounts.js`'s refusal for exactly
that consistency argument, and the counterpart is one concatenation.

**That was drawing the line where the work got inconvenient rather than where the
argument stopped.** Done on both providers, and both now say the folder is
HIDDEN, which is the difference between a fact and a place somebody can find.

### ⭐ And that change found an unguarded sentence, by accident

Changing the OpenAI success copy broke NOTHING. The existing arm matches a
PREFIX, so an appended clause is invisible to it.

⇒ **Changing a user-facing sentence and watching nothing go red is how you learn
the sentence is unguarded.** Guarded now, perturbation-verified: removing the
clause reds that arm by name.

### The rest

- The fail-closed error still said "which agents are running", the same untruth
  the refusals were reworded to remove, and diverged from its sibling.
- `forgetAccount`'s docblock still promised "the refusal names the way forward"
  when the default refusal deliberately names none.
- The provider early return wrote the message without cancelling the announcement
  timer, and it was the ONE exception to a comment claiming EVERY writer does.

## Challenge loop, iteration 21 (2026-08-31)

Four WARNINGs, eight NITs. Seventh consecutive non-empty pass, and the shape has
changed: these are COVERAGE GAPS rather than defects. The code is right and
nothing would have noticed if it stopped being.

- **The card's central behaviour was asserted by nothing.** No test anywhere
  checked that a Claude button calls `/api/accounts/claude`. Both ENDS of the join
  were pinned (the markup carries the provider marker, the server answers on the
  path) and the concatenation between them was covered by nothing, because the one
  endpoint arm in that file was hardcoded to openai, because the fixture was.
  ⇒ **Two ends pinned separately is not the middle being covered.**
- **My "ONE exception" was three.** Iteration 20 fixed a writer that did not
  cancel the announce timer and called it the only one. Two more write AFTER an
  await, where the pre-fetch cancel cannot reach them. **A count in a comment is a
  claim**, and this one was wrong the moment it was written.
- **Iteration 20's uninstall fix was itself unguarded.** Collapsing the two flags
  restores the bug with nothing red. Guarded now, and labelled a SOURCE-level pin
  rather than implying behavioural coverage it does not have.
- **A comment denied a copy that the comment sixteen lines below argues for.**
  Four copies of the refusal exist; a test pinned one pair. The fallback, which is
  the copy a screen-reader user hears on the day the title is dropped, is pinned
  now too.

### A self-catch worth keeping

The new drift pin FAILED first, and it looked exactly like a real drift. It was my
test decoding the page side and comparing against RAW engine source, which stores
the same sentence with a literal escape. **The same "measure against the right
world" error the sibling drift test already avoids by normalising both sides.**

⇒ I nearly reported a drift that did not exist, from a test I had just written to
detect drift.

## Challenge loop, iteration 22 (2026-08-31)

Six WARNINGs, six NITs. Eighth consecutive non-empty pass, and the last one run
against a plan that still carried this ledger.

### A data-safety gap on the sibling, measured rather than inherited

`DELETE /api/accounts/openai` would rename ANY `~/.codex-*` directory, because
every guard in that engine keys on the NAME. Measured before fixing: a planted
`~/.codex-notanaccount` holding one user file was renamed with the file carried
along, and the answer said `forgotten: true`.

The Claude side has guarded this since this card. **OpenAI has had a live
Disconnect since #1372 without it.**

⇒ Fixed with three arms, and **the guard's cost is stated where the guard is**: an
account with a CORRUPTED `auth.json` also answers null, so it can no longer be
disconnected, which is exactly when somebody would want to. Kept because renaming
a folder the person made and calling it forgotten is the worse error.

### The fix broke two controls, and that was correct

Their fixture wrote `auth.json` containing `{ label }`, which codex never produces.
So it modelled a directory that is NOT an account while asserting that accounts
are removable, and passed only because nothing checked identity.

⭐ **A test that only passes because the guard is missing is not coverage of the
feature, it is coverage of the gap.**

### Every "success" in a fixture ran the catch

`web.ask-first-1683.test.js` defined no `document`, and the success path calls
`getElementById` to move focus after the repaint. Measured: a successful two-press
removal ended with `msg.textContent === "document is not defined"`.

The arms above still passed **because they assert what was FETCHED, not what was
SAID**. So the success sentence, the scroll and the focus move were covered by
nothing at any layer. Second dependency that fixture missed, after `acctCancelSay`,
both added in the same diff.

### The rest

- The disabled row's reason lives in its `aria-label` because a `title` on a
  control announced as unavailable is not read out. Deleting it left every web test
  green: the qualifier assertion matches only the label's PREFIX. **The one
  sentence a screen-reader user hears was the one part nothing pinned.**
- The success write was the FOURTH uncancelled writer. The comment claiming EVERY
  writer cancels has now been wrong four times.

### Three of my own tests failed for the wrong reason today

Each looked exactly like a real finding: a regex anchored on `.'` when the text
ends `."`, a comparison that decoded one side and not the other, and a fixture
missing a global. **Check the raw text before believing your own assertion.**

# kosmos#2612: a provider qualifier before the raw directory path

Follow-up to #2584's deferred NIT. Built by April, night shift 2026-09-09.

## The defect

When two **default** accounts from **different providers** share one email (a Claude default in
`~/.claude` and an OpenAI ChatGPT default in `~/.codex`, both `josh@you.com`), the second one's
disambiguating qualifier fell through to its raw directory, so the visible tag and the accessible
name read:

> "Sign in again as josh@you.com (**/Users/josh/.codex**)"

`accountQualifiers` reserves `main` for the first default in a key-group, and a second default has
no label at all (`list()` sets `label: null` for a default), so it went straight to the
collision-proof last resort. Unique and correct; a poor thing to show a person or announce to a
screen reader.

## The fix

One step inserted before the `dir` fallback: prefer a short provider name. Defaults differ BY
provider, which makes the provider the natural disambiguator for exactly this collision.

```
label  ->  provider ("OpenAI" / "Claude")  ->  dir
                 ^ only where the key-group actually spans providers
```

🛑 **THE SCOPING IS PART OF THE FIX, NOT A REFINEMENT, AND I MISSED IT AT FIRST.**
`accountQualifiers` has **three** call sites, and my first version reasoned about one of them.
Settings groups by provider and shows a head; `fillCreateAccounts` and the switch-account menu
filter to a SINGLE provider and show no head, so "(OpenAI)" there says nothing the surrounding
list does not already say, while REPLACING a path that at least identified the row. That is the
#1917 shape ("a real tester could not tell which to pick") which the picker call site exists to
prevent. So the provider name is offered only when the group genuinely holds more than one
provider: informative by construction rather than by which screen happens to be calling.

## Decisions, and what was rejected

**An unknown provider falls through to `dir` rather than being guessed.** The two values the
payload carries are `anthropic` (set in server.js, alongside providerName "Anthropic / Claude") and
`openai` (openaiaccounts.js). Rejected: a ternary defaulting anything not `openai` to "Claude",
which would label a future third provider wrongly. Being wrong about WHICH account this is defeats
the whole point of a qualifier, so the map is explicit and silence means `dir`.

**The short product name, not `providerName`.** This renders inside a parenthetical after the
login, and "(Anthropic / Claude)" carries a slash that reads as a second field.

**Still subject to the used-set, and the comparison is CASE-INSENSITIVE in both branches.** An
earlier version of this paragraph said the default falls back "if another row already took
'OpenAI' as its LABEL", which describes a protection that **can never fire**: every label is
lowercase by construction, since `accounts.dirForLabel` and `openaiaccounts.cleanLabel` both
`.toLowerCase()` and strip to `[a-z0-9-]`. The reachable shape is a label of **"openai"**, which
an exact `Set.has` waves straight through while a screen reader announces it identically to
"OpenAI".

⚠️ **That was a REGRESSION, not merely a gap.** Measured on one email across `~/.claude`,
`~/.codex` and `~/.codex-openai` with exact matching: `["main","OpenAI","openai"]`, three distinct
strings and two distinct sounds. The same three rows BEFORE this card gave
`["main","/home/.codex","openai"]`, which is ugly and audibly distinct.

📌 **And it bites in both orderings, which is why there are two arms.** Fixing only the provider
lookup leaves the real payload order broken: the default is emitted first, takes "OpenAI", and the
labelled row then reaches the LABEL branch where an exact `used.has('openai')` misses. My first fix
did exactly that, and the real-payload arm is what caught it.

**Which row gets the friendly name is first-come, and that is a deliberate non-choice.** In the
rare trio above the default takes "OpenAI" and the labelled row falls to its path, so the row that
HAS a name shows a path. Reserving every row's own label up front would invert it, at the cost of
a self-exclusion pass in a function whose comments already warn about its fragility. The invariant
that matters (distinct, audibly distinct qualifiers) holds either way; which row gets the prettier
one is cosmetic in a case the card itself says does not reproduce on Josh's machine.

## The reserved word `main` is compared case-insensitively too, and that was a live collision

**A label can be a case-variant of `main`, and my first version did not catch it.** `list()` READS
a label straight off the directory basename with no normalisation (`engine/accounts.js:264`,
`engine/openaiaccounts.js:166`); only the CREATE path lowercases (`dirForLabel`, `cleanLabel`). So
a `.claude-Main` directory, makeable by hand or restored from a backup, yields the label "Main".

⚠️ **Reproduced before fixing.** With the row holding `main` in a DIFFERENT key-group (so the
reserved word is not yet taken in this one), the group came out `["Main","main"]`: two distinct
strings, ONE sound. After the fix, `["Claude","main"]`.

🛑 **THE SHAPE MATTERS AND MY FIRST PROBE HAD IT WRONG.** With the default in the SAME group there
is no collision, because the case-insensitive label lookup catches it. A careless fixture shows
nothing, which is why the shape is written into the arm.

📌 **And the comment that used to sit beside those comparisons was itself the defect it warned
about.** It said "nothing can put a case-variant of `main` into `used`, since labels are
lowercase", which is true only of labels this app creates. That is the fourth claim on this
branch I made about another file and got wrong.

## Two things this makes slightly worse, recorded rather than hidden

- **The cross-provider pair's VISIBLE tag repeats the group head.** Settings renders one
  `<section>` per provider with a head (`accountGroupsHtml`), so "(OpenAI)" sits inside a box
  already labelled "OpenAI". It is still the right trade, because the per-control ACCESSIBLE name
  has no head to lean on and that is the surface a screen-reader user actually gets.

  🛑 **AN EARLIER VERSION OF THIS BULLET DESCRIBED SOMETHING THE CODE CANNOT DO, and it survived
  in this file for two iterations.** It said two OpenAI accounts on one email "now read (main) and
  (OpenAI)". They do not: the `providersHere.size > 1` scoping added one section above makes the
  provider step unreachable in a single-provider group. Measured on exactly that fixture:
  `["main","two"]` when the second is labelled and `["main","/h/.codex-x"]` when it is not, never
  `"OpenAI"`. A reviewer swept 12,544 fixture combinations against origin/main's helper and found
  ZERO cases putting a provider name into a single-provider group.
  ⇒ **I wrote the downside before adding the scoping, then added the scoping and never went back
  to the downside it eliminated.** That is the repo's convention 5 in prose form, in the one file
  the next reader would consult to learn whether the scoping works.
- **The cross-provider pair mixes two axes**: "(main)" says which is original, "(OpenAI)" says
  which provider. Somebody hearing "(main)" cannot tell it is the Claude one. "(Claude)" and
  "(OpenAI)" would be more parallel, at the cost of dropping the reserved `main` that the rest of
  this function is built around.

## Weakest premise

That "Claude" and "OpenAI" are the names a person recognises for these two accounts. They are what
the rest of the product calls them, and the provider group heads on the same screen say "Anthropic
/ Claude" and "OpenAI", so a reader sees the long form directly above the short one. If Josh would
rather the qualifier match the group head exactly, it is a one-line change and the arms pin the
value, so it will fail loudly rather than drift.

## Test plan

- `web.account-qualifier.test.js`, **nine** new arms in two groups.
  **The qualifier group (seven):** the OpenAI-second case, the Claude-second mirror, a CONTROL that
  an unknown provider gets the path rather than a guess, the lowercase-label collision in BOTH
  payload orderings, a row labelled literally `main` beside the default (which must keep its
  identifying path, since both rows are Claude and the provider distinguishes nothing there), and
  its mirror proving the same collision in a cross-provider group still gets the provider name, so
  the scoping did not simply disable the feature.
  **The cross-derivation pin (two):** provider-to-short-name is derived in THREE places in
  `web/index.html`, and the repo CLAUDE.md's convention 5 prescribes the remedy when a fact is
  duplicated: "if you must duplicate, add a test that pins them equal". The two short forms must
  agree exactly and the long group-head form must CONTAIN the short one. The pin also asserts the
  disagreement that ALREADY exists (an unknown provider: the two ternaries guess "Claude", the
  qualifier answers ""), which is **kosmos#2634**, so whoever fixes that card sees this arm go red
  and updates it deliberately. Not consolidated here because `qualName` is pinned to its exact
  current form by an existing arm, and folding a three-site refactor into a one-step change makes
  a small reviewable diff broad.
  ⚠️ The pre-existing cross-provider arm asserts only that the two qualifiers DIFFER, which the raw
  `dir` already satisfied, so it passed throughout the defect. Distinctness and readability are
  separate properties and only one was pinned.
  ⚠️ And the pre-existing arm for the `label: 'main'` shape uses a fixture with **no `provider`
  field**, which `/api/accounts` never emits, so it passed unchanged through this card. The
  reachable version is new.
  📌 It did NOT exercise the unknown-provider path, which an earlier version of this sentence
  claimed: with no `provider` on either row `providersHere` is `{''}`, so the provider step is
  never reached at all.
- `docs/browser-checks/render-account-dup-reauth-2584.js`, two new arms on the RENDERED
  aria-labels: neither may contain a path separator, and one must read "(OpenAI)". Measured after:
  `["Sign in again as agent@example.com (main)","Sign in again as agent@example.com (OpenAI)"]`.
- **Seven mutation controls**, each redding exactly the arms it should: reverting to `dir`,
  guessing an unknown provider as "Claude", letting the provider qualifier escape the used-set,
  reverting membership to an exact `Set.has` (reds both ordering arms), fixing ONLY the provider
  lookup rather than both sites (reds the real-payload arm, which is how my own incomplete first
  fix was caught), and the scoping in BOTH directions: `true` reds the single-provider arm and
  `false` reds three cross-provider arms.
- Two drift mutations on the cross-derivation pin: changing one short name and changing the group
  head each red it.

## Iteration 5's deferred NITs, worked 2026-09-10 01:0x

Four of the five were fixed on this branch (commit `efa18395`): the scoping rationale rewritten to
describe the property the code actually tests, `providersHere` folded into the existing one-pass
precompute as `providersByKey`, the browser check's slash test scoped to the qualifier
parenthetical rather than the whole aria-label (plus its pass line corrected to name all three
properties it asserts), and the `#2634` pointer stated at the code per convention 5.

The changed browser-check arm was measured in BOTH directions, since a scope can fail by being too
wide or too narrow and one arm only ever sees one of those:

| control | result |
|---|---|
| mutant: `providerDistinguishes` forced false, so the second default falls to its `dir` | rc=1, and the message now names the qualifier `"/home/.codex"`, not the whole label |
| a slash seeded into `who` (`name: 'work a/b'`) | old whole-label test fires on **2 of 2** names; new qualifier-scoped test fires on **0 of 2** |

### The fifth NIT: I REVERSED my own call, and the reversal is the useful part

The fifth was the plan filename lacking the timestamp the root CLAUDE.md prescribes. I had deferred
it with the reasoning: the reviewer measured 81 of 783 non-proof plans carrying a date-shaped
suffix, so the DOC is the likelier stale half, and the fix belongs in the doc rather than in 700
renames.

**That was wrong, and it was wrong for a reason worth keeping.** Re-measured here:

- Of the last **40** added non-proof plans on `origin/main`, **3** carry a date-shaped suffix.
- **Two of those three landed tonight**, within hours of the convention itself.
- The root `CLAUDE.md` that states the convention (twice, lines 91 and 110) was committed
  **2026-09-09 23:09**, about two hours before I deferred the NIT.

⇒ **A low adoption ratio is exactly what a two-hour-old convention looks like on an old corpus.**
The ratio cannot discriminate between "the doc is stale" and "the doc is new", and I read it as
evidence for the first without checking the second. The discriminating fact was the convention's
AGE, and it was one `git log` away.

**Weakest premise in the corrected reasoning:** I am inferring intent from three files, two of
which are the work of the same night as the convention. If the convention is later reverted or
narrowed, this rename is noise, but it is one file and it costs nothing to undo.

**What I rejected:** renaming the other ~700 plan files (not mine to do, and not on this branch),
and editing CLAUDE.md to match current practice (that would be arguing a two-hour-old deliberate
decision out of existence on the strength of a ratio that cannot support it).

Plan renamed to `.claude/plans/provider-qualifier-2612-20260909T2331.md`, the timestamp taken from
the file's own add-commit rather than from the clock at rename time.

### The `providersByKey` refactor is behaviour-identical, MEASURED

NIT (b) moved the provider set out of a per-row `rows.filter()` into the existing one-pass
precompute. That is a performance change that must not be a behaviour change, and "it is obviously
equivalent" is exactly the kind of claim this branch has been wrong about five times. So it was
swept rather than reasoned: both versions of `accountQualifiers` were extracted (the new one from
the working tree, the old one from `git show 65167cc2:web/index.html`) and run against the same
fixtures over the axes that matter (provider x label x email x isDefault, two rows).

```
combinations swept:                12544
DIFFERENCES old vs new:                0
CONTROL (mutant vs old) differences: 168   <- the sweep CAN see a difference
```

⭐ The control is the load-bearing half. A sweep reporting 0 differences and a sweep that is
structurally blind produce the identical line, so the same harness was re-run against a mutant
(`providerDistinguishes` forced false) and found 168 differences. Without that arm the 0 above
would mean nothing.

Probe kept at `/tmp` deliberately: it compares against a sha that will not survive a rebase, so it
is a measurement of this moment rather than a test worth committing.

## Challenge-loop iteration 6 (sonnet): no BLOCKERs, 1 WARNING, 1 NIT, both real

### The WARNING was a duplicate test wearing a broader comment

The arm named "the same collision in a cross-provider group still gets the provider name" had the
fixture `[claudeDefault, openaiDefault]`, **byte-for-byte the rows of an arm far above it**, so it
re-asserted a subset of that arm while its comment claimed to mirror the `label: 'main'` collision
directly above. **The combined case the comment describes was exercised by nothing.**

⭐ This is the branch's own recurring class, arriving for the sixth time and in its purest form:
**a claim about coverage that nothing backs, where the only thing asserting the coverage is the
comment.** A duplicate is the hardest version to see, because it is green, it is about the right
subject, and its neighbours are real.

Measured what the untested case actually does, then put it in the fixture:

| fixture | result |
|---|---|
| `[claudeDefault, named('main')]` (single-provider) | `["main", "/Users/x/.claude-main"]` |
| `[claudeDefault, named('main'), openaiDefault]` (spans providers) | `["main", "Claude", "OpenAI"]` |

⇒ The pair now shows the actual point: **the same `label: 'main'` row answers its PATH in a
single-provider group and "Claude" in a cross-provider one**, because the provider only becomes a
usable qualifier once the group spans providers. One fixture without the other cannot show that,
which is exactly why a duplicate read as coverage. Added an arm that all three stay audibly
distinct, which the three equalities do not imply.

### The NIT was a correctness defect once measured

The provider id was compared **exact-string** in `providersByKey` and in the ternary, while every
other membership test in this same function was made case-insensitive after being burned twice.

🛑 Not merely an asymmetry. A case-variant id **inflates the provider set**, so
`providerDistinguishes` goes TRUE for a group holding ONE real provider, and a row in it is then
qualified by a provider name that identifies nothing. That is the #1917 shape the scoping was added
to prevent, reached from the opposite direction.

Reproduced, three rows all genuinely Anthropic with one id spelled `"Anthropic"`:

```
exact    -> ["main", "work", "Claude"]                     <- a provider name in a
                                                              single-provider group
control  -> ["main", "work", "/Users/x/.claude-work"]      <- same rows, ids consistent
```

Both sites now lowercase so they agree; silence still means `dir`.

**Reachability traced rather than assumed:** `/api/accounts` rows take their provider from
`server.js` (`'anthropic'` at :4610, `'openai'` at :4696) and from `openaiaccounts.js`'s `PROVIDER`
constant, all lowercase literals. The `provider: 'claude'` at `server.js:4739` is an **error body**
from `POST /api/accounts/claude/apikey`, not an account row, so it never arrives here. ⇒ The new arm
**pins a property rather than guarding a live path**, and #2634 is the moment a third provider could
arrive differently cased. Recorded that way at the code, so nobody later reads it as a live guard.

### Mutation controls, both new arms proven able to fail

```
providersByKey NOT lowercased -> rc=1, reds EXACTLY the new case-variant arm
                                 (actual 'Claude' vs expected '/Users/x/.claude-work')
provider step disabled        -> rc=1, 6 arms red
```

The case-variant arm carries **its own two controls**, because its primary assertion would otherwise
be satisfied by a function that never qualifies by provider at all: a hand-normalised rerun must
agree, and a genuinely cross-provider group must still yield `"OpenAI"`.

📌 **What I got wrong about my own review process here:** the reviewer filed the casing issue as a
NIT and described it as "purely a robustness/consistency nit". I nearly accepted that rating.
Measuring it took two minutes and turned it into a reproducible wrong answer. ⭐ **A severity
label is the reviewer's guess, not a measurement, and the cheap move is to reproduce before
accepting the rating rather than after.**

State: 37 arms (was 36), `bash tools/run-tests.sh` rc=0 with 5580 tests and 0 fail, browser check
green under real playwright. **Not converged**; iteration 7 (opus) running.

## Challenge-loop iteration 7 (opus): no BLOCKERs, 2 WARNINGs, 1 NIT, all three real

### W1: I closed the CASE arm of a class and left the MISSING arm open

The empty-string provider inflated the group's provider set exactly as a case-variant did. Iteration
6 fixed one half of one class and I recorded it as if the class were closed.

```
provider-less row beside a real Anthropic one -> ["main", "Claude"]   <- provider name in a
                                                                        one-real-provider group
control, both rows named anthropic            -> ["main", "/h/.claude-w"]
```

An absent provider is not evidence of a SECOND provider, so it no longer votes; it still falls to
`dir` at the ternary, which is right for a row we cannot name.

⚠️ **This one is reachable FROM THE TESTS though not from `/api/accounts`:** `DEFAULT_ROW`,
`SECOND_ROW` and `OTHER` at the top of the test file all omit `provider`, so mixing one with a
provider-bearing row is a fixture any future author would write without thinking about it.

### W2: the arm I added in iteration 6 to cover this fix covered HALF of it

Iteration 6 added **two** normalisations (the group's provider set, and `provId` at the ternary) and
pinned **one**. Reverting the ternary's `.toLowerCase()` left all 37 arms green, because the
case-variant fixture was all-Anthropic, so `providerDistinguishes` is false and **the ternary is
never reached there**.

⭐ **An arm written to cover a fix can cover half of it and read as complete.** Same class as the
duplicate iteration 6 found, one level in: there the comment overclaimed against the fixture, here
the fixture underreached against the fix.

The shape that reaches the ternary needs the case-variant row **not** to be the first default (or it
takes `main` and never falls through) **and** the group to genuinely span providers (or the provider
step is skipped): an OpenAI default first, then a case-variant Anthropic row.
Measured: `["main","Claude"]` unmutated, `["main","/h/.claude"]` mutated.

### The NIT, where my own measurement CORRECTED the reviewer

The reviewer reported both `main` guards as individually redundant. Two sweeps, and they answer
different questions:

```
110,592 three-row fixtures, OUTPUTS differing from unmutated:
  M1 alone 25088     M2 alone 0      M1+M2 25088
 64,000 of the same fixtures, AUDIBLE COLLISIONS produced:
  base 0   M1 alone 0   M2 alone 0   M1+M2 7680     <- the control
```

⇒ **The reviewer's conclusion holds for the INVARIANT and not for the OUTPUT.** Neither guard alone
can break distinctness, so no arm asserting "no two qualifiers sound alike" can ever red one alone.
But M1 is observable in 25,088 fixtures, so it **can** be pinned by asserting the chosen qualifier
instead of the invariant. That arm now exists and M1 is caught.

📌 **M2 stays genuinely unpinned (0 differences in both sweeps) and the file now says so plainly**
rather than implying the pair-arm holds each guard. **A redundant guard that is honestly labelled
beats a vacuous arm claiming to hold it.** Both sweeps are bounded to three-row fixtures over that
label/provider/default space and are not proofs for all inputs.

⭐ **The transferable bit: "is this guard redundant?" is two questions.** Redundant for the
invariant, and redundant for the output. A single sweep answers whichever one it happened to
measure, and reports it as though it answered both.

### Consolidation, because the duplication had already bitten

The two `provId` derivations are now one `provIdOf` helper. They were separate one-liners for
**exactly one iteration** and drifted immediately, which is precisely what W2 was. Convention 5
names a duplicated fact as this codebase's most-shipped defect. Breaking the single helper now reds
**2** arms, which is the check that the consolidation kept coverage rather than merging it away.

### Mutation battery, 7 single-point mutations against all 40 arms

| # | mutation | before this commit | now |
|---|---|---|---|
| M1 | `main` compare not lowercased | SURVIVED | **caught** |
| M2 | `takenAlready('main')` -> `used.has` | SURVIVED | SURVIVED, measured unobservable |
| M3 | `takenAlready(qual)` -> `used.has` | caught | caught |
| M4 | `takenAlready(prov)` -> `used.has` | caught | caught |
| M6 | `providerDistinguishes := true` | caught | caught, 3 arms |
| M7 | ternary `provId` not lowercased | SURVIVED | **caught** |
| M8 | empty provider re-admitted | n/a | caught |

📌 Each mutation **asserts its target is present exactly once before substituting**, so a mutation
cannot silently no-op and report a false survival. That guard is the reason this battery is worth
anything: a mutation that fails to apply looks exactly like a mutation the tests caught.

State: 40 arms (was 37), `bash tools/run-tests.sh` rc=0 with 5583 tests and 0 fail, browser check
green under real playwright. **Not converged**; iteration 8 (sonnet) running.

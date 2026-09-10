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

- **Inside a SINGLE-provider group the qualifier repeats the group head.** Two OpenAI accounts on
  one email now read "(main)" and "(OpenAI)" under a box already headed "OpenAI", where the second
  previously showed its path and at least said which account it was. It is still the better
  trade: the accessible name has no group head to lean on, and that is the surface a screen-reader
  user actually gets.
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
  field**, which `/api/accounts` never emits, so it exercised only the unknown-provider path and
  passed unchanged through this card. The reachable version is new.
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

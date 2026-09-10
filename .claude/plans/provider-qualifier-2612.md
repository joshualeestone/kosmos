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
```

## Decisions, and what was rejected

**An unknown provider falls through to `dir` rather than being guessed.** The two values the
payload carries are `anthropic` (set in server.js, alongside providerName "Anthropic / Claude") and
`openai` (openaiaccounts.js). Rejected: a ternary defaulting anything not `openai` to "Claude",
which would label a future third provider wrongly. Being wrong about WHICH account this is defeats
the whole point of a qualifier, so the map is explicit and silence means `dir`.

**The short product name, not `providerName`.** This renders inside a parenthetical after the
login, and "(Anthropic / Claude)" carries a slash that reads as a second field.

**Still subject to the used-set**, like every other qualifier in that function. If another row in
the group already took "OpenAI" as its LABEL, the default falls to `dir` rather than sharing a
name, because two controls answering to one accessible name is the defect the whole function
exists to prevent.

## Weakest premise

That "Claude" and "OpenAI" are the names a person recognises for these two accounts. They are what
the rest of the product calls them, and the provider group heads on the same screen say "Anthropic
/ Claude" and "OpenAI", so a reader sees the long form directly above the short one. If Josh would
rather the qualifier match the group head exactly, it is a one-line change and the arms pin the
value, so it will fail loudly rather than drift.

## Test plan

- `web.account-qualifier.test.js`, four new arms: the OpenAI-second case, the Claude-second mirror,
  a CONTROL that an unknown provider gets the path rather than a guess, and one proving a label
  that already took the provider name pushes the default to its path.
  ⚠️ The pre-existing cross-provider arm asserts only that the two qualifiers DIFFER, which the raw
  `dir` already satisfied, so it passed throughout the defect. Distinctness and readability are
  separate properties and only one was pinned.
- `docs/browser-checks/render-account-dup-reauth-2584.js`, two new arms on the RENDERED
  aria-labels: neither may contain a path separator, and one must read "(OpenAI)". Measured after:
  `["Sign in again as agent@example.com (main)","Sign in again as agent@example.com (OpenAI)"]`.
- Three mutation controls, each redding exactly its own arm: reverting to `dir`, guessing an
  unknown provider as "Claude", and letting the provider qualifier escape the used-set.

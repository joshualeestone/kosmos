# Plan: hide the create-agent account dropdown at 1 account, show at 2+ (#2097 re-rule)

## Ruling
Josh re-ruled #2097 (2026-09-04, relayed by Splinter): HIDE the account dropdown
in the create-agent flow when there is only ONE account; SHOW it when there are
2+. His reasoning, firsthand: "if there's only one account then... we don't show
the account dropdown. It's just confusing to people. I watched that firsthand
with Ben. As soon as there's a second account then we should show it, but that
won't be most people."

This SUPERSEDES the earlier in-code "shown even at one" ruling that I honored in
#2119 (PR merged). Fix-forward, his call, documented.

## Change (web/index.html, ships on save + as this PR for Kosmos-team review)
1. `fillCreateAccounts()`: after populating `#create-account`, hide the account
   row unless there are 2+ usable accounts: `arow.hidden = usable.length < 2`.
   - `usable.length` 0 (placeholder-only) or 1 -> hidden (no choice to make).
   - 2+ -> shown. The one usable account is still the select's value, so create
     uses it when hidden. This mirrors the #2098 `create-model-row` hide pattern.
2. Gave the account `.frow` an id `create-account-row` (it previously had none).
3. Rewrote BOTH in-code ruling notes (the account markup note and the
   fillCreateAccounts JS comment) from "shown even at one" to the new ruling, so
   the next person does not re-derive the superseded rule. This is Splinter's
   explicit requirement (2): resolve the card-vs-ruling conflict Josh settled.

## Wiring (verified)
`openCreate()` -> `resetCreateProvider()` -> `applyCreateProviderUI()` ->
`fillCreateAccounts()` -> the hide. So the row is correct on modal open, and the
async account-load path (`loadCreateExtras` -> `fillCreateAccounts`) re-applies it
when accounts arrive (hidden while the list is empty, appears if 2+ load).

## Unaffected (kept, per Splinter)
#2098 model-hide (`create-model-row.hidden = openai`) + the model-why note + the
provider-aware default (`resetCreateProvider` starting on OpenAI only when there
is an OpenAI account and no Claude account). None touched.

## Weakest premise
"One account" means one usable account for the CURRENTLY SELECTED provider (the
list `fillCreateAccounts` builds is already provider-filtered). If Josh meant one
account TOTAL across providers, a user with 1 Claude + 1 OpenAI would see the
dropdown hidden under each provider despite having 2 accounts. I chose
per-provider because the dropdown only ever offers the current provider's
accounts, so "a box with a single entry" is a per-provider condition; and his
"that won't be most people" implies the common case is genuinely one account.
Reversible in a one-line change if he means total.

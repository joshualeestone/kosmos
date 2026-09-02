# #1834: reset the create-agent provider consistently

Follow-up surfaced by the blind review of #1786. Pre-existing, not introduced by #1786.

## The gap

In the create-agent form (`web/index.html`), `create-provider` (the provider dropdown) was
reset by NEITHER `openCreate()` NOR `refillDetails()`'s role-change (`resetDirty`) branch.
#1786 reset the whole step-two field set on a role change and deliberately left the provider
alone, because `openCreate` did not reset it either and resetting in only one place would make
the two paths inconsistent — so it carded the provider as a follow-up (this card).

The latent mismatch: pick role A -> at step two switch provider to OpenAI (the provider
`change` handler disables the model picker and swaps the account menu) -> return to step one
-> pick role B -> Continue. `refillDetails(true)` + `loadCreateExtras()` fire, but the form
still shows OpenAI with the model picker disabled while the rebuilt model menu lists Claude
models.

## Reachability (confirmed in source, not just claimed)

The mismatch is NOT reachable in the current build: the step-two -> step-one Back button was
removed 2026-08-19; `#create-back` calls `showTab('agents')` and exits the flow; the only
in-flow `cstep('role')` calls are `openCreate` (fresh open) and create-go's `!role` bail-out
(which requires no role, the opposite of the scenario). So there is no user-facing path back
to step one that re-picks a role while preserving provider state.

This is therefore a DEFENSIVE fix against a restored Back path — the latent-trap class of
#1801 (checks/fields keyed on a position that a future insert invalidates). The refillDetails
comment already anticipated "a restored Back".

## The fix

- Extract the provider `change`-handler body into a named `applyCreateProviderUI()` (ONE source
  of truth for the side effects: model-picker disabled state, account-menu fill by provider,
  model-why note). The change listener binds it. A second copy of this logic would be the exact
  "second derivation of one fact" inconsistency #1786 scoped out.
- Add `resetCreateProvider()` that sets the markup default (`anthropic`, per the `#create-provider`
  `<select>`) and re-applies the side effects via `applyCreateProviderUI()` — a bare value reset
  would leave the model picker disabled and the account menu stale.
- Call `resetCreateProvider()` from BOTH `openCreate` and `refillDetails`' `resetDirty` branch, so
  the two entry paths stay consistent (the property #1786's comment kept by resetting in neither).
- Correct the now-false comment in refillDetails that said the provider is "deliberately NOT reset".

## Ordering

In refillDetails' resetDirty branch, `resetCreateProvider()` runs BEFORE role-next's
`loadCreateExtras()` rebuilds the model menu. The interim `fillCreateAccounts`/`paintModelWhy`
calls are benign repaints on a step-two panel that loadCreateExtras rebuilds immediately after.

## Coverage

`web.create-provider-reset-1834.test.js` runs the SHIPPED `resetCreateProvider` +
`applyCreateProviderUI` against a fake document (reds on origin/main, where they do not exist),
asserts the reset undoes the OpenAI side effects, and asserts BOTH entry paths call
resetCreateProvider() (the resetDirty branch specifically). `web.create-role-reset-1786.test.js`
gains a no-op resetCreateProvider stub because it slices refillDetails, which now calls it.

## Why a Browser-check trailer, not a docs/browser-checks assertion

The mismatch is unreachable in the current build, so no browser check can drive it, and the
fleet cannot run browser checks (#1769). The commit carries a `Browser-check:` override trailer
with that reason (the #1720 gate accepts it), and the behaviour is covered by the node source
test above.

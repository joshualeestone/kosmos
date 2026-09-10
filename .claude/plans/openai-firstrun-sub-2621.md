# openai-firstrun-sub-2621 — offer "Sign in with ChatGPT" in the first-run install flow

## Problem (Josh, 2026-09-09 product review, #2621)

The installation (first-run) OpenAI connect step is **API-key-only**: after the
runner downloads, it shows `#fr-openai-flow` (a "paste an API key" form). Settings
offers the full **subscription-vs-API-key** choice (#2338/#2433: `#acct-openai-pick`
→ `#acct-openai-sub-step` / `#acct-openai-key-step`, driven by `acctOpenaiChoose`).
First-run Claude already does subscription (frConnectStart OAuth), so the gap is
OpenAI-first-run-specific. Josh: "we're not giving people the option to sign in
with ChatGPT for their subscription like we are in settings … I know we can do it."

Verified by content (origin/main): first-run has no subscription element at all;
`frPaintOpenai` drives only the key form; `#fr-openai-key-t` says "You will need an
OpenAI API key to finish."

## Design — port the Settings sub-vs-key picker into first-run, sharing the engine + driver

### HTML (first-run OpenAI wizard step, near `#fr-openai-flow`)
- Add `#fr-openai-pick` — "Choose how to connect OpenAI": `#fr-openai-pick-sub`
  ("Sign in with ChatGPT") + `#fr-openai-pick-key` ("Use an API key"). Mirror of
  Settings `#acct-openai-pick`.
- Add `#fr-openai-sub-step` — the subscription flow: warn callout, optional label
  (`#fr-openai-sub-label`), `#fr-openai-sub-go`, `#fr-openai-sub-open-row`/`-open`,
  `#fr-openai-sub-code`, `#fr-openai-sub-cancel-row`/`-cancel`. Mirror of Settings
  `#acct-openai-sub-step`.
- `#fr-openai-flow` (the existing key form) is now the "key" branch, revealed by the
  picker rather than directly.

### JS — MIRROR the driver with fr-* ids (decision changed mid-build, see below)
The Settings subscription driver (`acctOpenaiSubShowStart/Stop/Reset/Watch`, the
sub-go start, cancel) is coupled to `acct-openai-sub-*` IDs and ends in
`acctOpenaiSubConnected` → `acctShowSuccess` (a Settings-modal success). First-run's
success is `frPaintOpenai({connected:true})`. So:
- First-run gets its OWN `frOpenaiChoose`/`frOpenaiShowPick`/`frOpenaiSubShowStart`/
  `frOpenaiSubReset`/`frOpenaiSubWatch`/`frOpenaiSubConnected` + pick/sub-go/cancel
  handlers — first-run **mirrors** of the `acctOpenaiSub*` functions with `fr-*` ids.
  This is the SAME mirror pattern first-run already uses for the key form
  (`fr-openai-key` mirrors `acct-openai-key`, `fr-openai-go` mirrors `acct-openai-go`).
- What is genuinely **shared, not copied**: the pure state-mapper
  `acctOpenaiSubView(state)`, the poll teardown `acctOpenaiSubStop`, the module-level
  session state (`ACCT_OPENAI_SUB_SESSION`/`_POLL`, safe on a UI-exclusivity invariant
  — the wizard and the Settings modal are never both live), and the engine routes.
- **Settings code is UNTOUCHED** (not refactored), so the whole risk of breaking the
  critical Settings sign-in via a shared-driver refactor is zero.
- Reveal wiring: the download-complete handler (was `frOpenaiShowKey()` at the
  runner-present tick) now calls `frOpenaiShowPick()`; `frOpenaiShowKey` is removed
  as dead once both call sites move.

### Engine
Unchanged — reuses the shared `/api/accounts/openai/subscription/{start,status,cancel}`
routes and the #2584 reauth-safe driver. `reauthDir` is not used in first-run (fresh
add only), so the start POST omits it.

## Decisions / rejected
- **Chosen: MIRROR the driver with `fr-*` ids (this changed mid-build).** The initial
  plan was to generalize the Settings driver behind an `els` config so there was a
  single implementation. On writing it, two things pointed the other way: (1) first-run
  ALREADY mirrors Settings for the key form (`fr-openai-key`/`fr-openai-go` are copies
  of `acct-openai-key`/`acct-openai-go`), so a mirror is the established, consistent
  pattern here — not a novel duplication; and (2) generalizing would REFACTOR the
  working, tested Settings sign-in (touching `acctOpenaiSubReset`/`Stop`, which have
  external callers: `acctOpenaiChoose`, dialog-close, switch-away), putting a critical
  flow at risk for a payoff the mirror already gets by sharing the pure mapper +
  teardown + session state + engine routes. The residual cost — the DOM/poll wiring
  exists in two thin copies — is bounded and matches the key-form precedent; a change
  to the subscription poll semantics must touch both, which the JS + HTML comments both
  say. The blind review flagged the divergence from this plan; this section is the
  reconciliation (the delivered design is the mirror).
- **Rejected: reuse the Settings modal from within first-run.** First-run is a wizard
  pane, not a modal; opening the Settings modal mid-wizard is visually wrong and
  breaks the wizard's Continue gating.
- **Kept first-run's key-form trade-offs** (one-row key+Add, no Show/Hide) — Josh's
  explicit first-run call (#978); only the subscription branch is added.

## Weakest premise
That the SHARED session state / status element (ACCT_OPENAI_SUB_*, and the poll) is
torn down on EVERY way the person can leave an in-flight sign-in, so a late `connected`
resolve never paints over the pane they moved to. The naive mirror only guarded the
navigate-away-from-step-5 case (the FR_STEP guard); the real premise is broader, and the
missing exits were found in review and closed: switching providers (frCollapseProviders)
and switching branches (frOpenaiChoose) both now call frOpenaiSubAbort() (stop poll +
clear session + reset), mirroring Settings' acctPick switch-away. The one gap Settings
ALSO has (its acctOpenaiChoose does not abort on branch switch) is now closed on this
surface. Guarded by the browser check's teardown arms (navigate-away, and the abort
paths) plus the unchanged Settings sub/openai/firstrun checks + node suite staying green.

## Verification
- New browser check `render-firstrun-openai-sub-2621.js`: drives the first-run OpenAI
  step, asserts the picker offers both, "Use an API key" reveals the key form, "Sign
  in with ChatGPT" reveals the sub-step, and a stubbed subscription/start → connected
  paints the first-run connected box.
- Settings sub tests + the existing openai/firstrun browser checks stay green (the
  driver refactor is behavior-preserving).

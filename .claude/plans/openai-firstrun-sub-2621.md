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

### JS — share the driver, not duplicate it
The Settings subscription driver (`acctOpenaiSubShowStart/Stop/Reset/Watch`, the
sub-go start, cancel) is coupled to `acct-openai-sub-*` IDs and ends in
`acctOpenaiSubConnected` → `acctShowSuccess` (a Settings-modal success). First-run's
success is `frPaintOpenai({connected:true})`. So:
- Generalize the driver functions to take an **element-config `els`** (the sub-step
  element ids + the `msg` element) and an injected **`onConnected(account)`**. The
  pure `acctOpenaiSubView(state)` state-mapper and the module-level session state
  (`ACCT_OPENAI_SUB_SESSION`/`_POLL` — only one sign-in at a time app-wide) are
  already shared and stay so.
- Settings keeps its exact behavior: its handlers call the shared functions with the
  Settings `els` + `acctOpenaiSubConnected`. (Refactor is lookup-only; no behavior
  change — guarded by the existing Settings tests/browser-checks staying green.)
- First-run adds `frOpenaiChoose(which)` (mirror of `acctOpenaiChoose`) +
  `frOpenaiShowPick()`, and binds `#fr-openai-pick-sub/-key`, `#fr-openai-sub-go`,
  `#fr-openai-sub-cancel` to the shared driver with the first-run `els` +
  `frOpenaiSubConnected` (which calls `frPaintOpenai({connected:true, ...})`).
- Reveal wiring: the download-complete handler (currently `frOpenaiShowKey()` at the
  runner-present tick) calls `frOpenaiShowPick()` instead.

### Engine
Unchanged — reuses the shared `/api/accounts/openai/subscription/{start,status,cancel}`
routes and the #2584 reauth-safe driver. `reauthDir` is not used in first-run (fresh
add only), so the start POST omits it.

## Decisions / rejected
- **Rejected: duplicate the whole driver into first-run** (~150 lines). The codebase
  centralizes the subscription poll deliberately (its own comments); a second copy is
  a second source of truth a reviewer would reject. Sharing via an `els` config keeps
  one implementation.
- **Rejected: reuse the Settings modal from within first-run.** First-run is a wizard
  pane, not a modal; opening the Settings modal mid-wizard is visually wrong and
  breaks the wizard's Continue gating.
- **Kept first-run's key-form trade-offs** (one-row key+Add, no Show/Hide) — Josh's
  explicit first-run call (#978); only the subscription branch is added.

## Weakest premise
That generalizing the Settings driver leaves Settings behavior byte-identical. Guarded
by keeping all Settings sub tests + `render-firstrun-openai-connectbox-2241` /
`render-settings-openai-goldbox` / `render-claude-connect-choice-2433` green, plus a
new first-run subscription browser check.

## Verification
- New browser check `render-firstrun-openai-sub-2621.js`: drives the first-run OpenAI
  step, asserts the picker offers both, "Use an API key" reveals the key form, "Sign
  in with ChatGPT" reveals the sub-step, and a stubbed subscription/start → connected
  paints the first-run connected box.
- Settings sub tests + the existing openai/firstrun browser checks stay green (the
  driver refactor is behavior-preserving).

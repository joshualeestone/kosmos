# Plan: #1040 2b-logos final select - enhance #create-provider (provider logo combobox)

## What and why
#1040 2b converts the three native provider `<select>`s to the WAI-ARIA logo combobox
(`enhanceProviderSelect`). Two already shipped on main: `#d-provider` (#2495) and
`#acct-provider-pick`. This adds the LAST one, `#create-provider` (the Create Agent form),
so all three provider menus show the provider marks consistently.

## Scope (measured against origin/main)
- `#create-provider` (~9233) already carries the IDENTICAL roster as the two enhanced
  siblings (anthropic/openai enabled + google/meta/xai/alibaba/moonshot/mistral coming-soon),
  so the combobox renders each mark + the Grok no-mark chip with no markup change.
- The helper is proven on two live selects; this is one more `enhanceProviderSelect('create-provider')`
  call at the shared call site, nothing new invented.
- The create form's own `create-provider` change listener (applyCreateProviderUI, #2097) keeps
  working: the helper commits via `select.value` + a dispatched `change`, which that listener
  already consumes. No node test pins the enhanced-select set; `web.provider-menus.test.js`
  (option agreement) stays valid because the native select + options are preserved.

## NOT in scope (deferred, product-gated)
- 2b-roster (add GLM / MiniMax / DeepSeek) stays deferred to Josh's #770 roster decision.
- Item 8 (create default MODEL) is parked on Mona and touches create-model, not create-provider;
  the create-provider region is stable on main, so there is no rebase entanglement now.

## Verification
- `docs/browser-checks/render-provider-combobox-1040.js`: add `#create-provider` to the
  parametrized SELECTS (claudeVal 'anthropic'); it then runs the full WAI-ARIA contract
  (source-of-truth select hidden + in DOM, open/keyboard-nav/Enter-select/Esc-refocus, coming-soon
  aria-disabled + non-selectable, Grok chip, programmatic re-render, no truncation) over all three,
  both themes. Run headless (chromium+webkit) + CI.
- Full run-tests.sh.

## Decision / routing note
Splinter routed 2b to a claude-fe (Playwright MCP) session for a live a11y pass. This session is
default-mode, but the SHIPPABLE verification is the committed Playwright browser-check (the exact
path #2495 shipped by), run headless here + in CI. A human screen-reader pass remains the
post-cut follow-up no Playwright can replace (noted on the card). Weakest premise: that the
create form's reactive UI (model/account boxes reacting to a provider change) has no interaction
the combobox breaks; mitigated because the helper only re-fires the same `change` the existing
listeners already handle, and render-create-form / render-picker-provider-2097 cover that reactivity.

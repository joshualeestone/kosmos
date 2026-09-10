# acct-provider-combobox-1040: convert #acct-provider-pick to the logo combobox

Piece of kosmos#1040 2b-logos. Routed to Ice Cream Kitty by Splinter (2026-09-08); scoped by Angel,
who owns the umbrella plan `.claude/plans/provider-logo-combobox-1040.md`. #d-provider shipped first
(PR #2495); #create-provider (Item 8 area) stays with Angel. This branch does the middle one:
#acct-provider-pick (the "Add a provider" screen).

## Change (reuse the existing engine, do NOT rebuild)
- `web/index.html`: call `enhanceProviderSelect('acct-provider-pick')` beside the #d-provider call
  (after the function + its consts are initialized; the select and its change listener are defined
  earlier). The engine already falls back to `<label for>` for this labelled-not-aria-label select.
- `web/index.html`: `PROVIDER_MARK_KEY['claude'] = 'claude'`. This select uses the value `claude`
  where #d-provider uses `anthropic`; both name the same provider and get the same `claude` mark.
  Additive; #d-provider never looks up `claude`.
- `web/index.html`: give #acct-provider-pick's coming-soon options the same values as #d-provider
  (google/meta/xai/alibaba/moonshot/mistral) so the combobox renders each mark + Grok's chip. They
  stay `disabled`; this is 2b-logos (marks on existing rows), NOT 2b-roster (#770).
- `web/index.html`: `.pcombo-src` (the visually-hidden utility) uses `!important` like a standard
  .sr-only, so it wins over the enhanced select's container styles. #acct-provider-pick sits in
  `.rm-box-form`, and `.rm-box-form .tk-inp { width:100% }` (0,2,0) beat a plain `.pcombo-src`,
  leaving the native select full-width and overlapping. No effect on #d-provider.
- `docs/browser-checks/render-provider-combobox-1040.js`: parametrize over BOTH selects with a
  `claudeVal` (anthropic vs claude); no new check file, so no EXPECTED_SITES bump.

## Verification
- Headless browser-check (both selects, both themes): PASS (the full WAI-ARIA contract: source of
  truth preserved, keyboard nav, Enter-sync + change, Esc refocus, coming-soon aria-disabled + not
  selectable, Grok chip, no-dispatch re-render, open-popup re-render, no truncation).
- Full web unit suite: 1171/1171. web.accounts-add.test.js's coming-soon assertion updated to allow
  the value (it asserts the CLAIM: a disabled coming-soon provider is listed, per its own comment).

## Weakest premise / accepted residuals
- Adding values to the coming-soon options: safe because they stay disabled (never selected, never
  read by the change handler); the change-handler only acts on claude/openai. Guarded by the full
  web suite + the browser-check.
- Leaving #create-provider to Angel (Item 8 area, no-dispatch .value setters) is deliberate.

# #1040 piece 2b-logos: convert the 3 provider selects to logo comboboxes

Branch: provider-logo-combobox-1040. Owner: Angel (assigned by Splinter 2026-09-08, after Item 8 landed
since 2b touches the shared create-provider region). Mona's full spec is on #1040. Pieces 1 (#2484 marks)
and 2a (#2488 firstrun picker) are merged.

## Scope
- **2b-logos (THIS branch):** convert the three native `<select>`s to custom WAI-ARIA comboboxes that
  show provider logos, via ONE reusable `enhanceProviderSelect(id)`. Ship `#d-provider` first, then
  `#acct-provider-pick`, then `#create-provider`.
- **2b-roster (DEFERRED, NOT here):** adding GLM/MiniMax/DeepSeek to the select rosters is coupled to
  Josh's #770 roster decision (Mona's spec). Do it with #770, not now.

## Targets (current main)
- `#d-provider` (index.html ~7058), change listener ~27774. The settings SWITCH dialog.
- `#acct-provider-pick` (~7840), change listener ~16866. The "Add a provider" screen.
- `#create-provider` (~9138), change listener ~28565. The create-agent dialog.
All three read `.value` and listen to `change` (verified). ALL THREE stay in the DOM as the source of
truth, visually hidden (NOT removed), so `web.provider-menus.test.js` (agreement over the select bodies)
and every existing `.value`/`change` handler keep working unchanged.

## Design (WAI-ARIA APG combobox + listbox, preserves all behavior)
`enhanceProviderSelect(selectId)`:
- Trigger `<button role="combobox" aria-haspopup="listbox" aria-expanded aria-controls=<listboxId>>`
  showing the selected option's `.pmark` mark + label. Inherits the select's `aria-label`/`<label>`.
- Popup `<ul role="listbox" id=<listboxId>>` of `<li role="option" id aria-selected>` mirroring the
  select's `<option>`s: `.pmark` mark + name. A disabled option (`o.disabled`, the coming-soon ones)
  gets `aria-disabled="true"`, a dimmed `.pmark.dim` mark, and a "Coming soon" pill; it is not selectable.
- Keyboard (APG): Down/Up open + move active option; Enter/Space select the active option; Esc close and
  return focus to the trigger; Home/End first/last; type-ahead by first letter; click-outside closes.
  Active option tracked via `aria-activedescendant` on the listbox (focus stays on a focusable container).
- On selection: `select.value = key; select.dispatchEvent(new Event('change', {bubbles:true}))`, then
  update the trigger + `aria-selected`. Every existing handler runs unchanged.
- Re-sync: if code sets `select.value` programmatically (e.g. resetCreateProvider, applyCreateProviderUI),
  the trigger must reflect it. Provide a light re-render the select's own `change`/a MutationObserver, or
  call the widget's refresh from those paths. (Simplest robust: the widget listens to the select's `change`
  too, so a programmatic `dispatchEvent(change)` updates the trigger; verify resetCreateProvider dispatches.)

## Marks
Reuse 2a's `.pmark` pattern (CSS ~5346) + the provider-mark SVGs the firstrun picker uses (inline in the
`#firstrun [data-pmark]` spans, ~8500-8660). **xAI/Grok has NO official mark** -> graceful fallback: a
neutral initial-letter chip (never a wrong-brand lookalike).

### The select-value -> mark-key mapping (the values DIFFER from the firstrun data-pmark keys)
`#d-provider` option values map to firstrun mark keys as: anthropic->claude, openai->openai,
google->gemini, meta->meta, xai->(FALLBACK chip), alibaba->qwen, moonshot->kimi, mistral->mistral.
(2b-roster would later add glm/minimax/deepseek, but those are deferred.) A `PROVIDER_MARK_KEY` map
holds this; the combobox renders the mark for each option by its mapped key.

### Mark SVG source (decision, reversible)
The SVGs live inline in the firstrun picker markup (2a, Mona's), NOT in a reusable JS map, and the
firstrun `#firstrun` block is static HTML so it is always in the DOM. **Decision: at enhance time, build
a mark-node map by CLONING the firstrun `[data-pmark]` SVG spans** (reuses the EXACT marks, zero
duplication, zero change to Mona's 2a rendering). Fragility: the combobox depends on the firstrun markup
being present; acceptable since it is static, and reversible to a shared constant/template later. FYI'd
Mona (her mark lane); if she prefers extracting the marks to a shared source as part of 2b, do that
instead (a cleaner DRY, coordinated). Grok/xai: no clone available -> render an initial-letter chip.

## Tests
- Keep `web.provider-menus.test.js` and `web.mark-theme.test.js` green (hidden selects keep their options;
  no black fills).
- New `docs/browser-checks/render-provider-combobox-1040.js` (hermetic Playwright = the CI browser-checks
  job): closed state shows the selected mark+label; open/close via click + keyboard; ArrowDown/Up move the
  active option and set aria-activedescendant; Enter selects and syncs the hidden select's `.value` + fires
  change; Esc closes and refocuses the trigger; a disabled (coming-soon) option is aria-disabled and NOT
  selectable; the Grok row shows the fallback chip not a wrong mark; a programmatic `select.value=...;
  dispatch(change)` updates the trigger. Both themes. Plus a screenshot for the visual.
- #1720 gate: this is a web/ change; the new browser-check satisfies it (a NEW check needs the 3 bumps:
  tools/browser-checks.sh for-list, reason-grep EXPECTED_SITES/EXPECTED_CATCH_SITES, README row).

## Verification note
The a11y CONTRACT (keyboard/focus/aria/value-sync/disabled) is verified by the hermetic browser-check,
which is the CI Playwright mechanism Mona's spec requires. A real screen-reader pass is a human step no
Playwright (hermetic or MCP) can do. Offered Splinter an interactive claude-fe visual pass on top if wanted.

## Approach: incremental
Build `enhanceProviderSelect` + the CSS + the mark map, apply to `#d-provider` ONLY first, get its
browser-check green + challenge-loop, then extend to the other two selects in the same branch (or a
follow-up) once the pattern is proven. No em dashes.

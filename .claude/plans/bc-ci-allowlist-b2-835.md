# bc-ci-allowlist-b2-835 - expand the per-PR browser-checks CI allowlist (batch 2)

## Source
#835 (cut-efficiency). Batch 2 of the incremental expansion of KOSMOS_BC_CI_ALLOWLIST
in browser-checks.yml, so a break in more render checks fails at the PR, not at the cut.
Batch 1 (#2747, merged) established the mechanism and covered render-engmode-gate-2131,
render-discovery-gate-2651, render-createnav-2190.

## The mechanism (unchanged from batch 1)
KOSMOS_BC_CI_ALLOWLIST is a FILTER over checks the driver already invokes; the three
added here are all in browser-checks.sh's no-board/no-URL loop (run bare, file:// or
self-stubbed fetch, no board, no args), so this is a names-only change. Self-validating:
this PR edits browser-checks.yml (in the job's own path filter), so the expanded set runs
on the runner in THIS PR's CI. A candidate that headless-false-reds or never-runs turns
this PR's own CI red before merge. The CI is the classifier.

## Change
Add three verified DOM-state candidates (read their headers; each reads rendered
hidden-state, not paint/geometry):
- **render-claude-connect-choice-2433** - the Settings > Accounts add-provider modal offers
  Claude the subscription-vs-API-key choice; picking "Use an API key" reveals
  #acct-claude-key-step, "subscription" reveals #acct-claude-sub-step. Asserts which step
  is revealed (hidden-state on click). Its `sized()` helper DOES call
  getBoundingClientRect for a COARSE nonzero-size presence check (width > 0 && height > 0
  on the picker buttons and the key field) - this is the headless-SAFE geometry pattern,
  not fragile geometry: SwiftShader lays out non-zero boxes reliably, so a coarse
  presence check is robust; only exact-pixel / width-band / below-the-fold measurement is
  the fragile class the exclusion list filters out. The same coarse-presence pattern is
  used by batch-1's render-engmode-gate-2131 (its VIS helper asserts r.height > 0), which
  ran green in this exact CI lane (#2747), so this is a proven-safe pattern rather than an
  assumption. The self-validating same-PR CI is the definitive backstop either way.
- **render-picker-provider-2097** - the create-agent picker is provider-aware; reads the
  rendered #create-model-row / #create-account-row HIDDEN state (model select hidden WHOLE
  on OpenAI, account row hidden at one account). Pure hidden-state.
- **render-openai-only-2096** - the "cannot reach a Claude subscription" banner is
  provider-aware; drives the real renderConnection into #conn and reads its rendered
  hidden/text. Pure hidden/text state.

## Excluded while shortlisting this batch (geometry/layout, headless-fragile)
- render-agent-nav / render-settings-nav - "measures by rectangle", theme + width-band
  (56-60rem) responsive measurement; geometry.
- render-frnav-2647 - asserts a control's placement "below the fold" = viewport/scroll
  geometry (its press arm is DOM, but the placement assertion is geometry).

## Verification
- This PR's own browser-checks CI runs the expanded allowlist on the runner. GREEN means
  all three run and pass headless; a RED naming one means drop it and re-push. Merge on green.
- Node unit suite unaffected (yaml-only change); test.yml stays green.

## Weakest premise
That all three run green headless on the runner. If one does not, this PR's own CI catches
it before merge and I drop that name - self-validating, so a wrong pick costs an iteration,
never a bad merge.

# Plan: frcopy-3002 - first-run onboarding error-throw copy consistency

Card: #3002 (follow-up out of #2531, filed + claimed this session)

## Problem (measured on origin/main c2cf75c1f, 2026-09-13)
Two parallel copies of the three account-connect flows exist: the Settings surface
(`acct*`) and the first-run onboarding surface (`fr*`). Settings copies are fully
capitalized in both the thrown-Error fallback and the catch render (#2531's shipped
state). The first-run copies capitalize the catch fallback but leave the throw
fallback lowercase and unpunctuated:

| flow | fr* throw (before) | fr* catch (already right) | Settings throw sibling |
|---|---|---|---|
| sign-in  | :44804 `'we could not start that sign-in'` | :44811 `'We could not start that sign-in.'` | :19998/20004 |
| install  | :44864 `'we could not start that install'` | :44877 `'We could not start that install.'` | :18685 |
| add acct | :44984 `'we could not add that account'`   | :44989 `'We could not add that account.'`   | :19781/19849 |

Each fr* catch renders `err.message` RAW via `textContent`
(`String((err && err.message) || 'We could not ...')`) - no `pjSentence()`, so it does
not capitalize. When a fetch fails with no server `error`/`because`, the thrown lowercase
fallback becomes `err.message` and is shown raw: first-run shows a lowercase, unpunctuated
sentence where Settings shows the capitalized, punctuated one.

## Fix
Capitalize + add the trailing period to the 3 fr* throw fallbacks so they match BOTH
their own catch fallbacks AND the Settings sibling throws. Pure copy, zero behavior
change, no `pjSentence` path involved.

Handlers confirmed by context: `fr-openai-sub-go` (sign-in), `fr-openai-confirm-go`
(install), `fr-openai-go` (add account) - all `fr-` first-run.

## Deliberately out of scope
- The other lowercase `throw new Error(... || 'lowercase')` sites route through
  `pjSentence()` (which capitalizes at render) or belong to separate, internally
  self-consistent flows - CORRECT as-is, not touched. Only the fr* onboarding trio
  had a lowercase throw paired with an already-capitalized catch sibling.
- Server `error`/`because` casing (backend lane; these catches render it raw, separate).

## Weakest premise
That no in-flight branch rewrites the fr* onboarding error copy. Checked #2910 (Angel,
install-permissions screen) - different UI area; `git merge-tree` will catch any real
conflict at PR time.

## Verification
- Diff is exactly 3 lines (confirmed).
- No lowercase onboarding fallback remains in the working tree (confirmed).
- Browser-check: copy-only fault-path change; no rendered-layout or selector impact, so a
  `Browser-check:` trailer covers the #1720 gate.

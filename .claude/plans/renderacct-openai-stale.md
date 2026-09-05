# render-accounts-openai: assert the #2095 chosen-name display, not the key tail

## The problem (fleet-blocking a 6.35 re-cut)

Baron's clean-main re-cut aborted at step 3b on `docs/browser-checks/render-accounts-openai.js`.
#2095 made the human-chosen account name the PRIMARY display in two places, keeping the key last-4
only as a secondary detail. #2095 updated the product and its own check but left sibling assertions
here asserting the old key-tail display, so they went red on correct output.

## Ground truth (verified against the live check, not inferred)

I ran the browser-checks harness against the committed check and read exactly which `say()` lines
failed. Baron's routed diagnosis ("lines 100 + 137-139") was wrong in both directions:

- **Line 100 (add message)** FAILED: the message is now `Added: <chosen name>.` (e.g.
  `Added: Walk Test 49181-sg18.`), not `Added: API key ending WALK`. STALE -> fixed.
- **Lines 137-139 (account row)** PASSED: the row is
  `"Walk Test 49181-sg18 API key ending WALK Signed in Disconnect"` -- #2095 keeps the tail as a
  SECONDARY row detail, so `/API key ending WALK/` still matches. Correct as-is -> left untouched.
- **Line 251 (create-form account menu)** FAILED, and Baron did not name it: the `#create-account`
  options now lead with the chosen name (`["Walk Test 49181-sg18"]`), not the tail. STALE -> fixed.

## The change (browser-check only)

- Line 100: capture the entered label; assert the add message names the chosen account
  (`/Added/` + `msg.includes(walkLabel)`) and never the full key (`!/walkwalk/`, the security half,
  unchanged and load-bearing).
- Line 251: assert the account menu is enabled and offers the account by its chosen name
  (`opts.some((o) => o.includes(walkLabel))`).
- Row assertions unchanged (they pass; the tail is retained as a secondary detail).

No product change, no `web/` change (so the browser-check gate does not apply); only the check's
assertions are brought in line with the shipped #2095 display.

## Verification

The browser-checks harness re-run reports `PASS render-accounts-openai` (both fixed assertions pass,
first attempt, no retry). Baron's step-3b re-runs this check on clean main as the authoritative
re-check.

## Weakest premise

That the two fixed assertions are the complete stale set. Mitigated by reading the live run rather
than the routed summary: exactly two `say()` lines failed (100 + 251), and every other
`/API key ending WALK/` occurrence is a row-based check that passed because the tail survives as a
secondary detail. If a later #2095 follow-up removes that secondary tail, the row assertions would
need the same name-based update; that is out of scope here.

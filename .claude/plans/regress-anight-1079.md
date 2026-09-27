# regress-anight-1079: regress-a-night checks the board again

Card: #1079. Found while triaging it for Splinter, 2026-09-27.

## What was wrong (measured on origin/main bffda5d87)
- `docs/browser-checks/regress-a-night.js` has been a no-op since 2026-09-15: `afd16d894` "TEMP quarantine (revert after
  0.6.67 cut)" prints `PASS  regress-a-night QUARANTINED` and `process.exit(0)` before a browser starts. The real fix
  (Settings moved into the user menu by #3051) sat on `fix-regress-anight-settings-nav` / `closeout-regress-anight`
  (f6e24d946), never merged, no PR, waiting on a browser run nobody did. Every cut since 0.6.67 reported the heaviest
  page check green while it checked nothing.

## Change
1. Cherry-pick f6e24d946 (Baron's closeout): drop the no-op; reach Settings via `#userpop-btn` then `#userpop-settings`.
2. The accounts assertion waits for a row (bounded 20s) instead of a fixed 200ms, since #881 made the list a live,
   multi-second read; on failure it prints what the box said.
3. `tools/browser-checks.sh`: regress-a-night's board (sb1) boots with its OWN sandboxed home holding one
   `night@example.com` default account. Since #3675 (2026-09-25) every fixture board reads a sandboxed home, so the
   assertion could only ever pass by listing the host Mac's real accounts, which #3675 forbids; with the sandbox,
   `/api/accounts` returned `{"accounts":[]}` (measured with a temporary diagnostic, dropped). The run-wide home is
   NOT seeded: other checks expect it to hold no accounts.

## Evidence (headless, the harness itself, `KOSMOS_BC_CI_ALLOWLIST=regress-a-night`, every board booted)
- At the cherry-pick alone: Settings navigation passes; "the accounts list is read, not asserted" FAILS light + dark,
  twice (retried).
- With the wait but no seed (4d9f6f14e): still FAILS, "the box said:" empty (the arm that proves the assertion can fail).
- With the seed (c15cfcdb2): 55 PASS, 0 FAIL, both themes "1 rows", no retry, `all page checks passed`.
- ⚠️ The harness runs a frozen copy of the LAST COMMIT (it logs this); two early reruns tested uncommitted edits that
  never ran. Every result above names the commit it was frozen at.

## Not in this change (left on #1079)
- `render-fields.js:151` still waits `networkidle`. Swapping to `load` as siblings did could shrink what it measures
  (no floor on fields measured) while staying green; not changed without measuring.
- The card's original question (does the rich fixture board cause the retry?) can now be answered by real runs:
  the harness already logs RICH_BOOTED and retries, and regress-a-night does real work again.

## Weakest premise
One headless pass on this Mac under load. The check is timing-sensitive elsewhere (it retried in the card's run).

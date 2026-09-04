# Challenge-loop proof: picker-provider-aware-2097

branch: picker-provider-aware-2097
converged: true
iterations: 7
diff_hash: ca537a2d840866a10b292aac204316a223f1332d547a1c8ffb5f086d81621e65

Cards #2097 + #2098: the create-agent picker in `web/index.html` is made
provider-aware. On OpenAI the model SELECT row is hidden whole with a note in
its place; the provider defaults to OpenAI only when OpenAI is the sole usable
provider, re-applied after the accounts fetch behind a touched sentinel. The
account row stays shown at one account (honoring a documented Josh ruling).

Reviews were run by fresh, blind challenge agents (no knowledge of prior
findings) spawned one per iteration. The orchestrator held the ledger and fixed
each finding. The loop converged when a full independent pass returned zero new
findings (iteration 7).

## Finding ledger (all resolved)

| # | Iter | Category   | File:Line                         | Description                                                                 | Status   | Resolution |
|---|------|------------|-----------------------------------|-----------------------------------------------------------------------------|----------|------------|
| 1 | 2    | BLOCKER    | web/index.html applyCreateProviderUI | "OpenAI picks its own model" note stayed HIDDEN -> empty gap; browser check false-green off textContent of a hidden element | RESOLVED | `why.hidden=false` on OpenAI in applyCreateProviderUI + loadCreateExtras; browser check asserts whyHidden |
| 2 | 3    | CONVENTION | docs/browser-checks/README.md:146 | em dash in the new README index row (violates the no-em-dash rule)           | RESOLVED | Replaced with a hyphen |
| 3 | 3    | WARNING    | web/index.html resetCreateProvider | comment said "connected" but the code checks account presence               | RESOLVED | Comment corrected to "has an account for" |
| 4 | 4    | WARNING    | web/index.html resetCreateProvider | provider-aware default inert on the FIRST create (resetCreateProvider runs before CREATE_ACCOUNTS loads) | RESOLVED | loadCreateExtras re-applies the openai default once the account list lands |
| 5 | 5    | WARNING    | web/index.html loadCreateExtras   | value-equality guard could not tell an untouched default from an import that set 'anthropic'; justifying comment was FALSE (importLoad is a 3rd caller) | RESOLVED | Replaced value-equality with CREATE_PROVIDER_TOUCHED sentinel (cleared by reset, set by the change handler); comment corrected |
| 6 | 5    | CONVENTION | web.picker-provider-2097.test.js  | first-create re-default is source-pin only (async+fetch, not eval-executable) | DEFERRED | Source-pins red on reversion; genuinely hard to unit-test -- documented compromise |
| 7 | 6    | WARNING    | web/index.html fillCreateAccounts | account-row hide (`usable.length<=1`) REVERSED a preserved Josh ruling (markup ~8037: shown even at one account) | RESOLVED | Removed the hide, the id, and the contradicting comment; test now asserts the row is NOT hidden. Flagged his-vs-his to Josh via Splinter (reversible) |
| 8 | 6    | CONVENTION | docs/browser-checks/render-picker-provider-2097.js | browser check reads `.hidden` not computed `display`                        | DEFERRED | `[hidden]{display:none!important}` (index.html:439) makes `.hidden` a real visual hide; check also asserts note text -- minor |

## Per-iteration summary

- **Iteration 1 (baseline):** initial validation; picker fixes + browser check + tests in place.
- **Iteration 2:** BLOCKER (#1) -- note hidden -> empty gap on OpenAI. Fixed and the browser check hardened to assert visibility (it had been false-green reading textContent of a hidden element).
- **Iteration 3:** 0 blocking; 2 non-shipping findings (#2 em dash, #3 wrong comment word). Both fixed (text only).
- **Iteration 4:** 0 blocking; WARNING (#4) first-create default inert. Completed the default in loadCreateExtras.
- **Iteration 5:** 0 blocking; WARNING (#5) the value-equality guard could override an explicit import + a false justifying comment. Replaced with the CREATE_PROVIDER_TOUCHED sentinel. CONVENTION (#6) deferred.
- **Iteration 6:** 0 blocking; sentinel verified exhaustively (no staleness, import ordering robust); WARNING (#7) the account-row hide reversed a documented Josh ruling. Removed the hide to honor the ruling. CONVENTION (#8) deferred.
- **Iteration 7 (converged):** 0 BLOCKING, 0 WARNING, 0 CONVENTION. Account-row removal verified clean (no orphans); holistic re-verification of the note, the model-row hide, the submission guard, the sentinel in both import orderings, non-vacuous tests (red on origin/main), reason-grep counts, README row, and the browser-checks loop. One informational note only (no defect).

## Convergence

Iteration 7 was a full independent blind pass returning zero new findings and no
unresolved ASKED findings, so the loop converged (6d). Two CONVENTIONs are
deliberately deferred with documented reasoning above; iteration 7 did not
re-raise either. The account-row decision is a reversible, Splinter-endorsed
call flagged to Josh for a morning re-rule.

## Validation

`tools/run-tests.sh` -> VAL_EXIT=0 on the final rebased base. Branch node tests
pass; the browser check reds on origin/main (missing `#create-model-row`) and
passes on HEAD. All findings above are resolved or documented-deferred.

---
pre_challenge: true
method: challenge-loop
branch: wkui-jspanels-3309
diff_hash: b9592bca833c29c873cd321ca13a5f05746506274fcb499d1e34643f68e49eeb
validation: passed
subdir_audit: passed
timestamp: 2026-09-19T17:20:26Z
iterations: 4
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 4
**Converged:** Yes (iteration 4: "No issues found")
**Total actionable findings:** 4 WARNINGs, several NITs (0 BLOCKERs, 0 CONVENTIONs)
**Fixed:** all | **Deferred:** none

Model rotation: opus / sonnet / opus / sonnet. Every round found real hardening of the
verification story until the clean pass. All arms were verified by BUILDING the Swift binary
and RUNNING the self-tests + the gate-verdict test, not by inspection - and iterations 3 and 4
each injected a live source perturbation (inverted mapping / swapped buttons) to prove the
guards actually catch it.

### Per-Iteration Breakdown

#### Iteration 1 (opus)
0 BLOCKER, 1 WARNING, 2 NIT.
- WARNING: the production NSAlert.runModal() OK/Cancel->value mapping had no coverage (the
  self-test used stubs). FIXED: extracted the mapping into pure helpers jsConfirmValue/
  jsPromptValue and added self-test arms asserting both responses.
- NIT: prompt field not focused -> added initialFirstResponder. NIT: gate diagnostic (kept to
  match the sibling filepanel gate).

#### Iteration 2 (sonnet)
0 BLOCKER, 2 WARNING, 2 NIT.
- WARNING: the mapping assumed "OK is the first addButton", enforced only by source order and
  untested - a swapped addButton would silently invert confirm/prompt and pass. FIXED: extracted
  the NSAlert construction into makeConfirmAlert/makePromptAlert and added self-test arms asserting
  buttons[0].title == "OK".
- WARNING: no companion gate-verdict test (the repo has shipped case/esac ordering bugs twice; the
  two sibling gates each have one; CLAUDE.md requires tests for behavioral changes). FIXED: added
  tools.jspanels-gate.test.js, which EXTRACTS the gate block by markers and pins its verdict/blame
  logic across 7 cases.
- NITs: nested-runModal safety comment; sharpened the gate's blame message for mapping/button arms.

#### Iteration 3 (opus)
0 BLOCKER, 1 WARNING.
- WARNING: the self-test's own exit code covered only the wiring arms, not the mapping/buttons
  arms - so an inverted mapping printed ":no" yet the binary still exited 0, leaving protection
  only in the (headless-skipped) build gate. FIXED: added all mapping/buttons booleans to the exit
  expression. Verified with an inverted-jsConfirmValue negative control: the binary now exits 1.

#### Iteration 4 (sonnet)
0 BLOCKER, 0 WARNING, 0 CONVENTION, 1 NIT.
**Converged.** The reviewer perturbed the source two ways (inverted mapping, swapped buttons) and
confirmed the binary self-fails (exit 1) each time - the self-fail claim is real, not aspirational.
The lone NIT (the prompt line relied on Swift's guaranteed left-to-right arg evaluation) was a
provably-equivalent 1-line clarity split; applied as finalization polish (no behavior change; both
self-tests still pass).

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status |
|---|------|----------|------|--------|-------------|--------|
| 1 | 1 | WARNING | native-app/main.swift | BRANCH | runModal mapping uncovered | FIXED (pure helpers + arms) |
| 2 | 1 | NIT | native-app/main.swift | BRANCH | prompt field not focused | FIXED |
| 3 | 2 | WARNING | native-app/main.swift | SELF | OK-is-first-button untested | FIXED (builders + arms) |
| 4 | 2 | WARNING | tools/build-kosmos-bundle.sh | BRANCH | no gate-verdict test | FIXED (jspanels-gate.test.js) |
| 5 | 2 | NIT | native-app/main.swift | SELF | nested-runModal note | FIXED |
| 6 | 3 | WARNING | native-app/main.swift | SELF | selftest exit omits mapping arms | FIXED (verified w/ control) |
| 7 | 4 | NIT | native-app/main.swift | SELF | prompt arg-eval-order clarity | FIXED (split) |

### Outstanding questions (ASKED)
None.

### Strengths
- completion-called-exactly-once on every path of all three delegates; runModal (always-answers)
  chosen over the abort-prone beginSheetModal, matching the #2807 rationale.
- The mapping+builder+selftest+exit-code+gate chain closes the OK/Cancel inversion risk end to end,
  proven by live perturbation in two iterations.
- The gate-test extracts the real block by markers (cannot drift), with unique #3309 markers distinct
  from the #1032/#1042 sibling gates; TIMED-OUT ordered before the product arm and pinned by a test.
- Blast-radius audited: the board uses in-DOM kConfirm/showConfirm, zero native dialog calls, so the
  fix is parity + preventive (honestly stated), not a today-broken flow.
- No em dashes in any changed file.

### Known limit (disclosed, not a gap)
No "real NSAlert on screen" self-test arm: runModal is a synchronous nested modal loop that a
headless build box cannot drive-then-dismiss and has no window server to present into. Coverage is
wiring + mapping + button-order + return-value round-trip; the real NSAlert is standard AppKit
exercised the first time a person hits a native dialog. Stated in the code comment and the plan.

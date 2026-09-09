---
method: challenge-loop
branch: surfacemap-grow-2518b
diff_hash: 5683449a7aea4b3d28ea5106bee8eb43244d17e53c0eab637d3b6032888c387c
timestamp: 2026-09-09T05:43:55Z
subdir_audit: passed
---

# Challenge-loop proof: surfacemap-grow-2518b (#2518 batch 2)

Second incremental batch of the browser-check surface map: +13 `// Browser-check-surface: <token>`
annotations across 13 browser-checks, plus a substantial hardening of the validation guard
`tools/test-browser-check-surface-map.sh`. Five blind challenge iterations, reviewer model rotated
across Sonnet (iter 2, 4) and Opus (iter 3, 5) so convergence is witnessed by more than one model.

#### Iteration 1 (findings, all resolved)
- [BLOCKER] `render-first-run` carried token `fr-return`, whose only web occurrence sat on a
  multi-line `<!-- -->` comment CONTINUATION line (a removed feature): dead + over-fire. Fixed:
  swapped to `fr-success` (1 functional, 0 comment).
- [CONVENTION] Guard-vs-seeds policy: the initial comment-free rule failed on Pete's merged seeds
  (pj-parent, pj-alltasks carry functional AND comment occurrences). Resolved by softening to
  require >=1 FUNCTIONAL occurrence (dead tokens hard-FAIL) and TOLERATE a comment mention as
  minor over-fire, consistent with the seeds.
- [BLOCKER] `render-addmem-flash` was dropped here under the strict policy; later found wrong (see
  iteration 2) and restored.

#### Iteration 2 (Sonnet)
- [BLOCKER] Restore `render-addmem-flash` (`pj-one-add-go`): it has 3 functional occurrences
  (id= at web:9727, getElementById at :33617/:37855) + 1 comment mention — the tolerated seed
  shape, and the exact button the check clicks. The iteration-1 drop was the error.
- [BLOCKER] The per-line "does the line start with a marker" classifier missed a comment OPENING
  after real code on the same line (`<markup> <!-- token -->`), false-passing a comment-only
  token. Rewrote `token_web_scan` to be POSITION-ACCURATE (splits each line into code/comment
  halves char-by-char, tracking `<!-- -->` and `/* */` across lines).
- [WARNING] Fragile bare-`*` CSS heuristic and close-then-reopen edge — both eliminated by the
  position-accurate rewrite.
- [CONVENTION] Header claimed "ZERO occurrences inside a comment," contradicting the tolerate gate;
  corrected.

#### Iteration 3 (Opus)
- [WARNING] The `//` URL guard exempted a preceding `"`/`'`, so `x="a"//tok` could false-pass a
  comment-only token (dangerous direction). Fixed: guard `//` on a preceding `:` only.
- [CONVENTION] PASS wording "occurrence(s)" -> "line(s)" (the count is lines-with-a-match).
- Self-found [BLOCKER-class] PERF: the per-token char-walk ran 114s on the 42k-line
  web/index.html (CI-timeout risk fleet-wide). Refactored to `split_halves` (one walk per file,
  then grep each token) -> 9s, identical results. Added trap-based tmpfile cleanup.

#### Iteration 4 (Sonnet)
- [BLOCKER] The one-walk refactor dropped the ERE-metachar escaping the removed `present_in_web`
  had. Restored it with the SAME sed the sibling gate uses; added a red-capable `metachar-escaped`
  control (unescaped `tok.dot` matches `tokXdot`=1, escaped=0).
- [BLOCKER, adjudicated NOT a defect] A reviewer fixture with a quoted `-->`/`*/` inside a comment
  was claimed a false pass. Verified against HTML/JS semantics: comments hold no string literals,
  so `-->`/`*/` end a comment at their FIRST occurrence regardless of quotes — the classifier
  matches the real parser and the gate. The legitimate part was a header overclaim ("never a false
  pass"), now corrected to the precise statement (the sole residual is a stray OPENER in a real
  code string = false FAIL, the safe direction).
- [WARNING, parity-correct] The boundary class treats `-` as a word char (`tok-cont-->`), matching
  the gate's own boundary exactly; fn=0 fails either way, so it changes a message not a verdict.
  Left for gate parity.

#### Iteration 5 (Opus)
- No issues found. Mutation-tested all 10 controls (each flips red under a plausibly-broken
  classifier); confirmed the escaping matches the sibling gate byte-for-byte and all 24 token arms
  are valid (functional occurrence present AND asserted by the declaring check).

### Final Ledger
- Iterations: 5. New findings per iteration: 3, 4, 3, 3, 0. Converged at iteration 5 (zero new
  findings, no unresolved ASKED findings).
- Final guard state: 21 annotated checks (24 token arms) + 10 red-capable synthetic controls, all
  pass in ~9s. Sibling gate (`test-browser-check-surface-gate.sh`) 0 FAILED; `test-zsh-tied-names`
  0 failures. All run from the repo root (the gate reads `docs/browser-checks` via a relative path).
- Scope: check-file annotations + the guard test only. No product code, no web/index.html change.
- Known residual (documented in the guard header): no string tokenizer, so a `/*`/`//` inside a
  quoted code string is read as a real marker — a false FAIL (safe direction), not tripped by any
  current token; the per-check override is the escape hatch.

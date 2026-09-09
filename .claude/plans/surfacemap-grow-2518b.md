# surfacemap-grow-2518b — second incremental batch of the browser-check surface map

## Context (kosmos#2518)
Second map-growth batch on top of the merged mechanism (Pete's #2525 gate + my #2529
validation guard). #2518 stays open as the incremental-map tracker. Each annotation is one
more cut-time check that can no longer stale silently at a PR that touches its surface.

## Change (+13 checks)
Added `// Browser-check-surface: <token>` to 13 browser-checks, one distinctive DOM id each,
every token VERIFIED to have at least one FUNCTIONAL occurrence in web/index.html (an id=,
selector, or getElementById string), low-occurrence (1-6). The primary requirement is
FUNCTIONAL PRESENCE — a token the gate can legitimately fire on; a stray comment mention
alongside is a tolerated minor over-fire (the per-check override clears it), consistent with
the merged seeds:
- render-found-count (fr-foundcount), render-github-door (s-sec-connect),
  render-boot-no-flash (boot-cover), render-composer-reset (pj-post-go),
  render-head-row (pj-room-search), render-detail-header-1841 (d-doctrine-add),
  render-agent-nav (d-nav-talk), render-addmem-flash-2429 (pj-one-add-go),
  render-member-modal (pj-one-agents), render-found-board (found-toggle),
  render-agentpage-fullwidth-2012 (d-sec-talk), emoji-picker-2254 (pj-emoji-btn),
  render-first-run (fr-success).
- Corrected in flight (iteration 1): render-first-run first carried fr-return, whose only web
  occurrence sat on a multi-line `<!-- -->` comment CONTINUATION line (a removed feature) —
  dead + over-fire. Swapped to fr-success (1 functional, 0 comment).
- Corrected in flight (iteration 2): render-addmem-flash was briefly DROPPED under the initial
  strict comment-free policy, then RESTORED once the policy softened to tolerate-over-fire.
  pj-one-add-go has 3 functional occurrences + 1 comment mention — the same shape as the seeds,
  and it is the button the check clicks (line 112). Dropping it was the error, not keeping it.
- render-engmode-gate-2131 (d-qask sits on a comment line) left unannotated for the same reason.

## Validation
- tools/test-browser-check-surface-map.sh (the #2529 guard, ENHANCED this batch): every
  annotated token must have >=1 FUNCTIONAL occurrence (dead tokens hard-FAIL); comment mentions
  alongside are TOLERATED over-fire. The classifier is POSITION-ACCURATE: it splits each line
  into code/comment halves char-by-char (positions preserved), tracking `<!-- -->` and `/* */`
  across lines and guarding `//` against URLs — so a comment on a CONTINUATION line (the
  fr-return case) AND a comment OPENING after real code on the same line (`<markup> <!-- tok -->`,
  the iteration-2 case) both classify the token as comment, not functional. Known residual: no
  string tokenizer, so a bare `/*`/`//` inside a quoted string can desync (risks a false FAIL,
  not a false pass; not tripped by any current token; override is the escape hatch). Carries 8
  synthetic controls proving red-capability across all these shapes. All 21 annotations pass.
- Pete's test-browser-check-surface-gate.sh still passes; annotations preserve trailing newlines.

## Scope / weakest premise
Check-file annotations + the guard test only, no product code, no web/index.html change. Weakest
premise: FUNCTIONAL-presence is the honesty bar; a token could be functional yet sit on a line
that changes for a reason unrelated to the check (rare over-fire, resolved by the per-check
override). The over-fire risk is TOLERATED by design — requiring comment-free would reject most
tokens (this codebase documents ids in comments widely) and break the merged seeds, which
themselves carry comment mentions. Conservative low-count token choice keeps residual over-fire
risk low. Incremental; ~110 checks remain.

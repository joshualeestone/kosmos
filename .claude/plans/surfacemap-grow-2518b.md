# surfacemap-grow-2518b — second incremental batch of the browser-check surface map

## Context (kosmos#2518)
Second map-growth batch on top of the merged mechanism (Pete's #2525 gate + my #2529
validation guard). #2518 stays open as the incremental-map tracker. Each annotation is one
more cut-time check that can no longer stale silently at a PR that touches its surface.

## Change (+13 checks)
Added `// Browser-check-surface: <token>` to 13 browser-checks, one distinctive DOM id each,
every token VERIFIED (by a tighter check than batch 1): present whole-token in web/index.html,
low-occurrence (1-6), and COMMENT-FREE — no occurrence on a `//`, `*` (block-comment
continuation), or `<!--` line, and every occurrence preceded by a selector char (`" ' # .`),
so a prose-wording edit cannot over-fire the gate:
- render-found-count (fr-foundcount), render-github-door (s-sec-connect),
  render-boot-no-flash (boot-cover), render-composer-reset (pj-post-go),
  render-head-row (pj-room-search), render-detail-header-1841 (d-doctrine-add),
  render-agent-nav (d-nav-talk), render-addmem-flash-2429 (pj-one-add-go),
  render-member-modal (pj-one-agents), render-found-board (found-toggle),
  render-agentpage-fullwidth-2012 (d-sec-talk), emoji-picker-2254 (pj-emoji-btn),
  render-first-run (fr-return).
- The tighter check SKIPPED render-engmode-gate-2131 (d-qask sits on a comment line) — the
  block-comment hole batch 1's looser analyzer would have missed. Left coarse.

## Validation
- tools/test-browser-check-surface-map.sh (the #2529 guard): all 21 annotations' tokens present
  whole-token; red-capable; non-vacuous.
- Pete's test-browser-check-surface-gate.sh still passes; annotations preserve trailing newlines.

## Scope / weakest premise
Check-file annotations only, no code, no product change. Weakest premise: distinctiveness is a
low-count + functional-only heuristic; a token could be low-count + functional yet sit on a line
that changes for a reason unrelated to the check (rare over-fire, resolved by the per-check
override). Conservative token choice + the comment-free verify keep that risk low. Incremental;
~110 checks remain for future batches.

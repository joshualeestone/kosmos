# Plan: bc-surface-lib -- extract the shared browser-check surface primitives

## Goal (kosmos#2518 follow-up, no-browser)
End the BYTE-COPY of two primitives shared by the browser-check surface gate and the CI
query helper, so they cannot diverge. Named as a clean follow-up in bc-map-helper.md ("a
clean, lower-risk follow-up for a fresh session; the drift-test makes the copies safe until
then"). Splinter endorsed proceeding 2026-09-09.

## The copy (verified present on origin/main before starting)
Two primitives, byte-identical in both files:
- annotation parse: `sed -n 's|...[Bb]rowser-check-surface:...|\1|p' | head -1`
  (gate:88, map `_bcm_map`:56)
- whole-token boundary match: metachar-escape `sed 's/[][\\.^$*+?(){}|]/\\&/g'` +
  `grep -qE "(^|[^A-Za-z0-9_-])${esc}([^A-Za-z0-9_-]|\$)"`  (gate:121-122, map `_bcm_token_hits`:65-69)

## The change
- NEW `tools/lib/browser-check-surface-lib.sh` exposing the two as `bc_surface_tokens_of <file>`
  and `bc_surface_token_hits <token> <text>`, VERBATIM (byte-preserving move). zsh-safe: no
  `path`/`status` locals, `return` not `exit`, safe under the helper's `set -u`.
- `tools/lib/browser-check-surface-gate.sh` sources the lib (sibling; `${BASH_SOURCE[0]:-$0}`
  resolves its own dir in both bash and zsh), calls the two primitives, drops its inline
  `esc_tok`. Its gate-specific enumeration / updated-check / per-check override logic is UNCHANGED.
- `tools/bc-surface-map.sh` sources the lib (under `lib/`), calls the two primitives, deletes
  its `_bcm_token_hits`. Its `_bcm_covering` diff-shape/web-scoping orchestration is UNCHANGED.
- Comments/plans reframed from "byte-copy, drift-guarded, extraction is a follow-up" to
  "shared function, single source of truth" (both file headers + bc-map-helper.md). The
  drift-detector arms in test-bc-surface-map.sh are KEPT and reframed as a WIRING check (they
  red if either consumer is re-pointed at a local reimplementation).

## Why it is safe (composition-preserving)
- The move is byte-preserving: `bash tools/bc-surface-map.sh map` output is byte-IDENTICAL to
  origin/main (verified). The three suites stay green: gate 12/12, helper 13/13 (incl. the
  drift/wiring arms), meta-guard 63/63, all EXIT=0.
- The self-path idiom `${BASH_SOURCE[0]:-$0}` is the one form that resolves a file's own dir
  under BOTH bash (BASH_SOURCE set) and zsh (a sourced file's $0), the shell mix these are
  used in. Verified by the zsh arms in both suites still passing.

## Weakest premise
If a caller ever sources the gate lib or runs the map helper from a context where neither
`${BASH_SOURCE[0]}` nor `$0` resolves to the file's real path (e.g. an exotic re-exec), the
`. "$(dirname ...)"` would miss the lib. Mitigation: both consumers are only ever invoked as
`bash tools/<x>.sh` / sourced by run-tests.sh from the repo root, and the zsh + integration
arms exercise exactly those paths; a miss would red the suites loudly (the primitives would be
undefined), never silently mis-gate.

## Validate
gate 12 arms, helper 13 arms, meta-guard, full node suite + test:shell. Full challenge-loop
(vary models), proof, 6j, PR (cd LITERAL path), CI, merge.

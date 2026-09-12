# #2860 — Unify board deployment-shape derivation across release and restart

## Problem
`tools/release.sh` (step 10a: refresh the libexec-deployed board before the restart)
and `tools/restart-local-board.sh` (the #360 restart) separately derive the same
board deploy shape from launchd's working directory + `KOSMOS_BOARD_LIBEXEC`. If the
two implementations drift, a release can deploy one shape while the restart classifies
another. Introduced by the #1164 re-visit (`board-deploy-1164`, merged as PR #2873).

## The duplicated derivation (verified on origin/main after #2873)
Both do the same three things:
1. `${KOSMOS_BOARD_LIBEXEC:-$HOME/.local/libexec/kosmos-board}` — the libexec DEST default.
2. Parse the launchd job's working directory: `sed -n 's/^[[:space:]]*working directory = //p' | head -1`.
3. Classify by exact string match: WD == repo-tree → (a); WD == libexec → (b); empty/other → (c).

- restart-local-board.sh (lines ~218, 240-247) distinguishes (a) vs (b) vs other and sets `BOARD_SRC`.
- release.sh (step 10a, ~1544-1548) only acts on (b) (refresh), leaving everything else alone.

## Decision: one shared classifier (remove the duplication)
Create `tools/lib/board-shape.sh` — matching the established `tools/lib/*.sh` pattern
(release.sh already sources cut-guard.sh, cut-rerun-guard.sh, versions-entry.sh, etc.).
Three functions, both callers source it:
- `board_shape_libexec_default` — the libexec DEST, respecting `KOSMOS_BOARD_LIBEXEC`.
- `board_shape_working_dir <launchctl-print-output>` — the `working directory = ` line, or empty. Takes the caller's already-captured `launchctl print` output (restart also needs it for PORT), so no extra launchctl call.
- `board_shape_of <wd> <repo> <libexec>` — echoes `repo | libexec | other`.

Both callers use these, so the two derivations become one and CANNOT drift.

### Deliberate decision on symlinked / normalized paths (the card asks for one)
The comparison stays an **exact string match**, NOT a realpath/pwd -P normalization:
- install-board.sh sets the launchd WorkingDirectory to the SAME string the caller
  passes as `$libexec` (the `KOSMOS_BOARD_LIBEXEC` override, or the identical default),
  so a real libexec board's WD and `$libexec` agree by construction without normalizing.
- Normalizing would (1) turn a FAIL-SAFE no-op into an ACTION for a board whose WD only
  RESOLVES to repo/libexec through a symlink — a behavior change in the release-critical
  cut path — and (2) require the paths to EXIST to canonicalize, which `$libexec` need not.
- If a real launchd-canonicalization divergence is ever observed, THIS one function is the
  single place to add normalization, and both callers get it at once. That centralization
  is the point of the card.

## Rejected
- A parity test across the two scripts (the card's OR alternative). Making each script's
  decision invokable in isolation is nearly the same work as extracting a shared function,
  and the shared function is strictly better: it removes the duplication rather than merely
  detecting drift after the fact. (The classifier still gets a unit test — see below.)
- realpath normalization (documented above).

## Test
`tools/test-board-shape-2860.sh` unit-tests `board_shape_of` (and the WD parse) across:
repo-tree, libexec, foreign path, absent (empty WD = shape c / bundle), and an aliased
(symlinked) path asserting the exact-match decision (an aliased WD that only RESOLVES to
libexec classifies as `other` — the documented deliberate call, red-capable). Wired into
`test:shell`.

## Weakest premise
That macOS launchd reports the WorkingDirectory as the exact configured string, not a
canonicalized one (e.g. `/private/var` vs `/var`). If it canonicalizes, the exact match
could false-negative (a real libexec board classified `other` → left alone). That is a
fail-SAFE direction (no destructive action), and the centralized classifier is exactly
where a normalization fix would land if the divergence is ever measured on a real Mac.

## Scope
Follow-up to #1164 (the destructive-destination case is fixed there / in #2870). This card
removes the duplicate derivation only; no behavior change intended for any current shape.

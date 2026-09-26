# retention-1605: dist retention keep rule + second-copy gate (#1605)

## Goal
Make tools/dist-retention.sh safe to run with --prune: keep what anyone can still need, and delete a
version only when a byte-identical copy of every file in its triple is proven somewhere else.

## Decisions
- Keep rule is a UNION (it only ever adds protection): served, staged, the N most recent PRIOR served
  versions (git history of the pointer, default 3), any other top-level pointer json (rollback), any
  --referenced-by file (default ../versions.html), and the old rolling --keep window (default 12,
  unchanged so existing callers keep their behaviour; --keep 0 gives exactly the #1605 rule).
- Unreadable pointer history fails CLOSED (family not pruned); --prod-history 0 opts out explicitly.
- Second-copy gate: --copy-base is REQUIRED for --prune --yes; full GET + sha256 per file; one
  missing/different file keeps the whole triple. installkosmos.com / chaoskosmos.com and the dist dir
  itself are refused as a base: the site serves the arm64 tarballs from a deploy of this same
  directory (measured 2026-09-26), so it is not a second copy. No default base is hard-coded.
- --check-copies runs the gate in a dry run.

## Measured
- R2 holds Windows zips from 0.6.84 on and NO arm64 tarballs (404, 9.9.9 control 404). So today the
  gate refuses every arm64 candidate: the tool deletes nothing arm64 until a real copy exists.
- Real-R2 control: a scratch dist holding R2's own 0.6.89 zip was proven and pruned; a one-byte-changed
  0.6.88 was refused (DIFFERS) and kept.

## Tests
tools/test-dist-retention.sh: 80 pre-existing checks unchanged in meaning (LEGACY args: fixture mirror
as copy base, --prod-history 0), plus gate and history arms. 10 perturbations of the new guards each
turn the suite red.

## Status
- [x] implementation
- [x] tests + perturbations
- [ ] challenge loop
- [ ] PR, merge, card comment

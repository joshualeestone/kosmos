# Plan: resolve_install_user diagnostic logging (kosmos#3258)

Branch: `instuser-regression-3253` (branch name predates learning #3253 was a
taken/unrelated card; this work addresses **#3258**).

## Problem

Josh's fresh-Mac 0.6.77 install resolved to the WRONG user ("Kosmos is installed
on this computer for another user"). `resolve_install_user` logged only on
REFUSAL, so a mis-install that SUCCEEDED for the wrong user left nothing in
`/var/log/install.log` to say which resolution branch fired. The diagnosis was
blocked purely for lack of that record.

## Change (diagnostic-only, behavior UNCHANGED)

`install/pkg-scripts/resolve-install-user.sh`
- After the owner count is computed, echo the raw resolution inputs to stderr
  (which the pkg captures into `/var/log/install.log`):
  `resolve_install_user: console='<user>' owner_count=<N> owners=[<a,b,...>]`.
  The echo is `>&2`-only, fires before any resolution branch, returns 0, and
  touches no captured value (`INSTALL_USER` / `INSTALL_UID` / return code), so
  every resolution path is byte-for-byte unchanged.
- Add a kosmos#3108 warning comment: do NOT add a "prefer the non-console owner"
  heuristic without reversing #3108's pinned guard. #3108 decided against that
  heuristic and #3169 landed a pinned test guard to keep it out.

`tools/test-resolve-install-user.sh`
- Two new arms pin the log contract (console + owner_count + owners), plus a
  negative control (a single owner logs `owner_count=1`, not 2) so the assertion
  is not matching a constant. Self-contained: re-stubs the owner sensors the
  parse tests overrode.

## Scope / what this deliberately does NOT do

- Does NOT touch `postinstall` (Renet's #3254 work lives there — no collision).
- The real DETECTION fix (owner-anchor for macOS 26 vs `/dev/console`
  multi-account resolution) is HELD pending this log's data from a live install.
  It is NOT an #3108 reversal.

## Test plan

`bash tools/test-resolve-install-user.sh` ends "all checks passed"; full
`yarn test` green.

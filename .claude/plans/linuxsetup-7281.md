# kosmos#7281 slice B: setup.sh installs the Linux family (branch linuxsetup-7281)

The whole plan is in the card's comment 6431703337 and on branch linuxbundle-7281 (.claude/plans/linuxbundle-7281.md).

## Review 1 (2026-10-26 21:5x): 1 blocker, 2 warnings, 3 nits
- BLOCKER FIXED: the family was decided from the network pointer even for a local copy (KOSMOS_SRC); the Linux CI
  job (test-linux-setup-4920) installs the checkout that way with no runtime, so it would break the day the Linux
  pointer publishes. KOSMOS_SRC and KOSMOS_BUNDLE_ARCH now keep the family off (tested).
- WARNING FIXED: a failed read of the Linux pointer downgraded an installed Linux-family copy to the unchecked
  portable bundle. An install whose runtime/bin/node is its own (a regular file that runs) now refuses instead; a
  portable install (node linked to a system one) keeps the transitional fallback (both tested).
- WARNING FIXED: the family needs an a.b.c version in the Linux pointer (not any "version" text), and the body is
  reused by the main pointer read instead of being fetched a second time.
- NIT RECORDED: a first install has no signed check, exactly as a Mac curl|sh install (nothing installed to verify with).
- NIT FIXED with the blocker: KOSMOS_BUNDLE_ARCH turns the family off.
- NIT OPEN (next round): the install-time changes are pinned by source regexes, not run through install_kosmos with
  a file:// release; worth a behavioural test.
- From the review, for slice D: the installed verifier never binds `platform`, so slice D's cross-platform refusal
  must land no later than slice C.
